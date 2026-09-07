import XCTest
@testable import HAPI_Companion

@MainActor
final class CompanionHandledEventsTests: XCTestCase {
    func testLegacyReplayMigratesOnlyMatchedUUIDAndSurvivesLegacyRemoval() throws {
        let suite = "HandledEventsTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let id = UUID().uuidString
        let unmatched = UUID().uuidString
        defaults.set([id, unmatched], forKey: "deliveredCompanionEventIds")
        let ledger = CompanionHandledEvents(defaults: defaults)
        let hub = URL(string: "https://example.invalid/path")!
        XCTAssertTrue(ledger.contains(id, hubURL: hub))
        defaults.removeObject(forKey: "deliveredCompanionEventIds")
        XCTAssertTrue(ledger.contains(id, hubURL: URL(string: "https://EXAMPLE.invalid:443")!))
        XCTAssertFalse(ledger.contains(unmatched, hubURL: hub))
        XCTAssertFalse(ledger.contains(id, hubURL: URL(string: "https://other.invalid")!))
    }
}
