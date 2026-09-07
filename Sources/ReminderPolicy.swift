import Foundation

enum ReminderDecision: Equatable, Sendable {
    case notifyWithSound
    case bannerOnly
    case suppress(reason: String)
}

enum ReminderPolicy {
    static func evaluate(
        event: CompanionEvent,
        preferences: ReminderPreferences,
        now: Date,
        calendar: Calendar
    ) -> ReminderDecision {
        let settings = preferences.normalized()
        if settings.scope == .specified {
            let matches = settings.selectedSessionIDs.contains(event.sessionId) || settings.keywords.contains {
                event.sessionName.range(of: $0, options: .caseInsensitive) != nil
            }
            if !matches { return .suppress(reason: "会话未纳入提醒") }
        }
        if settings.durationEnabled, event.kind != "permission-request",
           let duration = event.durationMs, duration.isFinite, duration >= 0,
           duration <= Double(settings.minimumMinutes) * 60_000 {
            return .suppress(reason: "任务未超过时长阈值")
        }
        let created = Date(timeIntervalSince1970: Double(event.createdAt) / 1000)
        if settings.quietEnabled,
           isQuiet(now, settings: settings, calendar: calendar) || isQuiet(created, settings: settings, calendar: calendar) {
            return settings.quietMode == .mute ? .bannerOnly : .suppress(reason: "完全勿扰时段")
        }
        return .notifyWithSound
    }

    private static func isQuiet(_ date: Date, settings: ReminderPreferences, calendar: Calendar) -> Bool {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        guard let hour = parts.hour, let minute = parts.minute else { return false }
        let value = hour * 60 + minute
        let start = settings.quietStartMinutes
        let end = settings.quietEndMinutes
        if start == end { return true }
        if start < end { return value >= start && value < end }
        return value >= start || value < end
    }
}
