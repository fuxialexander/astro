import SwiftUI

/// iPad-optimized task list view with side-by-side list and detail panel
struct MyTasksViewiPad: View {
    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var colorScheme

    @State private var selectedNode: PlanNode?
    @State private var statusFilter: Set<PlanNode.NodeStatus> = []
    @State private var searchText = ""

    let initialStatusFilter: [PlanNode.NodeStatus]

    init(initialStatusFilter: [PlanNode.NodeStatus] = []) {
        self.initialStatusFilter = initialStatusFilter
    }

    private var sizeClass: DeviceSizeClass {
        DeviceSizeClass.current(horizontalSizeClass)
    }

    private var allTasks: [PlanNode] {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.type == .task }
    }

    private var filteredTasks: [PlanNode] {
        var tasks = allTasks

        // Status filter
        if !statusFilter.isEmpty {
            tasks = tasks.filter { statusFilter.contains($0.status) }
        }

        // Search filter
        if !searchText.isEmpty {
            tasks = tasks.filter {
                $0.title.localizedCaseInsensitiveContains(searchText) ||
                $0.description.localizedCaseInsensitiveContains(searchText)
            }
        }

        return tasks.sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        HStack(spacing: 0) {
            // Task list
            VStack(spacing: 0) {
                // Toolbar
                iPadToolbar {
                    Text("My Tasks")
                        .font(.headline)
                } trailing: {
                    HStack(spacing: 12) {
                        // Status filter menu
                        Menu {
                            Button("All Tasks") {
                                statusFilter.removeAll()
                            }

                            Divider()

                            ForEach(PlanNode.NodeStatus.allCases, id: \.self) { status in
                                Button {
                                    if statusFilter.contains(status) {
                                        statusFilter.remove(status)
                                    } else {
                                        statusFilter.insert(status)
                                    }
                                } label: {
                                    HStack {
                                        Text(status.displayName)
                                        if statusFilter.contains(status) {
                                            Image(systemName: "checkmark")
                                        }
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "line.3.horizontal.decrease.circle")
                                Text(filterLabel)
                            }
                            .font(.subheadline)
                        }

                        Text("\(filteredTasks.count)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                Divider()

                // Search bar
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)

                    TextField("Search tasks", text: $searchText)
                        .textFieldStyle(.plain)

                    if !searchText.isEmpty {
                        Button {
                            searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(AdaptiveColors.surface(colorScheme))
                .overlay(alignment: .bottom) {
                    Divider()
                }

                // Task list
                if filteredTasks.isEmpty {
                    ContentUnavailableView(
                        statusFilter.isEmpty ? "No Tasks" : "No Matching Tasks",
                        systemImage: "checklist",
                        description: Text(statusFilter.isEmpty ? "Tasks will appear here when created" : "Try adjusting your filters")
                    )
                    .frame(maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredTasks) { node in
                                TaskRowCard(
                                    node: node,
                                    projectName: projectName(for: node),
                                    isSelected: selectedNode?.id == node.id,
                                    onTap: {
                                        withAnimation(.easeInOut(duration: 0.2)) {
                                            selectedNode = node
                                        }
                                    }
                                )
                            }
                        }
                        .padding(16)
                    }
                    .background(AdaptiveColors.background(colorScheme))
                }
            }
            .frame(maxWidth: .infinity)

            // Detail panel (conditional)
            if let node = selectedNode {
                Divider()

                TaskDetailPaneliPad(
                    node: node,
                    projectName: projectName(for: node),
                    onClose: {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedNode = nil
                        }
                    }
                )
                .frame(width: iPadLayout.inspectorWidthWide)
                .transition(.move(edge: .trailing))
            }
        }
        .background(AdaptiveColors.background(colorScheme))
        .onAppear {
            if !initialStatusFilter.isEmpty {
                statusFilter = Set(initialStatusFilter)
            }
        }
    }

    private var filterLabel: String {
        if statusFilter.isEmpty {
            return "All"
        } else if statusFilter.count == 1 {
            return statusFilter.first?.displayName ?? "Filtered"
        } else {
            return "\(statusFilter.count) filters"
        }
    }

    private func projectName(for node: PlanNode) -> String? {
        // Find project that contains this node
        for (projectId, nodes) in planStore.nodesByProject {
            if nodes.contains(where: { $0.id == node.id }) {
                return projectStore.projects.first(where: { $0.id == projectId })?.name
            }
        }
        return nil
    }
}

// MARK: - Task Row Card

private struct TaskRowCard: View {
    let node: PlanNode
    let projectName: String?
    let isSelected: Bool
    let onTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 14) {
                // Status indicator
                AdaptiveStatusIndicator(status: node.status, size: 32)

                VStack(alignment: .leading, spacing: 8) {
                    Text(node.title)
                        .font(NexusTheme.Typography.bodyMedium)
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                        .lineLimit(2)

                    if !node.description.isEmpty {
                        Text(node.description)
                            .font(NexusTheme.Typography.caption1)
                            .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                            .lineLimit(2)
                    }

                    // Metadata row
                    HStack(spacing: 10) {
                        if let projectName = projectName {
                            HStack(spacing: 4) {
                                Image(systemName: "folder")
                                    .font(.system(size: 10))
                                Text(projectName)
                            }
                            .font(NexusTheme.Typography.caption2)
                            .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                        }

                        if let estimate = node.estimate {
                            HStack(spacing: 4) {
                                Image(systemName: "clock")
                                    .font(.system(size: 10))
                                Text(estimate.rawValue)
                            }
                            .font(NexusTheme.Typography.caption2.monospaced())
                            .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                        }

                        Spacer()

                        if let priority = node.priority {
                            NexusPriorityBadge(priority: priority)
                        }

                        Text(node.status.displayName)
                            .font(NexusTheme.Typography.caption2Medium)
                            .foregroundColor(statusColor)
                    }
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(isSelected ? Color.accentColor.opacity(0.08) : AdaptiveColors.surface(colorScheme))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(
                        isSelected ? Color.accentColor : AdaptiveColors.border(colorScheme),
                        lineWidth: isSelected ? 2 : 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private var statusColor: Color {
        switch node.status {
        case .planned:
            return AdaptiveColors.textTertiary(colorScheme)
        case .dispatched, .inProgress:
            return AdaptiveColors.statusInProgress
        case .autoVerified, .completed:
            return AdaptiveColors.statusCompleted
        case .awaitingJudgment:
            return AdaptiveColors.statusAwaiting
        case .pruned:
            return AdaptiveColors.statusPruned
        }
    }
}

// MARK: - Task Detail Panel

private struct TaskDetailPaneliPad: View {
    let node: PlanNode
    let projectName: String?
    let onClose: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        InspectorPanel(title: "Task Details", onClose: onClose) {
            VStack(alignment: .leading, spacing: 24) {
                // Status
                HStack {
                    AdaptiveStatusIndicator(status: node.status, size: 36)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(node.status.displayName)
                            .font(NexusTheme.Typography.bodyMedium)
                            .foregroundColor(statusColor)

                        if let projectName = projectName {
                            Text(projectName)
                                .font(NexusTheme.Typography.caption1)
                                .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                        }
                    }

                    Spacer()
                }

                // Title & description
                VStack(alignment: .leading, spacing: 10) {
                    Text(node.title)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                    if !node.description.isEmpty {
                        Text(node.description)
                            .font(NexusTheme.Typography.body)
                            .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                    }
                }

                Divider()

                // Metadata
                VStack(spacing: 12) {
                    if let priority = node.priority {
                        MetadataRow(label: "Priority", icon: "flag.fill") {
                            NexusPriorityBadge(priority: priority)
                        }
                    }

                    if let estimate = node.estimate {
                        MetadataRow(label: "Estimate", icon: "clock") {
                            Text(estimate.rawValue)
                                .font(NexusTheme.Typography.caption1Medium.monospaced())
                                .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                        }
                    }

                    if let dueDate = node.dueDate {
                        MetadataRow(label: "Due Date", icon: "calendar") {
                            Text(dueDate)
                                .font(NexusTheme.Typography.caption1Medium)
                                .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                        }
                    }

                    MetadataRow(label: "Created", icon: "clock.arrow.circlepath") {
                        Text(node.createdAt.relativeString)
                            .font(NexusTheme.Typography.caption1)
                            .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                    }

                    if let executionStartedAt = node.executionStartedAt {
                        MetadataRow(label: "Started", icon: "play.circle") {
                            Text(executionStartedAt.relativeString)
                                .font(NexusTheme.Typography.caption1)
                                .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                        }
                    }

                    if let executionCompletedAt = node.executionCompletedAt {
                        MetadataRow(label: "Completed", icon: "checkmark.circle") {
                            Text(executionCompletedAt.relativeString)
                                .font(NexusTheme.Typography.caption1)
                                .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                        }
                    }
                }

                // Execution output (if available)
                if let output = node.executionOutput, !output.isEmpty {
                    Divider()

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Output")
                            .font(NexusTheme.Typography.bodyMedium)
                            .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                        ScrollView {
                            Text(output)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 200)
                        .padding(12)
                        .background(AdaptiveColors.background(colorScheme))
                        .cornerRadius(8)
                    }
                }

                // Error (if available)
                if let error = node.executionError, !error.isEmpty {
                    Divider()

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(AdaptiveColors.danger)
                            Text("Error")
                                .font(NexusTheme.Typography.bodyMedium)
                                .foregroundColor(AdaptiveColors.danger)
                        }

                        Text(error)
                            .font(NexusTheme.Typography.caption1)
                            .foregroundColor(AdaptiveColors.danger)
                            .padding(12)
                            .background(AdaptiveColors.danger.opacity(0.1))
                            .cornerRadius(8)
                    }
                }

                Divider()

                // Actions
                VStack(spacing: 10) {
                    if let executionId = node.executionId {
                        NavigationLink {
                            TaskDetailView(nodeId: node.id, projectId: node.projectId ?? "")
                        } label: {
                            Label("View Execution", systemImage: "terminal.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    NavigationLink {
                        // Navigate to project plan
                        EmptyView()
                    } label: {
                        Label("View in Plan", systemImage: "git-branch")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private var statusColor: Color {
        switch node.status {
        case .planned:
            return AdaptiveColors.textTertiary(colorScheme)
        case .dispatched, .inProgress:
            return AdaptiveColors.statusInProgress
        case .autoVerified, .completed:
            return AdaptiveColors.statusCompleted
        case .awaitingJudgment:
            return AdaptiveColors.statusAwaiting
        case .pruned:
            return AdaptiveColors.statusPruned
        }
    }

    // MARK: - Supporting Views

    private struct MetadataRow<Content: View>: View {
        let label: String
        let icon: String
        let content: Content

        @Environment(\.colorScheme) private var colorScheme

        init(label: String, icon: String, @ViewBuilder content: () -> Content) {
            self.label = label
            self.icon = icon
            self.content = content()
        }

        var body: some View {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                    .frame(width: 20)

                Text(label)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                    .frame(width: 80, alignment: .leading)

                content

                Spacer()
            }
        }
    }
}


