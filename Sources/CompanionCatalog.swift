import Foundation

struct CompanionSession: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    var machineName: String? = nil
    var updatedAt: Double = 0
    var active: Bool = false
}

struct CompanionCatalog: Decodable, Sendable {
    struct Capabilities: Decodable, Sendable {
        let turnDuration: Bool
    }
    let sessions: [CompanionSession]
    let capabilities: Capabilities
}

// Shared with service tests; closures keep secrets behind their existing boundary.
struct CompanionCredentialAccess: Sendable {
    var load: @Sendable () throws -> CompanionCredential?
    var save: @Sendable (CompanionCredential) throws -> Void
    var delete: @Sendable () throws -> Void

    static let keychain = CompanionCredentialAccess(
        load: { try CompanionKeychain().load() },
        save: { try CompanionKeychain().save($0) },
        delete: { try CompanionKeychain().delete() }
    )
}
