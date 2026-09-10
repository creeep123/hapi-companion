import SwiftUI
import UniformTypeIdentifiers

struct CompanionSettingsView: View {
    @Bindable var model: CompanionModel
    @State private var search = ""
    @State private var keyword = ""
    private let coral = Color(red: 0.94, green: 0.37, blue: 0.29)

    var body: some View {
        @Bindable var store = model.settings
        VStack(spacing: 0) {
            HStack {
                Circle().fill(model.status == "已连接 HAPI Hub" ? Color.green : Color.secondary).frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.status).font(.callout).lineLimit(2)
                    if let host = model.connectedHubHost {
                        Text(host).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
                Spacer()
            }.padding(.horizontal, 24).padding(.vertical, 12)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !model.notificationAllowed {
                        HStack {
                            Text(model.permissionStatus).font(.caption)
                            Spacer()
                            Button("打开设置") { model.openNotificationSettings() }
                        }.padding(10).background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("提醒音效").font(.headline)
                        HStack {
                            Picker("音效", selection: Binding(get: { model.sounds.selected }, set: { model.sounds.select($0) })) {
                                ForEach(ReminderSoundPreset.all) { sound in Text(sound.name).tag(sound.id) }
                                if let name = model.sounds.customName { Text("自选：\(name)").tag("custom") }
                            }.labelsHidden().accessibilityLabel("提醒音效")
                            Button("试听") { model.sounds.play() }
                        }
                        HStack {
                            Text("音量").font(.callout)
                            Slider(value: Binding(get: { model.sounds.volume }, set: { model.sounds.volume = $0 }), in: 0...1, step: 0.01)
                                .accessibilityLabel("提醒音量")
                            Text("\(Int((model.sounds.volume * 100).rounded()))%")
                                .monospacedDigit().frame(width: 42, alignment: .trailing)
                        }
                        Text(model.sounds.volume == 0 ? "已静音，仍显示通知。" : "只调整 Companion；最终音量也受系统音量影响。")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button(model.sounds.customName == nil ? "导入音效…" : "替换自选音效…", action: importSound)
                            if model.sounds.customName != nil { Button("移除自选", action: model.sounds.removeCustom) }
                        }
                        Text("本机通用，自动保存。支持 WAV、AIFF、MP3、M4A，最长 10 秒、最大 10 MB。")
                            .font(.caption).foregroundStyle(.secondary)
                        Text("预置音效已统一响度；自选文件保留原始响度，可用上方音量调节。")
                            .font(.caption).foregroundStyle(.secondary)
                        Text(model.sounds.volume == 0 ? "试听已静音；调高音量后再试听。" : "试听会立即播放声音，不受勿扰规则限制。")
                            .font(.caption).foregroundStyle(.secondary)
                        if let feedback = model.sounds.feedback { Text(feedback).font(.caption).foregroundStyle(.orange) }
                    }
                    Divider()
                    VStack(alignment: .leading, spacing: 8) {
                        Text("提醒哪些会话").font(.headline)
                        Picker("提醒范围", selection: $store.preferences.scope) {
                            Text("全部会话").tag(ReminderScope.all)
                            Text("指定会话").tag(ReminderScope.specified)
                        }.pickerStyle(.segmented).labelsHidden().frame(maxWidth: .infinity)
                        if store.preferences.scope == .specified {
                            HStack {
                                TextField("搜索会话标题", text: $search)
                                    .textFieldStyle(.roundedBorder)
                                    .accessibilityIdentifier("session-search")
                                Button { Task { await model.refreshCatalog() } } label: { Image(systemName: "arrow.clockwise") }
                                    .help("刷新 HAPI 会话列表").disabled(model.catalogLoading)
                            }
                            if model.catalogLoading { ProgressView("正在读取会话…").controlSize(.small) }
                            if let error = model.catalogError {
                                Text(error).font(.caption).foregroundStyle(.orange).textSelection(.enabled)
                            }
                            sessionList
                            HStack {
                                Text("已选 \(store.preferences.selectedSessionIDs.count) 个会话").font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                if !store.preferences.selectedSessionIDs.isEmpty {
                                    Button("清除选择") { store.preferences.selectedSessionIDs = [] }.font(.caption)
                                }
                            }
                            Text("或按标题关键词提醒").font(.subheadline.weight(.medium))
                            if !store.preferences.keywords.isEmpty {
                                // Adaptive grid avoids a horizontally overflowing chip row.
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 125), alignment: .leading)], alignment: .leading, spacing: 6) {
                                    ForEach(store.preferences.keywords, id: \.self) { value in
                                        HStack(spacing: 4) {
                                            Text(value).lineLimit(1).help(value)
                                            Button { store.preferences.keywords.removeAll { $0 == value } } label: {
                                                Image(systemName: "xmark").font(.caption2)
                                            }.buttonStyle(.plain).accessibilityLabel("移除关键词 \(value)")
                                        }.font(.callout).padding(.horizontal, 8).padding(.vertical, 5)
                                            .background(coral.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
                                    }
                                }
                            }
                            HStack {
                                TextField("添加标题关键词…", text: $keyword).textFieldStyle(.roundedBorder).onSubmit(addKeyword)
                                Button("添加", action: addKeyword).disabled(keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                            Text("选中会话或标题包含任一关键词，就会纳入提醒。关键词也适用于新会话。")
                                .font(.caption).foregroundStyle(.secondary)
                            if store.preferences.selectedSessionIDs.isEmpty && store.preferences.keywords.isEmpty {
                                Text("尚未选择会话或关键词，当前不会提醒任何会话。")
                                    .font(.caption).foregroundStyle(.orange)
                            }
                        }
                    }
                    Divider()
                    VStack(alignment: .leading, spacing: 10) {
                        HStack { Text("跳过短任务").font(.headline); Spacer(); Toggle("跳过短任务", isOn: $store.preferences.durationEnabled).labelsHidden().toggleStyle(.switch) }
                        if store.preferences.durationEnabled {
                            HStack {
                                Text("本轮任务超过")
                                TextField("分钟", value: $store.preferences.minimumMinutes, format: .number)
                                    .frame(width: 52).textFieldStyle(.roundedBorder)
                                Stepper("分钟", value: $store.preferences.minimumMinutes, in: 1...1440).labelsHidden().fixedSize()
                                Text("分钟才提醒")
                                Spacer()
                            }
                            Text("耗时未知的任务仍提醒；需要你授权的请求不受时长限制。")
                                .font(.caption).foregroundStyle(.secondary)
                            if !model.durationSupported {
                                Text("尚未确认 Hub 支持任务耗时。旧版 Hub 需升级集成补丁，此时不会过滤耗时未知的任务。")
                                    .font(.caption).foregroundStyle(.orange)
                            }
                        }
                    }
                    Divider()
                    VStack(alignment: .leading, spacing: 10) {
                        HStack { Text("勿扰时段").font(.headline); Spacer(); Toggle("勿扰时段", isOn: $store.preferences.quietEnabled).labelsHidden().toggleStyle(.switch) }
                        if store.preferences.quietEnabled {
                            HStack {
                                Text("每天")
                                Spacer()
                                DatePicker("开始", selection: minuteBinding(start: true), displayedComponents: .hourAndMinute).labelsHidden().frame(width: 105)
                                Text("至")
                                DatePicker("结束", selection: minuteBinding(start: false), displayedComponents: .hourAndMinute).labelsHidden().frame(width: 105)
                            }
                            Picker("勿扰期间", selection: $store.preferences.quietMode) {
                                Text("只静音").tag(QuietMode.mute)
                                Text("关闭全部提醒").tag(QuietMode.suppress)
                            }.pickerStyle(.segmented)
                            Text(store.preferences.quietStartMinutes == store.preferences.quietEndMinutes
                                 ? "开始和结束相同：全天勿扰。"
                                 : "按本机时间；勿扰期间完成的任务，结束后不补响。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Text("筛选跳过的提醒不会在修改设置后补发。")
                        .font(.caption).foregroundStyle(.secondary)
                    if model.loginItemStatus != "登录时自动启动：已启用" {
                        HStack {
                            Text(model.loginItemStatus).font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button("登录项设置") { model.openLoginItemSettings() }.font(.caption)
                        }
                    }
                }.padding(20)
            }
            Divider()
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Button("测试提醒") { Task { await model.sendTestNotification() } }
                        .help("使用当前音量发送测试提醒，不受筛选和勿扰规则限制")
                    Spacer()
                    Text(store.isConfigured ? "✓ 自动保存" : "等待 Hub 配置").font(.caption).foregroundStyle(.secondary)
                }
                if let action = model.lastAction { Text(action).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                Text("测试提醒使用当前音效和音量，不受勿扰规则限制。")
                    .font(.caption2).foregroundStyle(.secondary)
            }.padding(.horizontal, 24).padding(.vertical, 12)
        }
        .tint(coral)
        .frame(minWidth: 520, idealWidth: 560, maxWidth: .infinity, minHeight: 620, idealHeight: 800, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func importSound() {
        let panel = NSOpenPanel()
        panel.title = "选择提醒音效"
        panel.allowedContentTypes = ReminderSounds.extensions.compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do { try model.sounds.importSound(from: url) }
            catch { model.sounds.feedback = error.localizedDescription }
        }
    }

    private var sessionList: some View {
        let selected = model.settings.preferences.selectedSessionIDs
        let rows = model.catalog.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }
        let knownIDs = Set(model.catalog.map(\.id))
        let missing = selected.subtracting(knownIDs).sorted()
        return ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(rows) { session in
                    HStack {
                        Toggle(isOn: selection(session.id)) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(session.title).lineLimit(2)
                                if let name = session.machineName { Text(name).font(.caption).foregroundStyle(.secondary) }
                            }
                        }.toggleStyle(.checkbox)
                        Spacer(minLength: 0)
                    }.padding(.horizontal, 12).padding(.vertical, 9)
                    Divider()
                }
                if model.catalogLoaded && rows.isEmpty {
                    Text(search.isEmpty ? "Hub 中暂无会话" : "没有匹配的会话")
                        .foregroundStyle(.secondary).padding(16)
                }
                if !missing.isEmpty {
                    Text("已选但当前列表中不可用").font(.caption).foregroundStyle(.secondary).padding(.top, 8)
                    ForEach(missing, id: \.self) { id in
                        Toggle("会话 \(id.prefix(12))…", isOn: selection(id))
                            .toggleStyle(.checkbox).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }.frame(height: 156).background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.12)))
    }

    private func selection(_ id: String) -> Binding<Bool> {
        Binding(get: { model.settings.preferences.selectedSessionIDs.contains(id) }, set: { on in
            if on { model.settings.preferences.selectedSessionIDs.insert(id) }
            else { model.settings.preferences.selectedSessionIDs.remove(id) }
        })
    }

    private func addKeyword() {
        let value = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        model.settings.preferences.keywords.append(value)
        keyword = ""
    }

    private func minuteBinding(start: Bool) -> Binding<Date> {
        Binding(get: {
            let minutes = start ? model.settings.preferences.quietStartMinutes : model.settings.preferences.quietEndMinutes
            return Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date()) ?? Date()
        }, set: { date in
            let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
            let minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
            if start { model.settings.preferences.quietStartMinutes = minutes }
            else { model.settings.preferences.quietEndMinutes = minutes }
        })
    }
}
