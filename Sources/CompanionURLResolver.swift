import Foundation

struct CompanionResolvedURL: Equatable {
    let target: URL
    let hubOrigin: URL
}

enum CompanionURLResolver {
    static func resolve(eventURL value: String, sessionId: String, configuredHubURL: URL) -> CompanionResolvedURL? {
        guard let hubOrigin = origin(of: configuredHubURL),
              let encodedSessionId = encodedPathComponent(sessionId),
              let fallback = URL(string: "/sessions/\(encodedSessionId)", relativeTo: hubOrigin)?.absoluteURL else {
            return nil
        }
        let candidate = URL(string: value, relativeTo: hubOrigin)?.absoluteURL
        let target = candidate.flatMap {
            CompanionConfiguration.sameOrigin($0, hubOrigin) ? $0 : nil
        } ?? fallback
        return CompanionResolvedURL(target: target, hubOrigin: hubOrigin)
    }

    private static func origin(of url: URL) -> URL? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private static func encodedPathComponent(_ value: String) -> String? {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#")
        return value.addingPercentEncoding(withAllowedCharacters: allowed)
    }
}
