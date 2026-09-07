import Foundation

struct CompanionEvent: Codable, Sendable {
    let version: Int
    let eventId: String
    let createdAt: Int64
    let kind: String
    let title: String
    let body: String
    let severity: String
    let sessionId: String
    let sessionName: String
    let machineId: String?
    let url: String
    let requestId: String?
    let tag: String?
    var durationMs: Double? = nil
}

struct CompanionCredential: Codable, Sendable {
    let hubURL: URL
    let deviceId: String
    let token: String
}


extension CompanionEvent {
    private enum CodingKeys: String, CodingKey {
        case version, eventId, createdAt, kind, title, body, severity, sessionId, sessionName
        case machineId, url, requestId, tag, durationMs
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(Int.self, forKey: .version)
        eventId = try c.decode(String.self, forKey: .eventId)
        createdAt = try c.decode(Int64.self, forKey: .createdAt)
        kind = try c.decode(String.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        body = try c.decode(String.self, forKey: .body)
        severity = try c.decode(String.self, forKey: .severity)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        sessionName = try c.decode(String.self, forKey: .sessionName)
        machineId = try c.decodeIfPresent(String.self, forKey: .machineId)
        url = try c.decode(String.self, forKey: .url)
        requestId = try c.decodeIfPresent(String.self, forKey: .requestId)
        tag = try c.decodeIfPresent(String.self, forKey: .tag)
        // An optional enhancement must never poison durable replay of a legacy event.
        if let value = try? c.decode(Double.self, forKey: .durationMs),
           value.isFinite, value >= 0, value <= 9_007_199_254_740_991 {
            durationMs = value
        } else {
            durationMs = nil
        }
    }
}
