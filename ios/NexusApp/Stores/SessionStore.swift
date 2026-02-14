import Foundation
import Observation

@Observable
@MainActor
final class SessionStore {
    var sessions: [String: ChatSessionData] = [:]
    var loaded = false

    private var saveWorkItems: [String: DispatchWorkItem] = [:]

    // MARK: - Lifecycle

    func load() async {
        let cached = await LocalCache.shared.loadCachedSessions()
        for session in cached {
            sessions[session.id] = session
        }
        loaded = true
    }

    // MARK: - CRUD

    @discardableResult
    func createSession(type: SessionType, projectId: String, nodeId: String? = nil) -> ChatSessionData {
        let session = ChatSessionData(
            type: type,
            projectId: projectId,
            nodeId: nodeId
        )
        sessions[session.id] = session
        immediateSave(session)
        return session
    }

    func getSession(_ id: String) -> ChatSessionData? {
        sessions[id]
    }

    func getSessionsForNode(_ nodeId: String, type: SessionType? = nil) -> [ChatSessionData] {
        sessions.values
            .filter { $0.nodeId == nodeId && (type == nil || $0.type == type) }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func getSessionsForProject(_ projectId: String, type: SessionType? = nil) -> [ChatSessionData] {
        sessions.values
            .filter { $0.projectId == projectId && (type == nil || $0.type == type) }
            .sorted { $0.createdAt < $1.createdAt }
    }

    // MARK: - Message Operations

    func addMessage(_ sessionId: String, role: SessionMessage.SessionRole, content: String, appliedMutations: PlanChatMutations? = nil) {
        guard sessions[sessionId] != nil else { return }
        let message = SessionMessage(role: role, content: content, appliedMutations: appliedMutations)
        sessions[sessionId]?.messages.append(message)
        sessions[sessionId]?.updatedAt = .now
        debouncedSave(sessionId)
    }

    func appendToLastAssistantMessage(_ sessionId: String, chunk: String) {
        guard sessions[sessionId] != nil else { return }
        if let lastIdx = sessions[sessionId]?.messages.lastIndex(where: { $0.role == .assistant }) {
            sessions[sessionId]?.messages[lastIdx].content += chunk
            sessions[sessionId]?.updatedAt = .now
            // Don't save during streaming — too frequent
        }
    }

    func updateLastAssistantMessage(_ sessionId: String, content: String, appliedMutations: PlanChatMutations? = nil) {
        guard sessions[sessionId] != nil else { return }
        if let lastIdx = sessions[sessionId]?.messages.lastIndex(where: { $0.role == .assistant }) {
            sessions[sessionId]?.messages[lastIdx].content = content
            sessions[sessionId]?.messages[lastIdx].appliedMutations = appliedMutations
            sessions[sessionId]?.updatedAt = .now
            debouncedSave(sessionId)
        }
    }

    // MARK: - Session State

    func setProviderSessionId(_ sessionId: String, providerSessionId: String) {
        guard sessions[sessionId] != nil else { return }
        sessions[sessionId]?.providerSessionId = providerSessionId
        sessions[sessionId]?.updatedAt = .now
        debouncedSave(sessionId)
    }

    func setStatus(_ sessionId: String, status: SessionStatus) {
        guard sessions[sessionId] != nil else { return }
        sessions[sessionId]?.status = status
        sessions[sessionId]?.updatedAt = .now
        if status == .completed || status == .error || status == .cancelled {
            sessions[sessionId]?.completedAt = .now
            immediateSave(sessions[sessionId]!)
        } else {
            debouncedSave(sessionId)
        }
    }

    func setSummary(_ sessionId: String, summary: ExecutionSummary) {
        guard sessions[sessionId] != nil else { return }
        sessions[sessionId]?.summary = summary
        sessions[sessionId]?.updatedAt = .now
        immediateSave(sessions[sessionId]!)
    }

    func setMetrics(_ sessionId: String, metrics: UsageMetrics) {
        guard sessions[sessionId] != nil else { return }
        sessions[sessionId]?.metrics = metrics
        sessions[sessionId]?.updatedAt = .now
        debouncedSave(sessionId)
    }

    // MARK: - Steer Operations

    func addSteerMessage(_ sessionId: String, message: String, interrupted: Bool? = nil) {
        guard sessions[sessionId] != nil else { return }
        let steerMsg = SteerMessage(message: message, interrupted: interrupted)
        sessions[sessionId]?.steerMessages.append(steerMsg)
        sessions[sessionId]?.updatedAt = .now
        debouncedSave(sessionId)
    }

    func updateSteerMessage(_ sessionId: String, index: Int, accepted: Bool?, ackMessage: String?) {
        guard sessions[sessionId] != nil,
              let steerMessages = sessions[sessionId]?.steerMessages,
              index < steerMessages.count else { return }
        sessions[sessionId]?.steerMessages[index].accepted = accepted
        sessions[sessionId]?.steerMessages[index].ackMessage = ackMessage
        sessions[sessionId]?.updatedAt = .now
        debouncedSave(sessionId)
    }

    // MARK: - Cleanup

    func deleteSession(_ id: String) {
        sessions.removeValue(forKey: id)
        saveWorkItems[id]?.cancel()
        saveWorkItems.removeValue(forKey: id)
        Task {
            await LocalCache.shared.deleteCachedSession(id: id)
        }
    }

    func clearSessionsForNode(_ nodeId: String) {
        let toRemove = sessions.values.filter { $0.nodeId == nodeId }
        for session in toRemove {
            deleteSession(session.id)
        }
    }

    // MARK: - Message History for API Calls

    /// Build a messages array suitable for sending to the server (conversation history)
    func buildMessagesArray(_ sessionId: String) -> [[String: String]]? {
        guard let session = sessions[sessionId] else { return nil }
        let msgs = session.messages.filter { $0.role == .user || $0.role == .assistant }
        guard !msgs.isEmpty else { return nil }
        return msgs.map { ["role": $0.role.rawValue, "content": $0.content] }
    }

    // MARK: - Persistence Helpers

    private func immediateSave(_ session: ChatSessionData) {
        Task {
            await LocalCache.shared.cacheSession(session)
        }
    }

    private func debouncedSave(_ sessionId: String) {
        saveWorkItems[sessionId]?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, let session = self.sessions[sessionId] else { return }
                await LocalCache.shared.cacheSession(session)
            }
        }
        saveWorkItems[sessionId] = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: workItem)
    }
}
