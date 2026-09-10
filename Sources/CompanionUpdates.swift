import Foundation
import Observation
import Sparkle
import UserNotifications

/// Sparkle owns update validation, download, atomic replacement and relaunch.
@MainActor
@Observable
final class CompanionUpdates: NSObject, SPUUpdaterDelegate, @preconcurrency SPUStandardUserDriverDelegate {
    nonisolated static let notificationID = "companion.application-update"
    var availableVersion: String?
    var supportsGentleScheduledUpdateReminders: Bool { true }
    let enabled: Bool
    var canCheckForUpdates = false
    @ObservationIgnored private var checkObservation: NSKeyValueObservation?
    @ObservationIgnored private var controller: SPUStandardUpdaterController?
    var automaticallyChecks: Bool {
        didSet { controller?.updater.automaticallyChecksForUpdates = automaticallyChecks }
    }
    var version: String {
        let info = Bundle.main.infoDictionary ?? [:]
        return "\(info["CFBundleShortVersionString"] as? String ?? "—") (\(info["CFBundleVersion"] as? String ?? "—"))"
    }

    init(enabled: Bool) {
        self.enabled = enabled
        automaticallyChecks = enabled && (UserDefaults.standard.object(forKey: "SUEnableAutomaticChecks") as? Bool ?? true)
        super.init()
        guard enabled else { return }
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: self)
        if let updater = controller?.updater {
            updater.httpHeaders = ["Accept": "application/vnd.github.raw+json"]
            checkObservation = updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] _, change in
                let allowed = change.newValue ?? false
                Task { @MainActor [weak self] in self?.canCheckForUpdates = allowed }
            }
        }
        controller?.startUpdater()
    }

    func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        availableVersion = update.displayVersionString
        guard !state.userInitiated else { return }
        let content = UNMutableNotificationContent()
        content.title = "HAPI Companion 有新版本"
        content.body = "版本 \(update.displayVersionString) 已可用，点击查看并更新。"
        // No completion sound: application updates are not task completions.
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: Self.notificationID, content: content, trigger: nil))
    }

    func standardUserDriverWillFinishUpdateSession() {
        availableVersion = nil
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [Self.notificationID])
    }

    func checkForUpdates() { controller?.checkForUpdates(nil) }

    func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) {
        request.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
    }

    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        // The validated update is about to replace this ad-hoc signed app.
        // Its new code identity must pair again, without touching Runner credentials.
        do { try CompanionKeychain().delete() }
        catch { CompanionLog.error("Could not reset Companion device credential before update") }
    }
}
