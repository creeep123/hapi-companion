import Foundation
import Security

struct CompanionSidecarCredentialAccess: Sendable {
    var load: @Sendable (URL) throws -> CompanionCredential?
    var save: @Sendable (CompanionCredential) throws -> Void
    var delete: @Sendable (URL) throws -> Void

    static let keychain = CompanionSidecarCredentialAccess(
        load: { try CompanionSidecarKeychain().load(publicHubURL: $0) },
        save: { try CompanionSidecarKeychain().save($0) },
        delete: { try CompanionSidecarKeychain().delete(publicHubURL: $0) }
    )
}

struct CompanionSidecarKeychain: Sendable {
    private let service = "io.github.creeep123.hapicompanion.device.v2"
    func load(publicHubURL: URL) throws -> CompanionCredential? {
        var query = baseQuery(publicHubURL)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw CompanionKeychainError.osStatus(status) }
        let credential = try JSONDecoder().decode(CompanionCredential.self, from: data)
        guard credential.transportVersion == 2, let bound = credential.publicHubURL,
              CompanionConfiguration.sameOrigin(bound, publicHubURL) else { throw CompanionKeychainError.invalidData }
        return credential
    }
    func save(_ credential: CompanionCredential) throws {
        guard credential.transportVersion == 2, let origin = credential.publicHubURL else { throw CompanionKeychainError.invalidData }
        let data = try JSONEncoder().encode(credential), base = baseQuery(origin)
        let updated = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw CompanionKeychainError.osStatus(updated) }
        var query = base; query[kSecValueData as String] = data; query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(query as CFDictionary, nil); guard status == errSecSuccess else { throw CompanionKeychainError.osStatus(status) }
    }
    func delete(publicHubURL: URL) throws { let status = SecItemDelete(baseQuery(publicHubURL) as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw CompanionKeychainError.osStatus(status) } }
    private func baseQuery(_ url: URL) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: Data(normalized(url).utf8).base64EncodedString()] }
    private func normalized(_ url: URL) -> String { let port = url.port.map { ":\($0)" } ?? ""; return "\(url.scheme?.lowercased() ?? "")://\(url.host?.lowercased() ?? "")\(port)" }
}
