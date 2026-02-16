import SwiftUI

// MARK: - Enhanced Dashboard View
// Matches ios.pen design aesthetic with deep dark theme and sophisticated layout

struct DashboardViewEnhanced: View {
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(UsageStore.self) private var usageStore
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            AdaptiveColors.background(colorScheme).ignoresSafeArea()

            ScrollView {
                VStack(spacing: NexusTheme.Spacing.xl) {
                    // Stats Grid
                    EnhancedStatsGrid()

                    // Pending Approvals & Decisions
                    EnhancedDecisionSection()

                    // Active Projects
                    EnhancedActiveProjects()

                    // System Health (if needed)
                    NavigationLink {
                        EnvironmentsView()
                    } label: {
                        SystemHealthCardEnhanced()
                    }
                    .buttonStyle(.plain)
                }
                .padding(NexusTheme.Spacing.lg)
                .padding(.bottom, NexusTheme.Spacing.xxxl)
            }
            .scrollFadeOverlay()
            .refreshable {
                await usageStore.loadTodayUsage()
                await projectStore.refresh()
                await planStore.loadPlans(projectIds: projectStore.activeProjects.map(\.id))
            }
        }
        .navigationBarTitleDisplayMode(.large)
        .navigationTitle("Dashboard")
        .task {
            await usageStore.loadTodayUsage()
            await planStore.loadPlans(projectIds: projectStore.activeProjects.map(\.id))
        }
    }
}

// MARK: - Enhanced Stats Grid

private struct EnhancedStatsGrid: View {
    @Environment(UsageStore.self) private var usageStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore

    private var runningTasksCount: Int {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.type == .task && $0.status.isActive }
            .count
    }

    private var completedTasksCount: Int {
        let allNodes = planStore.nodesByProject.values.flatMap { $0 }
        let tasks = allNodes.filter { $0.type == .task }
        let completed = tasks.filter { $0.status.isDone }
        return completed.count
    }

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: NexusTheme.Spacing.lg) {
            HStack(spacing: NexusTheme.Spacing.md) {
                AdaptiveStatsCard(
                    title: "Active Projects",
                    value: "\(projectStore.activeProjects.count)",
                    icon: "folder.fill",
                    color: AdaptiveColors.primary
                )

                AdaptiveStatsCard(
                    title: "Running Tasks",
                    value: "\(runningTasksCount)",
                    icon: "play.circle.fill",
                    color: AdaptiveColors.statusInProgress
                )
            }

            HStack(spacing: NexusTheme.Spacing.md) {
                AdaptiveStatsCard(
                    title: "Completed",
                    value: "\(completedTasksCount)",
                    icon: "checkmark.circle.fill",
                    color: AdaptiveColors.statusCompleted
                )

                AdaptiveStatsCard(
                    title: "Usage Today",
                    value: usageStore.formattedCost,
                    icon: "dollarsign.circle.fill",
                    color: AdaptiveColors.warning
                )
            }
        }
    }
}

// MARK: - Enhanced Decision Section

private struct EnhancedDecisionSection: View {
    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(RealtimeStore.self) private var realtimeStore

    private var decisions: [PlanNode] {
        planStore.pendingDecisions()
    }

    private var pendingApprovals: [ActivityEvent] {
        realtimeStore.pendingApprovals
    }

    var body: some View {
        VStack(spacing: NexusTheme.Spacing.xl) {
            // Pending Approvals
            if !pendingApprovals.isEmpty {
                VStack(alignment: .leading, spacing: NexusTheme.Spacing.lg) {
                    NexusSectionHeader(
                        title: "Approval Required",
                        count: pendingApprovals.count
                    )

                    ForEach(pendingApprovals, id: \.id) { approval in
                        EnhancedApprovalCard(approval: approval) { approved, selectedOption in
                            try await realtimeStore.respondToApproval(
                                approval.approvalId!,
                                approved: approved,
                                selectedOption: selectedOption
                            )
                        }
                    }
                }
            }

            // Pending Decisions
            if !decisions.isEmpty {
                VStack(alignment: .leading, spacing: NexusTheme.Spacing.lg) {
                    NexusSectionHeader(
                        title: "Pending Decisions",
                        count: decisions.count
                    )

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: NexusTheme.Spacing.md) {
                            ForEach(decisions) { decision in
                                NavigationLink(
                                    destination: TaskDetailView(nodeId: decision.id, projectId: decision.projectId)
                                ) {
                                    NexusDecisionCard(
                                        decision: decision,
                                        projectName: projectStore.project(id: decision.projectId)?.name ?? "",
                                        aiRecommendation: "Use OAuth2 flow for better security and user experience. This pattern is widely adopted and well-documented."
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 2) // Prevent shadow clipping
                    }
                    .padding(.horizontal, -2)
                }
            }
        }
    }
}

// MARK: - Enhanced Approval Card

private struct EnhancedApprovalCard: View {
    let approval: ActivityEvent
    let onRespond: (Bool, String?) async throws -> Void

    @State private var isResponding = false

    var body: some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.lg) {
            // Header
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(NexusTheme.Typography.footnote)
                    .foregroundColor(NexusTheme.Colors.statusAwaiting)

                Text("Agent Request")
                    .font(NexusTheme.Typography.caption2Medium)
                    .foregroundColor(NexusTheme.Colors.statusAwaiting)

                Spacer()
            }

            // Message
            Text(approval.approvalMessage ?? "Approval required")
                .font(NexusTheme.Typography.body)
                .foregroundColor(NexusTheme.Colors.textPrimary)
                .lineLimit(4)

            // Options or Actions
            if let options = approval.approvalOptions, !options.isEmpty {
                VStack(spacing: NexusTheme.Spacing.sm) {
                    ForEach(options, id: \.self) { option in
                        Button {
                            Task {
                                isResponding = true
                                try? await onRespond(true, option)
                                isResponding = false
                            }
                        } label: {
                            Text(option)
                                .font(NexusTheme.Typography.footnoteMedium)
                                .foregroundColor(NexusTheme.Colors.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, NexusTheme.Spacing.md)
                                .background(NexusTheme.Colors.surfaceElevated)
                                .cornerRadius(NexusTheme.CornerRadius.md)
                        }
                        .disabled(isResponding)
                    }
                }
            } else {
                HStack(spacing: NexusTheme.Spacing.md) {
                    Button {
                        Task {
                            isResponding = true
                            try? await onRespond(false, nil)
                            isResponding = false
                        }
                    } label: {
                        Text("Deny")
                    }
                    .buttonStyle(NexusSecondaryButtonStyle())
                    .disabled(isResponding)

                    Button {
                        Task {
                            isResponding = true
                            try? await onRespond(true, nil)
                            isResponding = false
                        }
                    } label: {
                        Text("Approve")
                    }
                    .buttonStyle(NexusPrimaryButtonStyle())
                    .disabled(isResponding)
                }
            }
        }
        .padding(NexusTheme.Spacing.xl)
        .background(NexusTheme.Colors.surface)
        .cornerRadius(NexusTheme.CornerRadius.lg)
        .shadow(
            color: NexusTheme.Shadow.cardElevated.color,
            radius: NexusTheme.Shadow.cardElevated.radius,
            x: NexusTheme.Shadow.cardElevated.x,
            y: NexusTheme.Shadow.cardElevated.y
        )
    }
}

// MARK: - Enhanced Active Projects

private struct EnhancedActiveProjects: View {
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore

    var body: some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.lg) {
            NexusSectionHeader(
                title: "Active Projects",
                count: projectStore.activeProjects.count
            ) {
                // Navigate to all projects
            }

            if projectStore.activeProjects.isEmpty {
                ContentUnavailableView(
                    "No Active Projects",
                    systemImage: "folder",
                    description: Text("Create your first project to get started")
                )
                .frame(height: 200)
            } else {
                ForEach(projectStore.activeProjects) { project in
                    NavigationLink(destination: ProjectDetailView(projectId: project.id)) {
                        NexusProjectCard(
                            project: project,
                            isGenerating: planStore.isGenerating(projectId: project.id)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: - Enhanced System Health Card

private struct SystemHealthCardEnhanced: View {
    @Environment(RealtimeStore.self) private var realtimeStore

    private var connectedMachines: Int {
        realtimeStore.connectedMachines.count
    }

    var body: some View {
        HStack(spacing: NexusTheme.Spacing.lg) {
            Image(systemName: "server.rack")
                .font(.system(size: 32))
                .foregroundColor(connectedMachines > 0 ? NexusTheme.Colors.success : NexusTheme.Colors.textTertiary)

            VStack(alignment: .leading, spacing: NexusTheme.Spacing.xs) {
                Text("System Health")
                    .font(NexusTheme.Typography.bodyMedium)
                    .foregroundColor(NexusTheme.Colors.textPrimary)

                Text("\(connectedMachines) machines connected")
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(NexusTheme.Colors.textSecondary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(NexusTheme.Typography.footnote)
                .foregroundColor(NexusTheme.Colors.textTertiary)
        }
        .padding(NexusTheme.Spacing.lg)
        .background(NexusTheme.Colors.surface)
        .cornerRadius(NexusTheme.CornerRadius.md)
        .shadow(
            color: NexusTheme.Shadow.card.color,
            radius: NexusTheme.Shadow.card.radius,
            x: NexusTheme.Shadow.card.x,
            y: NexusTheme.Shadow.card.y
        )
    }
}
