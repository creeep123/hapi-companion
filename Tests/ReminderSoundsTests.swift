import XCTest
import AppKit
@testable import HAPI_Companion

@MainActor
final class ReminderSoundsTests: XCTestCase {
    private var root: URL!
    private var defaults: UserDefaults!
    private var suite: String!
    private var bundle: Bundle { Bundle(for: AppDelegate.self) }

    override func setUp() async throws {
        suite = "sounds-tests-" + UUID().uuidString
        defaults = UserDefaults(suiteName: suite)!
        root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suite)
        try FileManager.default.removeItem(at: root)
    }

    private func store() -> ReminderSounds {
        ReminderSounds(defaults: defaults, directory: root.appending(path: "managed"), bundle: bundle)
    }

    private func source() throws -> URL {
        let file = root.appending(path: "my sound.aiff")
        try FileManager.default.copyItem(at: XCTUnwrap(bundle.url(forResource: "HapiComplete", withExtension: "aiff")), to: file)
        return file
    }

    func testAllBundledPresetsDecodeAndAreShort() throws {
        XCTAssertEqual(Set(ReminderSoundPreset.all.map(\.id)).count, 6)
        for preset in ReminderSoundPreset.all {
            let url = try XCTUnwrap(bundle.url(forResource: preset.resource, withExtension: preset.ext))
            let sound = try XCTUnwrap(NSSound(contentsOf: url, byReference: false))
            XCTAssertGreaterThanOrEqual(sound.duration, 1)
            XCTAssertLessThanOrEqual(sound.duration, 3)
        }
    }

    func testDefaultPersistenceAndUnknownSettingRecovery() {
        let first = store()
        XCTAssertEqual(first.selected, "original")
        first.select("pixiedust")
        XCTAssertEqual(store().selected, "pixiedust")
        first.select("not-a-preset")
        XCTAssertEqual(first.selected, "pixiedust")
        defaults.set(Data("{\"selected\":\"future-preset\"}".utf8), forKey: ReminderSounds.key)
        XCTAssertEqual(store().selected, "original")
        defaults.set(Data("broken".utf8), forKey: ReminderSounds.key)
        XCTAssertEqual(store().selected, "original")
    }

    func testCustomCopySurvivesSourceDeletionAndRelaunch() throws {
        let original = try source()
        let bytes = try Data(contentsOf: original)
        let first = store()
        try first.importSound(from: original)
        try FileManager.default.removeItem(at: original)
        let second = store()
        XCTAssertEqual(second.selected, "custom")
        XCTAssertEqual(second.customName, "my sound")
        var played: URL?
        XCTAssertTrue(second.play { url, _ in played = url; return true })
        let copy = try XCTUnwrap(played)
        XCTAssertNotEqual(copy, original)
        XCTAssertEqual(try Data(contentsOf: copy), bytes)
    }

    func testRejectedImportKeepsExistingSelectionAndCopy() throws {
        let first = store()
        try first.importSound(from: source())
        let before = defaults.data(forKey: ReminderSounds.key)
        let bad = root.appending(path: "broken.wav")
        try Data("not audio".utf8).write(to: bad)
        XCTAssertThrowsError(try first.importSound(from: bad))
        try Data(repeating: 0, count: 10 * 1024 * 1024 + 1).write(to: bad)
        XCTAssertThrowsError(try first.importSound(from: bad))
        XCTAssertEqual(defaults.data(forKey: ReminderSounds.key), before)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.appending(path: "managed").path).count, 1)
    }

    func testTooLongAudioRejected() throws {
        // Valid 11-second, mono PCM WAV: verifies decoded duration, not its extension.
        var wav = Data()
        func word(_ value: UInt32, bytes: Int) {
            for index in 0..<bytes { wav.append(UInt8((value >> (8 * index)) & 255)) }
        }
        let size: UInt32 = 11 * 8000 * 2
        wav.append(Data("RIFF".utf8)); word(36 + size, bytes: 4)
        wav.append(Data("WAVEfmt ".utf8)); word(16, bytes: 4)
        word(1, bytes: 2); word(1, bytes: 2); word(8000, bytes: 4)
        word(16000, bytes: 4); word(2, bytes: 2); word(16, bytes: 2)
        wav.append(Data("data".utf8)); word(size, bytes: 4)
        wav.append(Data(repeating: 0, count: Int(size)))
        let url = root.appending(path: "long.wav")
        try wav.write(to: url)
        XCTAssertGreaterThan(try XCTUnwrap(NSSound(data: wav)).duration, 10)
        XCTAssertThrowsError(try store().importSound(from: url))
    }

    func testReplacementAndRemovalOnlyAffectManagedCopy() throws {
        let first = store()
        let original = try source()
        try first.importSound(from: original)
        try first.importSound(from: original)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.appending(path: "managed").path).count, 1)
        first.removeCustom()
        XCTAssertEqual(store().selected, "original")
        XCTAssertNil(store().customName)
        XCTAssertTrue(FileManager.default.fileExists(atPath: original.path))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.appending(path: "managed").path).isEmpty)
    }

    func testMissingCustomFallsBackAndTotalPlaybackFailureIsNotSuccess() throws {
        let first = store()
        try first.importSound(from: source())
        try FileManager.default.removeItem(at: root.appending(path: "managed"))
        var attempts: [String] = []
        XCTAssertTrue(first.play { url, _ in
            attempts.append(url.lastPathComponent)
            return FileManager.default.fileExists(atPath: url.path)
        })
        XCTAssertEqual(attempts.count, 2)
        XCTAssertEqual(attempts.last, "SoundOriginal.wav")
        XCTAssertNotNil(first.feedback)
        XCTAssertFalse(first.play { _, _ in false })
    }

    func testMalformedStoredPathCannotPlayOrDeleteOutsideManagedDirectory() throws {
        let original = try source()
        let payload = try JSONSerialization.data(withJSONObject: [
            "selected": "custom", "customFile": original.path, "customName": "outside"
        ])
        defaults.set(payload, forKey: ReminderSounds.key)
        let first = store()
        XCTAssertEqual(first.selected, "original")
        first.removeCustom()
        XCTAssertTrue(FileManager.default.fileExists(atPath: original.path))
    }

    func testFailedCopyPreservesSelection() throws {
        let original = try source()
        let blockedDirectory = root.appending(path: "managed")
        try Data("a file, not a directory".utf8).write(to: blockedDirectory)
        let first = store()
        first.select("cetialpha")
        XCTAssertThrowsError(try first.importSound(from: original))
        XCTAssertEqual(store().selected, "cetialpha")
        XCTAssertNil(first.customName)
        XCTAssertTrue(FileManager.default.fileExists(atPath: original.path))
    }

    func testVolumeMigratesWithoutChangingOldSoundSettingsAndPersists() throws {
        let first = store()
        try first.importSound(from: source())
        let existingMetadata = defaults.data(forKey: ReminderSounds.key)
        XCTAssertEqual(first.volume, 0.8)
        first.volume = 0.37
        XCTAssertEqual(store().volume, 0.37)
        XCTAssertEqual(defaults.data(forKey: ReminderSounds.key), existingMetadata)
        XCTAssertEqual(store().selected, "custom")
        first.removeCustom()
        XCTAssertEqual(store().volume, 0.37)
    }

    func testImportKeepsVolumeAndFallbackReceivesSameGain() throws {
        let first = store()
        first.volume = 0.42
        try first.importSound(from: source())
        XCTAssertEqual(first.volume, 0.42)
        var gains: [Float] = []
        XCTAssertTrue(first.play { _, gain in
            gains.append(gain)
            return gains.count == 2
        })
        XCTAssertEqual(gains, [0.42, 0.42])
    }

    func testZeroVolumeIsIntentionalSilenceEvenWhenAudioMissing() {
        let first = store()
        first.select("moonbeam")
        first.volume = 0
        XCTAssertTrue(first.play { _, _ in XCTFail("Muted playback must not open an audio device"); return false })
        XCTAssertEqual(store().volume, 0)
        first.volume = 0.1
        XCTAssertFalse(first.play { _, _ in false }, "Nonzero playback failures must remain retryable")
    }

    func testVolumeBoundsAndMalformedPersistedValues() {
        let first = store()
        first.volume = 2
        XCTAssertEqual(first.volume, 1)
        first.volume = -1
        XCTAssertEqual(first.volume, 0)
        first.volume = .nan
        XCTAssertEqual(first.volume, 0.8)
        defaults.set(3, forKey: ReminderSounds.volumeKey)
        XCTAssertEqual(store().volume, 1)
        defaults.set("invalid", forKey: ReminderSounds.volumeKey)
        XCTAssertEqual(store().volume, 0.8)
    }
}
