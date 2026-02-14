import Foundation

/// SSE events from /api/events/stream
enum SSEEventType: String {
    case taskStdout = "task:stdout"
    case taskText = "task:text"
    case taskProgress = "task:progress"
    case taskResult = "task:result"
    case taskToolTrace = "task:tool_trace"
    case taskFileChange = "task:file_change"
    case taskSessionInit = "task:session_init"
    case taskSteerAck = "task:steer_ack"
    case machineConnected = "machine:connected"
    case machineDisconnected = "machine:disconnected"
    case sessionAttached = "session:attached"
    case sessionDetached = "session:detached"
    case sessionEvent = "session:event"
    case heartbeat
}

/// Parsed real-time event from SSE stream
struct ActivityEvent: Identifiable {
    let id: String
    let type: SSEEventType
    let timestamp: Date
    let data: [String: AnyCodable]

    init(id: String = UUID().uuidString, type: SSEEventType, timestamp: Date = .now, data: [String: AnyCodable] = [:]) {
        self.id = id
        self.type = type
        self.timestamp = timestamp
        self.data = data
    }

    var taskId: String? { data["taskId"]?.stringValue }
    var machineId: String? { data["machineId"]?.stringValue }
}
