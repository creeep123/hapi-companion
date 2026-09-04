import Foundation
import Security

enum CompanionKeychainError: Error {
    case invalidData
    case osStatus(OSStatus)
}

struct CompanionKeychain: Sendable {
    private let service = "io.github.creeep123.hapicompanion.device"
    private let account = "primary"

    func load() throws -> CompanionCredential? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw CompanionKeychainError.osStatus(status) }
        guard let data = result as? Data else { throw CompanionKeychainError.invalidData }
        return try JSONDecoder().decode(CompanionCredential.self, from: data)
    }

    func save(_ credential: CompanionCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let updateStatus = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw CompanionKeychainError.osStatus(updateStatus)
        }
        var query = baseQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let addStatus = SecItemAdd(query as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw CompanionKeychainError.osStatus(addStatus) }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CompanionKeychainError.osStatus(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
