import AppKit
import Observation
import UserNotifications
import ServiceManagement

@MainActor
@Observable
final class CompanionModel {
    private let sessionOpener = SessionOpener()
    private let service = CompanionService()
    private var activeSound: NSSound?
    private let deliveredEventIdsKey = "deliveredCompanionEventIds"
    var status = "正在启动 HAPI Companion…"
    var loginItemStatus = "正在检查登录启动…"

    func requestNotificationPermission() async {
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound])
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            UserDefaults.standard.set(settings.authorizationStatus.rawValue, forKey: "notificationAuthorizationStatus")
            UserDefaults.standard.set(settings.soundSetting.rawValue, forKey: "notificationSoundSetting")
            status = granted ? "通知权限已启用" : "通知权限未启用"
            if granted {
                enableLoginItem()
                startService()
            }
        } catch {
            status = "通知权限请求失败：\(error.localizedDescription)"
        }
    }

    private func enableLoginItem() {
        do {
            let service = SMAppService.mainApp
            if service.status == .notRegistered {
                try SMAppService.mainApp.register()
            }
            switch service.status {
            case .enabled: loginItemStatus = "登录时自动启动：已启用"
            case .requiresApproval: loginItemStatus = "登录时自动启动：需要在系统设置批准"
            case .notFound: loginItemStatus = "登录时自动启动：应用位置无效"
            case .notRegistered: loginItemStatus = "登录时自动启动：未启用"
            @unknown default: loginItemStatus = "登录时自动启动：状态未知"
            }
        } catch {
            // Notification delivery remains available for the current login;
            // expose the failure without crashing the menu-bar agent.
            loginItemStatus = "登录启动未启用：\(error.localizedDescription)"
        }
    }

    private func startService() {
        Task {
            await service.start(onEvent: { [weak self] event, _ in
                guard let self else { return false }
                return await self.deliver(event)
            }, onStatus: { [weak self] status in
                await MainActor.run { self?.status = status }
            })
        }
    }

    private func deliver(_ event: CompanionEvent) async -> Bool {
        if deliveredEventIds.contains(event.eventId) {
            CompanionLog.info("deduplicated event=\(event.eventId.prefix(8))")
            status = "正在确认已显示的通知：\(event.sessionName)"
            return true
        }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized,
              settings.alertSetting == .enabled else {
            CompanionLog.error("notification unavailable auth=\(settings.authorizationStatus.rawValue) alert=\(settings.alertSetting.rawValue)")
            status = "通知横幅已关闭；请在系统设置中启用后重试"
            return false
        }
        let content = UNMutableNotificationContent()
        content.title = event.title
        content.body = event.body
        content.userInfo = ["sessionId": event.sessionId, "url": event.url]
        do {
            try await UNUserNotificationCenter.current().add(UNNotificationRequest(
                identifier: event.eventId,
                content: content,
                trigger: nil
            ))
            guard playSound() else {
                status = "提示音播放失败；通知将在稍后重试"
                return false
            }
            rememberDelivered(event.eventId)
            CompanionLog.info("notification delivered event=\(event.eventId.prefix(8))")
            status = "已通知：\(event.sessionName)"
            return true
        } catch {
            status = "通知失败：\(error.localizedDescription)"
            return false
        }
    }

    private var deliveredEventIds: Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: deliveredEventIdsKey) ?? [])
    }

    private func rememberDelivered(_ eventId: String) {
        var ids = UserDefaults.standard.stringArray(forKey: deliveredEventIdsKey) ?? []
        ids.removeAll { $0 == eventId }
        ids.append(eventId)
        if ids.count > 256 { ids.removeFirst(ids.count - 256) }
        UserDefaults.standard.set(ids, forKey: deliveredEventIdsKey)
    }

    func openLoginItemSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }

    @discardableResult
    func playSound() -> Bool {
        guard let url = Bundle.main.url(forResource: "HapiComplete", withExtension: "aiff"),
              let sound = NSSound(contentsOf: url, byReference: true) else {
            status = "找不到内置提示音"
            return false
        }
        activeSound?.stop()
        activeSound = sound
        let started = sound.play()
        status = started ? "已播放原生提示音" : "提示音播放失败"
        return started
    }

    func sendTestNotification() async {
        let content = UNMutableNotificationContent()
        content.title = "HAPI Companion 测试"
        content.body = "声音和原生通知工作正常"

        // Sound is played explicitly so behavior does not depend on the
        // browser notification implementation. Keep content.sound nil to
        // avoid double playback if macOS behavior changes.
        playSound()
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        do {
            try await UNUserNotificationCenter.current().add(request)
            status = "测试通知已发送"
        } catch {
            status = "测试通知失败：\(error.localizedDescription)"
        }
    }

    func openEventURL(_ value: String, fallbackSessionId: String) {
        let configuredHubURL = try? CompanionConfiguration.load().hubURL
        let eventURL = URL(string: value)
        let hubURL = eventURL.flatMap(Self.originURL) ?? configuredHubURL
        guard let hubURL,
              let url = eventURL ?? URL(string: "/sessions/\(fallbackSessionId)", relativeTo: hubURL)?.absoluteURL else {
            status = "会话地址无效；请检查 HAPI CLI 配置"
            return
        }
        sessionOpener.open(url: url, hubOrigin: hubURL) { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success(let destination): self?.status = "已通过 \(destination) 打开会话"
                case .failure(let error): self?.status = "跳转失败：\(error.localizedDescription)"
                }
            }
        }
    }

    private static func originURL(for url: URL) -> URL? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }
}
