import AppKit
import Foundation
import Observation
import Security

enum MobileSetupStage: Equatable, Sendable {
    case relayNotPaired
    case readyToAdd
    case awaitingPhone
    case awaitingRotation
    case activationUncertain
    case active
    case paused
    case removalIncomplete
}

@MainActor
@Observable
final class MobileNotificationController {
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let secrets: MobileRelaySecretAccess
    @ObservationIgnored private let api: MobileRelayAPI
    @ObservationIgnored private let registerDevice: @Sendable (String, String) async throws -> RegistrationResponse
    @ObservationIgnored private let deleteDevice: @Sendable (String) async throws -> Void
    @ObservationIgnored private var hubURL: URL?
    @ObservationIgnored private var storedSecrets: MobileRelaySecrets?
    @ObservationIgnored private var currentPreferences = ReminderPreferences()
    @ObservationIgnored private var pendingPreferences: ReminderPreferences?
    @ObservationIgnored private var syncingRules = false
    @ObservationIgnored private var knownRelayRevision: Int?

    var endpointText = ""
    var pairingCode = ""
    var privacyAccepted = false
    var stage: MobileSetupStage = .relayNotPaired
    var busy = false
    var message: String?
    var relayReachable = false
    var rulesState = "尚未同步"
    var localPolicyRevision = 0
    var syncedPolicyRevision: Int?
    var syncedAt: Date?
    var syncedTimeZone: String?
    var lastNtfyAcceptedAt: Date?
    var streamConnected = false
    var lastAckSequence: Int?
    var attentionCode: MobileRelayAttentionCode?
    var conflictRevision: Int?
    var conflictDeferred = false
    var testAccepted = false
    var keychainUnavailable = false
    var contentMode: MobileNotificationContentMode = .fixed
    private(set) var pendingContentMode: MobileNotificationContentMode?
    var supportsEventPreview = false
    var contentModeState = "使用固定隐私文案"
    private(set) var eventPreviewConsentGranted = false

    init(
        defaults: UserDefaults = .standard,
        secrets: MobileRelaySecretAccess = .keychain,
        api: MobileRelayAPI = .live(),
        registerDevice: @escaping @Sendable (String, String) async throws -> RegistrationResponse,
        deleteDevice: @escaping @Sendable (String) async throws -> Void
    ) {
        self.defaults = defaults
        self.secrets = secrets
        self.api = api
        self.registerDevice = registerDevice
        self.deleteDevice = deleteDevice
    }

    var relayPaired: Bool { storedSecrets != nil }
    var hasPhone: Bool { storedSecrets?.topic != nil }
    var subscriptionAddress: String? {
        guard let topic = storedSecrets?.topic else { return nil }
        return "ntfy://ntfy.sh/\(topic)"
    }
    var topicName: String? { storedSecrets?.topic }
    var topicForQRCode: String? { subscriptionAddress }
    var enabled: Bool { stage == .active }
    var needsHubRepair: Bool { attentionCode == .hubUnauthorized }
    var canResume: Bool { attentionCode != nil && !needsHubRepair }
    var attentionMessage: String? {
        switch attentionCode {
        case .hubUnauthorized: "Hub 授权已失效，请修复 Relay 设备连接"
        case .hubContractInvalid: "Hub 返回的数据格式不兼容，请检查 Hub 补丁版本"
        case .hubStreamUnavailable: "Hub 通知流暂时不可用"
        case .hubStreamEnded: "Hub 通知流已中断"
        case .hubAckConflict: "Hub 确认进度发生冲突"
        case .hubAckUnavailable: "Hub 暂时无法确认通知进度"
        case .ntfyInvalidURL: "ntfy 服务地址配置无效"
        case .ntfyRateLimited: "ntfy 请求过多，请稍后恢复"
        case .ntfyTemporaryFailure: "ntfy 服务暂时不可用"
        case .ntfyConfigurationError: "ntfy 配置需要检查"
        case .ntfyInvalidResponse: "ntfy 返回的数据无法识别"
        case .networkTemporaryFailure: "网络暂时不可用"
        case nil: nil
        }
    }

    func enqueueSync(preferences: ReminderPreferences) {
        currentPreferences = preferences
        pendingPreferences = preferences
        guard !syncingRules else { return }
        syncingRules = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            while let next = pendingPreferences {
                pendingPreferences = nil
                while busy { try? await Task.sleep(for: .milliseconds(100)) }
                await sync(preferences: next)
            }
            syncingRules = false
        }
    }

    func configure(hubURL: URL, preferences: ReminderPreferences) {
        self.hubURL = hubURL
        currentPreferences = preferences
        let scope = storageScope(hubURL)
        endpointText = defaults.string(forKey: key("endpoint", scope)) ?? ""
        do { storedSecrets = try secrets.load(scope); keychainUnavailable = false }
        catch {
            storedSecrets = nil
            keychainUnavailable = true
            message = "无法读取钥匙串中的 Relay 配置，请检查钥匙串访问后重试"
        }
        localPolicyRevision = defaults.integer(forKey: key("policyRevision", scope))
        knownRelayRevision = defaults.object(forKey: key("relayRevision", scope)) == nil ? nil : defaults.integer(forKey: key("relayRevision", scope))
        contentMode = MobileNotificationContentMode(rawValue: defaults.string(forKey: key("contentMode", scope)) ?? "") ?? .fixed
        pendingContentMode = defaults.string(forKey: key("pendingContentMode", scope)).flatMap(MobileNotificationContentMode.init(rawValue:))
        contentModeState = contentMode == .eventPreview ? "已开启，仅影响后续通知" : "使用固定隐私文案"
        let savedStage = defaults.string(forKey: key("stage", scope))
        if storedSecrets == nil { stage = .relayNotPaired }
        else if storedSecrets?.topic == nil { stage = .readyToAdd }
        else if savedStage == "active" { stage = .active }
        else if savedStage == "paused" { stage = .paused }
        else if savedStage == "activationUncertain" { stage = .activationUncertain }
        else if savedStage == "awaitingRotation" { stage = .awaitingRotation }
        else if savedStage == "removalIncomplete" { stage = .removalIncomplete }
        else { stage = .awaitingPhone }
    }

    func pairRelay() async {
        guard !busy else { return }
        guard privacyAccepted else { message = "请先阅读并同意 ntfy.sh 隐私说明"; return }
        guard let endpoint = validatedEndpoint(), !pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            message = "请填写 Relay 的 HTTPS 地址和一次性配对码"; return
        }
        await perform {
            let response = try await api.pair(endpoint, pairingCode.trimmingCharacters(in: .whitespacesAndNewlines))
            let value = MobileRelaySecrets(managementToken: response.managementToken, topic: nil, pendingActivation: nil)
            try saveSecrets(value)
            pairingCode = ""
            stage = .readyToAdd
            message = "Relay 已配对，可以添加手机"
            await refreshStatus()
        }
    }

    func addPhone(preferences: ReminderPreferences) async {
        guard !busy, let endpoint = validatedEndpoint(), var value = storedSecrets else { return }
        await perform {
            value.topic = try Self.randomTopic()
            try saveSecrets(value)
            testAccepted = false
            rulesState = "尚未同步"
            stage = .awaitingPhone
            saveStage("awaitingPhone")
            currentPreferences = preferences
            let status = try await api.status(endpoint, value.managementToken, nil)
            _ = try await pushConfiguration(endpoint: endpoint, secrets: value, expectedRevision: status.revision)
            message = "请在 ntfy 中订阅，然后发送测试手机通知"
        }
    }

    func testPhone(sessionId: String) async {
        guard !busy, let endpoint = validatedEndpoint(), let value = storedSecrets, value.topic != nil else { return }
        guard !sessionId.isEmpty else { message = "需要一个 HAPI 会话才能测试准确跳转"; return }
        await perform {
            try await api.test(endpoint, value.managementToken, sessionId)
            await refreshStatus()
            testAccepted = true
            message = "ntfy 已接收；请在手机上确认通知已经显示并能打开会话"
        }
    }

    func confirmPhone() async {
        guard !busy, let endpoint = validatedEndpoint(), let value = storedSecrets, value.topic != nil, let hubURL else { return }
        guard testAccepted else { message = "请先发送测试手机通知并确认 ntfy 已接收"; return }
        if stage == .awaitingRotation {
            await setEnabled(true)
            if stage == .active, var updated = storedSecrets {
                updated.rotationPreviousTopic = nil
                do { try saveSecrets(updated) }
                catch { message = "手机通知已恢复，但无法清理旧订阅地址记录：\(error.localizedDescription)" }
            }
            return
        }
        await perform {
            let installationId = relayInstallationId(for: hubURL)
            let relayStatus = try await api.status(endpoint, value.managementToken, nil)
            let registration = try await registerDevice(installationId, "HAPI Companion Mobile Relay")
            setCleanupDeviceId(registration.deviceId)
            do {
                let activationId = UUID().uuidString
                let activation = MobileRelayActivation(
                    activationId: activationId, installationId: installationId,
                    deviceId: registration.deviceId, token: registration.token, revision: relayStatus.revision
                )
                do { try savePendingActivation(activation) }
                catch {
                    if await cleanupHubDevice(registration.deviceId) { throw error }
                    return
                }
                do { try await api.activate(endpoint, value.managementToken, activation) }
                catch {
                    let recovered = try? await api.status(endpoint, value.managementToken, activationId)
                    guard recovered?.activation?.status == .committed else {
                        if recovered?.activation?.status == .rejected {
                            guard await cleanupHubDevice(registration.deviceId) else { return }
                            try clearPendingActivation()
                            stage = .awaitingPhone
                            saveStage("awaitingPhone")
                            throw error
                        }
                        stage = .activationUncertain
                        saveStage("activationUncertain")
                        message = "启用结果暂时无法确认；已保留现场，连接恢复后可继续确认"
                        return
                    }
                }
                try completeActivation(deviceId: registration.deviceId, activationId: activationId)
                clearCleanupDeviceId()
            }
        }
    }

    func setEnabled(_ enabled: Bool) async {
        guard !busy, let endpoint = validatedEndpoint(), let value = storedSecrets else { return }
        await perform {
            try await api.pause(endpoint, value.managementToken, !enabled)
            stage = enabled ? .active : .paused
            saveStage(enabled ? "active" : "paused")
            await refreshStatus()
            message = enabled ? "手机通知已启用" : "手机通知已停用；停用期间的提醒不会补发"
        }
    }

    func sync(preferences: ReminderPreferences, force: Bool = false) async {
        currentPreferences = preferences
        guard !busy, hasPhone, let endpoint = validatedEndpoint(), let value = storedSecrets else { return }
        busy = true
        defer { busy = false }
        localPolicyRevision += 1
        persistPolicyRevision()
        rulesState = "正在同步"
        do {
            let status = try await api.status(endpoint, value.managementToken, nil)
            apply(status)
            let expected = force ? (conflictRevision ?? status.revision) : (knownRelayRevision ?? status.revision)
            _ = try await pushConfiguration(endpoint: endpoint, secrets: value, expectedRevision: expected, contentMode: pendingContentMode ?? contentMode)
            finalizePendingContentMode()
            conflictRevision = nil
            conflictDeferred = false
        } catch MobileRelayError.conflict(let revision) {
            conflictRevision = revision
            conflictDeferred = false
            rulesState = "同步冲突，请选择如何处理"
        } catch {
            rulesState = "同步失败，手机仍使用上次规则"
            message = error.localizedDescription
        }
    }

    func deferConflict() {
        guard conflictRevision != nil else { return }
        conflictDeferred = true
        rulesState = "同步冲突，手机暂时继续使用上次规则"
    }

    func setContentMode(_ requested: MobileNotificationContentMode) async {
        guard !busy, hasPhone, let endpoint = validatedEndpoint(), let value = storedSecrets else { return }
        if requested == .eventPreview && !supportsEventPreview {
            contentModeState = "Relay 版本不支持，请先升级 Relay"
            return
        }
        if requested == .eventPreview && !eventPreviewConsentGranted {
            contentModeState = "请先确认公共 ntfy 隐私说明"
            return
        }
        guard requested != contentMode else { return }
        pendingContentMode = requested
        persistPendingContentMode()
        busy = true
        defer { busy = false }
        contentModeState = "正在同步"
        do {
            let status = try await api.status(endpoint, value.managementToken, nil)
            guard requested == .fixed || status.capabilities.notificationContentModes.contains(.eventPreview) else {
                supportsEventPreview = false
                contentModeState = "Relay 版本不支持，请先升级 Relay"
                return
            }
            _ = try await pushConfiguration(endpoint: endpoint, secrets: value, expectedRevision: knownRelayRevision ?? status.revision, contentMode: requested)
            contentMode = requested
            persistContentMode()
            clearPendingContentMode()
            contentModeState = requested == .eventPreview ? "已开启，仅影响后续通知" : "已关闭，仅影响后续通知；既有通知不会被删除"
        } catch MobileRelayError.conflict(let revision) {
            conflictRevision = revision
            conflictDeferred = false
            contentModeState = contentMode == .fixed ? "同步冲突，手机仍使用固定隐私文案" : "同步冲突，手机仍显示标题和摘要"
        } catch {
            contentModeState = contentMode == .fixed ? "同步失败，手机仍使用固定隐私文案" : "同步失败，手机仍显示标题和摘要"
            message = error.localizedDescription
        }
    }

    func grantEventPreviewConsent() { eventPreviewConsentGranted = true }

    func refreshStatus() async {
        guard let endpoint = validatedEndpoint(), let value = storedSecrets else { return }
        do {
            if stage == .activationUncertain, let pending = pendingActivation() {
                let status = try await api.status(endpoint, value.managementToken, pending.activationId)
                if status.activation?.status == .committed { try completeActivation(deviceId: pending.deviceId, activationId: pending.activationId) }
                else if status.activation?.status == .rejected {
                    guard await cleanupHubDevice(pending.deviceId) else { return }
                    try clearPendingActivation()
                    stage = .awaitingPhone; saveStage("awaitingPhone")
                    message = "上次启用未完成，请再次确认手机"
                } else {
                    let activation = MobileRelayActivation(
                        activationId: pending.activationId, installationId: pending.installationId,
                        deviceId: pending.deviceId, token: pending.token, revision: pending.revision
                    )
                    try await api.activate(endpoint, value.managementToken, activation)
                    try completeActivation(deviceId: pending.deviceId, activationId: pending.activationId)
                }
                apply(status)
            } else { apply(try await api.status(endpoint, value.managementToken, nil)) }
        }
        catch { relayReachable = false; message = error.localizedDescription }
    }

    func removePhone() async {
        guard !busy, let endpoint = validatedEndpoint(), var value = storedSecrets else { return }
        await perform {
            try await api.remove(endpoint, value.managementToken)
            let pendingDeviceId = value.pendingActivation?.deviceId
            if let hubURL, let deviceId = cleanupDeviceId() ?? defaults.string(forKey: key("deviceId", storageScope(hubURL))) ?? pendingDeviceId {
                do { try await deleteDevice(deviceId) }
                catch {
                    stage = .removalIncomplete; saveStage("removalIncomplete")
                    throw error
                }
                defaults.removeObject(forKey: key("deviceId", storageScope(hubURL)))
                defaults.removeObject(forKey: key("activationId", storageScope(hubURL)))
                clearCleanupDeviceId()
            }
            value.topic = nil
            value.pendingActivation = nil
            value.rotationPreviousTopic = nil
            try saveSecrets(value)
            knownRelayRevision = nil
            if let hubURL { defaults.removeObject(forKey: key("relayRevision", storageScope(hubURL))) }
            stage = .readyToAdd
            saveStage("readyToAdd")
            message = "手机已移除"
        }
    }

    func disconnectRelay() async {
        guard !busy, !hasPhone, let endpoint = validatedEndpoint(), let value = storedSecrets, let hubURL else { return }
        await perform {
            try await api.unpair(endpoint, value.managementToken)
            try secrets.delete(storageScope(hubURL))
            storedSecrets = nil
            endpointText = ""
            defaults.removeObject(forKey: key("endpoint", storageScope(hubURL)))
            stage = .relayNotPaired
            message = "Relay 已断开"
        }
    }

    func repairDevice() async {
        guard !busy, let endpoint = validatedEndpoint(), let value = storedSecrets, let hubURL,
              let activationId = defaults.string(forKey: key("activationId", storageScope(hubURL))) else { return }
        await perform {
            let installationId = relayInstallationId(for: hubURL)
            let registration = try await registerDevice(installationId, "HAPI Companion Mobile Relay")
            let repair = MobileRelayRepair(
                activationId: activationId, installationId: installationId,
                deviceId: registration.deviceId, token: registration.token
            )
            try await api.repair(endpoint, value.managementToken, repair)
            defaults.set(registration.deviceId, forKey: key("deviceId", storageScope(hubURL)))
            await refreshStatus()
            message = "Relay 设备连接已修复"
        }
    }

    func resumeNotifications() async {
        guard !busy, canResume, let endpoint = validatedEndpoint(), let value = storedSecrets else { return }
        await perform {
            try await api.resume(endpoint, value.managementToken)
            await refreshStatus()
            message = "已请求恢复手机通知"
        }
    }

    func rotateTopic(preferences: ReminderPreferences) async {
        guard !busy, stage == .active, let endpoint = validatedEndpoint(), var value = storedSecrets else { return }
        await perform {
            try await api.pause(endpoint, value.managementToken, true)
            let status = try await api.status(endpoint, value.managementToken, nil)
            value.rotationPreviousTopic = value.topic
            value.topic = try Self.randomTopic()
            try saveSecrets(value)
            testAccepted = false
            rulesState = "尚未同步"
            stage = .awaitingRotation
            saveStage("awaitingRotation")
            currentPreferences = preferences
            _ = try await pushConfiguration(endpoint: endpoint, secrets: value, expectedRevision: knownRelayRevision ?? status.revision)
            message = "已停止向旧订阅地址发送；请订阅新地址并测试"
        }
    }

    func cancelOnboarding() async {
        guard !busy, let endpoint = validatedEndpoint(), var value = storedSecrets else { return }
        await perform {
            if stage == .awaitingRotation, let previous = value.rotationPreviousTopic {
                let status = try await api.status(endpoint, value.managementToken, nil)
                value.topic = previous
                value.rotationPreviousTopic = nil
                try saveSecrets(value)
                _ = try await pushConfiguration(endpoint: endpoint, secrets: value, expectedRevision: status.revision)
                try await api.pause(endpoint, value.managementToken, false)
                stage = .active
                saveStage("active")
                message = "已取消更换，继续使用原订阅地址"
            } else if stage == .awaitingPhone {
                try await api.remove(endpoint, value.managementToken)
                value.topic = nil
                value.rotationPreviousTopic = nil
                try saveSecrets(value)
                stage = .readyToAdd
                saveStage("readyToAdd")
                message = "已取消添加手机"
            }
            testAccepted = false
        }
    }

    func copyTopicName() {
        guard let topicName else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(topicName, forType: .string)
        message = "主题名称已复制；在 ntfy 的“主题名称”框中粘贴即可，请勿分享"
    }

    func timeZoneChanged() async {
        guard hasPhone else { return }
        await sync(preferences: currentPreferences)
    }

    private func pushConfiguration(endpoint: URL, secrets: MobileRelaySecrets, expectedRevision: Int, contentMode: MobileNotificationContentMode? = nil) async throws -> Int {
        guard let hubURL, let topic = secrets.topic else { throw MobileRelayError.invalidResponse }
        if localPolicyRevision == 0 { localPolicyRevision = 1; persistPolicyRevision() }
        let config = MobileRelayConfiguration(
            receiverId: relayInstallationId(for: hubURL),
            ntfyBaseUrl: "https://ntfy.sh",
            topic: topic,
            hapiOrigin: Self.origin(hubURL),
            revision: expectedRevision + 1,
            policy: MobileRelayPolicy(currentPreferences),
            contentMode: contentMode ?? self.contentMode
        )
        let revision = try await api.configure(endpoint, secrets.managementToken, config, expectedRevision)
        knownRelayRevision = revision
        persistRelayRevision(revision)
        rulesState = "规则已同步"
        syncedPolicyRevision = localPolicyRevision
        syncedAt = Date()
        syncedTimeZone = TimeZone.current.identifier
        return revision
    }

    private func apply(_ status: MobileRelayStatus) {
        relayReachable = true
        if knownRelayRevision == nil { knownRelayRevision = status.revision; persistRelayRevision(status.revision) }
        lastNtfyAcceptedAt = status.lastNtfyAcceptedAt
        streamConnected = status.streamConnected
        lastAckSequence = status.lastAckSequence
        attentionCode = status.health.attentionCode
        supportsEventPreview = status.capabilities.notificationContentModes.contains(.eventPreview)
        if !supportsEventPreview && (contentMode == .eventPreview || pendingContentMode == .eventPreview) {
            if contentMode == .eventPreview {
                contentMode = .fixed
                persistContentMode()
            }
            if pendingContentMode == .eventPreview { clearPendingContentMode() }
            contentModeState = "Relay 未声明支持标题和摘要，当前按固定隐私文案处理；请先升级 Relay"
        }
    }

    private func perform(_ operation: () async throws -> Void) async {
        busy = true; defer { busy = false }
        do { try await operation() }
        catch { message = error.localizedDescription; relayReachable = false }
    }

    private func saveSecrets(_ value: MobileRelaySecrets) throws {
        guard let hubURL else { throw MobileRelayError.invalidEndpoint }
        try secrets.save(storageScope(hubURL), value)
        storedSecrets = value
        defaults.set(endpointText, forKey: key("endpoint", storageScope(hubURL)))
    }

    private func validatedEndpoint() -> URL? {
        guard let url = URL(string: endpointText.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme?.lowercased() == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { return nil }
        return url
    }

    private func setCleanupDeviceId(_ deviceId: String) {
        guard let hubURL else { return }
        defaults.set(deviceId, forKey: key("cleanupDeviceId", storageScope(hubURL)))
    }

    private func cleanupDeviceId() -> String? {
        guard let hubURL else { return nil }
        return defaults.string(forKey: key("cleanupDeviceId", storageScope(hubURL)))
    }

    private func clearCleanupDeviceId() {
        guard let hubURL else { return }
        defaults.removeObject(forKey: key("cleanupDeviceId", storageScope(hubURL)))
    }

    private func cleanupHubDevice(_ deviceId: String) async -> Bool {
        do {
            try await deleteDevice(deviceId)
            clearCleanupDeviceId()
            return true
        } catch {
            setCleanupDeviceId(deviceId)
            stage = .removalIncomplete
            saveStage("removalIncomplete")
            message = "Hub 设备清理未完成，请重试移除"
            return false
        }
    }

    private func relayInstallationId(for url: URL) -> String {
        let scope = storageScope(url), storageKey = key("installationId", scope)
        if let existing = defaults.string(forKey: storageKey) { return existing }
        let value = UUID().uuidString
        defaults.set(value, forKey: storageKey)
        return value
    }

    private func persistPolicyRevision() {
        guard let hubURL else { return }
        defaults.set(localPolicyRevision, forKey: key("policyRevision", storageScope(hubURL)))
    }

    private func persistRelayRevision(_ revision: Int) {
        guard let hubURL else { return }
        defaults.set(revision, forKey: key("relayRevision", storageScope(hubURL)))
    }

    private func persistContentMode() {
        guard let hubURL else { return }
        defaults.set(contentMode.rawValue, forKey: key("contentMode", storageScope(hubURL)))
    }

    private func persistPendingContentMode() {
        guard let hubURL, let pendingContentMode else { return }
        defaults.set(pendingContentMode.rawValue, forKey: key("pendingContentMode", storageScope(hubURL)))
    }

    private func clearPendingContentMode() {
        pendingContentMode = nil
        guard let hubURL else { return }
        defaults.removeObject(forKey: key("pendingContentMode", storageScope(hubURL)))
    }

    private func finalizePendingContentMode() {
        guard let pendingContentMode else { return }
        contentMode = pendingContentMode
        persistContentMode()
        clearPendingContentMode()
        contentModeState = contentMode == .eventPreview ? "已开启，仅影响后续通知" : "已关闭，仅影响后续通知；既有通知不会被删除"
    }

    private func saveStage(_ value: String) {
        guard let hubURL else { return }
        defaults.set(value, forKey: key("stage", storageScope(hubURL)))
    }

    private func savePendingActivation(_ activation: MobileRelayActivation) throws {
        guard var value = storedSecrets else { throw MobileRelayError.invalidResponse }
        value.pendingActivation = MobileRelayPendingActivation(
            activationId: activation.activationId, installationId: activation.installationId,
            deviceId: activation.deviceId, token: activation.token, revision: activation.revision
        )
        try saveSecrets(value)
    }

    private func pendingActivation() -> MobileRelayPendingActivation? { storedSecrets?.pendingActivation }

    private func clearPendingActivation() throws {
        guard var value = storedSecrets else { return }
        value.pendingActivation = nil
        try saveSecrets(value)
    }

    private func completeActivation(deviceId: String, activationId: String) throws {
        guard let hubURL else { throw MobileRelayError.invalidResponse }
        try clearPendingActivation()
        defaults.set(deviceId, forKey: key("deviceId", storageScope(hubURL)))
        defaults.set(activationId, forKey: key("activationId", storageScope(hubURL)))
        stage = .active
        saveStage("active")
        message = "手机通知已启用"
    }

    private func storageScope(_ url: URL) -> String { Data(Self.origin(url).utf8).base64EncodedString() }
    private func key(_ field: String, _ scope: String) -> String { "mobileRelay.\(field).\(scope)" }

    static func origin(_ url: URL) -> String {
        var components = URLComponents()
        components.scheme = url.scheme?.lowercased()
        components.host = url.host?.lowercased()
        components.port = url.port
        return components.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? url.absoluteString
    }

    static func randomTopic() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw MobileRelayError.invalidResponse }
        return "hapi-" + bytes.map { String(format: "%02x", $0) }.joined()
    }
}
