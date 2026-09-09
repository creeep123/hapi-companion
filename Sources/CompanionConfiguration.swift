import Foundation

enum CompanionConfigurationError: LocalizedError {
    case missingCLISettings
    case invalidCLISettings
    case invalidHomeDirectory

    var errorDescription: String? {
        switch self {
        case .missingCLISettings: "找不到所选 HAPI 配置目录中的 settings.json"
        case .invalidHomeDirectory: "HAPI 配置目录必须是绝对路径"
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

    // A saved app-specific selection wins over a shell's HAPI_HOME. Finder and
    // login launches therefore connect to the same Hub as the installer.
    static let homeDirectoryKey = "hapiHomeDirectory"

    static func settingsURL(
        savedHome: String? = UserDefaults.standard.string(forKey: homeDirectoryKey),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        userHome: URL = FileManager.default.homeDirectoryForCurrentUser
    ) throws -> URL {
        let selected = savedHome ?? environment["HAPI_HOME"] ?? userHome.appending(path: ".hapi").path
        let expanded: String
        if selected == "~" { expanded = userHome.path }
        else if selected.hasPrefix("~/") { expanded = userHome.appending(path: String(selected.dropFirst(2))).path }
        else { expanded = selected }
        guard expanded.hasPrefix("/") else { throw CompanionConfigurationError.invalidHomeDirectory }
        return URL(fileURLWithPath: expanded, isDirectory: true).appending(path: "settings.json")
    }

    static func load() throws -> CompanionConfiguration {
        try load(from: settingsURL())
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
