import XCTest
@testable import HAPI_Companion

private final class RelayRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [URLRequest] = []
    func append(_ value: URLRequest) { lock.withLock { values.append(value) } }
    func requests() -> [URLRequest] { lock.withLock { values } }
}

private final class RelayURLProtocol: URLProtocol, @unchecked Sendable {
    static let recorder = RelayRequestRecorder()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var recorded = request
        if recorded.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
            recorded.httpBody = data
        }
        Self.recorder.append(recorded)
        let path = request.url!.path
        let body: String
        switch path {
        case "/v1/pair": body = #"{"managementToken":"secret"}"#
        case "/v1/status": body = #"{"revision":3,"enabled":true,"paused":false,"activation":{"status":"committed","activationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},"health":{"stream":"attention","lastAckSeq":8,"latestNtfyAcceptanceAt":1788768000000,"attentionCode":"ntfy_configuration_error"},"capabilities":{"notificationContentModes":["fixed","eventPreview"]}}"#
        case "/v1/config": body = #"{"revision":4}"#
        case "/v1/test": body = #"{"accepted":true}"#
        case "/v1/activate": body = #"{"status":"committed"}"#
        case "/v1/pause", "/v1/resume", "/v1/receiver": body = #"{"ok":true}"#
        default: body = #"{"error":"unexpected"}"#
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: path.hasPrefix("/v1/") ? 200 : 404, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class InvalidRelayResponseProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        let body: String
        switch path {
        case "/v1/test": body = #"{"accepted":false}"#
        case "/v1/activate": body = #"{"status":"pending"}"#
        case "/v1/status": body = #"{"revision":1,"enabled":false,"paused":false,"activation":null,"health":{"stream":"attention","attentionCode":"secret_server_detail"}}"#
        default: body = #"{"ok":false}"#
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class ConflictRelayResponseProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let malformed = request.url?.host == "malformed.relay.example"
        let body = malformed ? #"{"error":"revision conflict"}"# : #"{"error":"revision conflict","revision":17}"#
        let response = HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class MobileRelayClientTests: XCTestCase, @unchecked Sendable {
    func testWireContractUsesBearerEnvelopeRealSessionAndActivationRecoveryQuery() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RelayURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = MobileRelayClient(session: session)
        let endpoint = URL(string: "https://relay.example")!
        _ = try await client.pair(endpoint: endpoint, code: "pair-code")
        let status = try await client.status(endpoint: endpoint, token: "management", activationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        XCTAssertEqual(status.lastAckSequence, 8)
        XCTAssertFalse(status.streamConnected)
        XCTAssertEqual(status.health.attentionCode, .ntfyConfigurationError)
        XCTAssertEqual(status.capabilities.notificationContentModes, [.fixed, .eventPreview])
        let config = MobileRelayConfiguration(
            receiverId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ntfyBaseUrl: "https://ntfy.sh",
            topic: "hapi-0123456789abcdef0123456789abcdef", hapiOrigin: "https://hapi.example", revision: 4,
            policy: MobileRelayPolicy(ReminderPreferences(), timeZone: TimeZone(identifier: "Asia/Shanghai")!)
        )
        let configuredRevision = try await client.configure(endpoint: endpoint, token: "management", configuration: config, expectedRevision: 3)
        XCTAssertEqual(configuredRevision, 4)
        try await client.test(endpoint: endpoint, token: "management", sessionId: "real/session")
        try await client.pause(endpoint: endpoint, token: "management", paused: true)
        try await client.resume(endpoint: endpoint, token: "management")

        let requests = RelayURLProtocol.recorder.requests()
        let statusRequest = try XCTUnwrap(requests.first { $0.url?.path == "/v1/status" })
        XCTAssertEqual(URLComponents(url: statusRequest.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.name, "activationId")
        XCTAssertEqual(statusRequest.value(forHTTPHeaderField: "Authorization"), "Bearer management")
        let configJSON = try XCTUnwrap(try JSONSerialization.jsonObject(with: try XCTUnwrap(requests.first { $0.url?.path == "/v1/config" }?.httpBody)) as? [String: Any])
        XCTAssertEqual(configJSON["expectedRevision"] as? Int, 3)
        let nested = try XCTUnwrap(configJSON["config"] as? [String: Any])
        XCTAssertEqual(nested["revision"] as? Int, 4)
        XCTAssertEqual(nested["contentMode"] as? String, "fixed")
        XCTAssertEqual((nested["policy"] as? [String: Any])?["timeZone"] as? String, "Asia/Shanghai")
        let testJSON = try XCTUnwrap(try JSONSerialization.jsonObject(with: try XCTUnwrap(requests.first { $0.url?.path == "/v1/test" }?.httpBody)) as? [String: String])
        XCTAssertEqual(testJSON["sessionId"], "real/session")
        let pauseJSON = try XCTUnwrap(try JSONSerialization.jsonObject(with: try XCTUnwrap(requests.first { $0.url?.path == "/v1/pause" }?.httpBody)) as? [String: Bool])
        XCTAssertEqual(pauseJSON["paused"], true)
        XCTAssertEqual(requests.first { $0.url?.path == "/v1/resume" }?.httpMethod, "POST")
    }

    func testRejectsNonHTTPSBeforeNetwork() async {
        let client = MobileRelayClient(session: .shared)
        do { _ = try await client.pair(endpoint: URL(string: "http://relay.example")!, code: "code"); XCTFail("Expected rejection") }
        catch MobileRelayError.invalidEndpoint { }
        catch { XCTFail("Unexpected \(error)") }
    }

    func testRejectsFalseAcknowledgementsAndUnknownAttentionCode() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [InvalidRelayResponseProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = MobileRelayClient(session: session)
        let endpoint = URL(string: "https://relay.example")!
        do { try await client.test(endpoint: endpoint, token: "management", sessionId: "session"); XCTFail("Expected false acceptance rejection") }
        catch MobileRelayError.invalidResponse { }
        let activation = MobileRelayActivation(activationId: UUID().uuidString, installationId: UUID().uuidString, deviceId: UUID().uuidString, token: String(repeating: "s", count: 48), revision: 1)
        do { try await client.activate(endpoint: endpoint, token: "management", activation: activation); XCTFail("Expected non-committed rejection") }
        catch MobileRelayError.invalidResponse { }
        do { _ = try await client.status(endpoint: endpoint, token: "management"); XCTFail("Expected unknown attention rejection") }
        catch MobileRelayError.invalidResponse { }
        do { try await client.resume(endpoint: endpoint, token: "management"); XCTFail("Expected false ok rejection") }
        catch MobileRelayError.invalidResponse { }
    }

    func testStatusRejectsUnknownActivationAndStreamEnums() throws {
        let unknownActivation = #"{"revision":1,"enabled":false,"paused":false,"activation":{"status":"pending","activationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},"health":{"stream":"stopped"}}"#
        XCTAssertThrowsError(try JSONDecoder().decode(MobileRelayStatus.self, from: Data(unknownActivation.utf8)))
        let unknownStream = #"{"revision":1,"enabled":false,"paused":false,"activation":null,"health":{"stream":"secret_internal_state"}}"#
        XCTAssertThrowsError(try JSONDecoder().decode(MobileRelayStatus.self, from: Data(unknownStream.utf8)))
        let legacy = #"{"revision":1,"enabled":false,"paused":false,"activation":null,"health":{"stream":"stopped"}}"#
        let legacyStatus = try JSONDecoder().decode(MobileRelayStatus.self, from: Data(legacy.utf8))
        XCTAssertTrue(legacyStatus.capabilities.notificationContentModes.isEmpty)
    }

    func testConflictResponseReadsRevisionFromHeterogeneousErrorBody() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ConflictRelayResponseProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = MobileRelayClient(session: session)
        let config = MobileRelayConfiguration(
            receiverId: UUID().uuidString, ntfyBaseUrl: "https://ntfy.sh",
            topic: "hapi-0123456789abcdef0123456789abcdef", hapiOrigin: "https://hapi.example", revision: 2,
            policy: MobileRelayPolicy(ReminderPreferences())
        )
        do {
            _ = try await client.configure(endpoint: URL(string: "https://relay.example")!, token: "management", configuration: config, expectedRevision: 1)
            XCTFail("Expected conflict")
        } catch MobileRelayError.conflict(let revision) {
            XCTAssertEqual(revision, 17)
        }
        do {
            _ = try await client.configure(endpoint: URL(string: "https://malformed.relay.example")!, token: "management", configuration: config, expectedRevision: 1)
            XCTFail("Expected malformed conflict rejection")
        } catch MobileRelayError.invalidResponse { }
    }
}
