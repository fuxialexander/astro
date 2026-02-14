import SwiftUI

struct TaskDetailView: View {
    let nodeId: String
    let projectId: String

    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(ExecutionStore.self) private var executionStore
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(NavigationContext.self) private var navigationContext
    @Environment(SessionStore.self) private var sessionStore

    @AppStorage("selectedModel") private var selectedModel = "claude-sonnet-4-5-20250929"
    @State private var selectedMachineId: String?
    @State private var selectedTab: Tab = .overview

    enum Tab: String, CaseIterable {
        case overview = "Overview"
        case session = "Session"
        case files = "Files"
    }

    private var node: PlanNode? {
        planStore.node(id: nodeId, projectId: projectId)
    }

    private var execution: TaskExecution? {
        executionStore.execution(for: nodeId)
    }

    private var project: Project? {
        projectStore.project(id: projectId)
    }

    var body: some View {
        Group {
            if let node {
                VStack(spacing: 0) {
                    // Segmented tab picker
                    Picker("View", selection: $selectedTab) {
                        ForEach(Tab.allCases, id: \.self) { tab in
                            Text(tab.rawValue).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .padding(.vertical, 8)

                    Divider()

                    // Tab content
                    switch selectedTab {
                    case .overview:
                        TaskOverviewTab(
                            node: node,
                            nodeId: nodeId,
                            projectId: projectId,
                            execution: execution,
                            selectedModel: $selectedModel,
                            selectedMachineId: $selectedMachineId,
                            onRun: { dispatchAndGoToSession(node) }
                        )
                    case .session:
                        TaskSessionTab(
                            nodeId: nodeId,
                            projectId: projectId,
                            execution: execution,
                            onDispatch: { dispatchTask(node) },
                            onCancel: { Task { await executionStore.cancelExecution(nodeId: nodeId) } }
                        )
                    case .files:
                        FileChangesView(changes: execution?.fileChanges ?? [])
                    }
                }
                .navigationTitle(node.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        if execution?.status == .running {
                            Button {
                                Task { await executionStore.cancelExecution(nodeId: nodeId) }
                            } label: {
                                Image(systemName: "stop.circle")
                                    .foregroundStyle(.red)
                            }
                        } else if node.status == .planned || node.status == .completed {
                            Button {
                                dispatchAndGoToSession(node)
                            } label: {
                                Image(systemName: "play.circle")
                            }
                        }
                    }
                }
            } else {
                ContentUnavailableView("Task Not Found", systemImage: "doc.badge.gearshape")
            }
        }
        .task {
            navigationContext.currentProjectId = projectId
            navigationContext.currentNodeId = nodeId
        }
    }

    /// Resolve working directory: prefer project.workingDirectory, fall back to repository
    private var resolvedWorkingDirectory: String? {
        if let dir = project?.workingDirectory, !dir.isEmpty { return dir }
        if let repo = project?.repository, !repo.isEmpty { return repo }
        return nil
    }

    private func dispatchTask(_ node: PlanNode) {
        executionStore.dispatchTask(
            nodeId: nodeId,
            projectId: projectId,
            title: node.title,
            description: node.description,
            environment: node.environment?.rawValue ?? "local",
            visionDoc: project?.visionDoc,
            targetMachineId: selectedMachineId ?? project?.defaultMachineId,
            workingDirectory: resolvedWorkingDirectory,
            model: selectedModel
        )
    }

    private func dispatchAndGoToSession(_ node: PlanNode) {
        dispatchTask(node)
        withAnimation {
            selectedTab = .session
        }
    }
}

// MARK: - Overview Tab

private struct TaskOverviewTab: View {
    let node: PlanNode
    let nodeId: String
    let projectId: String
    let execution: TaskExecution?
    @Binding var selectedModel: String
    @Binding var selectedMachineId: String?
    let onRun: () -> Void

    @Environment(PlanStore.self) private var planStore
    @Environment(ExecutionStore.self) private var executionStore
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(SessionStore.self) private var sessionStore

    private let availableModels: [(id: String, label: String)] = [
        ("claude-sonnet-4-5-20250929", "Sonnet 4.5"),
        ("claude-opus-4-6", "Opus 4.6"),
        ("claude-haiku-4-5-20251001", "Haiku 4.5"),
    ]

    private var connectedMachines: [MachineInfo] {
        realtimeStore.connectedMachines.filter { $0.connectionStatus == .connected }
    }

    /// Execution session summary from SessionStore
    private var executionSummaryData: ExecutionSummary? {
        guard let sid = executionStore.executionSessionId(for: nodeId) else { return nil }
        return sessionStore.getSession(sid)?.summary
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Tappable property badges
                HStack(spacing: 10) {
                    // Status picker
                    Menu {
                        ForEach(PlanNode.NodeStatus.allCases, id: \.self) { s in
                            Button {
                                updateField("status", value: s.rawValue)
                            } label: {
                                if s == node.status {
                                    Label(s.displayName, systemImage: "checkmark")
                                } else {
                                    Text(s.displayName)
                                }
                            }
                        }
                    } label: {
                        StatusBadge(status: node.status, large: true)
                    }

                    // Priority picker
                    Menu {
                        ForEach(Priority.allCases, id: \.self) { p in
                            Button {
                                updateField("priority", value: p.rawValue)
                            } label: {
                                if p == node.priority {
                                    Label(p.displayName, systemImage: "checkmark")
                                } else {
                                    Text(p.displayName)
                                }
                            }
                        }
                    } label: {
                        PriorityBadge(priority: node.priority ?? .medium, large: true)
                    }

                    // Estimate picker
                    Menu {
                        ForEach(Estimate.allCases, id: \.self) { e in
                            Button {
                                updateField("estimate", value: e.rawValue)
                            } label: {
                                if e == node.estimate {
                                    Label(e.rawValue, systemImage: "checkmark")
                                } else {
                                    Text(e.rawValue)
                                }
                            }
                        }
                    } label: {
                        EstimateBadge(estimate: node.estimate ?? .m, large: true)
                    }

                    // Environment picker
                    Menu {
                        Button {
                            updateField("environment", value: nil as String?)
                        } label: {
                            if node.environment == nil {
                                Label("Auto", systemImage: "checkmark")
                            } else {
                                Text("Auto")
                            }
                        }
                        ForEach([TaskEnvironment.remote, .hpc, .cloud], id: \.self) { env in
                            Button {
                                updateField("environment", value: env.rawValue)
                            } label: {
                                if env == node.environment {
                                    Label(env.rawValue.capitalized, systemImage: "checkmark")
                                } else {
                                    Text(env.rawValue.capitalized)
                                }
                            }
                        }
                    } label: {
                        if let env = node.environment {
                            EnvironmentBadge(environment: env, large: true)
                        } else {
                            HStack(spacing: 4) {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 11))
                                Text("Auto")
                                    .font(.footnote)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.tint.opacity(0.1), in: Capsule())
                        }
                    }
                }

                // Description
                if !node.description.isEmpty {
                    Text(node.description)
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                // Model/Machine picker + Run button (if not already running)
                if execution?.status != .running {
                    HStack {
                        Text("Model")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Picker("Model", selection: $selectedModel) {
                            ForEach(availableModels, id: \.id) { model in
                                Text(model.label).tag(model.id)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    .padding(.horizontal, 4)

                    if !connectedMachines.isEmpty {
                        HStack {
                            Text("Machine")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Picker("Machine", selection: $selectedMachineId) {
                                Text("Auto").tag(nil as String?)
                                ForEach(connectedMachines) { machine in
                                    Text(machine.name).tag(machine.machineId as String?)
                                }
                            }
                            .pickerStyle(.menu)
                        }
                        .padding(.horizontal, 4)
                    }

                    Button {
                        onRun()
                    } label: {
                        Label("Run Task", systemImage: "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }

                // Execution summary card (from SessionStore)
                if let summary = executionSummaryData {
                    SummaryCard(summary: summary)
                }

                // Execution metrics
                if let exec = execution {
                    executionMetrics(exec)
                }

                // Git info
                if let branch = node.branchName {
                    gitSection(branch: branch, prUrl: node.prUrl, prNumber: node.prNumber)
                }
            }
            .padding()
        }
    }

    private func updateField(_ field: String, value: String?) {
        Task {
            let patch: [String: AnyCodable] = [field: AnyCodable(value as Any)]
            try? await planStore.updateNode(id: nodeId, projectId: projectId, patch: patch)
        }
    }

    @ViewBuilder
    private func executionMetrics(_ exec: TaskExecution) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Last Execution")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                HStack(spacing: 4) {
                    Circle()
                        .fill(statusColor(exec.status))
                        .frame(width: 8, height: 8)
                    Text(exec.status.rawValue.capitalized)
                        .font(.caption)
                }
            }

            if let metrics = exec.metrics {
                HStack(spacing: 16) {
                    if let cost = metrics.estimatedCostUsd {
                        metricItem(label: "Cost", value: String(format: "$%.3f", cost))
                    }
                    if let tokens = metrics.tokensUsed {
                        metricItem(label: "Tokens", value: "\(tokens)")
                    }
                    if let turns = metrics.turnsUsed {
                        metricItem(label: "Turns", value: "\(turns)")
                    }
                    Spacer()
                }
            }

            Text(exec.startedAt.relativeString)
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func gitSection(branch: String, prUrl: String?, prNumber: Int?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Git")
                .font(.subheadline.weight(.semibold))

            HStack {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(branch)
                    .font(.subheadline.monospaced())
            }

            if let prUrl, let prNumber {
                Link(destination: URL(string: prUrl)!) {
                    HStack {
                        Image(systemName: "arrow.triangle.pull")
                            .font(.caption)
                        Text("PR #\(prNumber)")
                            .font(.subheadline)
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func metricItem(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.subheadline.weight(.medium).monospacedDigit())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func statusColor(_ status: TaskExecution.ExecutionStatus) -> Color {
        switch status {
        case .pending: return .gray
        case .running: return .blue
        case .success: return .green
        case .failure: return .red
        case .cancelled: return .orange
        }
    }
}

// MARK: - Execution Summary Card

private struct SummaryCard: View {
    let summary: ExecutionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.subheadline)
                    .foregroundStyle(.blue)
                Text("Execution Summary")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(summary.status.capitalized)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(statusBadgeColor, in: Capsule())
                    .foregroundStyle(.white)
            }

            Text(summary.workCompleted)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if !summary.filesChanged.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "doc.badge.gearshape")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(summary.filesChanged.count) file\(summary.filesChanged.count == 1 ? "" : "s") changed")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if !summary.followUps.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Follow-ups")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    ForEach(summary.followUps, id: \.self) { followUp in
                        HStack(alignment: .top, spacing: 6) {
                            Text("\u{2022}")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(followUp)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var statusBadgeColor: Color {
        switch summary.status.lowercased() {
        case "success", "completed": return .green
        case "failure", "error", "failed": return .red
        case "cancelled": return .orange
        default: return .gray
        }
    }
}

// MARK: - Session Tab (Unified Output + Chat + Activity)

private struct TaskSessionTab: View {
    let nodeId: String
    let projectId: String
    let execution: TaskExecution?
    let onDispatch: () -> Void
    let onCancel: () -> Void

    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(ExecutionStore.self) private var executionStore
    @Environment(SessionStore.self) private var sessionStore

    @State private var message = ""
    @State private var isStreamingChat = false
    @State private var streamingChatText = ""
    @State private var currentChatSessionId: String?

    private let streamClient = AgentStreamClient()

    private var node: PlanNode? {
        planStore.node(id: nodeId, projectId: projectId)
    }

    private var isRunning: Bool {
        execution?.status == .running
    }

    /// Task chat session (separate from execution session)
    private var chatSession: ChatSessionData? {
        if let id = currentChatSessionId {
            return sessionStore.getSession(id)
        }
        return sessionStore.getSessionsForNode(nodeId, type: .taskChat).last
    }

    /// Execution session (for steer messages)
    private var execSession: ChatSessionData? {
        guard let sid = executionStore.executionSessionId(for: nodeId) else { return nil }
        return sessionStore.getSession(sid)
    }

    var body: some View {
        VStack(spacing: 0) {
            sessionScrollView
            Divider()
            inputArea
        }
        .task {
            await loadChatHistory()
        }
    }

    private var sessionScrollView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                sessionContent
                    .padding()
                Color.clear.frame(height: 1).id("bottom")
            }
            .onChange(of: execution?.streamText) {
                scrollToBottom(proxy)
            }
            .onChange(of: execution?.activityEvents.count) {
                scrollToBottom(proxy)
            }
            .onChange(of: chatSession?.messages.count) {
                scrollToBottom(proxy)
            }
            .onChange(of: streamingChatText) {
                scrollToBottom(proxy)
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.1)) {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    @ViewBuilder
    private var sessionContent: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            executionEventsSection
            chatSection
        }
    }

    @ViewBuilder
    private var executionEventsSection: some View {
        if let exec = execution {
            ForEach(Array(exec.activityEvents.enumerated()), id: \.offset) { idx, event in
                SessionEventRow(event: event)
                    .id(idx)
            }

            if exec.status == .running && !exec.streamText.isEmpty {
                StreamingTextRow(text: exec.streamText)
                    .id("streaming")
            }
        } else if chatSession == nil && !isStreamingChat {
            emptyState
        }
    }

    @ViewBuilder
    private var chatSection: some View {
        if let chatSession {
            ForEach(chatSession.messages) { msg in
                if msg.role == .user {
                    UserMessageRow(message: msg.content, timestamp: msg.timestamp)
                } else if msg.role == .assistant {
                    AssistantMessageRow(content: msg.content, timestamp: msg.timestamp)
                }
            }
        }

        if isStreamingChat && !streamingChatText.isEmpty {
            AssistantMessageRow(content: streamingChatText, timestamp: .now)
                .id("chat-streaming")
        }
    }

    private func loadChatHistory() async {
        // Check if we already have a session in the store
        if chatSession != nil { return }

        // Try loading from server
        do {
            if let data = try await NexusAPI.shared.getChat(nodeId: nodeId),
               let msgs = data.messages, !msgs.isEmpty {
                let newSession = sessionStore.createSession(type: .taskChat, projectId: projectId, nodeId: nodeId)
                currentChatSessionId = newSession.id
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

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "play.circle")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)

            Text("No session yet")
                .font(.headline)

            Text("Run this task to see the agent's output, tool calls, and interact with it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                onDispatch()
            } label: {
                Label("Run Task", systemImage: "play.fill")
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private var inputArea: some View {
        HStack(alignment: .bottom, spacing: 12) {
            // Run/Stop button
            if isRunning {
                Button {
                    onCancel()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.callout)
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(Color.red, in: Circle())
                }
            } else {
                Button {
                    onDispatch()
                } label: {
                    Image(systemName: "play.fill")
                        .font(.callout)
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(Color.green, in: Circle())
                }
            }

            // Chat input (for steering when running, or chat when not)
            TextField(isRunning ? "Steer agent..." : "Ask about this task...", text: $message, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22))
                .lineLimit(1...4)
                .disabled(isStreamingChat)

            // Send button (drag up to interrupt when running)
            if isRunning {
                InterruptableSendButton(
                    disabled: message.isEmpty || isStreamingChat,
                    onSend: { interrupt in sendMessage(interrupt: interrupt) }
                )
            } else {
                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(message.isEmpty || isStreamingChat ? Color.gray.opacity(0.5) : Color.accentColor, in: Circle())
                }
                .disabled(message.isEmpty || isStreamingChat)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func sendMessage(interrupt: Bool = false) {
        let userMessage = message
        message = ""

        if isRunning {
            sendSteerMessage(userMessage, interrupt: interrupt)
        } else {
            sendChatMessage(userMessage)
        }
    }

    private func sendSteerMessage(_ steerMessage: String, interrupt: Bool = false) {
        Task {
            await executionStore.steer(nodeId: nodeId, message: steerMessage, interrupt: interrupt)
        }
    }

    private func sendChatMessage(_ userMessage: String) {
        // Create or reuse session
        let sid: String
        if let existingSession = chatSession {
            sid = existingSession.id
        } else {
            let newSession = sessionStore.createSession(type: .taskChat, projectId: projectId, nodeId: nodeId)
            sid = newSession.id
            currentChatSessionId = sid
        }

        // Add user message
        sessionStore.addMessage(sid, role: .user, content: userMessage)

        isStreamingChat = true
        streamingChatText = ""

        Task {
            guard let node else { return }
            let project = projectStore.project(id: projectId)

            let stream = await streamClient.taskChat(
                nodeId: nodeId,
                projectId: projectId,
                message: userMessage,
                taskTitle: node.title,
                taskDescription: node.description,
                sessionId: chatSession?.providerSessionId,
                taskOutput: execution?.streamText,
                visionDoc: project?.visionDoc,
                messages: sessionStore.buildMessagesArray(sid)
            )

            for await event in stream {
                switch event {
                case .text(let text):
                    streamingChatText += text
                case .done(let providerSid, _):
                    if let providerSid {
                        sessionStore.setProviderSessionId(sid, providerSessionId: providerSid)
                    }
                    sessionStore.addMessage(sid, role: .assistant, content: streamingChatText)
                    streamingChatText = ""
                    isStreamingChat = false
                case .error(let msg, _):
                    sessionStore.addMessage(sid, role: .system, content: "Error: \(msg)")
                    isStreamingChat = false
                default:
                    break
                }
            }
            isStreamingChat = false
        }
    }
}

// MARK: - Session Event Row

private struct SessionEventRow: View {
    let event: TaskActivityEvent

    var body: some View {
        switch event {
        case .text(let content, let timestamp):
            TextEventRow(content: content, timestamp: timestamp)

        case .toolUse(let id, let toolName, let toolInput, let timestamp):
            ToolUseRow(id: id, toolName: toolName, toolInput: toolInput, timestamp: timestamp)

        case .toolResult(let id, let toolName, let toolResult, let success, _, let timestamp):
            ToolResultRow(id: id, toolName: toolName, result: toolResult, success: success, timestamp: timestamp)

        case .steer(let message, let accepted, let ackMessage, let interrupted, let timestamp):
            SteerEventRow(message: message, accepted: accepted, ackMessage: ackMessage, interrupted: interrupted, timestamp: timestamp)

        case .chatUser(let message, let timestamp):
            UserMessageRow(message: message, timestamp: timestamp)

        case .chatAssistant(let content, let timestamp):
            AssistantMessageRow(content: content, timestamp: timestamp)

        case .fileChange(let path, let action, _, let linesAdded, let linesRemoved, _):
            FileChangeRow(path: path, action: action, linesAdded: linesAdded, linesRemoved: linesRemoved)

        case .error(let error, let timestamp):
            ErrorEventRow(error: error, timestamp: timestamp)
        }
    }
}

// MARK: - Event Row Components

private struct TextEventRow: View {
    let content: String
    let timestamp: Date

    var body: some View {
        Text(content)
            .font(.system(.subheadline, design: .monospaced))
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 2)
    }
}

private struct StreamingTextRow: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ProgressView()
                .scaleEffect(0.6)

            Text(text.suffix(2000))
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }
}

private struct ToolUseRow: View {
    let id: String
    let toolName: String
    let toolInput: AnyCodable
    let timestamp: Date

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "wrench.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)

                    Text(toolName)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(formatToolInput(toolInput))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(Color.orange.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }

    private func formatToolInput(_ input: AnyCodable) -> String {
        if let data = try? JSONEncoder().encode(input),
           let obj = try? JSONSerialization.jsonObject(with: data),
           let pretty = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted),
           let str = String(data: pretty, encoding: .utf8) {
            return str
        }
        return "\(input)"
    }
}

private struct ToolResultRow: View {
    let id: String
    let toolName: String
    let result: AnyCodable?
    let success: Bool?
    let timestamp: Date

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: success == true ? "checkmark.circle.fill" : success == false ? "xmark.circle.fill" : "circle.fill")
                .font(.caption)
                .foregroundStyle(success == true ? .green : success == false ? .red : .gray)

            Text(toolName)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text("completed")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}

private struct SteerEventRow: View {
    let message: String
    let accepted: Bool?
    let ackMessage: String?
    let interrupted: Bool?
    let timestamp: Date

    private var isInterrupted: Bool { interrupted == true }

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: isInterrupted ? "bolt.fill" : "arrow.triangle.turn.up.right.diamond.fill")
                    .font(.caption)
                    .foregroundStyle(isInterrupted ? .orange : .purple)

                Text("You")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(isInterrupted ? .orange : .purple)
            }

            HStack(spacing: 4) {
                if isInterrupted {
                    Image(systemName: "bolt.fill")
                        .font(.caption2)
                }
                Text(message)
                    .font(.subheadline)
            }
            .padding(8)
            .foregroundStyle(.white)
            .background(isInterrupted ? Color.orange : Color.purple.opacity(0.8), in: RoundedRectangle(cornerRadius: 8))

            if let accepted {
                HStack(spacing: 4) {
                    Image(systemName: accepted ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(.caption2)
                        .foregroundStyle(accepted ? .green : .red)
                    Text(accepted ? (isInterrupted ? "Interrupted" : "Queued") : (ackMessage ?? "Failed"))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.vertical, 4)
    }
}

private struct UserMessageRow: View {
    let message: String
    let timestamp: Date

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text("You")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)

            Text(message)
                .font(.subheadline)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16))
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.vertical, 4)
    }
}

private struct AssistantMessageRow: View {
    let content: String
    let timestamp: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Assistant")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)

            Text(content)
                .font(.subheadline)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }
}

private struct FileChangeRow: View {
    let path: String
    let action: String
    let linesAdded: Int?
    let linesRemoved: Int?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: action == "create" ? "doc.badge.plus" : action == "delete" ? "doc.badge.minus" : "doc.badge.gearshape")
                .font(.caption)
                .foregroundStyle(action == "create" ? .green : action == "delete" ? .red : .blue)

            Text(path.components(separatedBy: "/").last ?? path)
                .font(.caption.monospaced())
                .lineLimit(1)

            Spacer()

            if let added = linesAdded, added > 0 {
                Text("+\(added)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.green)
            }
            if let removed = linesRemoved, removed > 0 {
                Text("-\(removed)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.red)
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 6))
    }
}

private struct ErrorEventRow: View {
    let error: String
    let timestamp: Date

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)

            Text(error)
                .font(.subheadline)
                .foregroundStyle(.red)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        .padding(.vertical, 4)
    }
}

// MARK: - Interruptable Send Button (drag up to interrupt)

private struct InterruptableSendButton: View {
    let disabled: Bool
    let onSend: (_ interrupt: Bool) -> Void

    @State private var dragOffset: CGFloat = 0
    @State private var isInterruptMode: Bool = false

    private let interruptThreshold: CGFloat = 40

    var body: some View {
        let currentColor = disabled
            ? Color.gray.opacity(0.5)
            : (isInterruptMode ? Color.orange : Color.accentColor)
        let currentIcon = isInterruptMode ? "bolt.fill" : "arrow.up"

        Image(systemName: currentIcon)
            .font(.callout.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: 36, height: 36)
            .background(currentColor, in: Circle())
            .contentShape(Circle())
            .scaleEffect(isInterruptMode ? 1.2 : 1.0)
            .offset(y: dragOffset)
            .animation(.easeOut(duration: 0.15), value: isInterruptMode)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard !disabled else { return }
                        // Only track upward drag (negative translation)
                        dragOffset = min(0, value.translation.height)
                        isInterruptMode = -value.translation.height >= interruptThreshold
                    }
                    .onEnded { value in
                        guard !disabled else { return }
                        let interrupt = -value.translation.height >= interruptThreshold
                        onSend(interrupt)
                        dragOffset = 0
                        isInterruptMode = false
                    }
            )
            .accessibilityLabel(isInterruptMode ? "Interrupt and send" : "Send message")
            .accessibilityHint("Drag up to interrupt the agent")
    }
}
