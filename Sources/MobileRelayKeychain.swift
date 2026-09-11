import Foundation
import Security

struct MobileRelayPendingActivation: Codable, Equatable, Sendable {
    let activationId: String
    let installationId: String
    let deviceId: String
    let token: String
    let revision: Int
}

struct MobileRelaySecrets: Codable, Equatable, Sendable {
    let managementToken: String
    var topic: String?
    var pendingActivation: MobileRelayPendingActivation?
    var rotationPreviousTopic: String? = nil
}

struct MobileRelaySecretAccess: Sendable {
    var load: @Sendable (String) throws -> MobileRelaySecrets?
    var save: @Sendable (String, MobileRelaySecrets) throws -> Void
    var delete: @Sendable (String) throws -> Void

    static let keychain = MobileRelaySecretAccess(
        load: { try MobileRelayKeychain().load(scope: $0) },
        save: { try MobileRelayKeychain().save($1, scope: $0) },
        delete: { try MobileRelayKeychain().delete(scope: $0) }
    )
}

struct MobileRelayKeychain: Sendable {
    private let service = "io.github.creeep123.hapicompanion.mobile-relay"

    func load(scope: String) throws -> MobileRelaySecrets? {
        var query = baseQuery(scope)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw status == errSecSuccess ? CompanionKeychainError.invalidData : CompanionKeychainError.osStatus(status)
        }
        return try JSONDecoder().decode(MobileRelaySecrets.self, from: data)
    }

    func save(_ secrets: MobileRelaySecrets, scope: String) throws {
        let data = try JSONEncoder().encode(secrets)
        let update = SecItemUpdate(baseQuery(scope) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw CompanionKeychainError.osStatus(update) }
        var query = baseQuery(scope)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw CompanionKeychainError.osStatus(status) }
    }

    func delete(scope: String) throws {
        let status = SecItemDelete(baseQuery(scope) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CompanionKeychainError.osStatus(status) }
    }

    private func baseQuery(_ scope: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: scope]
    }
}
