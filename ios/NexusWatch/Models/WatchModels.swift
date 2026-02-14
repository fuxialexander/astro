import Foundation

// Lightweight models for watchOS — only what the watch needs

struct WatchDecision: Codable, Identifiable, Hashable {
    let id: String
    var projectId: String
    var title: String
    var description: String
    var status: String // "awaiting_judgment"
    var projectName: String?
    var priority: String?
    var executionOutput: String?
    var executionError: String?
    var createdAt: Date
    var updatedAt: Date

    static func == (lhs: WatchDecision, rhs: WatchDecision) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct WatchTask: Codable, Identifiable, Hashable {
    let id: String
    var projectId: String
    var title: String
    var status: TaskStatus
    var projectName: String?
    var priority: String?
    var updatedAt: Date

    enum TaskStatus: String, Codable {
        case planned, dispatched
        case inProgress = "in_progress"
        case autoVerified = "auto_verified"
        case awaitingJudgment = "awaiting_judgment"
        case completed, pruned

        var displayName: String {
            switch self {
            case .planned: return "Planned"
            case .dispatched: return "Dispatched"
            case .inProgress: return "Running"
            case .autoVerified: return "Verified"
            case .awaitingJudgment: return "Judgment"
            case .completed: return "Done"
            case .pruned: return "Pruned"
            }
        }

        var isActive: Bool {
            switch self {
            case .dispatched, .inProgress, .awaitingJudgment: return true
            default: return false
            }
        }

        var iconName: String {
            switch self {
            case .planned: return "circle"
            case .dispatched: return "arrow.up.circle"
            case .inProgress: return "play.circle.fill"
            case .autoVerified: return "checkmark.circle.fill"
            case .awaitingJudgment: return "exclamationmark.triangle.fill"
            case .completed: return "checkmark.seal.fill"
            case .pruned: return "xmark.circle"
            }
        }
    }

    static func == (lhs: WatchTask, rhs: WatchTask) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct WatchProject: Codable, Identifiable {
    let id: String
    var name: String
    var status: String
}

struct WatchStats: Codable {
    var activeProjects: Int
    var tasksCompleted: Int
    var pendingDecisions: Int
    var activeTasks: Int
    var costToday: Double
}
