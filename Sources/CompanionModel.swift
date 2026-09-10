import AppKit
import Observation
import UserNotifications
import ServiceManagement

@MainActor
@Observable
final class CompanionModel {
    private let sessionOpener = SessionOpener()
    private let service: CompanionService
    let updates: CompanionUpdates
    let sounds: ReminderSounds
    private let defaults: UserDefaults
    private let preview: Bool
    private var started = false
    private var currentHubURL: URL?
    var connectedHubHost: String? { currentHubURL?.host }
    let settings: ReminderSettingsStore
    var status = "正在启动 HAPI Companion…"
    var loginItemStatus = "正在检查登录启动…"
    var permissionStatus = "正在检查通知权限…"
    var notificationAllowed = false
    var catalog: [CompanionSession] = []
    var catalogLoading = false
    var catalogError: String?
    var catalogLoaded = false
    var durationSupported = false
    var lastAction: String?

    init(defaults: UserDefaults = .standard, service: CompanionService = CompanionService(), preview: Bool = false) {
        self.defaults = defaults
        self.service = service
        self.preview = preview
        updates = CompanionUpdates(enabled: !preview && !CompanionRuntime.isTesting)
        let previewSounds = preview ? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "HAPI Companion/PreviewSounds", directoryHint: .isDirectory) : nil
        sounds = ReminderSounds(defaults: defaults, directory: previewSounds)
        settings = ReminderSettingsStore(defaults: defaults)
    }

    func start() async {
        guard !started else { return }
        started = true
        if preview {
            configure(hubURL: URL(string: "https://preview.invalid")!)
            status = "设计预览 · 未连接真实 Hub"
            loginItemStatus = "预览模式，不注册登录项"
            notificationAllowed = true
            permissionStatus = "预览模式"
            catalog = [
                CompanionSession(id: "preview-1", title: "HAPI Companion 项目接管与维护", machineName: "MacAir"),
                CompanionSession(id: "preview-2", title: "小火胃 管理", machineName: "MacAir"),
                CompanionSession(id: "preview-3", title: "站群总管", machineName: "MacAir"),
                CompanionSession(id: "preview-4", title: "外链提交工程师", machineName: "VM")
            ]
            settings.preferences.scope = .specified
            settings.preferences.selectedSessionIDs = ["preview-1", "preview-3"]
            settings.preferences.keywords = ["Companion", "站群"]
            settings.preferences.durationEnabled = true
            settings.preferences.quietEnabled = true
            durationSupported = true
            catalogLoaded = true
            return
        }
        do { configure(hubURL: try CompanionConfiguration.load().hubURL) }
        catch { status = error.localizedDescription }
        enableLoginItem()
        // Permission failure must not prevent user-rule suppressions from being ACKed.
        await service.start(onEvent: { [weak self] event, _, hubURL in
            guard let self else { return false }
            return await self.deliver(event, hubURL: hubURL)
        }, onStatus: { [weak self] status in
            await MainActor.run { self?.status = status }
        })
        await requestNotificationPermission()
    }

    private func configure(hubURL: URL) {
        if let currentHubURL, CompanionConfiguration.sameOrigin(currentHubURL, hubURL) { return }
        currentHubURL = hubURL
        settings.configure(hubURL: hubURL)
        catalog = []
        catalogLoaded = false
        durationSupported = false
        catalogError = nil
    }

    func requestNotificationPermission() async {
        guard !preview else { return }
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            await refreshPermission()
        } catch { permissionStatus = "通知权限请求失败：\(error.localizedDescription)" }
    }

    func refreshPermission() async {
        guard !preview else { return }
        let value = await UNUserNotificationCenter.current().notificationSettings()
        notificationAllowed = value.authorizationStatus == .authorized && value.alertSetting == .enabled
        permissionStatus = notificationAllowed ? "通知权限已启用" : "通知横幅未启用，请前往系统设置开启"
    }

    private func enableLoginItem() {
        do {
            let service = SMAppService.mainApp
            if service.status == .notFound {
                // Replacing an ad-hoc signed local build can leave Background Task
                // Management pointing at the old bundle instance. Clear that stale
                // registration before registering the newly installed bundle.
                try? service.unregister()
            }
            if service.status == .notRegistered || service.status == .notFound {
                try service.register()
            }
            switch service.status {
            case .enabled: loginItemStatus = "登录时自动启动：已启用"
            case .requiresApproval: loginItemStatus = "登录时自动启动：需要在系统设置批准"
            case .notFound: loginItemStatus = "登录时自动启动：应用位置无效"
            case .notRegistered: loginItemStatus = "登录时自动启动：未启用"
            @unknown default: loginItemStatus = "登录时自动启动：状态未知"
            }
        } catch { loginItemStatus = "登录启动未启用：\(error.localizedDescription)" }
    }

    func refreshCatalog() async {
        guard !preview, !catalogLoading else { return }
        catalogLoading = true
        defer { catalogLoading = false }
        do {
            let result = try await service.fetchCatalog()
            // Never replace rows for a Hub whose configuration changed during this request.
            let configured = try CompanionConfiguration.load().hubURL
            guard CompanionConfiguration.sameOrigin(configured, result.hubURL) else { return }
            configure(hubURL: result.hubURL)
            var seen = Set<String>()
            catalog = result.catalog.sessions.filter { seen.insert($0.id).inserted }
                .sorted { $0.updatedAt > $1.updatedAt }
            durationSupported = result.catalog.capabilities.turnDuration
            catalogLoaded = true
            catalogError = nil
        } catch { catalogError = error.localizedDescription }
    }

    private func deliver(_ event: CompanionEvent, hubURL: URL) async -> Bool {
        configure(hubURL: hubURL)
        let decision = ReminderPolicy.evaluate(event: event, preferences: settings.preferences, now: Date(), calendar: .current)
        let ledger = CompanionHandledEvents(defaults: defaults)
        let result = await ReminderDelivery.process(
            event: event, decision: decision, alreadyHandled: ledger.contains(event.eventId, hubURL: hubURL),
            submitBanner: { [self] in
                await refreshPermission()
                guard notificationAllowed else { throw CompanionServiceError.deliveryDeferred }
                let content = UNMutableNotificationContent()
                content.title = event.title
                content.body = event.body
                content.userInfo = ["sessionId": event.sessionId, "url": event.url]
                try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: event.eventId, content: content, trigger: nil))
            },
            playSound: { [self] in playSound() },
            remember: { id in ledger.remember(id, hubURL: hubURL) }
        )
        if result {
            CompanionLog.info("event handled event=\(event.eventId.prefix(8))")
            switch decision {
            case .suppress(let reason): lastAction = "已跳过提醒：\(reason)"
            case .bannerOnly: lastAction = "已静音提醒：\(event.sessionName)"
            case .notifyWithSound: lastAction = "已提醒：\(event.sessionName)"
            }
        } else {
            lastAction = notificationAllowed ? "提醒未完成，将在重连后重试" : permissionStatus
        }
        return result
    }

    func openLoginItemSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension") { NSWorkspace.shared.open(url) }
    }

    func openNotificationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") { NSWorkspace.shared.open(url) }
    }

    @discardableResult
    func playSound() -> Bool {
        sounds.play()
    }

    func sendTestNotification() async {
        guard !preview else { lastAction = "设计预览不发送真实通知"; return }
        await refreshPermission()
        guard notificationAllowed else { lastAction = permissionStatus; return }
        let content = UNMutableNotificationContent()
        content.title = "HAPI Companion 测试"
        content.body = "这是一条测试提醒，不受会话筛选和勿扰规则限制。"
        do {
            try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
            lastAction = playSound() ? "测试提醒已发送" : "测试横幅已发送，但提示音播放失败"
        } catch { lastAction = "测试提醒失败：\(error.localizedDescription)" }
    }

    func openEventURL(_ value: String, fallbackSessionId: String) {
        guard let configuredHubURL = try? CompanionConfiguration.load().hubURL,
              let resolved = CompanionURLResolver.resolve(eventURL: value, sessionId: fallbackSessionId, configuredHubURL: configuredHubURL) else {
            lastAction = "会话地址无效；请检查 HAPI CLI 配置"
            return
        }
        sessionOpener.open(url: resolved.target, hubOrigin: resolved.hubOrigin) { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success(let destination): self?.lastAction = "已通过 \(destination) 打开会话"
                case .failure(let error): self?.lastAction = "跳转失败：\(error.localizedDescription)"
                }
            }
        }
    }
}
