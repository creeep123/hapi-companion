import XCTest
@testable import HAPI_Companion

@MainActor
final class CompanionUpdatesTests: XCTestCase {
    func testReleaseHasSignedUpdateConfiguration() {
        let info = Bundle(for: CompanionUpdates.self).infoDictionary!
        XCTAssertEqual(info["SUFeedURL"] as? String, "https://api.github.com/repos/creeep123/hapi-companion/contents/updates/appcast.xml?ref=main")
        XCTAssertEqual(Data(base64Encoded: info["SUPublicEDKey"] as? String ?? "")?.count, 32)
        XCTAssertEqual(info["SURequireSignedFeed"] as? Bool, true)
        XCTAssertEqual(info["SUVerifyUpdateBeforeExtraction"] as? Bool, true)
        XCTAssertEqual(info["SUAutomaticallyUpdate"] as? Bool, false)
        XCTAssertEqual(info["SUSendProfileInfo"] as? Bool, false)
    }

    func testPreviewDoesNotStartOrChangeRealUpdaterPreferences() {
        let previous = UserDefaults.standard.object(forKey: "SUEnableAutomaticChecks") as? Bool
        let updates = CompanionUpdates(enabled: false)
        updates.automaticallyChecks = true
        updates.checkForUpdates()
        XCTAssertFalse(updates.enabled)
        XCTAssertEqual(UserDefaults.standard.object(forKey: "SUEnableAutomaticChecks") as? Bool, previous)
    }
}
