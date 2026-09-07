import XCTest
@testable import HAPI_Companion

@MainActor
final class ReminderPreferencesTests: XCTestCase {
    func testDefaultsPreserveExistingNotificationsAndNormalizeInput() {
        var p = ReminderPreferences()
        XCTAssertEqual(p.scope, .all)
        XCTAssertFalse(p.durationEnabled)
        XCTAssertFalse(p.quietEnabled)
        p.minimumMinutes = 9999
        p.quietStartMinutes = -1
        p.quietEndMinutes = 1500
        p.keywords = ["  CAFÉ ", "café", " ", "发布"]
        p.selectedSessionIDs = ["", "id"]
        let result = p.normalized()
        XCTAssertEqual(result.minimumMinutes, 1440)
        XCTAssertEqual(result.quietStartMinutes, 0)
        XCTAssertEqual(result.quietEndMinutes, 1439)
        XCTAssertEqual(result.keywords, ["CAFÉ", "发布"])
        XCTAssertEqual(result.selectedSessionIDs, ["id"])
    }

    func testAutosaveRelaunchAndOriginIsolationWithoutPersistingURLSecrets() throws {
        let name = "ReminderPreferencesTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let store = ReminderSettingsStore(defaults: defaults)
        XCTAssertFalse(store.isConfigured)
        store.configure(hubURL: URL(string: "https://user:private@EXAMPLE.com/path?secret=value")!)
        store.preferences.scope = .specified
        store.preferences.selectedSessionIDs = ["persisted-id"]
        store.preferences.keywords = ["  build  ", "BUILD"]
        XCTAssertEqual(store.preferences.keywords, ["build"])
        let reopened = ReminderSettingsStore(defaults: defaults)
        reopened.configure(hubURL: URL(string: "https://example.com:443/else")!)
        XCTAssertEqual(reopened.preferences, store.preferences)
        reopened.configure(hubURL: URL(string: "https://example.com:444")!)
        XCTAssertEqual(reopened.preferences, ReminderPreferences())
        reopened.preferences.scope = .specified
        reopened.configure(hubURL: URL(string: "https://example.com")!)
        XCTAssertEqual(reopened.preferences.selectedSessionIDs, ["persisted-id"])
        let domain = try XCTUnwrap(defaults.persistentDomain(forName: name))
        XCTAssertFalse(String(describing: domain).contains("private"))
        XCTAssertFalse(String(describing: domain).contains("secret"))
    }

    func testInvalidHubDoesNotSaveOrReuseOtherHubRules() throws {
        let name = "ReminderPreferencesTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let store = ReminderSettingsStore(defaults: defaults)
        store.configure(hubURL: URL(string: "https://example.com")!)
        store.preferences.scope = .specified
        store.configure(hubURL: URL(string: "file:///tmp/foo")!)
        XCTAssertFalse(store.isConfigured)
        XCTAssertEqual(store.preferences, ReminderPreferences())
        store.preferences.keywords = ["unsaved"]
        store.configure(hubURL: URL(string: "https://example.com")!)
        XCTAssertEqual(store.preferences.scope, .specified)
        XCTAssertTrue(store.preferences.keywords.isEmpty)
    }
}
