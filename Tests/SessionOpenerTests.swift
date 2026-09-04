import XCTest
@testable import HAPI_Companion

final class SessionOpenerTests: XCTestCase {
    func testSameOriginIgnoresPath() throws {
        let pwa = try XCTUnwrap(URL(string: "https://hapi.example/"))
        let session = try XCTUnwrap(URL(string: "https://hapi.example/sessions/123?view=active"))
        XCTAssertTrue(CompanionConfiguration.sameOrigin(pwa, session))
    }

    func testSameOriginRejectsDifferentPortOrHost() throws {
        let origin = try XCTUnwrap(URL(string: "https://hapi.example/"))
        XCTAssertFalse(CompanionConfiguration.sameOrigin(try XCTUnwrap(URL(string: "https://other.example/")), origin))
        XCTAssertFalse(CompanionConfiguration.sameOrigin(try XCTUnwrap(URL(string: "https://hapi.example:8443/")), origin))
    }
}
