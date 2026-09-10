import AppKit
import SwiftUI
import UserNotifications

enum CompanionRuntime {
    static var isTesting: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || NSClassFromString("XCTestCase") != nil
    }
    static var isPreview: Bool {
        ProcessInfo.processInfo.arguments.contains("--settings-preview")
            || Bundle.main.object(forInfoDictionaryKey: "HAPISettingsPreview") as? Bool == true
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private(set) var model: CompanionModel?
    private(set) var statusItem: NSStatusItem?
    private(set) var settingsWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // App-hosted XCTest must never pair, touch Keychain, register a login item or open SSE.
        guard !CompanionRuntime.isTesting else { return }
        let preview = CompanionRuntime.isPreview
        let defaults = preview ? UserDefaults(suiteName: "io.github.creeep123.hapicompanion.preview")! : .standard
        let model = CompanionModel(defaults: defaults, preview: preview)
        self.model = model
        installStatusItem()
        if !preview { UNUserNotificationCenter.current().delegate = self }
        Task {
            await model.start()
            if preview || ProcessInfo.processInfo.arguments.contains("--settings") { showSettings() }
            if ProcessInfo.processInfo.arguments.contains("--phase0-test") { await model.sendTestNotification() }
        }
    }

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            let icon = NSImage(named: "MenuBarIcon") ?? NSImage(systemSymbolName: "bell", accessibilityDescription: "HAPI Companion")
            icon?.size = NSSize(width: 18, height: 18)
            icon?.isTemplate = true
            button.image = icon
            button.toolTip = "HAPI Companion · 点击打开提醒设置"
            button.setAccessibilityLabel("HAPI Companion")
            button.target = self
            button.action = #selector(statusClicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        statusItem = item
    }

    @objc private func statusClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "提醒设置…", action: #selector(showSettings), keyEquivalent: ",").target = self
            menu.addItem(withTitle: "测试提醒（使用当前音量）", action: #selector(testReminder), keyEquivalent: "").target = self
            menu.addItem(NSMenuItem.separator())
            menu.addItem(withTitle: "退出 HAPI Companion", action: #selector(quit), keyEquivalent: "q").target = self
            statusItem?.menu = menu
            statusItem?.button?.performClick(nil)
            statusItem?.menu = nil
        } else { showSettings() }
    }

    func makeSettingsWindow(model: CompanionModel) -> NSWindow {
        if settingsWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "HAPI Companion"
            window.identifier = NSUserInterfaceItemIdentifier("companion-settings")
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: CompanionSettingsView(model: model))
            window.setContentSize(NSSize(width: 560, height: 800))
            window.setFrameAutosaveName("CompanionSettings")
            window.center()
            settingsWindow = window
        }
        return settingsWindow!
    }

    @objc func showSettings() {
        guard let model else { return }
        _ = makeSettingsWindow(model: model)
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
        Task {
            await model.refreshPermission()
            await model.refreshCatalog()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showSettings()
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationDidBecomeActive(_ notification: Notification) {
        guard let model else { return }
        Task { await model.refreshPermission() }
    }

    @objc private func testReminder() {
        Task { await model?.sendTestNotification() }
    }

    @objc private func quit() { NSApp.terminate(nil) }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if response.notification.request.identifier == CompanionUpdates.notificationID {
            if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
                await MainActor.run { self.model?.updates.checkForUpdates() }
            }
            return
        }
        guard let sessionId = response.notification.request.content.userInfo["sessionId"] as? String else { return }
        let url = response.notification.request.content.userInfo["url"] as? String ?? ""
        await MainActor.run { self.model?.openEventURL(url, fallbackSessionId: sessionId) }
    }
}
