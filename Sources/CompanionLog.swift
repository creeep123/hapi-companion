import OSLog

enum CompanionLog {
    private static let logger = Logger(subsystem: "io.github.creeep123.hapicompanion", category: "connection")

    static func info(_ message: String) {
        logger.info("\(message, privacy: .public)")
    }

    static func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
    }
}
