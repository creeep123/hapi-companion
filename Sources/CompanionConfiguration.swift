import Foundation

enum CompanionConfigurationError: LocalizedError {
    case missingCLISettings
    case invalidCLISettings

    var errorDescription: String? {
        switch self {
        case .missingCLISettings: "找不到 ~/.hapi/settings.json"
        case .invalidCLISettings: "HAPI CLI 设置缺少 apiUrl 或 cliApiToken"
        }
    }
}

struct CompanionConfiguration: Sendable {
    let hubURL: URL
    let cliAPIToken: String

    private struct CLISettings: Decodable {
        let apiUrl: String
        let cliApiToken: String
    }

    static func load() throws -> CompanionConfiguration {
        let settingsURL = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: ".hapi/settings.json")
        return try load(from: settingsURL)
    }

    static func load(from settingsURL: URL) throws -> CompanionConfiguration {
        guard let data = try? Data(contentsOf: settingsURL) else {
            throw CompanionConfigurationError.missingCLISettings
        }
        guard let settings = try? JSONDecoder().decode(CLISettings.self, from: data),
              let hubURL = URL(string: settings.apiUrl),
              ["http", "https"].contains(hubURL.scheme?.lowercased() ?? ""),
              hubURL.host != nil,
              !settings.cliApiToken.isEmpty else {
            throw CompanionConfigurationError.invalidCLISettings
        }
        return CompanionConfiguration(hubURL: hubURL, cliAPIToken: settings.cliApiToken)
    }

    static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && effectivePort(lhs) == effectivePort(rhs)
    }

    private static func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }
}
