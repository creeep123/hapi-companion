import XCTest
@testable import HAPI_Companion

final class ReminderPolicyTests: XCTestCase {
    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }
    private func date(_ hour: Int, _ minute: Int = 0) -> Date {
        utc.date(from: DateComponents(year: 2026, month: 9, day: 8, hour: hour, minute: minute))!
    }
    private func event(title: String = "部署", duration: Any? = nil, kind: String = "ready", created: Date? = nil) throws -> CompanionEvent {
        var json: [String: Any] = [
            "version": 1, "eventId": "event", "createdAt": Int64((created ?? date(12)).timeIntervalSince1970 * 1000),
            "kind": kind, "title": "Ready", "body": "Done", "severity": "info",
            "sessionId": "stable-id", "sessionName": title, "url": "/sessions/stable-id"
        ]
        if let duration { json["durationMs"] = duration }
        return try JSONDecoder().decode(CompanionEvent.self, from: JSONSerialization.data(withJSONObject: json))
    }
    private func decision(_ event: CompanionEvent, _ preferences: ReminderPreferences, now: Date? = nil, calendar: Calendar? = nil) -> ReminderDecision {
        ReminderPolicy.evaluate(event: event, preferences: preferences, now: now ?? date(12), calendar: calendar ?? utc)
    }

    func testSpecifiedSelectionUsesStableIDOrLiteralUnicodeTitleAndEmptyNeverMatches() throws {
        var p = ReminderPreferences()
        p.scope = .specified
        p.keywords = [" ", " CAFÉ ", "[release]"]
        XCTAssertEqual(decision(try event(title: "Mon café"), p), .notifyWithSound)
        XCTAssertEqual(decision(try event(title: "[release] 发布"), p), .notifyWithSound)
        if case .suppress = decision(try event(title: "r"), p) {} else { XCTFail("Keyword must not be interpreted as regex") }
        p.keywords = []
        if case .suppress = decision(try event(), p) {} else { XCTFail("Empty selection must suppress") }
        p.selectedSessionIDs = ["stable-id"]
        XCTAssertEqual(decision(try event(title: "renamed"), p), .notifyWithSound)
    }

    func testStrictThresholdMissingMalformedAndPermissionBypass() throws {
        var p = ReminderPreferences()
        p.durationEnabled = true
        for duration in [0, 59_999, 60_000] {
            if case .suppress = decision(try event(duration: duration), p) {} else { XCTFail("Threshold must be strict") }
        }
        let unknownOrLong: [Any] = [60_001, -1, "invalid", NSNull()]
        for duration in unknownOrLong {
            XCTAssertEqual(decision(try event(duration: duration), p), .notifyWithSound)
        }
        XCTAssertEqual(decision(try event(), p), .notifyWithSound)
        XCTAssertEqual(decision(try event(duration: 1, kind: "permission-request"), p), .notifyWithSound)
        p.scope = .specified
        if case .suppress = decision(try event(kind: "permission-request"), p) {} else { XCTFail("Permission still follows scope") }
    }

    func testOvernightBoundsAndReplayUseBothEventAndDeliveryTime() throws {
        var p = ReminderPreferences()
        p.quietEnabled = true
        XCTAssertEqual(decision(try event(), p, now: date(23)), .bannerOnly)
        XCTAssertEqual(decision(try event(), p, now: date(7, 59)), .bannerOnly)
        XCTAssertEqual(decision(try event(), p, now: date(8)), .notifyWithSound)
        XCTAssertEqual(decision(try event(created: date(23)), p, now: date(12)), .bannerOnly)
        XCTAssertEqual(decision(try event(created: date(8)), p, now: date(12)), .notifyWithSound)
        p.quietMode = .suppress
        if case .suppress = decision(try event(), p, now: date(23)) {} else { XCTFail("Full quiet suppresses") }
    }

    func testSameDayAllDayAndLocalTimeZone() throws {
        var p = ReminderPreferences()
        p.quietEnabled = true
        p.quietStartMinutes = 10 * 60
        p.quietEndMinutes = 11 * 60
        XCTAssertEqual(decision(try event(), p, now: date(10)), .bannerOnly)
        XCTAssertEqual(decision(try event(), p, now: date(11)), .notifyWithSound)
        var local = utc
        local.timeZone = TimeZone(secondsFromGMT: 8 * 3600)!
        XCTAssertEqual(decision(try event(), p, now: date(2), calendar: local), .bannerOnly)
        p.quietStartMinutes = p.quietEndMinutes
        XCTAssertEqual(decision(try event(), p), .bannerOnly)
    }
}
