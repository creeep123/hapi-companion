import AppKit
import Observation

struct ReminderSoundPreset: Identifiable {
    let id: String
    let name: String
    let resource: String
    let ext: String

    static let all: [Self] = [
        .init(id: "original", name: "经典完成 · 1.7 秒", resource: "SoundOriginal", ext: "wav"),
        .init(id: "pixiedust", name: "星尘 · Pixie Dust · 1.7 秒", resource: "SoundPixieDust", ext: "wav"),
        .init(id: "moonbeam", name: "月光 · Moonbeam · 1.9 秒", resource: "SoundMoonbeam", ext: "wav"),
        .init(id: "tejat", name: "双音轻铃 · Tejat · 1.2 秒", resource: "SoundTejat", ext: "wav"),
        .init(id: "capella", name: "明亮和弦 · Capella · 1.4 秒", resource: "SoundCapella", ext: "wav"),
        .init(id: "cetialpha", name: "电子回响 · Ceti Alpha · 2.9 秒", resource: "SoundCetiAlpha", ext: "wav")
    ]
}

enum ReminderSoundError: LocalizedError {
    case invalidFile
    var errorDescription: String? { "请选择可播放的 WAV、AIFF、MP3 或 M4A 短音效（不超过 10 秒、10 MB）。" }
}

@MainActor
@Observable
final class ReminderSounds {
    private struct Saved: Codable {
        var selected = "original"
        var customFile: String?
        var customName: String?
    }
    static let key = "reminderSounds.v1"
    static let volumeKey = "reminderSoundVolume.v1"
    static let extensions = ["wav", "aiff", "aif", "mp3", "m4a"]
    private let defaults: UserDefaults
    private let directory: URL
    private let bundle: Bundle
    private var saved: Saved
    private var activeSound: NSSound?
    private var volumeLevel: Double
    var feedback: String?

    var selected: String { saved.selected }
    var customName: String? { saved.customName }
    var volume: Double {
        get { volumeLevel }
        set {
            volumeLevel = Self.clampedVolume(newValue)
            defaults.set(volumeLevel, forKey: Self.volumeKey)
            activeSound?.volume = Float(volumeLevel)
            if volumeLevel == 0 { activeSound?.stop() }
            feedback = nil
        }
    }

    private static func clampedVolume(_ value: Double) -> Double {
        value.isFinite ? min(1, max(0, value)) : 0.8
    }

    init(defaults: UserDefaults = .standard, directory: URL? = nil, bundle: Bundle = .main) {
        self.defaults = defaults
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "HAPI Companion/Sounds", directoryHint: .isDirectory)
        self.bundle = bundle
        volumeLevel = Self.clampedVolume((defaults.object(forKey: Self.volumeKey) as? NSNumber)?.doubleValue ?? 0.8)
        saved = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(Saved.self, from: $0) } ?? Saved()
        if !ReminderSoundPreset.all.contains(where: { $0.id == saved.selected }) && saved.selected != "custom" {
            saved.selected = "original"
        }
        if customURL == nil || saved.customName == nil {
            saved.customFile = nil
            saved.customName = nil
            if saved.selected == "custom" { saved.selected = "original" }
        }
    }

    func select(_ id: String) {
        guard ReminderSoundPreset.all.contains(where: { $0.id == id }) || (id == "custom" && customURL != nil) else { return }
        saved.selected = id
        feedback = nil
        persist()
    }

    private var customURL: URL? {
        guard let file = saved.customFile, file == (file as NSString).lastPathComponent,
              UUID(uuidString: (file as NSString).deletingPathExtension) != nil,
              Self.extensions.contains((file as NSString).pathExtension) else { return nil }
        return directory.appending(path: file)
    }

    /// Validate before replacing either preferences or the previous managed copy.
    func importSound(from source: URL) throws {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let ext = source.pathExtension.lowercased()
        let info = try source.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard Self.extensions.contains(ext), info.isRegularFile == true,
              let size = info.fileSize, size > 0, size <= 10 * 1024 * 1024 else { throw ReminderSoundError.invalidFile }
        let data = try Data(contentsOf: source)
        guard data.count <= 10 * 1024 * 1024, let sound = NSSound(data: data),
              sound.duration.isFinite, sound.duration > 0, sound.duration <= 10 else { throw ReminderSoundError.invalidFile }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let name = UUID().uuidString + "." + ext
        let destination = directory.appending(path: name)
        try data.write(to: destination, options: .atomic)
        let old = customURL
        saved = Saved(selected: "custom", customFile: name, customName: source.deletingPathExtension().lastPathComponent)
        persist()
        if let old { try? FileManager.default.removeItem(at: old) }
        feedback = "已导入并选用；移动原文件不影响提醒。"
    }

    func removeCustom() {
        let old = customURL
        if saved.selected == "custom" { saved.selected = "original" }
        saved.customFile = nil
        saved.customName = nil
        persist()
        if let old { try? FileManager.default.removeItem(at: old) }
        feedback = "已移除自选音效。"
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(saved) { defaults.set(data, forKey: Self.key) }
    }

    private func presetURL(_ id: String) -> URL? {
        guard let preset = ReminderSoundPreset.all.first(where: { $0.id == id }) else { return nil }
        return bundle.url(forResource: preset.resource, withExtension: preset.ext)
    }

    /// A failed custom sound may fall back, but never makes failed playback count as delivery.
    @discardableResult
    func play(using start: ((URL, Float) -> Bool)? = nil) -> Bool {
        if volume == 0 {
            activeSound?.stop()
            feedback = "音量为 0%，仅显示通知，不播放声音。"
            return true
        }
        let start = start ?? { [self] url, gain in
            guard let sound = NSSound(contentsOf: url, byReference: false) else { return false }
            activeSound?.stop()
            sound.volume = gain
            activeSound = sound
            return sound.play()
        }
        let chosen = saved.selected == "custom" ? customURL : presetURL(saved.selected)
        if let chosen, start(chosen, Float(volume)) { feedback = nil; return true }
        if saved.selected != "original", let fallback = presetURL("original"), start(fallback, Float(volume)) {
            feedback = "所选音效不可用，本次已改用经典完成；请重新选择或导入。"
            return true
        }
        feedback = "提示音播放失败，请重新选择音效或检查音频输出。"
        return false
    }
}
