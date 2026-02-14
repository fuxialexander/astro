import Foundation

struct PlanNode: Codable, Identifiable, Hashable {
    let id: String
    var projectId: String
    var type: NodeType
    var title: String
    var description: String
    var status: NodeStatus
    var parentId: String?
    var dependencies: [String]
    var environment: TaskEnvironment?
    var verification: VerificationType
    var position: Position
    var startDate: String?
    var endDate: String?
    var priority: Priority?
    var labelIds: [String]?
    var dueDate: String?
    var estimate: Estimate?
    var milestoneId: String?
    var boardOrder: Int?
    var createdAt: Date
    var updatedAt: Date
    // Execution metadata
    var executionId: String?
    var executionOutput: String?
    var executionError: String?
    var executionStartedAt: Date?
    var executionCompletedAt: Date?
    // Git PR metadata
    var branchName: String?
    var prUrl: String?
    var prNumber: Int?

    init(
        id: String,
        projectId: String,
        type: NodeType,
        title: String,
        description: String,
        status: NodeStatus,
        parentId: String? = nil,
        dependencies: [String] = [],
        environment: TaskEnvironment? = nil,
        verification: VerificationType = .auto,
        position: Position = Position(x: 0, y: 0),
        startDate: String? = nil,
        endDate: String? = nil,
        priority: Priority? = nil,
        labelIds: [String]? = nil,
        dueDate: String? = nil,
        estimate: Estimate? = nil,
        milestoneId: String? = nil,
        boardOrder: Int? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        executionId: String? = nil,
        executionOutput: String? = nil,
        executionError: String? = nil,
        executionStartedAt: Date? = nil,
        executionCompletedAt: Date? = nil,
        branchName: String? = nil,
        prUrl: String? = nil,
        prNumber: Int? = nil
    ) {
        self.id = id
        self.projectId = projectId
        self.type = type
        self.title = title
        self.description = description
        self.status = status
        self.parentId = parentId
        self.dependencies = dependencies
        self.environment = environment
        self.verification = verification
        self.position = position
        self.startDate = startDate
        self.endDate = endDate
        self.priority = priority
        self.labelIds = labelIds
        self.dueDate = dueDate
        self.estimate = estimate
        self.milestoneId = milestoneId
        self.boardOrder = boardOrder
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.executionId = executionId
        self.executionOutput = executionOutput
        self.executionError = executionError
        self.executionStartedAt = executionStartedAt
        self.executionCompletedAt = executionCompletedAt
        self.branchName = branchName
        self.prUrl = prUrl
        self.prNumber = prNumber
    }

    private enum CodingKeys: String, CodingKey {
        case id, projectId, type, title, description, status, parentId, dependencies
        case environment, verification, position, startDate, endDate, priority
        case labelIds, dueDate, estimate, milestoneId, boardOrder, createdAt, updatedAt
        case executionId, executionOutput, executionError, executionStartedAt, executionCompletedAt
        case branchName, prUrl, prNumber
    }

    // Custom decoder: backend plan_result omits projectId, createdAt, updatedAt
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        projectId = try c.decodeIfPresent(String.self, forKey: .projectId) ?? ""
        type = try c.decode(NodeType.self, forKey: .type)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decode(String.self, forKey: .description)
        status = try c.decode(NodeStatus.self, forKey: .status)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        dependencies = try c.decodeIfPresent([String].self, forKey: .dependencies) ?? []
        environment = try c.decodeIfPresent(TaskEnvironment.self, forKey: .environment)
        verification = try c.decodeIfPresent(VerificationType.self, forKey: .verification) ?? .auto
        position = try c.decodeIfPresent(Position.self, forKey: .position) ?? Position(x: 0, y: 0)
        startDate = try c.decodeIfPresent(String.self, forKey: .startDate)
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        priority = try c.decodeIfPresent(Priority.self, forKey: .priority)
        labelIds = try c.decodeIfPresent([String].self, forKey: .labelIds)
        dueDate = try c.decodeIfPresent(String.self, forKey: .dueDate)
        estimate = try c.decodeIfPresent(Estimate.self, forKey: .estimate)
        milestoneId = try c.decodeIfPresent(String.self, forKey: .milestoneId)
        boardOrder = try c.decodeIfPresent(Int.self, forKey: .boardOrder)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()
        executionId = try c.decodeIfPresent(String.self, forKey: .executionId)
        executionOutput = try c.decodeIfPresent(String.self, forKey: .executionOutput)
        executionError = try c.decodeIfPresent(String.self, forKey: .executionError)
        executionStartedAt = try c.decodeIfPresent(Date.self, forKey: .executionStartedAt)
        executionCompletedAt = try c.decodeIfPresent(Date.self, forKey: .executionCompletedAt)
        branchName = try c.decodeIfPresent(String.self, forKey: .branchName)
        prUrl = try c.decodeIfPresent(String.self, forKey: .prUrl)
        prNumber = try c.decodeIfPresent(Int.self, forKey: .prNumber)
    }

    enum NodeType: String, Codable, CaseIterable {
        case milestone, task, branch, decision
    }

    enum NodeStatus: String, Codable, CaseIterable {
        case planned, dispatched
        case inProgress = "in_progress"
        case autoVerified = "auto_verified"
        case awaitingJudgment = "awaiting_judgment"
        case completed, pruned

        var displayName: String {
            switch self {
            case .planned: return "Planned"
            case .dispatched: return "Dispatched"
            case .inProgress: return "In Progress"
            case .autoVerified: return "Verified"
            case .awaitingJudgment: return "Awaiting Judgment"
            case .completed: return "Completed"
            case .pruned: return "Pruned"
            }
        }

        var isActive: Bool {
            switch self {
            case .dispatched, .inProgress, .awaitingJudgment: return true
            default: return false
            }
        }

        var isDone: Bool {
            switch self {
            case .autoVerified, .completed: return true
            default: return false
            }
        }
    }

    enum VerificationType: String, Codable {
        case auto, human
    }

    struct Position: Codable, Hashable {
        var x: Double
        var y: Double
    }

    static func == (lhs: PlanNode, rhs: PlanNode) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct PlanEdge: Codable, Identifiable, Hashable {
    let id: String
    var source: String
    var target: String
    var type: EdgeType

    enum EdgeType: String, Codable {
        case dependency, branch
    }
}
