import XCTest
@testable import HAPI_Companion

final class CompanionSSEParserTests: XCTestCase {
    func testParsesLFFrameInHonoFieldOrder() throws {
        var parser = CompanionSSEParser()
        var result: CompanionSSEFrame?
        for byte in Data("event: notification\ndata: {\"ok\":true}\nid: 42\n\n".utf8) {
            if let frame = try parser.append(byte) { result = frame }
        }
        XCTAssertEqual(result, CompanionSSEFrame(event: "notification", id: 42, data: "{\"ok\":true}"))
    }

    func testParsesCRLFAndMultipleDataLines() throws {
        var parser = CompanionSSEParser()
        var result: CompanionSSEFrame?
        for byte in Data("id: 7\r\nevent: notification\r\ndata: first\r\ndata: second\r\n\r\n".utf8) {
            if let frame = try parser.append(byte) { result = frame }
        }
        XCTAssertEqual(result, CompanionSSEFrame(event: "notification", id: 7, data: "first\nsecond"))
    }
}
