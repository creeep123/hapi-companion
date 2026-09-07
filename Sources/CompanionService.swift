import Foundation

enum CompanionServiceError: LocalizedError {
    case serverStatus(Int)
    case pairingUnauthorized
    case deviceUnauthorized
    case deliveryDeferred
    case catalogUnsupported

    var errorDescription: String? {
        switch self {
        case .catalogUnsupported: "Hub 尚未支持会话列表；请升级 Companion 集成补丁"
        case .serverStatus(let status): "Hub 返回 HTTP \(status)"
        case .pairingUnauthorized: "HAPI CLI 凭证已失效，请先重新登录 HAPI"
        case .deviceUnauthorized: "设备凭证已失效"
        case .deliveryDeferred: "通知暂时无法显示"
        }
    }
}

private struct AuthResponse: Decodable { let token: String }
private struct RegistrationResponse: Decodable {
    let deviceId: String
    let token: String
}

actor CompanionService {
    typealias EventHandler = @Sendable (CompanionEvent, Int, URL) async -> Bool
    typealias StatusHandler = @Sendable (String) async -> Void

    private let keychain: CompanionCredentialAccess
    private let loadConfiguration: @Sendable () throws -> CompanionConfiguration
    private let defaults: UserDefaults
    private var credentialTask: Task<CompanionCredential, Error>?
    private let session: URLSession
    private var runTask: Task<Void, Never>?
    private var connectionHealthy = false

    init(
        session: URLSession? = nil,
        credentials: CompanionCredentialAccess = .keychain,
        defaults: UserDefaults = .standard,
        configuration: @escaping @Sendable () throws -> CompanionConfiguration = { try CompanionConfiguration.load() }
    ) {
        self.keychain = credentials
        self.defaults = defaults
        self.loadConfiguration = configuration
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 90
        self.session = session ?? URLSession(configuration: configuration)
    }

    func start(onEvent: @escaping EventHandler, onStatus: @escaping StatusHandler) {
        guard runTask == nil else { return }
        runTask = Task {
            var attempt = 0
            while !Task.isCancelled {
                do {
                    let credential = try await ensureCredential()
                    CompanionLog.info("connecting device=\(credential.deviceId.prefix(8))")
                    await onStatus("正在连接 HAPI Hub…")
                    try await consume(credential: credential, onEvent: onEvent, onStatus: onStatus)
                    attempt = 0
                } catch CompanionServiceError.deviceUnauthorized {
                    CompanionLog.error("device credential rejected")
                    try? keychain.delete()
                    await onStatus("设备凭证已失效，将重新配对…")
                    attempt += 1
                    try? await Task.sleep(for: .seconds(min(30, max(2, 1 << min(attempt, 5)))))
                } catch CompanionServiceError.pairingUnauthorized {
                    CompanionLog.error("pairing credential rejected")
                    await onStatus("HAPI 登录已失效；修复 CLI 登录后会自动重试")
                    // A broken master credential must never create a hot authentication loop.
                    try? await Task.sleep(for: .seconds(60))
                } catch is CancellationError {
                    break
                } catch {
                    CompanionLog.error("connection interrupted: \(error.localizedDescription)")
                    if connectionHealthy {
                        attempt = 0
                        connectionHealthy = false
                    }
                    await onStatus("连接中断：\(error.localizedDescription)")
                    let seconds = min(30, max(1, 1 << min(attempt, 5)))
                    attempt += 1
                    try? await Task.sleep(for: .seconds(seconds))
                }
            }
        }
    }

    func stop() {
        runTask?.cancel()
        runTask = nil
        credentialTask?.cancel()
        credentialTask = nil
    }

    func ensureCredential() async throws -> CompanionCredential {
        if let task = credentialTask { return try await task.value }
        let task = Task { try await self.acquireCredential() }
        credentialTask = task
        defer { credentialTask = nil }
        return try await task.value
    }

    private func acquireCredential() async throws -> CompanionCredential {
        let configuration = try loadConfiguration()
        let hubURL = configuration.hubURL
        if let existing = try keychain.load() {
            if CompanionConfiguration.sameOrigin(existing.hubURL, hubURL) {
                return existing
            }
            CompanionLog.info("configured Hub changed; replacing device credential")
            try keychain.delete()
        }

        var authRequest = URLRequest(url: hubURL.appending(path: "api/auth"))
        authRequest.httpMethod = "POST"
        authRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authRequest.httpBody = try JSONEncoder().encode(["accessToken": configuration.cliAPIToken])
        let (authData, authResponse) = try await session.data(for: authRequest)
        guard let authHTTP = authResponse as? HTTPURLResponse, authHTTP.statusCode == 200 else {
            let status = (authResponse as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 { throw CompanionServiceError.pairingUnauthorized }
            throw CompanionServiceError.serverStatus(status)
        }
        let jwt = try JSONDecoder().decode(AuthResponse.self, from: authData).token
        let installationId = defaults.string(forKey: "companionInstallationId") ?? UUID().uuidString
        defaults.set(installationId, forKey: "companionInstallationId")

        var register = URLRequest(url: hubURL.appending(path: "api/companion/devices/register"))
        register.httpMethod = "POST"
        register.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        register.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let deviceName = Host.current().localizedName ?? "Mac"
        register.httpBody = try JSONSerialization.data(withJSONObject: ["installationId": installationId, "name": deviceName])
        let (registerData, registerResponse) = try await session.data(for: register)
        guard let registerHTTP = registerResponse as? HTTPURLResponse, registerHTTP.statusCode == 200 else {
            let status = (registerResponse as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 { throw CompanionServiceError.pairingUnauthorized }
            throw CompanionServiceError.serverStatus(status)
        }
        let result = try JSONDecoder().decode(RegistrationResponse.self, from: registerData)
        CompanionLog.info("paired device=\(result.deviceId.prefix(8))")
        let credential = CompanionCredential(hubURL: hubURL, deviceId: result.deviceId, token: result.token)
        try keychain.save(credential)
        return credential
    }

    private func consume(credential: CompanionCredential, onEvent: @escaping EventHandler, onStatus: @escaping StatusHandler) async throws {
        var request = URLRequest(url: credential.hubURL.appending(path: "companion/events"))
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue(credential.deviceId, forHTTPHeaderField: "X-Hapi-Device-Id")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 { throw CompanionServiceError.deviceUnauthorized }
            throw CompanionServiceError.serverStatus(status)
        }
        connectionHealthy = true
        CompanionLog.info("SSE connected status=200")
        await onStatus("已连接 HAPI Hub")

        var parser = CompanionSSEParser()
        for try await byte in bytes {
            try Task.checkCancellation()
            if let frame = try parser.append(byte) {
                if frame.event == "notification", let eventId = frame.id {
                    let data = Data(frame.data.utf8)
                    let event = try JSONDecoder().decode(CompanionEvent.self, from: data)
                    CompanionLog.info("received seq=\(eventId) event=\(event.eventId.prefix(8))")
                    try await CompanionDeliveryGate.process(
                        event: event,
                        seq: eventId,
                        deliver: { event, seq in await onEvent(event, seq, credential.hubURL) },
                        acknowledge: { [self] seq, id in
                            try await acknowledge(seq, eventId: id, credential: credential)
                        }
                    )
                }
            }
        }
        throw URLError(.networkConnectionLost)
    }

    func fetchCatalog() async throws -> (catalog: CompanionCatalog, hubURL: URL) {
        let credential = try await ensureCredential()
        var request = URLRequest(url: credential.hubURL.appending(path: "companion/sessions"))
        request.timeoutInterval = 15
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue(credential.deviceId, forHTTPHeaderField: "X-Hapi-Device-Id")
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 || status == 501 { throw CompanionServiceError.catalogUnsupported }
        guard status == 200 else { throw CompanionServiceError.serverStatus(status) }
        return (try JSONDecoder().decode(CompanionCatalog.self, from: data), credential.hubURL)
    }

    private func acknowledge(_ seq: Int, eventId: String, credential: CompanionCredential) async throws {
        var request = URLRequest(url: credential.hubURL.appending(path: "companion/ack"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue(credential.deviceId, forHTTPHeaderField: "X-Hapi-Device-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["seq": seq, "eventId": eventId])
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 { throw CompanionServiceError.deviceUnauthorized }
            throw CompanionServiceError.serverStatus(status)
        }
        CompanionLog.info("acknowledged seq=\(seq) event=\(eventId.prefix(8))")
    }
}
