import XCTest
@testable import HAPI_Companion

final class CompanionConfigurationTests: XCTestCase {
    func testSavedHomeWinsOverAnotherRunnerEnvironment() throws {
        let url = try CompanionConfiguration.settingsURL(savedHome: "/tmp/new-hub", environment: ["HAPI_HOME": "/tmp/old-hub"])
        XCTAssertEqual(url.path, "/tmp/new-hub/settings.json")
        let finder = try CompanionConfiguration.settingsURL(savedHome: "/tmp/new-hub", environment: [:])
        XCTAssertEqual(finder, url)
    }

    func testEnvironmentAndDefaultHomeResolution() throws {
        let home = URL(fileURLWithPath: "/Users/test")
        XCTAssertEqual(try CompanionConfiguration.settingsURL(savedHome: nil, environment: ["HAPI_HOME": "~/alternate"], userHome: home).path, "/Users/test/alternate/settings.json")
        XCTAssertEqual(try CompanionConfiguration.settingsURL(savedHome: nil, environment: [:], userHome: home).path, "/Users/test/.hapi/settings.json")
        XCTAssertThrowsError(try CompanionConfiguration.settingsURL(savedHome: "", environment: ["HAPI_HOME": "/tmp/valid"]))
        XCTAssertThrowsError(try CompanionConfiguration.settingsURL(savedHome: "relative", environment: [:]))
    }

    func testSelectedMissingFileDoesNotFallBack() throws {
        let path = try CompanionConfiguration.settingsURL(savedHome: "/nonexistent/\(UUID().uuidString)", environment: [:])
        XCTAssertThrowsError(try CompanionConfiguration.load(from: path))
    }

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

    func testRejectsNonHTTPHubURL() throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "hapi-companion-settings-\(UUID().uuidString).json")
        try Data(#"{"apiUrl":"file:///tmp/hapi","cliApiToken":"secret"}"#.utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertThrowsError(try CompanionConfiguration.load(from: url))
    }

    func testDefaultHTTPSPortIsSameOrigin() throws {
        let implicit = try XCTUnwrap(URL(string: "https://hapi.example"))
        let explicit = try XCTUnwrap(URL(string: "https://hapi.example:443/sessions/1"))
        XCTAssertTrue(CompanionConfiguration.sameOrigin(implicit, explicit))
    }
}
