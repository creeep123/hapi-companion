import Darwin
import Foundation

enum SingleInstanceClaim {
    case acquired(SingleInstanceGuard)
    case alreadyRunning
    case unavailable(Error)
}

/// Keeps one Companion process per macOS user, even when another copy is launched
/// from Xcode, a build directory, or an old app location with the same bundle ID.
final class SingleInstanceGuard {
    private let lockURL: URL
    private var descriptor: Int32 = -1

    init(lockURL: URL) {
        self.lockURL = lockURL
    }

    static func claimDefault(fileManager: FileManager = .default) -> SingleInstanceClaim {
        do {
            let directory = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appending(path: "HAPI Companion", directoryHint: .isDirectory)
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            return SingleInstanceGuard(lockURL: directory.appending(path: "instance.lock")).claim()
        } catch {
            return .unavailable(error)
        }
    }

    func claim() -> SingleInstanceClaim {
        guard descriptor < 0 else { return .acquired(self) }
        let fd = Darwin.open(lockURL.path, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard fd >= 0 else {
            return .unavailable(POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO))
        }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            let code = errno
            Darwin.close(fd)
            if code == EWOULDBLOCK { return .alreadyRunning }
            return .unavailable(POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO))
        }
        descriptor = fd
        return .acquired(self)
    }

    func release() {
        guard descriptor >= 0 else { return }
        flock(descriptor, LOCK_UN)
        Darwin.close(descriptor)
        descriptor = -1
    }

    deinit { release() }
}
