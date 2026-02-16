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

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            AdaptiveColors.background(colorScheme).ignoresSafeArea()

            if let node {
                VStack(spacing: 0) {
                    // Segmented tab picker
                    Picker("View", selection: $selectedTab) {
                        ForEach(Tab.allCases, id: \.self) { tab in
                            Text(tab.rawValue).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, NexusTheme.Spacing.lg)
                    .padding(.vertical, NexusTheme.Spacing.md)
                    .background(AdaptiveColors.surface(colorScheme))

                    Divider()
                        .background(AdaptiveColors.border(colorScheme))

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
                                    .foregroundStyle(AdaptiveColors.danger)
                            }
                        } else if node.status == .planned || node.status == .completed {
                            Button {
                                dispatchAndGoToSession(node)
                            } label: {
                                Image(systemName: "play.circle")
                                    .foregroundStyle(AdaptiveColors.primary)
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
    @Environment(\.colorScheme) private var colorScheme

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
            VStack(alignment: .leading, spacing: NexusTheme.Spacing.lg) {
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

                // Pending Approval
                if let approval = realtimeStore.pendingApprovals.first(where: { $0.nodeId == nodeId }) {
                    ApprovalCard(approval: approval) { approved, selectedOption in
                        try await realtimeStore.respondToApproval(
                            approval.approvalId!,
                            approved: approved,
                            selectedOption: selectedOption
                        )
                    }
                }

                // Description
                if !node.description.isEmpty {
                    Text(node.description)
                        .font(NexusTheme.Typography.body)
                        .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                }

                // Model/Machine picker + Run button (if not already running)
                if execution?.status != .running {
                    VStack(spacing: NexusTheme.Spacing.md) {
                        HStack {
                            Text("Model")
                                .font(NexusTheme.Typography.subheadline)
                                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                            Spacer()
                            Picker("Model", selection: $selectedModel) {
                                ForEach(availableModels, id: \.id) { model in
                                    Text(model.label).tag(model.id)
                                }
                            }
                            .pickerStyle(.menu)
                        }
                        .padding(NexusTheme.Spacing.md)
                        .background(AdaptiveColors.surfaceElevated(colorScheme))
                        .cornerRadius(NexusTheme.CornerRadius.md)

                        if !connectedMachines.isEmpty {
                            HStack {
                                Text("Machine")
                                    .font(NexusTheme.Typography.subheadline)
                                    .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                                Spacer()
                                Picker("Machine", selection: $selectedMachineId) {
                                    Text("Auto").tag(nil as String?)
                                    ForEach(connectedMachines) { machine in
                                        Text(machine.name).tag(machine.machineId as String?)
                                    }
                                }
                                .pickerStyle(.menu)
                            }
                            .padding(NexusTheme.Spacing.md)
                            .background(AdaptiveColors.surfaceElevated(colorScheme))
                            .cornerRadius(NexusTheme.CornerRadius.md)
                        }

                        Button {
                            onRun()
                        } label: {
                            Label("Run Task", systemImage: "play.fill")
                                .font(NexusTheme.Typography.bodyMedium)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, NexusTheme.Spacing.md)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AdaptiveColors.success)
                    }
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
            .padding(NexusTheme.Spacing.lg)
        }
        .adaptiveScrollFade(colorScheme: colorScheme)
    }

    private func updateField(_ field: String, value: String?) {
        Task {
            let patch: [String: AnyCodable] = [field: AnyCodable(value as Any)]
            try? await planStore.updateNode(id: nodeId, projectId: projectId, patch: patch)
        }
    }

    @ViewBuilder
    private func executionMetrics(_ exec: TaskExecution) -> some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.md) {
            HStack {
                Text("Last Execution")
                    .font(NexusTheme.Typography.subheadline.weight(.semibold))
                    .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                Spacer()
                HStack(spacing: 4) {
                    Circle()
                        .fill(statusColor(exec.status))
                        .frame(width: 8, height: 8)
                    Text(exec.status.rawValue.capitalized)
                        .font(NexusTheme.Typography.caption1)
                        .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                }
            }

            if let metrics = exec.metrics {
                HStack(spacing: NexusTheme.Spacing.lg) {
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
                .font(NexusTheme.Typography.caption1)
                .foregroundStyle(AdaptiveColors.textTertiary(colorScheme))
        }
        .padding(NexusTheme.Spacing.lg)
        .background(AdaptiveColors.surfaceElevated(colorScheme))
        .cornerRadius(NexusTheme.CornerRadius.md)
    }

    @ViewBuilder
    private func gitSection(branch: String, prUrl: String?, prNumber: Int?) -> some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.sm) {
            Text("Git")
                .font(NexusTheme.Typography.subheadline.weight(.semibold))
                .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

            HStack {
                Image(systemName: "arrow.triangle.branch")
                    .font(NexusTheme.Typography.caption1)
                    .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                Text(branch)
                    .font(NexusTheme.Typography.subheadline.monospaced())
                    .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
            }

            if let prUrl, let prNumber {
                Link(destination: URL(string: prUrl)!) {
                    HStack {
                        Image(systemName: "arrow.triangle.pull")
                            .font(NexusTheme.Typography.caption1)
                        Text("PR #\(prNumber)")
                            .font(NexusTheme.Typography.subheadline)
                    }
                    .foregroundColor(AdaptiveColors.primary)
                }
            }
        }
        .padding(NexusTheme.Spacing.lg)
        .background(AdaptiveColors.surfaceElevated(colorScheme))
        .cornerRadius(NexusTheme.CornerRadius.md)
    }

    private func metricItem(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(NexusTheme.Typography.subheadline.weight(.medium).monospacedDigit())
                .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
            Text(label)
                .font(NexusTheme.Typography.caption2)
                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
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
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.md) {
            HStack(spacing: NexusTheme.Spacing.sm) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(NexusTheme.Typography.subheadline)
                    .foregroundStyle(AdaptiveColors.primary)
                Text("Execution Summary")
                    .font(NexusTheme.Typography.subheadline.weight(.semibold))
                    .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                Spacer()
                Text(summary.status.capitalized)
                    .font(NexusTheme.Typography.caption1.weight(.medium))
                    .padding(.horizontal, NexusTheme.Spacing.sm)
                    .padding(.vertical, 4)
                    .background(statusBadgeColor, in: Capsule())
                    .foregroundStyle(.white)
            }

            Text(summary.workCompleted)
                .font(NexusTheme.Typography.subheadline)
                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))

            if !summary.filesChanged.isEmpty {
                HStack(spacing: NexusTheme.Spacing.xs) {
                    Image(systemName: "doc.badge.gearshape")
                        .font(NexusTheme.Typography.caption1)
                        .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                    Text("\(summary.filesChanged.count) file\(summary.filesChanged.count == 1 ? "" : "s") changed")
                        .font(NexusTheme.Typography.caption1)
                        .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                }
            }

            if !summary.followUps.isEmpty {
                VStack(alignment: .leading, spacing: NexusTheme.Spacing.xs) {
                    Text("Follow-ups")
                        .font(NexusTheme.Typography.caption1.weight(.medium))
                        .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                    ForEach(summary.followUps, id: \.self) { followUp in
                        HStack(alignment: .top, spacing: NexusTheme.Spacing.sm) {
                            Text("\u{2022}")
                                .font(NexusTheme.Typography.caption1)
                                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                            Text(followUp)
                                .font(NexusTheme.Typography.caption1)
                                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                        }
                    }
                }
            }
        }
        .padding(NexusTheme.Spacing.lg)
        .background(AdaptiveColors.surfaceElevated(colorScheme))
        .cornerRadius(NexusTheme.CornerRadius.md)
    }

    private var statusBadgeColor: Color {
        switch summary.status.lowercased() {
        case "success", "completed": return AdaptiveColors.statusCompleted
        case "failure", "error", "failed": return AdaptiveColors.statusError
        case "cancelled": return AdaptiveColors.statusAwaiting
        default: return AdaptiveColors.statusPruned
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
    @Environment(\.colorScheme) private var colorScheme

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
        ZStack {
            AdaptiveColors.background(colorScheme).ignoresSafeArea()

            VStack(spacing: 0) {
                sessionScrollView
                Divider()
                    .background(AdaptiveColors.border(colorScheme))
                inputArea
                    .background(AdaptiveColors.surface(colorScheme))
            }
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
        LazyVStack(alignment: .leading, spacing: NexusTheme.Spacing.sm) {
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
        VStack(spacing: NexusTheme.Spacing.lg) {
            Image(systemName: "play.circle")
                .font(.system(size: 48))
                .foregroundStyle(AdaptiveColors.textTertiary(colorScheme))

            Text("No session yet")
                .font(NexusTheme.Typography.headline)
                .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

            Text("Run this task to see the agent's output, tool calls, and interact with it.")
                .font(NexusTheme.Typography.subheadline)
                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                .multilineTextAlignment(.center)

            Button {
                onDispatch()
            } label: {
                Label("Run Task", systemImage: "play.fill")
                    .padding(.horizontal, NexusTheme.Spacing.xl)
                    .padding(.vertical, NexusTheme.Spacing.md)
            }
            .buttonStyle(.borderedProminent)
            .tint(AdaptiveColors.success)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private var inputArea: some View {
        HStack(alignment: .bottom, spacing: NexusTheme.Spacing.md) {
            // Run/Stop button
            if isRunning {
                Button {
                    onCancel()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(NexusTheme.Typography.callout)
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(AdaptiveColors.danger, in: Circle())
                }
            } else {
                Button {
                    onDispatch()
                } label: {
                    Image(systemName: "play.fill")
                        .font(NexusTheme.Typography.callout)
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(AdaptiveColors.success, in: Circle())
                }
            }

            // Chat input (for steering when running, or chat when not)
            TextField(isRunning ? "Steer agent..." : "Ask about this task...", text: $message, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(AdaptiveColors.surfaceElevated(colorScheme), in: RoundedRectangle(cornerRadius: 22))
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
                        .font(NexusTheme.Typography.callout.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(message.isEmpty || isStreamingChat ? AdaptiveColors.textTertiary(colorScheme) : AdaptiveColors.primary, in: Circle())
                }
                .disabled(message.isEmpty || isStreamingChat)
            }
        }
        .padding(.horizontal, NexusTheme.Spacing.lg)
        .padding(.vertical, NexusTheme.Spacing.md)
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
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Text(content)
            .font(.system(.subheadline, design: .monospaced))
            .foregroundStyle(AdaptiveColors.textPrimary(colorScheme))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 2)
    }
}

private struct StreamingTextRow: View {
    let text: String
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(alignment: .top, spacing: NexusTheme.Spacing.sm) {
            ProgressView()
                .scaleEffect(0.6)
                .tint(AdaptiveColors.primary)

            Text(text.suffix(2000))
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(AdaptiveColors.textPrimary(colorScheme))
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
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.xs) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: NexusTheme.Spacing.sm) {
                    Image(systemName: "wrench.fill")
                        .font(NexusTheme.Typography.caption1)
                        .foregroundStyle(AdaptiveColors.warning)

                    Text(toolName)
                        .font(NexusTheme.Typography.subheadline.weight(.medium))
                        .foregroundStyle(AdaptiveColors.textPrimary(colorScheme))

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(NexusTheme.Typography.caption1)
                        .foregroundStyle(AdaptiveColors.textTertiary(colorScheme))
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(formatToolInput(toolInput))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                    .padding(NexusTheme.Spacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AdaptiveColors.surfaceElevated(colorScheme), in: RoundedRectangle(cornerRadius: NexusTheme.CornerRadius.sm))
            }
        }
        .padding(.vertical, NexusTheme.Spacing.xs)
        .padding(.horizontal, NexusTheme.Spacing.sm)
        .background(AdaptiveColors.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: NexusTheme.CornerRadius.sm))
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
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: NexusTheme.Spacing.sm) {
            Image(systemName: success == true ? "checkmark.circle.fill" : success == false ? "xmark.circle.fill" : "circle.fill")
                .font(NexusTheme.Typography.caption1)
                .foregroundStyle(success == true ? AdaptiveColors.success : success == false ? AdaptiveColors.danger : AdaptiveColors.textTertiary(colorScheme))

            Text(toolName)
                .font(NexusTheme.Typography.caption1)
                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))

            Text("completed")
                .font(NexusTheme.Typography.caption1)
                .foregroundStyle(AdaptiveColors.textTertiary(colorScheme))
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
    @Environment(\.colorScheme) private var colorScheme

    private var isInterrupted: Bool { interrupted == true }

    var body: some View {
        VStack(alignment: .trailing, spacing: NexusTheme.Spacing.xs) {
            HStack(spacing: NexusTheme.Spacing.sm) {
                Image(systemName: isInterrupted ? "bolt.fill" : "arrow.triangle.turn.up.right.diamond.fill")
                    .font(NexusTheme.Typography.caption1)
                    .foregroundStyle(isInterrupted ? AdaptiveColors.warning : Color.purple)

                Text("You")
                    .font(NexusTheme.Typography.caption1.weight(.medium))
                    .foregroundStyle(isInterrupted ? AdaptiveColors.warning : Color.purple)
            }

            HStack(spacing: NexusTheme.Spacing.xs) {
                if isInterrupted {
                    Image(systemName: "bolt.fill")
                        .font(NexusTheme.Typography.caption2)
                }
                Text(message)
                    .font(NexusTheme.Typography.subheadline)
            }
            .padding(NexusTheme.Spacing.sm)
            .foregroundStyle(.white)
            .background(isInterrupted ? AdaptiveColors.warning : Color.purple.opacity(0.8), in: RoundedRectangle(cornerRadius: NexusTheme.CornerRadius.sm))

            if let accepted {
                HStack(spacing: NexusTheme.Spacing.xs) {
                    Image(systemName: accepted ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(NexusTheme.Typography.caption2)
                        .foregroundStyle(accepted ? AdaptiveColors.success : AdaptiveColors.danger)
                    Text(accepted ? (isInterrupted ? "Interrupted" : "Queued") : (ackMessage ?? "Failed"))
                        .font(NexusTheme.Typography.caption2)
                        .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.vertical, NexusTheme.Spacing.xs)
    }
}

private struct UserMessageRow: View {
    let message: String
    let timestamp: Date
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .trailing, spacing: NexusTheme.Spacing.xs) {
            Text("You")
                .font(NexusTheme.Typography.caption2.weight(.medium))
                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))

            Text(message)
                .font(NexusTheme.Typography.subheadline)
                .padding(.horizontal, NexusTheme.Spacing.md)
                .padding(.vertical, NexusTheme.Spacing.sm)
                .background(AdaptiveColors.primary, in: RoundedRectangle(cornerRadius: NexusTheme.CornerRadius.lg))
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.vertical, NexusTheme.Spacing.xs)
    }
}

private struct AssistantMessageRow: View {
    let content: String
    let timestamp: Date
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.xs) {
            Text("Assistant")
                .font(NexusTheme.Typography.caption2.weight(.medium))
                .foregroundStyle(AdaptiveColors.textSecondary(colorScheme))

            Text(content)
                .font(NexusTheme.Typography.subheadline)
                .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                .padding(.horizontal, NexusTheme.Spacing.md)
                .padding(.vertical, NexusTheme.Spacing.sm)
                .background(AdaptiveColors.surfaceElevated(colorScheme), in: RoundedRectangle(cornerRadius: NexusTheme.CornerRadius.lg))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, NexusTheme.Spacing.xs)
    }
}

private struct FileChangeRow: View {
    let path: String
    let action: String
    let linesAdded: Int?
    let linesRemoved: Int?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: NexusTheme.Spacing.sm) {
            Image(systemName: action == "create" ? "doc.badge.plus" : action == "delete" ? "doc.badge.minus" : "doc.badge.gearshape")
                .font(NexusTheme.Typography.caption1)
                .foregroundStyle(action == "create" ? AdaptiveColors.success : action == "delete" ? AdaptiveColors.danger : AdaptiveColors.primary)

            Text(path.components(separatedBy: "/").last ?? path)
                .font(NexusTheme.Typography.caption1.monospaced())
                .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                .lineLimit(1)

            Spacer()

            if let added = linesAdded, added > 0 {
                Text("+\(added)")
                    .font(NexusTheme.Typography.caption1.monospaced())
                    .foregroundStyle(AdaptiveColors.success)
            }
            if let removed = linesRemoved, removed > 0 {
                Text("-\(removed)")
                    .font(NexusTheme.Typography.caption1.monospaced())
                    .foregroundStyle(AdaptiveColors.danger)
            }
        }
        .padding(.vertical, NexusTheme.Spacing.xs)
        .padding(.horizontal, NexusTheme.Spacing.sm)
        .background(AdaptiveColors.surfaceElevated(colorScheme), in: RoundedRectangle(cornerRadius: NexusTheme.CornerRadius.sm))
    }
}

private struct ErrorEventRow: View {
    let error: String
    let timestamp: Date
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: NexusTheme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(NexusTheme.Typography.caption1)
                .foregroundStyle(AdaptiveColors.danger)

            Text(error)
                .font(NexusTheme.Typography.subheadline)
                .foregroundStyle(AdaptiveColors.danger)
        }
        .padding(NexusTheme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AdaptiveColors.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: NexusTheme.CornerRadius.sm))
        .padding(.vertical, NexusTheme.Spacing.xs)
    }
}

// MARK: - Interruptable Send Button (drag up to interrupt)

private struct InterruptableSendButton: View {
    let disabled: Bool
    let onSend: (_ interrupt: Bool) -> Void
    @Environment(\.colorScheme) private var colorScheme

    @State private var dragOffset: CGFloat = 0
    @State private var isInterruptMode: Bool = false

    private let interruptThreshold: CGFloat = 40

    var body: some View {
        let currentColor = disabled
            ? AdaptiveColors.textTertiary(colorScheme)
            : (isInterruptMode ? AdaptiveColors.warning : AdaptiveColors.primary)
        let currentIcon = isInterruptMode ? "bolt.fill" : "arrow.up"

        Image(systemName: currentIcon)
            .font(NexusTheme.Typography.callout.weight(.semibold))
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
