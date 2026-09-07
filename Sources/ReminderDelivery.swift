import Foundation

@MainActor
enum ReminderDelivery {
    static func process(
        event: CompanionEvent,
        decision: ReminderDecision,
        alreadyHandled: Bool,
        submitBanner: () async throws -> Void,
        playSound: () -> Bool,
        remember: (String) -> Void
    ) async -> Bool {
        if alreadyHandled { return true }
        switch decision {
        case .suppress:
            remember(event.eventId)
            return true
        case .bannerOnly, .notifyWithSound:
            do {
                try await submitBanner()
                if decision == .notifyWithSound && !playSound() { return false }
                remember(event.eventId)
                return true
            } catch {
                return false
            }
        }
    }
}
