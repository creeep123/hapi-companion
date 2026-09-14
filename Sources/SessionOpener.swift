import AppKit

enum SessionOpenError: LocalizedError {
    case noHandler

    var errorDescription: String? {
        switch self {
        case .noHandler: "找不到可打开 HAPI 的应用"
        }
    }
}

struct SessionOpener {
    func open(
        url: URL,
        hubOrigin: URL,
        completion: @escaping @Sendable (Result<String, Error>) -> Void
    ) {
        if let pwa = findInstalledEdgePWA(for: hubOrigin) {
            // Pass the deep link to the installed PWA in one launch request. A supported
            // HAPI PWA consumes it with Launch Handler and changes its SPA route in place.
            launchPWA(at: pwa, url: url, completion: completion)
            return
        }

        openEdgeFallback(url: url, completion: completion)
    }

    private func findInstalledEdgePWA(for hubOrigin: URL) -> URL? {
        let fileManager = FileManager.default
        let roots = [
            fileManager.homeDirectoryForCurrentUser.appending(path: "Applications/Edge Apps.localized"),
            URL(fileURLWithPath: "/Applications/Edge Apps.localized", isDirectory: true)
        ]
        for root in roots {
            guard let apps = try? fileManager.contentsOfDirectory(
                at: root,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            ) else { continue }
            for app in apps where app.pathExtension == "app" {
                guard let bundle = Bundle(url: app),
                      bundle.object(forInfoDictionaryKey: "CrBundleIdentifier") as? String == "com.microsoft.edgemac",
                      let shortcut = bundle.object(forInfoDictionaryKey: "CrAppModeShortcutURL") as? String,
                      let shortcutURL = URL(string: shortcut),
                      CompanionConfiguration.sameOrigin(shortcutURL, hubOrigin) else { continue }
                return app
            }
        }
        return nil
    }

    private func launchPWA(
        at pwa: URL,
        url: URL,
        completion: @escaping @Sendable (Result<String, Error>) -> Void
    ) {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        NSWorkspace.shared.open([url], withApplicationAt: pwa, configuration: configuration) { _, error in
            if let error {
                CompanionLog.error("installed PWA launch failed: \(error.localizedDescription)")
                openEdgeFallback(url: url, completion: completion)
            } else {
                completion(.success("Edge HAPI PWA 窗口"))
            }
        }
    }

    private func openEdgeFallback(
        url: URL,
        completion: @escaping @Sendable (Result<String, Error>) -> Void
    ) {
        if let edge = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.microsoft.edgemac") {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            configuration.createsNewApplicationInstance = true
            configuration.arguments = ["--app=\(url.absoluteString)"]
            NSWorkspace.shared.openApplication(at: edge, configuration: configuration) { _, error in
                if let error {
                    completion(.failure(error))
                } else {
                    completion(.success("新的 Edge HAPI 应用窗口"))
                }
            }
            return
        }

        if NSWorkspace.shared.open(url) {
            completion(.success("默认浏览器（降级路径）"))
        } else {
            completion(.failure(SessionOpenError.noHandler))
        }
    }
}
