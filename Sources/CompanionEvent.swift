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
}

struct CompanionCredential: Codable, Sendable {
    let hubURL: URL
    let deviceId: String
    let token: String
}

