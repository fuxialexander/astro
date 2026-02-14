import SwiftUI

/// Task-level AI chat interface
struct TaskChatView: View {
    let nodeId: String
    let projectId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(SessionStore.self) private var sessionStore

    @State private var message = ""
    @State private var isStreaming = false
    @State private var streamingText = ""
    @State private var currentSessionId: String?

    private let streamClient = AgentStreamClient()

    private var node: PlanNode? {
        planStore.node(id: nodeId, projectId: projectId)
    }

    /// Current task chat session
    private var session: ChatSessionData? {
        if let id = currentSessionId {
            return sessionStore.getSession(id)
        }
        return sessionStore.getSessionsForNode(nodeId, type: .taskChat).last
    }

    var body: some View {
        VStack(spacing: 0) {
            // Message list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let session {
                            ForEach(session.messages) { msg in
                                ChatBubble(
                                    role: msg.role == .user ? "user" : msg.role == .assistant ? "assistant" : "system",
                                    content: msg.content
                                )
                            }
                        }

                        if isStreaming && !streamingText.isEmpty {
                            ChatBubble(role: "assistant", content: streamingText)
                                .id("streaming")
                        }
                    }
                    .padding()

                    Color.clear.frame(height: 1).id("bottom")
                }
                .onChange(of: streamingText) {
                    proxy.scrollTo("bottom")
                }
                .onChange(of: session?.messages.count) {
                    proxy.scrollTo("bottom")
                }
            }

            Divider()

            // Input
            HStack(spacing: 8) {
                TextField("Ask about this task...", text: $message, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)

                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "paperplane.fill")
                }
                .disabled(message.isEmpty || isStreaming)
            }
            .padding()
        }
        .navigationTitle("Task Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
        }
        .task {
            await loadChatHistory()
        }
    }

    private func loadChatHistory() async {
        // Check if we already have a session in the store
        if session != nil { return }

        // Try loading from server
        do {
            if let data = try await NexusAPI.shared.getChat(nodeId: nodeId),
               let msgs = data.messages, !msgs.isEmpty {
                // Create a session and populate it with server data
                let newSession = sessionStore.createSession(type: .taskChat, projectId: projectId, nodeId: nodeId)
                currentSessionId = newSession.id
                if let serverSessionId = data.session?.sessionId {
                    sessionStore.setProviderSessionId(newSession.id, providerSessionId: serverSessionId)
                }
                for msg in msgs {
                    let role: SessionMessage.SessionRole = msg.role == "user" ? .user : msg.role == "assistant" ? .assistant : .system
                    sessionStore.addMessage(newSession.id, role: role, content: msg.content)
                }
            }
        } catch {}
    }

    private func sendMessage() {
        let userMessage = message
        message = ""

        // Create or reuse session
        let sid: String
        if let existingSession = session {
            sid = existingSession.id
        } else {
            let newSession = sessionStore.createSession(type: .taskChat, projectId: projectId, nodeId: nodeId)
            sid = newSession.id
            currentSessionId = sid
        }

        // Add user message
        sessionStore.addMessage(sid, role: .user, content: userMessage)

        isStreaming = true
        streamingText = ""

        Task {
            guard let node else { return }
            let project = projectStore.project(id: projectId)

            let stream = await streamClient.taskChat(
                nodeId: nodeId,
                projectId: projectId,
                message: userMessage,
                taskTitle: node.title,
                taskDescription: node.description,
                sessionId: session?.providerSessionId,
                visionDoc: project?.visionDoc,
                messages: sessionStore.buildMessagesArray(sid)
            )

            for await event in stream {
                switch event {
                case .text(let text):
                    streamingText += text
                case .done(let providerSid, _):
                    if let providerSid {
                        sessionStore.setProviderSessionId(sid, providerSessionId: providerSid)
                    }
                    sessionStore.addMessage(sid, role: .assistant, content: streamingText)
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
}

// MARK: - Chat Bubble

struct ChatBubble: View {
    let role: String
    let content: String

    var body: some View {
        HStack {
            if role == "user" { Spacer(minLength: 40) }

            VStack(alignment: role == "user" ? .trailing : .leading, spacing: 4) {
                Text(role == "user" ? "You" : role == "error" ? "Error" : "Assistant")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Text(content)
                    .font(.subheadline)
                    .padding(10)
                    .background(
                        role == "user" ? Color.blue.opacity(0.1) :
                        role == "error" ? Color.red.opacity(0.1) :
                        Color(.systemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 12)
                    )
                    .textSelection(.enabled)
            }

            if role != "user" { Spacer(minLength: 40) }
        }
    }
}
