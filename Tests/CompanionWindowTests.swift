import XCTest
import AppKit
@testable import HAPI_Companion

@MainActor
final class CompanionWindowTests: XCTestCase {
    func testHostedTestLaunchNeverStartsProductionModel() {
        XCTAssertTrue(CompanionRuntime.isTesting)
        let delegate = AppDelegate()
        delegate.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        XCTAssertNil(delegate.model)
        XCTAssertNil(delegate.statusItem)
    }

    func testSettingsWindowRetainedAcrossCloseAndReopen() async throws {
        let suite = "CompanionWindowTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = CompanionModel(defaults: defaults, preview: true)
        await model.start()
        let delegate = AppDelegate()
        let first = delegate.makeSettingsWindow(model: model)
        XCTAssertEqual(first.title, "HAPI Companion")
        XCTAssertNotNil(first.contentView)
        XCTAssertFalse(first.isReleasedWhenClosed)
        first.close()
        let second = delegate.makeSettingsWindow(model: model)
        XCTAssertTrue(first === second)
        XCTAssertFalse(delegate.applicationShouldTerminateAfterLastWindowClosed(NSApp))
        XCTAssertEqual(model.catalog.count, 4)
        XCTAssertTrue(model.status.contains("预览"))
    }
}
