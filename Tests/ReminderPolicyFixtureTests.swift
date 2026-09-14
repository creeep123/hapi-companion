import XCTest
@testable import HAPI_Companion

private struct SharedPolicyFixture: Decodable {
    struct Event: Decodable { let sessionId: String; let sessionName: String; let kind: String; let createdAt: Int64; let durationMs: Double? }
    struct Policy: Decodable {
        var scope: String?; var selectedSessionIds: [String]?; var keywords: [String]?
        var durationEnabled: Bool?; var minimumMinutes: Int?
        var quietEnabled: Bool?; var quietStartMinutes: Int?; var quietEndMinutes: Int?; var quietMode: String?; var timeZone: String?
    }
    struct Case: Decodable { let name: String; let now: Int64; let event: Event; let policy: Policy; let decision: String }
    let version: Int
    let cases: [Case]
}

final class ReminderPolicyFixtureTests: XCTestCase {
    func testSwiftPolicyMatchesRelayFixtureCorpus() throws {
        let testFile = URL(fileURLWithPath: #filePath)
        let data = try Data(contentsOf: testFile.deletingLastPathComponent().deletingLastPathComponent().appending(path: "contracts/reminder-policy-fixtures.json"))
        let fixture = try JSONDecoder().decode(SharedPolicyFixture.self, from: data)
        XCTAssertEqual(fixture.version, 1)
        for item in fixture.cases {
            var p = ReminderPreferences()
            if let value = item.policy.scope { p.scope = value == "specified" ? .specified : .all }
            p.selectedSessionIDs = Set(item.policy.selectedSessionIds ?? [])
            p.keywords = item.policy.keywords ?? []
            p.durationEnabled = item.policy.durationEnabled ?? false
            p.minimumMinutes = item.policy.minimumMinutes ?? 1
            p.quietEnabled = item.policy.quietEnabled ?? false
            p.quietStartMinutes = item.policy.quietStartMinutes ?? p.quietStartMinutes
            p.quietEndMinutes = item.policy.quietEndMinutes ?? p.quietEndMinutes
            if let mode = item.policy.quietMode { p.quietMode = mode == "suppress" ? .suppress : .mute }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: item.policy.timeZone ?? "UTC")!
            let event = CompanionEvent(
                version: 1, eventId: item.name, createdAt: item.event.createdAt, kind: item.event.kind,
                title: "", body: "", severity: "info", sessionId: item.event.sessionId,
                sessionName: item.event.sessionName, machineId: nil, url: "", requestId: nil, tag: nil,
                durationMs: item.event.durationMs
            )
            let decision = ReminderPolicy.evaluate(event: event, preferences: p, now: Date(timeIntervalSince1970: Double(item.now) / 1000), calendar: calendar)
            let actual: String
            switch decision { case .notifyWithSound: actual = "sound"; case .bannerOnly: actual = "quiet"; case .suppress: actual = "suppress" }
            XCTAssertEqual(actual, item.decision, item.name)
        }
    }
}
