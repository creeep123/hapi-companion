import XCTest
@testable import HAPI_Companion

@MainActor
final class CompanionUpdatesTests: XCTestCase {
    func testPreviewDoesNotStartOrChangeRealUpdaterPreferences() {
        let previous = UserDefaults.standard.object(forKey: "SUEnableAutomaticChecks") as? Bool
        let updates = CompanionUpdates(enabled: false)
        updates.automaticallyChecks = true
        updates.checkForUpdates()
        XCTAssertFalse(updates.enabled)
        XCTAssertEqual(UserDefaults.standard.object(forKey: "SUEnableAutomaticChecks") as? Bool, previous)
    }
}
