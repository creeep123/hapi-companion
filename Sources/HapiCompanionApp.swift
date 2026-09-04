import SwiftUI

@main
struct HapiCompanionApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra("HAPI Companion", systemImage: "bell.badge") {
            CompanionMenu()
                .environment(appDelegate.model)
        }
        .menuBarExtraStyle(.menu)
    }
}

private struct CompanionMenu: View {
    @Environment(CompanionModel.self) private var model

    var body: some View {
        Text(model.status)
        Text(model.loginItemStatus)
        if model.loginItemStatus.contains("需要") || model.loginItemStatus.contains("未启用") {
            Button("打开登录项设置") { model.openLoginItemSettings() }
        }
        Divider()
        Button("测试提示音") {
            model.playSound()
        }
        Button("测试原生通知") {
            Task { await model.sendTestNotification() }
        }
        Divider()
        Button("退出") {
            NSApplication.shared.terminate(nil)
        }
    }
}
