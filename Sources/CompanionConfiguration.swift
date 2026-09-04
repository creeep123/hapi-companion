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
              !settings.cliApiToken.isEmpty else {
            throw CompanionConfigurationError.invalidCLISettings
        }
        return CompanionConfiguration(hubURL: hubURL, cliAPIToken: settings.cliApiToken)
    }
}
