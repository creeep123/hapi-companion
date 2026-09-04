import XCTest
@testable import HAPI_Companion

final class CompanionURLResolverTests: XCTestCase {
    func testAcceptsExactSessionURLFromConfiguredHub() throws {
        let hub = try XCTUnwrap(URL(string: "https://hapi.example"))
        let result = try XCTUnwrap(CompanionURLResolver.resolve(
            eventURL: "https://hapi.example/sessions/abc",
            sessionId: "fallback",
            configuredHubURL: hub
        ))
        XCTAssertEqual(result.target.absoluteString, "https://hapi.example/sessions/abc")
        XCTAssertEqual(result.hubOrigin.absoluteString, "https://hapi.example")
    }

    func testRejectsExternalEventURLAndUsesConfiguredHubFallback() throws {
        let hub = try XCTUnwrap(URL(string: "https://hapi.example"))
        let result = try XCTUnwrap(CompanionURLResolver.resolve(
            eventURL: "https://evil.example/session/abc",
            sessionId: "safe-session",
            configuredHubURL: hub
        ))
        XCTAssertEqual(result.target.absoluteString, "https://hapi.example/sessions/safe-session")
    }

    func testAcceptsRelativeEventURL() throws {
        let hub = try XCTUnwrap(URL(string: "https://hapi.example"))
        let result = try XCTUnwrap(CompanionURLResolver.resolve(
            eventURL: "/sessions/abc",
            sessionId: "fallback",
            configuredHubURL: hub
        ))
        XCTAssertEqual(result.target.absoluteString, "https://hapi.example/sessions/abc")
    }

    func testEscapesFallbackSessionAsOnePathComponent() throws {
        let hub = try XCTUnwrap(URL(string: "https://hapi.example"))
        let result = try XCTUnwrap(CompanionURLResolver.resolve(
            eventURL: "https://evil.example/session",
            sessionId: "../admin?x=1",
            configuredHubURL: hub
        ))
        XCTAssertEqual(result.target.absoluteString, "https://hapi.example/sessions/..%2Fadmin%3Fx=1")
    }
}
