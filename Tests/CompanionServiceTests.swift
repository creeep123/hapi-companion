import XCTest
@testable import HAPI_Companion

private final class ServiceStubState: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: CompanionCredential?
    private var paths: [String] = []
    private var deletes = 0
    private var saves = 0
    let catalogStatus: Int

    init(credential: CompanionCredential?, catalogStatus: Int) {
        stored = credential
        self.catalogStatus = catalogStatus
    }
    func load() -> CompanionCredential? { lock.withLock { stored } }
    func save(_ value: CompanionCredential) { lock.withLock { stored = value; saves += 1 } }
    func delete() { lock.withLock { stored = nil; deletes += 1 } }
    func snapshot() -> (paths: [String], deletes: Int, saves: Int) { lock.withLock { (paths, deletes, saves) } }

    func response(_ request: URLRequest) -> (Int, Data) {
        let path = request.url!.path
        lock.withLock { paths.append(path) }
        switch path {
        case "/api/auth":
            // Keep acquisition suspended while another actor caller enters.
            Thread.sleep(forTimeInterval: 0.05)
            return (200, Data(#"{"token":"fixture-jwt"}"#.utf8))
        case "/api/companion/devices/register":
            return (200, Data(#"{"deviceId":"fixture-device","token":"fixture-device-token"}"#.utf8))
        case "/companion/sessions":
            guard request.value(forHTTPHeaderField: "X-Hapi-Device-Id") == "fixture-device",
                  request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-device-token",
                  request.url?.query == nil else { return (403, Data()) }
            return (catalogStatus, Data(#"{"sessions":[{"id":"session-1","title":"真实会话","updatedAt":123,"active":true}],"capabilities":{"turnDuration":true}}"#.utf8))
        default:
            return (500, Data())
        }
    }
}

private final class ServiceStubRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var states: [String: ServiceStubState] = [:]
    func set(_ state: ServiceStubState?, host: String) { lock.withLock { states[host] = state } }
    func get(host: String) -> ServiceStubState? { lock.withLock { states[host] } }
}

private final class ServiceURLProtocol: URLProtocol, @unchecked Sendable {
    static let registry = ServiceStubRegistry()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let state = Self.registry.get(host: url.host ?? "") else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let (status, body) = state.response(request)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

private final class ServiceFixture: @unchecked Sendable {
    let service: CompanionService
    let state: ServiceStubState
    let hubURL: URL
    private let session: URLSession
    private let defaults: UserDefaults
    private let suite: String

    init(paired: Bool = true, catalogStatus: Int = 200) {
        let host = UUID().uuidString.lowercased() + ".invalid"
        let url = URL(string: "https://\(host)")!
        hubURL = url
        let credential = paired ? CompanionCredential(hubURL: url, deviceId: "fixture-device", token: "fixture-device-token") : nil
        let state = ServiceStubState(credential: credential, catalogStatus: catalogStatus)
        self.state = state
        ServiceURLProtocol.registry.set(state, host: host)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ServiceURLProtocol.self]
        session = URLSession(configuration: configuration)
        suite = "CompanionServiceTests." + UUID().uuidString
        defaults = UserDefaults(suiteName: suite)!
        service = CompanionService(session: session, credentials: CompanionCredentialAccess(
            load: { state.load() }, save: { state.save($0) }, delete: { state.delete() }
        ), defaults: defaults, configuration: { CompanionConfiguration(hubURL: url, cliAPIToken: "fixture-cli") })
    }

    deinit {
        session.invalidateAndCancel()
        defaults.removePersistentDomain(forName: suite)
        ServiceURLProtocol.registry.set(nil, host: hubURL.host!)
    }
}

final class CompanionServiceTests: XCTestCase, @unchecked Sendable {
    func testConcurrentCatalogAndStreamAcquisitionPairOnlyOnce() async throws {
        let fixture = ServiceFixture(paired: false)
        async let streamCredential = fixture.service.ensureCredential()
        async let catalog = fixture.service.fetchCatalog()
        async let secondCredential = fixture.service.ensureCredential()
        let (first, response, second) = try await (streamCredential, catalog, secondCredential)
        XCTAssertTrue(first.token == second.token, "Concurrent callers must receive identical credentials")
        XCTAssertEqual(first.deviceId, "fixture-device")
        XCTAssertEqual(response.catalog.sessions.map(\.id), ["session-1"])
        let snapshot = fixture.state.snapshot()
        XCTAssertEqual(snapshot.paths.filter { $0 == "/api/auth" }.count, 1)
        XCTAssertEqual(snapshot.paths.filter { $0 == "/api/companion/devices/register" }.count, 1)
        XCTAssertEqual(snapshot.paths.filter { $0 == "/companion/sessions" }.count, 1)
        XCTAssertEqual(snapshot.saves, 1)
        XCTAssertEqual(snapshot.deletes, 0)
    }

    func testExistingCredentialLookupDoesNotFetchCatalogAndCatalogUsesDeviceAuth() async throws {
        let fixture = ServiceFixture()
        _ = try await fixture.service.ensureCredential()
        XCTAssertTrue(fixture.state.snapshot().paths.isEmpty)
        let result = try await fixture.service.fetchCatalog()
        XCTAssertEqual(result.hubURL, fixture.hubURL)
        XCTAssertTrue(result.catalog.capabilities.turnDuration)
        let session = try XCTUnwrap(result.catalog.sessions.first)
        XCTAssertEqual(session.title, "真实会话")
        XCTAssertNil(session.machineName)
        XCTAssertEqual(session.updatedAt, 123)
        XCTAssertTrue(session.active)
        XCTAssertEqual(fixture.state.snapshot().paths, ["/companion/sessions"])
    }

    func testUnsupportedOrUnauthorizedCatalogNeverInvalidatesCredential() async throws {
        for status in [404, 501, 401] {
            let fixture = ServiceFixture(catalogStatus: status)
            do {
                _ = try await fixture.service.fetchCatalog()
                XCTFail("Expected catalog error")
            } catch CompanionServiceError.catalogUnsupported {
                XCTAssertTrue(status == 404 || status == 501)
            } catch CompanionServiceError.serverStatus(let received) {
                XCTAssertEqual(received, 401)
                XCTAssertEqual(status, 401)
            }
            let retained = try await fixture.service.ensureCredential()
            XCTAssertEqual(retained.deviceId, "fixture-device")
            let snapshot = fixture.state.snapshot()
            XCTAssertEqual(snapshot.deletes, 0)
            XCTAssertEqual(snapshot.saves, 0)
            XCTAssertEqual(snapshot.paths, ["/companion/sessions"])
        }
    }
}
