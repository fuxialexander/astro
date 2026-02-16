import SwiftUI

/// iPad-optimized project list view with grid layout and detail panel
struct ProjectListViewiPad: View {
    @Environment(ProjectStore.self) private var projectStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var colorScheme

    @State private var selectedProject: Project?
    @State private var showNewProject = false

    private var sizeClass: DeviceSizeClass {
        DeviceSizeClass.current(horizontalSizeClass)
    }

    var body: some View {
        HStack(spacing: 0) {
            // Main content - project grid
            VStack(spacing: 0) {
                // Toolbar
                iPadToolbar {
                    Text("Projects")
                        .font(.headline)
                } trailing: {
                    HStack(spacing: 12) {
                        Text("\(projectStore.projects.count)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Button {
                            showNewProject = true
                        } label: {
                            Label("New Project", systemImage: "plus.circle.fill")
                                .font(.subheadline.weight(.medium))
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }

                Divider()

                // Project grid
                if projectStore.projects.isEmpty {
                    ContentUnavailableView(
                        "No Projects",
                        systemImage: "folder",
                        description: Text("Create a project to get started")
                    )
                    .frame(maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVGrid(
                            columns: iPadLayout.adaptiveGridColumns(sizeClass, columnCount: 2),
                            spacing: 16
                        ) {
                            ForEach(projectStore.projects) { project in
                                ProjectGridCard(
                                    project: project,
                                    isSelected: selectedProject?.id == project.id,
                                    onTap: {
                                        withAnimation(.easeInOut(duration: 0.2)) {
                                            selectedProject = project
                                        }
                                    }
                                )
                            }
                        }
                        .adaptivePadding(sizeClass)
                    }
                    .background(AdaptiveColors.background(colorScheme))
                }
            }
            .frame(maxWidth: .infinity)

            // Detail panel (conditional)
            if let project = selectedProject {
                Divider()

                ProjectDetailPanel(
                    project: project,
                    onClose: {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedProject = nil
                        }
                    }
                )
                .frame(width: iPadLayout.inspectorWidthWide)
                .transition(.move(edge: .trailing))
            }
        }
        .background(AdaptiveColors.background(colorScheme))
        .sheet(isPresented: $showNewProject) {
            NavigationStack {
                NewProjectView()
            }
        }
    }
}

// MARK: - Project Grid Card

private struct ProjectGridCard: View {
    let project: Project
    let isSelected: Bool
    let onTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    // Icon
                    Text(project.icon)
                        .font(.system(size: 36))
                        .frame(width: 64, height: 64)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(colorFromHex( project.color).opacity(0.15))
                        )

                    Spacer()

                    // Health indicator
                    if let health = project.health {
                        NexusHealthIndicator(health: health)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(project.name)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                        .lineLimit(1)

                    Text(project.description)
                        .font(NexusTheme.Typography.caption1)
                        .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                        .lineLimit(3)
                        .frame(height: 48, alignment: .top)
                }

                // Progress bar
                if let progress = project.progress {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("\(progress)% Complete")
                                .font(NexusTheme.Typography.caption2Medium)
                                .foregroundColor(AdaptiveColors.textTertiary(colorScheme))

                            Spacer()

                            Text(project.updatedAt.relativeString)
                                .font(NexusTheme.Typography.caption2)
                                .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                        }

                        ProgressView(value: Double(progress), total: 100)
                            .tint(colorFromHex( project.color))
                            .frame(height: 6)
                    }
                } else {
                    // Status instead of progress
                    HStack {
                        Text(project.status.rawValue.capitalized)
                            .font(NexusTheme.Typography.caption2Medium)
                            .foregroundColor(statusColor)

                        Spacer()

                        Text(project.updatedAt.relativeString)
                            .font(NexusTheme.Typography.caption2)
                            .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                    }
                }
            }
            .frame(height: 220)
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(isSelected ? Color.accentColor.opacity(0.08) : AdaptiveColors.surface(colorScheme))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(
                        isSelected ? Color.accentColor : AdaptiveColors.border(colorScheme),
                        lineWidth: isSelected ? 2 : 1
                    )
            )
            .shadow(
                color: colorScheme == .dark ? Color.black.opacity(0.3) : Color.black.opacity(0.05),
                radius: isSelected ? 12 : 6,
                x: 0,
                y: isSelected ? 4 : 2
            )
        }
        .buttonStyle(.plain)
    }

    private var statusColor: Color {
        switch project.status {
        case .active:
            return AdaptiveColors.statusInProgress
        case .archived:
            return AdaptiveColors.textTertiary(colorScheme)
        }
    }
}

// MARK: - Project Detail Panel

private struct ProjectDetailPanel: View {
    let project: Project
    let onClose: () -> Void

    @Environment(PlanStore.self) private var planStore
    @Environment(\.colorScheme) private var colorScheme

    @State private var nodes: [PlanNode] = []

    var body: some View {
        InspectorPanel(title: "Project Details", onClose: onClose) {
            VStack(alignment: .leading, spacing: 24) {
                // Header
                HStack {
                    Text(project.icon)
                        .font(.system(size: 48))
                        .frame(width: 72, height: 72)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(colorFromHex( project.color).opacity(0.15))
                        )

                    Spacer()
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(project.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                    Text(project.description)
                        .font(NexusTheme.Typography.body)
                        .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                }

                Divider()

                // Stats
                VStack(spacing: 14) {
                    StatRow(
                        label: "Status",
                        value: project.status.rawValue.capitalized,
                        color: statusColor
                    )

                    if let progress = project.progress {
                        StatRow(
                            label: "Progress",
                            value: "\(progress)%"
                        )

                        ProgressView(value: Double(progress), total: 100)
                            .tint(colorFromHex( project.color))
                    }

                    if let health = project.health {
                        HStack {
                            Text("Health")
                                .font(NexusTheme.Typography.caption1)
                                .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                                .frame(width: 80, alignment: .leading)

                            NexusHealthIndicator(health: health)

                            Spacer()
                        }
                    }

                    StatRow(
                        label: "Created",
                        value: project.createdAt.formatted(date: .abbreviated, time: .omitted)
                    )

                    StatRow(
                        label: "Updated",
                        value: project.updatedAt.relativeString
                    )
                }

                Divider()

                // Plan summary
                VStack(alignment: .leading, spacing: 12) {
                    Text("Plan Summary")
                        .font(NexusTheme.Typography.bodyMedium)
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                    if nodes.isEmpty {
                        Text("No tasks yet")
                            .font(NexusTheme.Typography.caption1)
                            .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                            .padding(.vertical, 8)
                    } else {
                        VStack(spacing: 8) {
                            PlanStatRow(
                                label: "Total Tasks",
                                value: "\(nodes.count)",
                                icon: "list.bullet"
                            )

                            PlanStatRow(
                                label: "In Progress",
                                value: "\(nodes.filter { $0.status.isActive }.count)",
                                icon: "play.circle.fill",
                                color: AdaptiveColors.statusInProgress
                            )

                            PlanStatRow(
                                label: "Completed",
                                value: "\(nodes.filter { $0.status == .completed || $0.status == .autoVerified }.count)",
                                icon: "checkmark.circle.fill",
                                color: AdaptiveColors.statusCompleted
                            )

                            PlanStatRow(
                                label: "Pending",
                                value: "\(nodes.filter { $0.status == .planned }.count)",
                                icon: "circle.dashed",
                                color: AdaptiveColors.textTertiary(colorScheme)
                            )
                        }
                    }
                }

                Divider()

                // Actions
                VStack(spacing: 10) {
                    NavigationLink {
                        ProjectDetailView(projectId: project.id)
                    } label: {
                        Label("View Project", systemImage: "arrow.right.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    NavigationLink {
                        ProjectDetailView(projectId: project.id)
                            .navigationDestination(for: String.self) { _ in
                                // Plan view will be shown via tab selection
                                EmptyView()
                            }
                    } label: {
                        Label("View Plan", systemImage: "git-branch")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .task {
            await loadNodes()
        }
        .onChange(of: project.id) { _, _ in
            Task {
                await loadNodes()
            }
        }
    }

    private var statusColor: Color {
        switch project.status {
        case .active:
            return AdaptiveColors.statusInProgress
        case .archived:
            return AdaptiveColors.textTertiary(colorScheme)
        }
    }

    private func loadNodes() async {
        await planStore.loadPlan(projectId: project.id)
        nodes = planStore.nodesByProject[project.id] ?? []
    }

    // MARK: - Supporting Views

    private struct StatRow: View {
        let label: String
        let value: String
        var color: Color?

        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            HStack {
                Text(label)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                    .frame(width: 80, alignment: .leading)

                Text(value)
                    .font(NexusTheme.Typography.bodyMedium)
                    .foregroundColor(color ?? AdaptiveColors.textPrimary(colorScheme))

                Spacer()
            }
        }
    }

    private struct PlanStatRow: View {
        let label: String
        let value: String
        let icon: String
        var color: Color?

        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundColor(color ?? AdaptiveColors.textSecondary(colorScheme))
                    .frame(width: 20)

                Text(label)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(AdaptiveColors.textSecondary(colorScheme))

                Spacer()

                Text(value)
                    .font(NexusTheme.Typography.caption1Medium)
                    .foregroundColor(color ?? AdaptiveColors.textPrimary(colorScheme))
            }
            .padding(.vertical, 4)
        }
    }
}
