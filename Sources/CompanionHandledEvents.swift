import Foundation

@MainActor
struct CompanionHandledEvents {
    let defaults: UserDefaults

    func contains(_ id: String, hubURL: URL) -> Bool {
        if (defaults.stringArray(forKey: key(hubURL)) ?? []).contains(id) { return true }
        // v0.1 used globally generated event UUIDs without an origin key. Lazily migrate
        // only an exact UUID seen again on this authenticated Hub, never the entire ledger.
        if UUID(uuidString: id) != nil,
           (defaults.stringArray(forKey: "deliveredCompanionEventIds") ?? []).contains(id) {
            remember(id, hubURL: hubURL)
            return true
        }
        return false
    }

    func remember(_ id: String, hubURL: URL) {
        let key = key(hubURL)
        var ids = defaults.stringArray(forKey: key) ?? []
        ids.removeAll { $0 == id }
        ids.append(id)
        defaults.set(Array(ids.suffix(256)), forKey: key)
    }

    private func key(_ url: URL) -> String {
        let origin = "\(url.scheme?.lowercased() ?? "")://\(url.host?.lowercased() ?? ""):\(url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80))"
        return "handledCompanionEvents.v2." + Data(origin.utf8).base64EncodedString()
    }
}
