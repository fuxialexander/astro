import SwiftUI

// MARK: - Mutation Parsing

private let updateBlockRegex = try? NSRegularExpression(pattern: "```nexus-updates\\s*\\n([\\s\\S]*?)```", options: [])
private let edgeBlockRegex = try? NSRegularExpression(pattern: "```nexus-edges\\s*\\n([\\s\\S]*?)```", options: [])
private let addNodesBlockRegex = try? NSRegularExpression(pattern: "```nexus-add-nodes\\s*\\n([\\s\\S]*?)```", options: [])

/// Extract nexus-updates, nexus-edges, and nexus-add-nodes blocks from a message
func extractPlanChatMutations(from content: String) -> (cleanContent: String, mutations: PlanChatMutations) {
    var cleanContent = content
    var mutations = PlanChatMutations()

    // Extract node updates
    if let regex = updateBlockRegex {
        let range = NSRange(cleanContent.startIndex..., in: cleanContent)
        let matches = regex.matches(in: cleanContent, options: [], range: range)
        for match in matches.reversed() {
            if let jsonRange = Range(match.range(at: 1), in: cleanContent) {
                let json = String(cleanContent[jsonRange])
                if let data = json.data(using: .utf8),
                   let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                    for item in array {
                        if let nodeId = item["nodeId"] as? String {
                            let codableChanges = item.mapValues { AnyCodable($0) }
                            mutations.nodeUpdates.append(PlanChatNodeUpdate(nodeId: nodeId, changes: codableChanges))
                        }
                    }
                }
            }
            if let fullRange = Range(match.range, in: cleanContent) {
                cleanContent.removeSubrange(fullRange)
            }
        }
    }

    // Extract edge operations
    if let regex = edgeBlockRegex {
        let range = NSRange(cleanContent.startIndex..., in: cleanContent)
        let matches = regex.matches(in: cleanContent, options: [], range: range)
        for match in matches.reversed() {
            if let jsonRange = Range(match.range(at: 1), in: cleanContent) {
                let json = String(cleanContent[jsonRange])
                if let data = json.data(using: .utf8),
                   let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                    for item in array {
                        if let action = item["action"] as? String,
                           let source = item["source"] as? String,
                           let target = item["target"] as? String {
                            mutations.edgeOps.append(PlanChatEdgeOp(
                                action: action,
                                source: source,
                                target: target,
                                edgeType: item["type"] as? String
                            ))
                        }
                    }
                }
            }
            if let fullRange = Range(match.range, in: cleanContent) {
                cleanContent.removeSubrange(fullRange)
            }
        }
    }

    // Extract new nodes
    if let regex = addNodesBlockRegex {
        let range = NSRange(cleanContent.startIndex..., in: cleanContent)
        let matches = regex.matches(in: cleanContent, options: [], range: range)
        for match in matches.reversed() {
            if let jsonRange = Range(match.range(at: 1), in: cleanContent) {
                let json = String(cleanContent[jsonRange])
                if let data = json.data(using: .utf8),
                   let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                    for item in array {
                        if let title = item["title"] as? String {
                            mutations.newNodes.append(PlanChatNewNode(
                                nodeId: item["id"] as? String,
                                title: title,
                                description: item["description"] as? String ?? "",
                                type: item["type"] as? String,
                                milestoneId: item["milestoneId"] as? String,
                                dependencies: item["dependencies"] as? [String],
                                priority: item["priority"] as? String,
                                estimate: item["estimate"] as? String,
                                environment: item["environment"] as? String,
                                verification: item["verification"] as? String
                            ))
                        }
                    }
                }
            }
            if let fullRange = Range(match.range, in: cleanContent) {
                cleanContent.removeSubrange(fullRange)
            }
        }
    }

    return (cleanContent.trimmingCharacters(in: .whitespacesAndNewlines), mutations)
}

// MARK: - Chat Panel View

/// Plan refinement chat panel (sidebar or sheet)
struct ChatPanelView: View {
    let projectId: String
    var initialMessage: String?
    var onClose: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(SessionStore.self) private var sessionStore

    @State private var message = ""
    @State private var isStreaming = false
    @State private var streamingText = ""
    @State private var initialMessageSent = false
    @State private var currentSessionId: String?

    private let streamClient = AgentStreamClient()

    private var project: Project? {
        projectStore.project(id: projectId)
    }

    /// Current session (latest plan chat for this project)
    private var session: ChatSessionData? {
        if let id = currentSessionId {
            return sessionStore.getSession(id)
        }
        return sessionStore.getSessionsForProject(projectId, type: .planChat).last
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            chatHeader

            Divider()

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        // System message
                        PlanChatBubble(
                            message: SessionMessage(role: .system, content: "I can help you refine your plan. Ask me to add tasks, reorganize dependencies, or explain the rationale behind the plan structure."),
                            getNodeTitle: getNodeTitle
                        )

                        if let session {
                            ForEach(session.messages) { msg in
                                PlanChatBubble(message: msg, getNodeTitle: getNodeTitle)
                            }
                        }

                        if isStreaming && !streamingText.isEmpty {
                            PlanChatBubble(
                                message: SessionMessage(role: .assistant, content: streamingText),
                                getNodeTitle: getNodeTitle
                            )
                        }
                    }
                    .padding()

                    Color.clear.frame(height: 1).id("bottom")
                }
                .onChange(of: streamingText) {
                    withAnimation(.easeOut(duration: 0.1)) {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
                .onChange(of: session?.messages.count) {
                    withAnimation(.easeOut(duration: 0.1)) {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }

            Divider()

            // Input
            chatInput
        }
        .background(Color(.systemGroupedBackground))
        .task {
            if let initialMessage, !initialMessageSent {
                initialMessageSent = true
                message = initialMessage
                // Auto-send after a brief delay
                try? await Task.sleep(for: .milliseconds(100))
                sendMessage()
            }
        }
    }

    // MARK: - Header

    private var chatHeader: some View {
        HStack {
            Text("Plan Chat")
                .font(.headline)

            Spacer()

            if let onClose {
                Button {
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(.bar)
    }

    // MARK: - Input

    private var chatInput: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Refine your plan...", text: $message, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
                .lineLimit(1...4)

            Button {
                sendMessage()
            } label: {
                Image(systemName: isStreaming ? "stop.fill" : "paperplane.fill")
                    .font(.body)
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(message.isEmpty && !isStreaming ? Color.gray : Color.accentColor, in: Circle())
            }
            .disabled(message.isEmpty && !isStreaming)
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(.bar)
    }

    // MARK: - Helpers

    private func getNodeTitle(_ nodeId: String) -> String {
        planStore.node(id: nodeId, projectId: projectId)?.title ?? nodeId
    }

    private func sendMessage() {
        let userMessage = message
        message = ""

        // Create or reuse session
        let sid: String
        if let existingSession = session {
            sid = existingSession.id
        } else {
            let newSession = sessionStore.createSession(type: .planChat, projectId: projectId)
            sid = newSession.id
            currentSessionId = sid
        }

        // Add user message
        sessionStore.addMessage(sid, role: .user, content: userMessage)

        isStreaming = true
        streamingText = ""

        Task {
            let nodes = planStore.nodes(for: projectId)
            let edges = planStore.edges(for: projectId)

            let planNodes = nodes.map { [
                "id": $0.id,
                "title": $0.title,
                "description": $0.description,
                "status": $0.status.rawValue,
            ] }
            let planEdges = edges.map { [
                "source": $0.source,
                "target": $0.target,
            ] }

            var rawAssistantText = ""

            let stream = await streamClient.chat(
                projectId: projectId,
                message: userMessage,
                sessionId: session?.providerSessionId,
                visionDoc: project?.visionDoc,
                planNodes: planNodes,
                planEdges: planEdges,
                messages: sessionStore.buildMessagesArray(sid)
            )

            for await event in stream {
                switch event {
                case .text(let text):
                    rawAssistantText += text
                    streamingText = rawAssistantText

                case .done(let providerSid, _):
                    if let providerSid {
                        sessionStore.setProviderSessionId(sid, providerSessionId: providerSid)
                    }

                    // Extract mutations from the raw text
                    let (cleanContent, mutations) = extractPlanChatMutations(from: rawAssistantText)

                    // Apply mutations to the plan store
                    if !mutations.isEmpty {
                        await applyMutations(mutations)
                    }

                    // Add assistant message with mutations
                    sessionStore.addMessage(sid, role: .assistant, content: cleanContent, appliedMutations: mutations.isEmpty ? nil : mutations)

                    streamingText = ""
                    isStreaming = false

                case .error(let msg, _):
                    sessionStore.addMessage(sid, role: .system, content: "Error: \(msg)")
                    isStreaming = false

                default:
                    break
                }
            }
            isStreaming = false
        }
    }

    // MARK: - Apply Mutations

    private func applyMutations(_ mutations: PlanChatMutations) async {
        let prefix = String(projectId.prefix(8))

        // Create new nodes
        for newNode in mutations.newNodes {
            let nodeId = newNode.nodeId.map { $0.hasPrefix(prefix) ? $0 : "\(prefix)-\($0)" }
                ?? "\(prefix)-\(UUID().uuidString.prefix(8))"

            let node = PlanNode(
                id: nodeId,
                projectId: projectId,
                type: PlanNode.NodeType(rawValue: newNode.type ?? "task") ?? .task,
                title: newNode.title,
                description: newNode.description,
                status: .planned,
                dependencies: newNode.dependencies ?? [],
                environment: newNode.environment.flatMap { TaskEnvironment(rawValue: $0) },
                verification: PlanNode.VerificationType(rawValue: newNode.verification ?? "auto") ?? .auto,
                position: .init(x: 40, y: 40),
                priority: Priority(rawValue: newNode.priority ?? "medium"),
                estimate: Estimate(rawValue: newNode.estimate ?? "M"),
                milestoneId: newNode.milestoneId,
                createdAt: .now,
                updatedAt: .now
            )

            try? await planStore.addNode(node)

            // Add edges for dependencies
            for dep in node.dependencies {
                let edge = PlanEdge(id: "e-\(dep)-\(nodeId)", source: dep, target: nodeId, type: .dependency)
                try? await planStore.addEdge(edge, projectId: projectId)
            }
        }

        // Apply node updates
        for update in mutations.nodeUpdates {
            var patch: [String: AnyCodable] = [:]
            for (key, value) in update.changes where key != "nodeId" {
                patch[key] = value
            }
            if !patch.isEmpty {
                try? await planStore.updateNode(id: update.nodeId, projectId: projectId, patch: patch)
            }
        }

        // Apply edge operations
        for edgeOp in mutations.edgeOps {
            if edgeOp.action == "add" {
                let edge = PlanEdge(
                    id: "e-\(edgeOp.source)-\(edgeOp.target)",
                    source: edgeOp.source,
                    target: edgeOp.target,
                    type: PlanEdge.EdgeType(rawValue: edgeOp.edgeType ?? "dependency") ?? .dependency
                )
                try? await planStore.addEdge(edge, projectId: projectId)
            } else if edgeOp.action == "remove" {
                // Find and delete the edge
                let edges = planStore.edges(for: projectId)
                if let edge = edges.first(where: { $0.source == edgeOp.source && $0.target == edgeOp.target }) {
                    try? await planStore.deleteEdge(id: edge.id, projectId: projectId)
                }
            }
        }
    }
}

// MARK: - Plan Chat Bubble

private struct PlanChatBubble: View {
    let message: SessionMessage
    let getNodeTitle: (String) -> String

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
            // Role label
            Text(roleLabel)
                .font(.caption2.weight(.medium))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            // Message content
            Text(message.content.isEmpty && message.role == .assistant ? "..." : message.content)
                .font(.subheadline)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 16))
                .foregroundStyle(bubbleForeground)

            // Mutation banners
            if let mutations = message.appliedMutations, !mutations.isEmpty {
                mutationBanners(mutations)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }

    private var roleLabel: String {
        switch message.role {
        case .user: return "You"
        case .assistant: return "Assistant"
        case .system: return "System"
        }
    }

    private var bubbleBackground: Color {
        switch message.role {
        case .user: return .accentColor
        case .system: return Color(.tertiarySystemGroupedBackground)
        case .assistant: return Color(.secondarySystemGroupedBackground)
        }
    }

    private var bubbleForeground: Color {
        switch message.role {
        case .user: return .white
        default: return .primary
        }
    }

    @ViewBuilder
    private func mutationBanners(_ mutations: PlanChatMutations) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            // Node updates
            ForEach(mutations.nodeUpdates) { update in
                MutationBanner(
                    icon: "pencil",
                    iconColor: .blue,
                    backgroundColor: .blue.opacity(0.1),
                    text: "Updated **\(getNodeTitle(update.nodeId))**: \(update.changedFields.joined(separator: ", "))"
                )
            }

            // Edge operations
            ForEach(mutations.edgeOps) { op in
                MutationBanner(
                    icon: op.action == "add" ? "arrow.triangle.branch" : "xmark",
                    iconColor: op.action == "add" ? .green : .orange,
                    backgroundColor: op.action == "add" ? .green.opacity(0.1) : .orange.opacity(0.1),
                    text: "\(op.action == "add" ? "Added" : "Removed") edge: \(getNodeTitle(op.source)) → \(getNodeTitle(op.target))"
                )
            }

            // New nodes
            ForEach(mutations.newNodes) { node in
                MutationBanner(
                    icon: "plus.circle.fill",
                    iconColor: .green,
                    backgroundColor: .green.opacity(0.1),
                    text: "Created **\(node.title)**\(node.type != nil && node.type != "task" ? " (\(node.type!))" : "")"
                )
            }
        }
    }
}

// MARK: - Mutation Banner

private struct MutationBanner: View {
    let icon: String
    let iconColor: Color
    let backgroundColor: Color
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(iconColor)

            Text(LocalizedStringKey(text))
                .font(.caption)
                .foregroundStyle(.primary)

            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(backgroundColor, in: RoundedRectangle(cornerRadius: 8))
    }
}
