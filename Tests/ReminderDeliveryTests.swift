import XCTest
@testable import HAPI_Companion

@MainActor
private final class ReminderGateHarness {
    var handled = Set<String>()
    var banners = 0
    var sounds = 0
    var acknowledgements = 0
    var decision: ReminderDecision = .suppress(reason: "not selected")
    var failACK = true

    func deliver(_ event: CompanionEvent) async -> Bool {
        await ReminderDelivery.process(event: event, decision: decision, alreadyHandled: handled.contains(event.eventId),
            submitBanner: { self.banners += 1 }, playSound: { self.sounds += 1; return true },
            remember: { self.handled.insert($0) })
    }

    func acknowledge() throws {
        acknowledgements += 1
        if failACK { throw URLError(.networkConnectionLost) }
    }
}

@MainActor
final class ReminderDeliveryTests: XCTestCase {
    private func event() throws -> CompanionEvent {
        try JSONDecoder().decode(CompanionEvent.self, from: Data("""
        {"version":1,"eventId":"one","createdAt":0,"kind":"ready","title":"Done","body":"Done","severity":"info","sessionId":"s","sessionName":"Session","url":"/sessions/s"}
        """.utf8))
    }

    func testSuppressionAndBannerOnlyRunExactlyRequiredEffects() async throws {
        let event = try event()
        var effects: [String] = []
        let suppressed = await ReminderDelivery.process(event: event, decision: .suppress(reason: "rule"), alreadyHandled: false,
            submitBanner: { effects.append("banner") }, playSound: { effects.append("sound"); return true }, remember: { effects.append($0) })
        XCTAssertTrue(suppressed)
        XCTAssertEqual(effects, ["one"])
        effects = []
        let muted = await ReminderDelivery.process(event: event, decision: .bannerOnly, alreadyHandled: false,
            submitBanner: { effects.append("banner") }, playSound: { effects.append("sound"); return false }, remember: { effects.append($0) })
        XCTAssertTrue(muted)
        XCTAssertEqual(effects, ["banner", "one"])
    }

    func testFailuresNeverRememberAndDedupeBypassesChangedRules() async throws {
        let event = try event()
        var effects: [String] = []
        let bannerFailed = await ReminderDelivery.process(event: event, decision: .notifyWithSound, alreadyHandled: false,
            submitBanner: { throw URLError(.unknown) }, playSound: { effects.append("sound"); return true }, remember: { effects.append($0) })
        XCTAssertFalse(bannerFailed)
        XCTAssertTrue(effects.isEmpty)
        let soundFailed = await ReminderDelivery.process(event: event, decision: .notifyWithSound, alreadyHandled: false,
            submitBanner: { effects.append("banner") }, playSound: { effects.append("sound"); return false }, remember: { effects.append($0) })
        XCTAssertFalse(soundFailed)
        XCTAssertEqual(effects, ["banner", "sound"])
        effects = []
        let retry = await ReminderDelivery.process(event: event, decision: .notifyWithSound, alreadyHandled: true,
            submitBanner: { effects.append("banner") }, playSound: { effects.append("sound"); return true }, remember: { effects.append($0) })
        XCTAssertTrue(retry)
        XCTAssertTrue(effects.isEmpty)
    }

    func testSuppressionACKFailureThenChangedPolicyDoesNotNotifyOnRetry() async throws {
        let event = try event()
        let harness = ReminderGateHarness()
        do {
            try await CompanionDeliveryGate.process(event: event, seq: 1,
                deliver: { event, _ in await harness.deliver(event) },
                acknowledge: { _, _ in try await harness.acknowledge() })
            XCTFail("Expected simulated ACK failure")
        } catch is URLError { }
        XCTAssertEqual(harness.handled, [event.eventId])
        harness.decision = .notifyWithSound
        harness.failACK = false
        try await CompanionDeliveryGate.process(event: event, seq: 1,
            deliver: { event, _ in await harness.deliver(event) },
            acknowledge: { _, _ in try await harness.acknowledge() })
        XCTAssertEqual(harness.acknowledgements, 2)
        XCTAssertEqual(harness.banners, 0)
        XCTAssertEqual(harness.sounds, 0)
    }
}
