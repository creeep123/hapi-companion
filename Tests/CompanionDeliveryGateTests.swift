import XCTest
@testable import HAPI_Companion

private actor Counts {
    var deliveries = 0
    var acknowledgements = 0
    func delivered() { deliveries += 1 }
    func acknowledged() { acknowledgements += 1 }
}

final class CompanionDeliveryGateTests: XCTestCase {
    func testFailedDeliveryStopsBeforeLaterEventAndAcknowledgement() async {
        let counts = Counts()
        let events = [makeEvent(id: "first"), makeEvent(id: "second")]

        do {
            for (index, event) in events.enumerated() {
                try await CompanionDeliveryGate.process(
                    event: event,
                    seq: index + 1,
                    deliver: { _, _ in
                        await counts.delivered()
                        return false
                    },
                    acknowledge: { _, _ in await counts.acknowledged() }
                )
            }
            XCTFail("Expected delivery to be deferred")
        } catch CompanionServiceError.deliveryDeferred {
            // Expected: the stream reconnects from the unchanged server ACK cursor.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        let deliveries = await counts.deliveries
        let acknowledgements = await counts.acknowledgements
        XCTAssertEqual(deliveries, 1)
        XCTAssertEqual(acknowledgements, 0)
    }

    private func makeEvent(id: String) -> CompanionEvent {
        CompanionEvent(
            version: 1, eventId: id, createdAt: 0, kind: "ready", title: "Ready",
            body: "Body", severity: "info", sessionId: "session", sessionName: "Test",
            machineId: nil, url: "/sessions/session", requestId: nil, tag: nil
        )
    }
}
