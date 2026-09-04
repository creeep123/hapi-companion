import AppKit
import UserNotifications

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let model = CompanionModel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        Task {
            await model.requestNotificationPermission()
            if ProcessInfo.processInfo.arguments.contains("--phase0-test") {
                await model.sendTestNotification()
            }
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let sessionId = response.notification.request.content.userInfo["sessionId"] as? String else {
            return
        }
        let url = response.notification.request.content.userInfo["url"] as? String ?? ""
        await MainActor.run {
            model.openEventURL(url, fallbackSessionId: sessionId)
        }
    }
}
