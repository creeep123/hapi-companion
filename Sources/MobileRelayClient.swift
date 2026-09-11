import Foundation

private final class MobileRelaySessionDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) { completionHandler(nil) }
}

enum MobileRelayError: LocalizedError, Equatable {
    case invalidEndpoint
    case unauthorized
    case conflict(Int)
    case server(Int)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidEndpoint: "Relay 地址必须是有效的 HTTPS 地址"
        case .unauthorized: "Relay 配对已失效，请重新配对"
        case .conflict: "手机规则已在别处更新"
        case .server(let code): "Relay 返回 HTTP \(code)"
        case .invalidResponse: "Relay 返回了无法识别的数据"
        }
    }
}

enum MobileRelayAttentionCode: String, Decodable, Equatable, Sendable {
    case hubUnauthorized = "hub_unauthorized"
    case hubContractInvalid = "hub_contract_invalid"
    case hubStreamUnavailable = "hub_stream_unavailable"
    case hubStreamEnded = "hub_stream_ended"
    case hubAckConflict = "hub_ack_conflict"
    case hubAckUnavailable = "hub_ack_unavailable"
    case ntfyInvalidURL = "ntfy_invalid_url"
    case ntfyRateLimited = "ntfy_rate_limited"
    case ntfyTemporaryFailure = "ntfy_temporary_failure"
    case ntfyConfigurationError = "ntfy_configuration_error"
    case ntfyInvalidResponse = "ntfy_invalid_response"
    case networkTemporaryFailure = "network_temporary_failure"
}

enum MobileRelayActivationStatus: String, Decodable, Equatable, Sendable { case committed, rejected }
enum MobileRelayStreamStatus: String, Decodable, Equatable, Sendable { case stopped, connecting, connected, attention }
enum MobileNotificationContentMode: String, Codable, Equatable, Sendable { case fixed, eventPreview }

struct MobileRelayStatus: Decodable, Equatable, Sendable {
    struct Capabilities: Decodable, Equatable, Sendable {
        var notificationContentModes: [MobileNotificationContentMode] = []
        private enum CodingKeys: String, CodingKey { case notificationContentModes }
        init(notificationContentModes: [MobileNotificationContentMode] = []) { self.notificationContentModes = notificationContentModes }
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            notificationContentModes = try values.decodeIfPresent([MobileNotificationContentMode].self, forKey: .notificationContentModes) ?? []
        }
    }
    struct Activation: Decodable, Equatable, Sendable { let status: MobileRelayActivationStatus; let activationId: String }
    struct Health: Decodable, Equatable, Sendable {
        let stream: MobileRelayStreamStatus
        let lastAckSeq: Int?
        let latestNtfyAcceptanceAt: Double?
        var attentionCode: MobileRelayAttentionCode? = nil
    }
    var revision: Int
    var enabled: Bool
    var paused: Bool
    var activation: Activation?
    var health: Health
    var capabilities: Capabilities = .init()

    private enum CodingKeys: String, CodingKey { case revision, enabled, paused, activation, health, capabilities }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        revision = try values.decode(Int.self, forKey: .revision)
        enabled = try values.decode(Bool.self, forKey: .enabled)
        paused = try values.decode(Bool.self, forKey: .paused)
        activation = try values.decodeIfPresent(Activation.self, forKey: .activation)
        health = try values.decode(Health.self, forKey: .health)
        capabilities = try values.decodeIfPresent(Capabilities.self, forKey: .capabilities) ?? .init()
    }

    init(revision: Int, enabled: Bool, paused: Bool, activation: Activation?, health: Health, capabilities: Capabilities = .init()) {
        self.revision = revision; self.enabled = enabled; self.paused = paused
        self.activation = activation; self.health = health; self.capabilities = capabilities
    }

    var lastNtfyAcceptedAt: Date? { health.latestNtfyAcceptanceAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
    var streamConnected: Bool { health.stream == .connected }
    var lastAckSequence: Int? { health.lastAckSeq }
}

struct MobileRelayPairResponse: Codable, Sendable { let managementToken: String }

struct MobileRelayPolicy: Codable, Equatable, Sendable {
    let scope: String
    let selectedSessionIds: [String]
    let keywords: [String]
    let durationEnabled: Bool
    let minimumMinutes: Int
    let quietEnabled: Bool
    let quietStartMinutes: Int
    let quietEndMinutes: Int
    let quietMode: String
    let timeZone: String

    init(_ value: ReminderPreferences, timeZone: TimeZone = .current) {
        let value = value.normalized()
        scope = value.scope.rawValue
        selectedSessionIds = value.selectedSessionIDs.sorted()
        keywords = value.keywords
        durationEnabled = value.durationEnabled
        minimumMinutes = value.minimumMinutes
        quietEnabled = value.quietEnabled
        quietStartMinutes = value.quietStartMinutes
        quietEndMinutes = value.quietEndMinutes
        quietMode = value.quietMode.rawValue
        self.timeZone = timeZone.identifier
    }
}

struct MobileRelayConfiguration: Codable, Sendable {
    let receiverId: String
    let ntfyBaseUrl: String
    let topic: String
    let hapiOrigin: String
    let revision: Int
    let policy: MobileRelayPolicy
    var contentMode: MobileNotificationContentMode = .fixed
}

struct MobileRelayActivation: Codable, Sendable {
    let activationId: String
    let installationId: String
    let deviceId: String
    let token: String
    let revision: Int
}

struct MobileRelayRepair: Codable, Sendable {
    let activationId: String
    let installationId: String
    let deviceId: String
    let token: String
}

private struct RevisionResponse: Decodable { let revision: Int }
private struct OKResponse: Decodable { let ok: Bool }
private struct TestResponse: Decodable { let accepted: Bool }
private struct ActivationResponse: Decodable { let status: String }
private struct ConfigEnvelope: Encodable { let expectedRevision: Int; let config: MobileRelayConfiguration }

struct MobileRelayAPI: Sendable {
    var pair: @Sendable (URL, String) async throws -> MobileRelayPairResponse
    var status: @Sendable (URL, String, String?) async throws -> MobileRelayStatus
    var configure: @Sendable (URL, String, MobileRelayConfiguration, Int) async throws -> Int
    var test: @Sendable (URL, String, String) async throws -> Void
    var activate: @Sendable (URL, String, MobileRelayActivation) async throws -> Void
    var pause: @Sendable (URL, String, Bool) async throws -> Void
    var repair: @Sendable (URL, String, MobileRelayRepair) async throws -> Void
    var resume: @Sendable (URL, String) async throws -> Void
    var remove: @Sendable (URL, String) async throws -> Void
    var unpair: @Sendable (URL, String) async throws -> Void

    static func live(_ client: MobileRelayClient = MobileRelayClient()) -> Self {
        Self(
            pair: { try await client.pair(endpoint: $0, code: $1) },
            status: { try await client.status(endpoint: $0, token: $1, activationId: $2) },
            configure: { try await client.configure(endpoint: $0, token: $1, configuration: $2, expectedRevision: $3) },
            test: { try await client.test(endpoint: $0, token: $1, sessionId: $2) },
            activate: { try await client.activate(endpoint: $0, token: $1, activation: $2) },
            pause: { try await client.pause(endpoint: $0, token: $1, paused: $2) },
            repair: { try await client.repair(endpoint: $0, token: $1, repair: $2) },
            resume: { try await client.resume(endpoint: $0, token: $1) },
            remove: { try await client.remove(endpoint: $0, token: $1) },
            unpair: { try await client.unpair(endpoint: $0, token: $1) }
        )
    }
}

actor MobileRelayClient {
    private let session: URLSession
    init(session: URLSession? = nil) {
        if let session { self.session = session }
        else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.waitsForConnectivity = true
            configuration.timeoutIntervalForRequest = 15
            self.session = URLSession(configuration: configuration, delegate: MobileRelaySessionDelegate(), delegateQueue: nil)
        }
    }

    func pair(endpoint: URL, code: String) async throws -> MobileRelayPairResponse {
        try await request(endpoint: endpoint, path: "v1/pair", method: "POST", token: nil, body: ["code": code])
    }

    func status(endpoint: URL, token: String, activationId: String? = nil) async throws -> MobileRelayStatus {
        var components = URLComponents(url: endpoint.appending(path: "v1/status"), resolvingAgainstBaseURL: false)!
        if let activationId { components.queryItems = [URLQueryItem(name: "activationId", value: activationId)] }
        return try await request(url: components.url!, method: "GET", token: token, body: Optional<String>.none)
    }

    func configure(endpoint: URL, token: String, configuration: MobileRelayConfiguration, expectedRevision: Int) async throws -> Int {
        let response: RevisionResponse = try await request(endpoint: endpoint, path: "v1/config", method: "PUT", token: token, body: ConfigEnvelope(expectedRevision: expectedRevision, config: configuration))
        return response.revision
    }

    func test(endpoint: URL, token: String, sessionId: String) async throws {
        let response: TestResponse = try await request(endpoint: endpoint, path: "v1/test", method: "POST", token: token, body: ["sessionId": sessionId])
        guard response.accepted else { throw MobileRelayError.invalidResponse }
    }

    func activate(endpoint: URL, token: String, activation: MobileRelayActivation) async throws {
        let response: ActivationResponse = try await request(endpoint: endpoint, path: "v1/activate", method: "POST", token: token, body: activation)
        guard response.status == "committed" else { throw MobileRelayError.invalidResponse }
    }

    func pause(endpoint: URL, token: String, paused: Bool) async throws {
        let response: OKResponse = try await request(endpoint: endpoint, path: "v1/pause", method: "POST", token: token, body: ["paused": paused])
        guard response.ok else { throw MobileRelayError.invalidResponse }
    }

    func repair(endpoint: URL, token: String, repair: MobileRelayRepair) async throws {
        let response: OKResponse = try await request(endpoint: endpoint, path: "v1/repair", method: "POST", token: token, body: repair)
        guard response.ok else { throw MobileRelayError.invalidResponse }
    }

    func resume(endpoint: URL, token: String) async throws {
        let response: OKResponse = try await request(endpoint: endpoint, path: "v1/resume", method: "POST", token: token, body: Optional<String>.none)
        guard response.ok else { throw MobileRelayError.invalidResponse }
    }

    func remove(endpoint: URL, token: String) async throws {
        let response: OKResponse = try await request(endpoint: endpoint, path: "v1/receiver", method: "DELETE", token: token, body: Optional<String>.none)
        guard response.ok else { throw MobileRelayError.invalidResponse }
    }

    func unpair(endpoint: URL, token: String) async throws {
        let response: OKResponse = try await request(endpoint: endpoint, path: "v1/unpair", method: "POST", token: token, body: Optional<String>.none)
        guard response.ok else { throw MobileRelayError.invalidResponse }
    }

    private func request<Response: Decodable, Body: Encodable>(endpoint: URL, path: String, method: String, token: String?, body: Body?) async throws -> Response {
        guard endpoint.scheme?.lowercased() == "https", endpoint.host != nil,
              endpoint.user == nil, endpoint.password == nil, endpoint.query == nil, endpoint.fragment == nil,
              endpoint.path.isEmpty || endpoint.path == "/" else { throw MobileRelayError.invalidEndpoint }
        return try await request(url: endpoint.appending(path: path), method: method, token: token, body: body)
    }

    private func request<Response: Decodable, Body: Encodable>(url: URL, method: String, token: String?, body: Body?) async throws -> Response {
        guard url.scheme?.lowercased() == "https", url.host != nil else { throw MobileRelayError.invalidEndpoint }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 || status == 403 { throw MobileRelayError.unauthorized }
        if status == 409 {
            guard let revision = try? JSONDecoder().decode(RevisionResponse.self, from: data).revision else {
                throw MobileRelayError.invalidResponse
            }
            throw MobileRelayError.conflict(revision)
        }
        guard (200..<300).contains(status) else { throw MobileRelayError.server(status) }
        guard let result = try? JSONDecoder.mobileRelay.decode(Response.self, from: data) else { throw MobileRelayError.invalidResponse }
        return result
    }
}

private extension JSONDecoder {
    static var mobileRelay: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
