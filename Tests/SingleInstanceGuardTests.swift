import XCTest
@testable import HAPI_Companion

final class SingleInstanceGuardTests: XCTestCase {
    func testSecondClaimFailsUntilFirstInstanceReleasesLock() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "SingleInstanceGuardTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let lock = directory.appending(path: "instance.lock")
        let first = SingleInstanceGuard(lockURL: lock)
        let second = SingleInstanceGuard(lockURL: lock)

        guard case .acquired = first.claim() else { return XCTFail("first instance did not acquire lock") }
        guard case .alreadyRunning = second.claim() else { return XCTFail("duplicate instance was not rejected") }
        first.release()
        guard case .acquired = second.claim() else { return XCTFail("lock was not released") }
    }
}
