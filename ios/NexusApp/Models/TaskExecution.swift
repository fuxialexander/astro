import Foundation

struct TaskExecution: Codable, Identifiable {
    var id: String { executionId }
    var nodeId: String
    var projectId: String
    var executionId: String
    var status: ExecutionStatus
    var streamText: String
    var error: String?
    var startedAt: Date
    var completedAt: Date?
    var toolTraces: [ToolTrace]
    var fileChanges: [FileChange]
    var sessionId: String?
    var machineId: String?
    var providerId: String?
    var providerName: String?
    var metrics: UsageMetrics?
    var activityEvents: [TaskActivityEvent]
    var branchName: String?
    var prUrl: String?
    var prNumber: Int?

    enum ExecutionStatus: String, Codable {
        case pending, running, success, failure, cancelled
    }
}

struct ToolTrace: Codable, Identifiable {
    let id: String
    var toolName: String
    var toolInput: AnyCodable
    var toolResult: AnyCodable?
    var success: Bool?
    var duration: Double?
    var timestamp: Date
}

struct FileChange: Codable, Identifiable {
    var id: String { path + (timestamp.map { "\($0.timeIntervalSince1970)" } ?? "") }
    var path: String
    var action: FileAction
    var linesAdded: Int?
    var linesRemoved: Int?
    var diff: String?
    var timestamp: Date?

    enum FileAction: String, Codable {
        case create, modify, delete
    }
}

enum TaskActivityEvent: Codable {
    case text(content: String, timestamp: Date)
    case toolUse(id: String, toolName: String, toolInput: AnyCodable, timestamp: Date)
    case toolResult(id: String, toolName: String, toolResult: AnyCodable?, success: Bool?, duration: Double?, timestamp: Date)
    case steer(message: String, accepted: Bool?, ackMessage: String?, interrupted: Bool?, timestamp: Date)
    case chatUser(message: String, timestamp: Date)
    case chatAssistant(content: String, timestamp: Date)
    case fileChange(path: String, action: String, diff: String?, linesAdded: Int?, linesRemoved: Int?, timestamp: Date)
    case error(error: String, timestamp: Date)

    private enum CodingKeys: String, CodingKey {
        case type, content, timestamp, id, toolName, toolInput, toolResult, success, duration
        case message, accepted, ackMessage, interrupted, path, action, diff, linesAdded, linesRemoved, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        let ts = try container.decode(Date.self, forKey: .timestamp)

        switch type {
        case "text":
            self = .text(content: try container.decode(String.self, forKey: .content), timestamp: ts)
        case "tool_use":
            self = .toolUse(
                id: try container.decode(String.self, forKey: .id),
                toolName: try container.decode(String.self, forKey: .toolName),
                toolInput: try container.decode(AnyCodable.self, forKey: .toolInput),
                timestamp: ts
            )
        case "tool_result":
            self = .toolResult(
                id: try container.decode(String.self, forKey: .id),
                toolName: try container.decode(String.self, forKey: .toolName),
                toolResult: try container.decodeIfPresent(AnyCodable.self, forKey: .toolResult),
                success: try container.decodeIfPresent(Bool.self, forKey: .success),
                duration: try container.decodeIfPresent(Double.self, forKey: .duration),
                timestamp: ts
            )
        case "steer":
            self = .steer(
                message: try container.decode(String.self, forKey: .message),
                accepted: try container.decodeIfPresent(Bool.self, forKey: .accepted),
                ackMessage: try container.decodeIfPresent(String.self, forKey: .ackMessage),
                interrupted: try container.decodeIfPresent(Bool.self, forKey: .interrupted),
                timestamp: ts
            )
        case "chat_user":
            self = .chatUser(message: try container.decode(String.self, forKey: .message), timestamp: ts)
        case "chat_assistant":
            self = .chatAssistant(content: try container.decode(String.self, forKey: .content), timestamp: ts)
        case "file_change":
            self = .fileChange(
                path: try container.decode(String.self, forKey: .path),
                action: try container.decode(String.self, forKey: .action),
                diff: try container.decodeIfPresent(String.self, forKey: .diff),
                linesAdded: try container.decodeIfPresent(Int.self, forKey: .linesAdded),
                linesRemoved: try container.decodeIfPresent(Int.self, forKey: .linesRemoved),
                timestamp: ts
            )
        case "error":
            self = .error(error: try container.decode(String.self, forKey: .error), timestamp: ts)
        default:
            self = .text(content: "[Unknown event: \(type)]", timestamp: ts)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let content, let ts):
            try container.encode("text", forKey: .type)
            try container.encode(content, forKey: .content)
            try container.encode(ts, forKey: .timestamp)
        case .toolUse(let id, let name, let input, let ts):
            try container.encode("tool_use", forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(name, forKey: .toolName)
            try container.encode(input, forKey: .toolInput)
            try container.encode(ts, forKey: .timestamp)
        case .toolResult(let id, let name, let result, let success, let duration, let ts):
            try container.encode("tool_result", forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(name, forKey: .toolName)
            try container.encodeIfPresent(result, forKey: .toolResult)
            try container.encodeIfPresent(success, forKey: .success)
            try container.encodeIfPresent(duration, forKey: .duration)
            try container.encode(ts, forKey: .timestamp)
        case .steer(let message, let accepted, let ack, let interrupted, let ts):
            try container.encode("steer", forKey: .type)
            try container.encode(message, forKey: .message)
            try container.encodeIfPresent(accepted, forKey: .accepted)
            try container.encodeIfPresent(ack, forKey: .ackMessage)
            try container.encodeIfPresent(interrupted, forKey: .interrupted)
            try container.encode(ts, forKey: .timestamp)
        case .chatUser(let message, let ts):
            try container.encode("chat_user", forKey: .type)
            try container.encode(message, forKey: .message)
            try container.encode(ts, forKey: .timestamp)
        case .chatAssistant(let content, let ts):
            try container.encode("chat_assistant", forKey: .type)
            try container.encode(content, forKey: .content)
            try container.encode(ts, forKey: .timestamp)
        case .fileChange(let path, let action, let diff, let added, let removed, let ts):
            try container.encode("file_change", forKey: .type)
            try container.encode(path, forKey: .path)
            try container.encode(action, forKey: .action)
            try container.encodeIfPresent(diff, forKey: .diff)
            try container.encodeIfPresent(added, forKey: .linesAdded)
            try container.encodeIfPresent(removed, forKey: .linesRemoved)
            try container.encode(ts, forKey: .timestamp)
        case .error(let error, let ts):
            try container.encode("error", forKey: .type)
            try container.encode(error, forKey: .error)
            try container.encode(ts, forKey: .timestamp)
        }
    }
}
