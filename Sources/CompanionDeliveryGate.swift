import Foundation

enum CompanionDeliveryGate {
    typealias Delivery = @Sendable (CompanionEvent, Int) async -> Bool
    typealias Acknowledge = @Sendable (Int, String) async throws -> Void

    static func process(
        event: CompanionEvent,
        seq: Int,
        deliver: Delivery,
        acknowledge: Acknowledge
    ) async throws {
        guard await deliver(event, seq) else {
            throw CompanionServiceError.deliveryDeferred
        }
        try await acknowledge(seq, event.eventId)
    }
}
