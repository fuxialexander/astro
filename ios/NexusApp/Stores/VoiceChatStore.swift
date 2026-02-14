import Foundation

struct VoiceChatMessage: Identifiable, Equatable {
    let id: UUID
    let role: Role
    let content: String
    let scope: NavigationContext.ChatScope
    let timestamp: Date

    enum Role: String {
        case user
        case assistant
        case error
    }

    init(role: Role, content: String, scope: NavigationContext.ChatScope) {
        self.id = UUID()
        self.role = role
        self.content = content
        self.scope = scope
        self.timestamp = Date()
    }
}

@Observable
@MainActor
final class VoiceChatStore {
    var messages: [VoiceChatMessage] = []
    var isStreaming: Bool = false
    var streamingText: String = ""

    // Per-scope session continuity
    private var sessionIds: [String: String] = [:]
    private let streamClient = AgentStreamClient()
    private var activeStreamTask: Task<Void, Never>?

    func send(
        message: String,
        scope: NavigationContext.ChatScope,
        projectStore: ProjectStore,
        planStore: PlanStore
    ) {
        let userMessage = VoiceChatMessage(role: .user, content: message, scope: scope)
        messages.append(userMessage)

        isStreaming = true
        streamingText = ""

        activeStreamTask?.cancel()
        activeStreamTask = Task {
            await streamResponse(message: message, scope: scope, projectStore: projectStore, planStore: planStore)
        }
    }

    func clearHistory() {
        messages.removeAll()
        sessionIds.removeAll()
        streamingText = ""
        isStreaming = false
        activeStreamTask?.cancel()
    }

    // MARK: - Private

    private func streamResponse(
        message: String,
        scope: NavigationContext.ChatScope,
        projectStore: ProjectStore,
        planStore: PlanStore
    ) async {
        let scopeKey = scopeKeyString(scope)
        let sessionId = sessionIds[scopeKey]

        let stream: AsyncStream<AgentEvent>

        switch scope {
        case .project(let projectId):
            let project = projectStore.project(id: projectId)
            let nodes = planStore.nodes(for: projectId)
            let edges = planStore.edges(for: projectId)
            let nodesData = nodes.map { ["id": $0.id, "title": $0.title, "status": $0.status.rawValue] }
            let edgesData = edges.map { ["source": $0.source, "target": $0.target] }
            stream = await streamClient.chat(
                projectId: projectId,
                message: message,
                sessionId: sessionId,
                visionDoc: project?.visionDoc,
                planNodes: nodesData,
                planEdges: edgesData,
                model: nil
            )

        case .task(let nodeId, let projectId):
            let node = planStore.node(id: nodeId, projectId: projectId)
            let project = projectStore.project(id: projectId)
            stream = await streamClient.taskChat(
                nodeId: nodeId,
                projectId: projectId,
                message: message,
                taskTitle: node?.title ?? "",
                taskDescription: node?.description ?? "",
                sessionId: sessionId,
                taskOutput: node?.executionOutput,
                visionDoc: project?.visionDoc,
                model: nil
            )

        case .general:
            // Route to first active project if available, otherwise use empty project context
            let projectId = projectStore.activeProjects.first?.id ?? ""
            let project = projectStore.activeProjects.first
            stream = await streamClient.chat(
                projectId: projectId,
                message: message,
                sessionId: sessionId,
                visionDoc: project?.visionDoc,
                planNodes: nil,
                planEdges: nil,
                model: nil
            )
        }

        var accumulatedText = ""

        for await event in stream {
            if Task.isCancelled { break }

            switch event {
            case .text(let text):
                accumulatedText += text
                streamingText = accumulatedText

            case .sessionInit(let sid, _):
                sessionIds[scopeKey] = sid

            case .done:
                if !accumulatedText.isEmpty {
                    let assistantMessage = VoiceChatMessage(
                        role: .assistant,
                        content: accumulatedText,
                        scope: scope
                    )
                    messages.append(assistantMessage)
                }
                streamingText = ""
                isStreaming = false
                return

            case .error(let msg, _):
                let errorMessage = VoiceChatMessage(
                    role: .error,
                    content: msg,
                    scope: scope
                )
                messages.append(errorMessage)
                streamingText = ""
                isStreaming = false
                return

            default:
                break
            }
        }

        // Stream ended without explicit done
        if !accumulatedText.isEmpty {
            let assistantMessage = VoiceChatMessage(
                role: .assistant,
                content: accumulatedText,
                scope: scope
            )
            messages.append(assistantMessage)
        }
        streamingText = ""
        isStreaming = false
    }

    private func scopeKeyString(_ scope: NavigationContext.ChatScope) -> String {
        switch scope {
        case .general: return "general"
        case .project(let id): return "project:\(id)"
        case .task(let nodeId, let projectId): return "task:\(projectId):\(nodeId)"
        }
    }
}
