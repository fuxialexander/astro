import Foundation

// MARK: - Session Types

enum SessionType: String, Codable {
    case planChat
    case taskChat
    case steer
    case execution
    case planGeneration
}

enum SessionStatus: String, Codable {
    case active
    case streaming
    case completed
    case error
    case cancelled
}

// MARK: - Session Message

struct SessionMessage: Codable, Identifiable {
    let id: String
    var role: SessionRole
    var content: String
    var timestamp: Date
    var appliedMutations: PlanChatMutations?

    enum SessionRole: String, Codable {
        case user
        case assistant
        case system
    }

    init(id: String = UUID().uuidString, role: SessionRole, content: String, timestamp: Date = .now, appliedMutations: PlanChatMutations? = nil) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.appliedMutations = appliedMutations
    }
}

// MARK: - Steer Message

struct SteerMessage: Codable, Identifiable {
    let id: String
    var message: String
    var accepted: Bool?
    var ackMessage: String?
    var interrupted: Bool?
    var timestamp: Date

    init(id: String = UUID().uuidString, message: String, accepted: Bool? = nil, ackMessage: String? = nil, interrupted: Bool? = nil, timestamp: Date = .now) {
        self.id = id
        self.message = message
        self.accepted = accepted
        self.ackMessage = ackMessage
        self.interrupted = interrupted
        self.timestamp = timestamp
    }
}

// MARK: - Execution Summary

struct ExecutionSummary: Codable {
    var workCompleted: String
    var filesChanged: [String]
    var status: String
    var followUps: [String]
}

// MARK: - Chat Session Data

struct ChatSessionData: Identifiable, Codable {
    let id: String
    var type: SessionType
    var status: SessionStatus
    var projectId: String
    var nodeId: String?
    var providerSessionId: String?
    var providerId: String?
    var model: String?
    var messages: [SessionMessage]
    var steerMessages: [SteerMessage]
    var summary: ExecutionSummary?
    var metrics: UsageMetrics?
    var createdAt: Date
    var updatedAt: Date
    var completedAt: Date?

    init(
        id: String = UUID().uuidString,
        type: SessionType,
        status: SessionStatus = .active,
        projectId: String,
        nodeId: String? = nil,
        providerSessionId: String? = nil,
        providerId: String? = nil,
        model: String? = nil,
        messages: [SessionMessage] = [],
        steerMessages: [SteerMessage] = [],
        summary: ExecutionSummary? = nil,
        metrics: UsageMetrics? = nil,
        createdAt: Date = .now,
        updatedAt: Date = .now,
        completedAt: Date? = nil
    ) {
        self.id = id
        self.type = type
        self.status = status
        self.projectId = projectId
        self.nodeId = nodeId
        self.providerSessionId = providerSessionId
        self.providerId = providerId
        self.model = model
        self.messages = messages
        self.steerMessages = steerMessages
        self.summary = summary
        self.metrics = metrics
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.completedAt = completedAt
    }
}

// MARK: - Plan Chat Mutations (moved from ChatPanelView)

struct PlanChatMutations: Codable {
    var nodeUpdates: [PlanChatNodeUpdate] = []
    var edgeOps: [PlanChatEdgeOp] = []
    var newNodes: [PlanChatNewNode] = []

    var isEmpty: Bool {
        nodeUpdates.isEmpty && edgeOps.isEmpty && newNodes.isEmpty
    }
}

struct PlanChatNodeUpdate: Codable, Identifiable {
    let id: String
    let nodeId: String
    let changes: [String: AnyCodable]

    var changedFields: [String] {
        changes.keys.filter { $0 != "nodeId" }.sorted()
    }

    init(id: String = UUID().uuidString, nodeId: String, changes: [String: AnyCodable]) {
        self.id = id
        self.nodeId = nodeId
        self.changes = changes
    }
}

struct PlanChatEdgeOp: Codable, Identifiable {
    let id: String
    let action: String // "add" or "remove"
    let source: String
    let target: String
    let edgeType: String?

    init(id: String = UUID().uuidString, action: String, source: String, target: String, edgeType: String? = nil) {
        self.id = id
        self.action = action
        self.source = source
        self.target = target
        self.edgeType = edgeType
    }
}

struct PlanChatNewNode: Codable, Identifiable {
    let id: String
    let nodeId: String?
    let title: String
    let description: String
    let type: String?
    let milestoneId: String?
    let dependencies: [String]?
    let priority: String?
    let estimate: String?
    let environment: String?
    let verification: String?

    init(
        id: String = UUID().uuidString,
        nodeId: String? = nil,
        title: String,
        description: String,
        type: String? = nil,
        milestoneId: String? = nil,
        dependencies: [String]? = nil,
        priority: String? = nil,
        estimate: String? = nil,
        environment: String? = nil,
        verification: String? = nil
    ) {
        self.id = id
        self.nodeId = nodeId
        self.title = title
        self.description = description
        self.type = type
        self.milestoneId = milestoneId
        self.dependencies = dependencies
        self.priority = priority
        self.estimate = estimate
        self.environment = environment
        self.verification = verification
    }
}
