import SwiftUI

/// iPad-optimized dashboard view with multi-column stats grid and expanded content areas
struct DashboardViewiPad: View {
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(UsageStore.self) private var usageStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var colorScheme

    private var sizeClass: DeviceSizeClass {
        DeviceSizeClass.current(horizontalSizeClass)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Stats grid - 2 or 3 columns based on size class
                StatsGridViewiPad()

                // Pending decisions
                if !pendingDecisions.isEmpty {
                    DecisionCarouselExpanded(decisions: pendingDecisions)
                }

                // Active projects - grid layout for iPad
                ActiveProjectsGridSection()

                // System health
                NavigationLink {
                    EnvironmentsView()
                } label: {
                    SystemHealthViewExpanded()
                }
                .buttonStyle(.plain)
            }
            .adaptivePadding(sizeClass)
        }
        .background(AdaptiveColors.background(colorScheme))
        .refreshable {
            await refreshData()
        }
        .task {
            await refreshData()
        }
    }

    private var pendingDecisions: [PlanNode] {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.status == .awaitingJudgment }
    }

    private func refreshData() async {
        await usageStore.loadTodayUsage()
        await projectStore.refresh()
        await planStore.loadPlans(projectIds: projectStore.activeProjects.map(\.id))
    }
}

// MARK: - iPad Stats Grid

private struct StatsGridViewiPad: View {
    @Environment(UsageStore.self) private var usageStore
    @Environment(PlanStore.self) private var planStore
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var colorScheme

    private var sizeClass: DeviceSizeClass {
        DeviceSizeClass.current(horizontalSizeClass)
    }

    private var runningTasksCount: Int {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.type == .task && $0.status.isActive }
            .count
    }

    private var completedTodayCount: Int {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { node in
                guard let completedAt = node.executionCompletedAt else { return false }
                return Calendar.current.isDateInToday(completedAt)
            }
            .count
    }

    var body: some View {
        LazyVGrid(
            columns: iPadLayout.adaptiveGridColumns(sizeClass, columnCount: sizeClass == .iPadRegular ? 3 : 2),
            spacing: 16
        ) {
            // Active tasks
            StatCard(
                title: "Running Tasks",
                value: "\(runningTasksCount)",
                icon: "play.circle.fill",
                color: AdaptiveColors.statusInProgress
            )

            // Completed today
            StatCard(
                title: "Completed Today",
                value: "\(completedTodayCount)",
                icon: "checkmark.circle.fill",
                color: AdaptiveColors.statusCompleted
            )

            // Cost today
            StatCard(
                title: "Cost Today",
                value: usageStore.formattedCost,
                icon: "dollarsign.circle.fill",
                color: AdaptiveColors.warning
            )

            // Connected machines (iPad regular only)
            if sizeClass == .iPadRegular {
                StatCard(
                    title: "Machines",
                    value: "\(realtimeStore.connectedMachines.count)",
                    icon: "server.rack",
                    color: AdaptiveColors.primary
                )
            }

            // Tokens used (iPad regular only)
            if sizeClass == .iPadRegular {
                StatCard(
                    title: "Tokens Used",
                    value: usageStore.formattedTokens,
                    icon: "chart.bar.fill",
                    color: .purple
                )
            }

            // Tasks completed (iPad regular only)
            if sizeClass == .iPadRegular {
                StatCard(
                    title: "Tasks Completed",
                    value: "\(usageStore.todayUsage.tasksCompleted)",
                    icon: "checkmark.circle.fill",
                    color: .orange
                )
            }
        }
    }

    private struct StatCard: View {
        let title: String
        let value: String
        let icon: String
        let color: Color

        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            VStack(alignment: .leading, spacing: NexusTheme.Spacing.md) {
                HStack {
                    Image(systemName: icon)
                        .font(.system(size: 28))
                        .foregroundColor(color)

                    Spacer()
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(value)
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                    Text(title)
                        .font(NexusTheme.Typography.caption1)
                        .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(AdaptiveColors.surface(colorScheme))
            .cornerRadius(NexusTheme.CornerRadius.md)
            .shadow(
                color: colorScheme == .dark ? Color.black.opacity(0.3) : Color.black.opacity(0.05),
                radius: 8,
                x: 0,
                y: 2
            )
        }
    }
}

// MARK: - Decision Carousel Expanded

private struct DecisionCarouselExpanded: View {
    let decisions: [PlanNode]

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "questionmark.circle.fill")
                    .font(.title3)
                    .foregroundColor(AdaptiveColors.statusAwaiting)

                Text("Pending Decisions")
                    .font(.headline)

                Spacer()

                Text("\(decisions.count)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(decisions.prefix(10)) { node in
                        NavigationLink(value: node) {
                            DecisionCardCompact(node: node)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(20)
        .background(AdaptiveColors.surface(colorScheme))
        .cornerRadius(NexusTheme.CornerRadius.md)
        .shadow(
            color: colorScheme == .dark ? Color.black.opacity(0.3) : Color.black.opacity(0.05),
            radius: 8,
            x: 0,
            y: 2
        )
    }

    private struct DecisionCardCompact: View {
        let node: PlanNode

        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "questionmark.diamond.fill")
                        .foregroundColor(AdaptiveColors.statusAwaiting)
                    Spacer()
                }

                Text(node.title)
                    .font(NexusTheme.Typography.bodyMedium)
                    .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                    .lineLimit(2)

                Text(node.description)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                    .lineLimit(3)

                Spacer()

                HStack {
                    Text("Awaiting Decision")
                        .font(NexusTheme.Typography.caption2Medium)
                        .foregroundColor(AdaptiveColors.statusAwaiting)

                    Spacer()
                }
            }
            .frame(width: 280, height: 160)
            .padding(16)
            .background(AdaptiveColors.statusAwaiting.opacity(0.08))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(AdaptiveColors.statusAwaiting.opacity(0.2), lineWidth: 1)
            )
        }
    }
}

// MARK: - Active Projects Grid Section

private struct ActiveProjectsGridSection: View {
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var colorScheme

    private var sizeClass: DeviceSizeClass {
        DeviceSizeClass.current(horizontalSizeClass)
    }

    private var runningTasksCount: Int {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.type == .task && $0.status.isActive }
            .count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Active Projects")
                    .font(.headline)

                Spacer()

                if runningTasksCount > 0 {
                    NavigationLink(value: NavigationTarget.runningTasks) {
                        HStack(spacing: 4) {
                            Image(systemName: "play.circle.fill")
                                .foregroundStyle(.blue)
                            Text("\(runningTasksCount) running")
                                .font(.subheadline.weight(.medium))
                        }
                        .foregroundStyle(.blue)
                    }
                } else {
                    Text("\(projectStore.activeProjects.count) projects")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            if projectStore.activeProjects.isEmpty {
                ContentUnavailableView(
                    "No Active Projects",
                    systemImage: "folder",
                    description: Text("Create a project to get started")
                )
                .frame(height: 200)
            } else {
                LazyVGrid(
                    columns: iPadLayout.adaptiveGridColumns(sizeClass, columnCount: 2),
                    spacing: 16
                ) {
                    ForEach(projectStore.activeProjects) { project in
                        NavigationLink(value: NavigationTarget.project(project)) {
                            ProjectGridCard(project: project)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(20)
        .background(AdaptiveColors.surface(colorScheme))
        .cornerRadius(NexusTheme.CornerRadius.md)
        .shadow(
            color: colorScheme == .dark ? Color.black.opacity(0.3) : Color.black.opacity(0.05),
            radius: 8,
            x: 0,
            y: 2
        )
        .navigationDestination(for: NavigationTarget.self) { target in
            switch target {
            case .project(let project):
                ProjectDetailView(projectId: project.id)
            case .runningTasks:
                MyTasksView(initialStatusFilter: [.dispatched, .inProgress, .awaitingJudgment])
            }
        }
    }

    private struct ProjectGridCard: View {
        let project: Project

        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    // Icon
                    Text(project.icon)
                        .font(.system(size: 32))
                        .frame(width: 56, height: 56)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(colorFromHex( project.color).opacity(0.15))
                        )

                    Spacer()

                    if let health = project.health {
                        NexusHealthIndicator(health: health)
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(project.name)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                        .lineLimit(1)

                    Text(project.description)
                        .font(NexusTheme.Typography.caption1)
                        .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                        .lineLimit(2)
                }

                Spacer()

                // Progress bar
                if let progress = project.progress {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("\(progress)% Complete")
                                .font(NexusTheme.Typography.caption2)
                                .foregroundColor(AdaptiveColors.textTertiary(colorScheme))

                            Spacer()

                            Text(project.updatedAt.relativeString)
                                .font(NexusTheme.Typography.caption2)
                                .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                        }

                        ProgressView(value: Double(progress), total: 100)
                            .tint(AdaptiveColors.primary)
                    }
                }
            }
            .frame(height: 180)
            .padding(16)
            .background(AdaptiveColors.background(colorScheme))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(AdaptiveColors.border(colorScheme), lineWidth: 1)
            )
        }
    }
}

// MARK: - System Health Expanded

private struct SystemHealthViewExpanded: View {
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "server.rack")
                    .font(.title3)
                    .foregroundColor(.blue)

                Text("System Health")
                    .font(.headline)

                Spacer()

                HStack(spacing: 6) {
                    Circle()
                        .fill(healthColor)
                        .frame(width: 8, height: 8)
                    Text(healthStatus)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 24) {
                // Connected machines
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(realtimeStore.connectedMachines.count)")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                    Text("Connected Machines")
                        .font(NexusTheme.Typography.caption1)
                        .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                }

                Spacer()

                // Provider status
                VStack(alignment: .trailing, spacing: 8) {
                    ForEach(uniqueProviders, id: \.self) { provider in
                        HStack(spacing: 6) {
                            Circle()
                                .fill(.green)
                                .frame(width: 6, height: 6)
                            Text(provider)
                                .font(NexusTheme.Typography.caption2)
                                .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                        }
                    }
                }
            }
        }
        .padding(20)
        .background(AdaptiveColors.surface(colorScheme))
        .cornerRadius(NexusTheme.CornerRadius.md)
        .shadow(
            color: colorScheme == .dark ? Color.black.opacity(0.3) : Color.black.opacity(0.05),
            radius: 8,
            x: 0,
            y: 2
        )
    }

    private var healthColor: Color {
        if realtimeStore.connectedMachines.isEmpty {
            return .gray
        } else {
            return .green
        }
    }

    private var healthStatus: String {
        if realtimeStore.connectedMachines.isEmpty {
            return "No Machines"
        } else {
            return "Operational"
        }
    }

    private var uniqueProviders: [String] {
        let providers = realtimeStore.connectedMachines
            .flatMap { $0.providers ?? [] }
            .filter { $0.status == "available" }
            .map { $0.type }

        return Array(Set(providers)).sorted()
    }
}

// MARK: - Navigation Target

private enum NavigationTarget: Hashable {
    case project(Project)
    case runningTasks
}
