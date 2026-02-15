import SwiftUI

struct ProjectDetailView: View {
    let projectId: String

    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(NavigationContext.self) private var navigationContext
    @SwiftUI.Environment(\.horizontalSizeClass) private var sizeClass

    @State private var selectedTab: Tab = .overview
    @State private var showVisionDoc = false
    
    // Two-panel state: chat OR detail, not both
    @State private var rightPanelMode: RightPanelMode = .none
    @State private var selectedNode: PlanNode?
    @State private var chatInitialMessage: String?

    enum Tab: String, CaseIterable {
        case overview = "Overview"
        case plan = "Plan"
        case timeline = "Timeline"
    }
    
    enum RightPanelMode {
        case none
        case chat
        case detail
    }

    private var project: Project? {
        projectStore.project(id: projectId)
    }

    private var isWide: Bool {
        sizeClass != .compact
    }

    private var generationState: PlanStore.GenerationState? {
        planStore.generationState(for: projectId)
    }

    var body: some View {
        Group {
            if let project {
                VStack(spacing: 0) {
                    // Generation progress banner
                    if let gen = generationState, gen.isGenerating {
                        GenerationBanner(state: gen)
                    } else if let gen = generationState, gen.nodeCount > 0, !gen.isGenerating {
                        // Just finished — show success briefly
                        GenerationCompleteBanner(nodeCount: gen.nodeCount)
                    }

                    if isWide {
                        iPadLayout(project: project)
                    } else {
                        compactLayout(project: project)
                    }
                }
            } else {
                ContentUnavailableView("Project Not Found", systemImage: "folder.badge.questionmark")
            }
        }
        .task {
            navigationContext.currentProjectId = projectId
            navigationContext.currentNodeId = nil
            await planStore.loadPlan(projectId: projectId)
        }
    }

    // MARK: - Compact layout (iPhone)

    private func compactLayout(project: Project) -> some View {
        VStack(spacing: 0) {
            Picker("View", selection: $selectedTab) {
                ForEach(Tab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            switch selectedTab {
            case .overview:
                ProjectOverviewTab(project: project)
            case .plan:
                PlanListView(projectId: projectId)
            case .timeline:
                PlanTimelineView(projectId: projectId)
            }
        }
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { compactToolbar }
        .sheet(isPresented: $showVisionDoc) {
            VisionDocEditor(projectId: projectId)
        }
        .sheet(isPresented: .init(
            get: { rightPanelMode == .chat },
            set: { if !$0 { rightPanelMode = .none } }
        )) {
            NavigationStack {
                ChatPanelView(
                    projectId: projectId,
                    initialMessage: chatInitialMessage,
                    onClose: { rightPanelMode = .none }
                )
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { rightPanelMode = .none }
                    }
                }
            }
        }
        .sheet(item: $selectedNode) { node in
            NavigationStack {
                NodeDetailPanel(
                    node: node,
                    projectId: projectId,
                    onClose: { 
                        selectedNode = nil
                        rightPanelMode = .none 
                    },
                    onDecompose: { nodeId in
                        handleDecompose(nodeId: nodeId)
                    }
                )
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { 
                            selectedNode = nil
                            rightPanelMode = .none 
                        }
                    }
                }
            }
        }
    }

    // MARK: - iPad/visionOS layout (desktop-class)

    private func iPadLayout(project: Project) -> some View {
        HStack(spacing: 0) {
            // Main content area
            VStack(spacing: 0) {
                // Tab bar
                HStack(spacing: 0) {
                    ForEach(Tab.allCases, id: \.self) { tab in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedTab = tab
                            }
                        } label: {
                            Text(tab.rawValue)
                                .font(.subheadline.weight(selectedTab == tab ? .semibold : .regular))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(selectedTab == tab ? Color.accentColor.opacity(0.1) : .clear)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                    toolbarButtons
                }
                .padding(.horizontal)
                .padding(.vertical, 6)
                .background(.bar)

                Divider()

                // Tab content with node selection support
                switch selectedTab {
                case .overview:
                    ProjectOverviewTab(project: project)
                case .plan:
                    PlanListViewWithSelection(
                        projectId: projectId,
                        onNodeSelect: handleNodeSelect
                    )
                case .timeline:
                    PlanTimelineView(projectId: projectId)
                }
            }
            .frame(maxWidth: .infinity)

            // Right panel: Chat OR Detail (mutually exclusive, like TypeScript version)
            if rightPanelMode == .chat {
                Divider()
                ChatPanelView(
                    projectId: projectId,
                    initialMessage: chatInitialMessage,
                    onClose: { 
                        withAnimation { 
                            rightPanelMode = .none 
                            chatInitialMessage = nil
                        } 
                    }
                )
                .frame(width: 380)
                .transition(.move(edge: .trailing))
            } else if rightPanelMode == .detail, let node = selectedNode {
                Divider()
                NodeDetailPanel(
                    node: node,
                    projectId: projectId,
                    onClose: { 
                        withAnimation { 
                            selectedNode = nil
                            rightPanelMode = .none 
                        } 
                    },
                    onDecompose: { nodeId in
                        handleDecompose(nodeId: nodeId)
                    }
                )
                .frame(width: 380)
                .transition(.move(edge: .trailing))
            }
        }
        .navigationTitle(project.name)
        #if !os(watchOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(isPresented: $showVisionDoc) {
            VisionDocEditor(projectId: projectId)
        }
    }
    
    // MARK: - Node Selection Handler
    
    private func handleNodeSelect(_ node: PlanNode?) {
        if let node {
            selectedNode = node
            // Switch to detail panel (closes chat)
            withAnimation(.easeInOut(duration: 0.2)) {
                rightPanelMode = .detail
                chatInitialMessage = nil
            }
        } else {
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedNode = nil
                if rightPanelMode == .detail {
                    rightPanelMode = .none
                }
            }
        }
    }
    
    // MARK: - Decompose Handler
    
    private func handleDecompose(nodeId: String) {
        guard let node = planStore.node(id: nodeId, projectId: projectId) else { return }
        let message = "Decompose @\(node.title) into smaller sub-tasks with minimal overlap. Each sub-task should be agent-solvable in one session."
        chatInitialMessage = message
        withAnimation(.easeInOut(duration: 0.2)) {
            selectedNode = nil
            rightPanelMode = .chat
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var compactToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button {
                    showVisionDoc = true
                } label: {
                    Label("Vision Document", systemImage: "doc.text")
                }
                Button {
                    rightPanelMode = rightPanelMode == .chat ? .none : .chat
                } label: {
                    Label(rightPanelMode == .chat ? "Hide Chat" : "Chat", systemImage: "bubble.left.and.bubble.right")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }

    private var toolbarButtons: some View {
        HStack(spacing: 12) {
            Button {
                showVisionDoc = true
            } label: {
                Label("Vision Doc", systemImage: "doc.text")
                    .font(.subheadline)
            }
            .buttonStyle(.bordered)

            // Chat button - toggles chat panel
            if rightPanelMode == .chat {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        rightPanelMode = .none
                        chatInitialMessage = nil
                    }
                } label: {
                    Label("Hide Chat", systemImage: "bubble.left.and.bubble.right")
                        .font(.subheadline)
                }
                .buttonStyle(.borderedProminent)
            } else {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        rightPanelMode = .chat
                        selectedNode = nil
                    }
                } label: {
                    Label("Chat", systemImage: "bubble.left.and.bubble.right")
                        .font(.subheadline)
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

// MARK: - Plan List View with Selection

/// A wrapper around PlanListView that supports node selection for the two-panel layout
private struct PlanListViewWithSelection: View {
    let projectId: String
    let onNodeSelect: (PlanNode?) -> Void
    
    @Environment(PlanStore.self) private var planStore
    @State private var grouping: PlanStore.TaskGrouping = .milestone
    @State private var searchText = ""
    @State private var statusFilter: PlanNode.NodeStatus?
    @State private var showAddTask = false

    private var filteredGroups: [(String, [PlanNode])] {
        var groups = planStore.tasksGrouped(by: grouping, projectId: projectId)
        if !searchText.isEmpty {
            groups = groups.map { (key, nodes) in
                (key, nodes.filter {
                    $0.title.localizedCaseInsensitiveContains(searchText) ||
                    $0.description.localizedCaseInsensitiveContains(searchText)
                })
            }.filter { !$0.1.isEmpty }
        }
        if let filter = statusFilter {
            groups = groups.map { (key, nodes) in
                (key, nodes.filter { $0.status == filter })
            }.filter { !$0.1.isEmpty }
        }
        return groups
    }

    var body: some View {
        List {
            ForEach(filteredGroups, id: \.0) { groupName, nodes in
                Section(groupName) {
                    ForEach(nodes) { node in
                        Button {
                            onNodeSelect(node)
                        } label: {
                            TaskRow(node: node)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                Task { try? await planStore.deleteNode(id: node.id, projectId: projectId) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search tasks")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Section("Group By") {
                        ForEach(PlanStore.TaskGrouping.allCases, id: \.self) { option in
                            Button {
                                grouping = option
                            } label: {
                                HStack {
                                    Text(option.rawValue)
                                    if grouping == option {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                    Section("Filter Status") {
                        Button("All") { statusFilter = nil }
                        ForEach(PlanNode.NodeStatus.allCases, id: \.self) { status in
                            Button {
                                statusFilter = status
                            } label: {
                                HStack {
                                    Text(status.displayName)
                                    if statusFilter == status {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAddTask = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showAddTask) {
            NavigationStack {
                AddTaskSheet(projectId: projectId)
            }
        }
    }
}

// MARK: - Add Task Sheet

private struct AddTaskSheet: View {
    let projectId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(PlanStore.self) private var planStore

    @State private var title = ""
    @State private var description = ""
    @State private var type: PlanNode.NodeType = .task
    @State private var priority: Priority = .medium
    @State private var estimate: Estimate = .m
    @State private var environment: TaskEnvironment?

    var body: some View {
        Form {
            Section("Task Details") {
                TextField("Title", text: $title)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(3...6)
            }

            Section("Properties") {
                Picker("Type", selection: $type) {
                    ForEach(PlanNode.NodeType.allCases, id: \.self) { t in
                        Text(t.rawValue.capitalized).tag(t)
                    }
                }
                Picker("Priority", selection: $priority) {
                    ForEach(Priority.allCases, id: \.self) { p in
                        Text(p.displayName).tag(p)
                    }
                }
                Picker("Estimate", selection: $estimate) {
                    ForEach(Estimate.allCases, id: \.self) { e in
                        Text(e.rawValue).tag(e)
                    }
                }
                Picker("Environment", selection: $environment) {
                    Text("Auto").tag(nil as TaskEnvironment?)
                    ForEach([TaskEnvironment.remote, .hpc, .cloud], id: \.self) { e in
                        Text(e.rawValue.capitalized).tag(e as TaskEnvironment?)
                    }
                }
            }
        }
        .navigationTitle("Add Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Add") {
                    addTask()
                }
                .disabled(title.isEmpty)
            }
        }
    }

    private func addTask() {
        let node = PlanNode(
            id: UUID().uuidString,
            projectId: projectId,
            type: type,
            title: title,
            description: description,
            status: .planned,
            dependencies: [],
            environment: environment,
            verification: .auto,
            position: .init(x: 0, y: 0),
            priority: priority,
            estimate: estimate,
            createdAt: .now,
            updatedAt: .now
        )

        Task {
            try? await planStore.addNode(node)
            dismiss()
        }
    }
}

// MARK: - Overview Tab

private struct ProjectOverviewTab: View {
    let project: Project
    @Environment(PlanStore.self) private var planStore

    private var nodes: [PlanNode] {
        planStore.nodes(for: project.id)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Description
                VStack(alignment: .leading, spacing: 8) {
                    Text("Description")
                        .font(.headline)
                    Text(project.description)
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))

                // Stats
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    StatCard(title: "Total Tasks", value: "\(nodes.count)", icon: "list.bullet", color: .blue)
                    StatCard(title: "Completed", value: "\(nodes.filter { $0.status.isDone }.count)", icon: "checkmark", color: .green)
                    StatCard(title: "In Progress", value: "\(nodes.filter { $0.status.isActive }.count)", icon: "bolt", color: .orange)
                }

                // Health & Progress
                if let health = project.health {
                    HStack {
                        Text("Health")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        Text(health.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.subheadline)
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }

                if let progress = project.progress {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Progress")
                                .font(.subheadline.weight(.medium))
                            Spacer()
                            Text("\(progress)%")
                                .font(.subheadline.monospacedDigit())
                        }
                        ProgressView(value: Double(progress), total: 100)
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }

                // Dates
                if project.startDate != nil || project.targetDate != nil {
                    HStack {
                        if let start = project.startDate {
                            VStack(alignment: .leading) {
                                Text("Start")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(start)
                                    .font(.subheadline)
                            }
                        }
                        Spacer()
                        if let target = project.targetDate {
                            VStack(alignment: .trailing) {
                                Text("Target")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(target)
                                    .font(.subheadline)
                            }
                        }
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding()
        }
    }
}

// MARK: - Generation Progress Banner

private struct GenerationBanner: View {
    let state: PlanStore.GenerationState

    @State private var dots = ""
    @State private var isExpanded = false

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 10) {
                    ProgressView()
                        .scaleEffect(0.8)

                    Text("Generating plan\(dots)")
                        .font(.subheadline.weight(.medium))

                    Spacer()

                    if let error = state.error {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)

            if isExpanded && !state.text.isEmpty {
                ScrollView {
                    Text(state.text.suffix(2000))
                        .font(.system(.caption2, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                }
                .frame(maxHeight: 150)
            }

            Divider()
        }
        .background(
            ZStack {
                .ultraThinMaterial
                LinearGradient(
                    colors: [Color.nexusBlue.opacity(0.05), Color.clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            }
        )
        .task {
            while true {
                try? await Task.sleep(for: .milliseconds(500))
                dots = dots.count >= 3 ? "" : dots + "."
            }
        }
    }
}

private struct GenerationCompleteBanner: View {
    let nodeCount: Int
    @State private var isVisible = true

    var body: some View {
        if isVisible {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Plan generated: \(nodeCount) nodes")
                    .font(.subheadline.weight(.medium))
                Spacer()
                Button {
                    withAnimation { isVisible = false }
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.green.opacity(0.1))
            .transition(.move(edge: .top).combined(with: .opacity))
            .task {
                try? await Task.sleep(for: .seconds(5))
                withAnimation { isVisible = false }
            }
        }
    }
}
