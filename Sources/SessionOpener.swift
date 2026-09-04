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
            findExistingEdgeWindow(origin: hubOrigin) { found in
                if found {
                    focusPWA(at: pwa) { focusResult in
                        switch focusResult {
                        case .failure(let error):
                            CompanionLog.error("installed PWA focus failed: \(error.localizedDescription)")
                            launchPWA(at: pwa, url: url, completion: completion)
                        case .success:
                            // Opening the PWA shim raises its existing app window, but may also
                            // restore its start URL. Navigate only after that activation settles.
                            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.5) {
                                navigateExistingEdgeWindow(url: url, origin: hubOrigin) { reused in
                                    if reused {
                                        completion(.success("现有 Edge HAPI PWA 窗口中的对应会话"))
                                    } else {
                                        launchPWA(at: pwa, url: url, completion: completion)
                                    }
                                }
                            }
                        }
                    }
                } else {
                    launchPWA(at: pwa, url: url, completion: completion)
                }
            }
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

    private func findExistingEdgeWindow(
        origin: URL,
        completion: @escaping @Sendable (Bool) -> Void
    ) {
        let originValue = appleScriptLiteral(originPrefix(origin))
        let source = """
        tell application "Microsoft Edge"
            if not running then return "not-found"
            repeat with w in windows
                try
                    if URL of active tab of w starts with \(originValue) then return "found"
                end try
            end repeat
            return "not-found"
        end tell
        """
        runAppleScript(source: source, expectedResult: "found", completion: completion)
    }

    private func navigateExistingEdgeWindow(
        url: URL,
        origin: URL,
        completion: @escaping @Sendable (Bool) -> Void
    ) {
        let target = appleScriptLiteral(url.absoluteString)
        let originValue = appleScriptLiteral(originPrefix(origin))
        let source = """
        tell application "Microsoft Edge"
            repeat with w in windows
                try
                    if URL of active tab of w starts with \(originValue) then
                        set URL of active tab of w to \(target)
                        return "reused"
                    end if
                end try
            end repeat
            return "not-found"
        end tell
        """
        runAppleScript(source: source, expectedResult: "reused", completion: completion)
    }

    private func runAppleScript(
        source: String,
        expectedResult: String,
        completion: @escaping @Sendable (Bool) -> Void
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            var details: NSDictionary?
            let result = NSAppleScript(source: source)?.executeAndReturnError(&details).stringValue
            if let details {
                CompanionLog.error("Edge automation failed: \(details)")
            }
            completion(result == expectedResult)
        }
    }

    private func focusPWA(
        at pwa: URL,
        completion: @escaping @Sendable (Result<Void, Error>) -> Void
    ) {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        NSWorkspace.shared.openApplication(at: pwa, configuration: configuration) { _, error in
            if let error { completion(.failure(error)) }
            else { completion(.success(())) }
        }
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

    private func appleScriptLiteral(_ value: String) -> String {
        let escaped = value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    private func originPrefix(_ origin: URL) -> String {
        origin.absoluteString.hasSuffix("/") ? origin.absoluteString : origin.absoluteString + "/"
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
