import Foundation
import Observation

enum ReminderScope: String, Codable, Sendable { case all, specified }
enum QuietMode: String, Codable, Sendable { case mute, suppress }

struct ReminderPreferences: Codable, Equatable, Sendable {
    var scope: ReminderScope = .all
    var selectedSessionIDs: Set<String> = []
    var keywords: [String] = []
    var durationEnabled = false
    var minimumMinutes = 1
    var quietEnabled = false
    var quietStartMinutes = 1380
    var quietEndMinutes = 480
    var quietMode: QuietMode = .mute

    func normalized() -> Self {
        var result = self
        result.minimumMinutes = min(1440, max(1, minimumMinutes))
        result.quietStartMinutes = min(1439, max(0, quietStartMinutes))
        result.quietEndMinutes = min(1439, max(0, quietEndMinutes))
        result.selectedSessionIDs = selectedSessionIDs.filter { !$0.isEmpty }
        result.keywords = keywords.reduce(into: []) { values, raw in
            let keyword = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !keyword.isEmpty && !values.contains(where: {
                $0.compare(keyword, options: .caseInsensitive) == .orderedSame
            }) { values.append(keyword) }
        }
        return result
    }
}

@MainActor
@Observable
final class ReminderSettingsStore {
    private struct StoredPreferences: Codable {
        let version: Int
        let preferences: ReminderPreferences
    }

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var storageKey: String?
    @ObservationIgnored private var loading = false
    private(set) var isConfigured = false
    var preferences = ReminderPreferences() {
        didSet {
            guard !loading, let storageKey else { return }
            let normalized = preferences.normalized()
            // Assignment in didSet does not recursively invoke this observer.
            if preferences != normalized { preferences = normalized }
            if let data = try? JSONEncoder().encode(StoredPreferences(version: 1, preferences: normalized)) {
                defaults.set(data, forKey: storageKey)
            }
        }
    }

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func configure(hubURL: URL) {
        guard let scheme = hubURL.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = hubURL.host?.lowercased(), !host.isEmpty else {
            loading = true
            storageKey = nil
            preferences = ReminderPreferences()
            isConfigured = false
            loading = false
            return
        }
        let port = hubURL.port ?? (scheme == "https" ? 443 : 80)
        let origin = "\(scheme)://\(host):\(port)"
        let key = "reminderPreferences.v1." + Data(origin.utf8).base64EncodedString()
        guard storageKey != key else { return }
        loading = true
        storageKey = key
        if let data = defaults.data(forKey: key),
           let stored = try? JSONDecoder().decode(StoredPreferences.self, from: data),
           stored.version == 1 {
            preferences = stored.preferences.normalized()
        } else {
            preferences = ReminderPreferences()
        }
        isConfigured = true
        loading = false
    }
}
