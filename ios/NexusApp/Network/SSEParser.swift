import Foundation

/// Unified SSE parser used by both GET (SSEClient) and POST (AgentStreamClient) streams.
/// Thread-safe: protects internal buffer with NSLock.
final class SSEParser: @unchecked Sendable {
    struct Message {
        var event: String?
        var data: String
        var id: String?
    }

    private(set) var lastEventID: String?
    private var buffer = ""
    private var currentEvent: String?
    private var currentData: [String] = []
    private var currentID: String?
    private let lock = NSLock()

    /// Feed a chunk of raw SSE text. Returns zero or more fully parsed messages.
    func feed(_ chunk: String) -> [Message] {
        lock.lock()
        defer { lock.unlock() }

        buffer += chunk
        var messages: [Message] = []

        // Split into lines. The last element may be an incomplete line
        // if the chunk didn't end with "\n".
        let lines = buffer.components(separatedBy: "\n")
        let hasTrailingNewline = buffer.hasSuffix("\n")
        let completeLineCount = hasTrailingNewline ? lines.count : max(lines.count - 1, 0)

        for i in 0..<completeLineCount {
            let line = lines[i]

            if line.isEmpty {
                // Empty line = dispatch event
                if !currentData.isEmpty {
                    let message = Message(
                        event: currentEvent,
                        data: currentData.joined(separator: "\n"),
                        id: currentID
                    )
                    if let id = currentID { lastEventID = id }
                    messages.append(message)
                }
                currentEvent = nil
                currentData = []
                currentID = nil
            } else if line.hasPrefix("event:") {
                currentEvent = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                currentData.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
            } else if line.hasPrefix("id:") {
                currentID = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("retry:") {
                // Could handle reconnection interval
            }
            // Lines starting with ":" are comments, ignore
        }

        // Buffer = only the incomplete trailing line (if any)
        if hasTrailingNewline {
            buffer = ""
        } else {
            buffer = lines.last ?? ""
        }

        return messages
    }

    /// Reset parser state (call on disconnect/reconnect)
    func reset() {
        lock.lock()
        defer { lock.unlock() }
        buffer = ""
        currentEvent = nil
        currentData = []
        currentID = nil
    }
}
