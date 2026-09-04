import XCTest
@testable import HAPI_Companion

final class CompanionConfigurationTests: XCTestCase {
    func testLoadsValidCLISettings() throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "hapi-companion-settings-\(UUID().uuidString).json")
        try Data(#"{"apiUrl":"https://hapi.example","cliApiToken":"secret"}"#.utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let configuration = try CompanionConfiguration.load(from: url)
        XCTAssertEqual(configuration.hubURL.absoluteString, "https://hapi.example")
        XCTAssertEqual(configuration.cliAPIToken, "secret")
    }

    func testRejectsMissingToken() throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "hapi-companion-settings-\(UUID().uuidString).json")
        try Data(#"{"apiUrl":"https://hapi.example","cliApiToken":""}"#.utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertThrowsError(try CompanionConfiguration.load(from: url))
    }
}
