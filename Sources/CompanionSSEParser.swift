import Foundation

struct CompanionSSEFrame: Equatable {
    let event: String
    let id: Int?
    let data: String
}

struct CompanionSSEParser {
    private var buffer = Data()
    private let maximumFrameBytes = 1_048_576

    mutating func append(_ byte: UInt8) throws -> CompanionSSEFrame? {
        buffer.append(byte)
        guard buffer.count <= maximumFrameBytes else { throw URLError(.dataLengthExceedsMaximum) }
        let endsLF = buffer.count >= 2 && buffer.suffix(2).elementsEqual([10, 10])
        let endsCRLF = buffer.count >= 4 && buffer.suffix(4).elementsEqual([13, 10, 13, 10])
        guard endsLF || endsCRLF else { return nil }
        defer { buffer.removeAll(keepingCapacity: true) }
        guard let text = String(data: buffer, encoding: .utf8) else { throw URLError(.cannotDecodeContentData) }
        return Self.parseFrame(text)
    }

    static func parseFrame(_ text: String) -> CompanionSSEFrame {
        var event = ""
        var id: Int?
        var dataLines: [String] = []
        for rawLine in text.split(whereSeparator: { $0.isNewline }) {
            let line = String(rawLine)
            if line.hasPrefix("event:") {
                event = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("id:") {
                id = Int(line.dropFirst(3).trimmingCharacters(in: .whitespaces))
            } else if line.hasPrefix("data:") {
                var value = String(line.dropFirst(5))
                if value.first == " " { value.removeFirst() }
                dataLines.append(value)
            }
        }
        return CompanionSSEFrame(event: event, id: id, data: dataLines.joined(separator: "\n"))
    }
}
