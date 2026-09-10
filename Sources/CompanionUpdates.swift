import Foundation
import Observation
import Sparkle

/// Sparkle owns update validation, download, atomic replacement and relaunch.
@MainActor
@Observable
final class CompanionUpdates: NSObject, SPUUpdaterDelegate {
    let enabled: Bool
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
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
        controller?.startUpdater()
    }

    func checkForUpdates() { controller?.checkForUpdates(nil) }

    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        // The validated update is about to replace this ad-hoc signed app.
        // Its new code identity must pair again, without touching Runner credentials.
        do { try CompanionKeychain().delete() }
        catch { CompanionLog.error("Could not reset Companion device credential before update") }
    }
}
