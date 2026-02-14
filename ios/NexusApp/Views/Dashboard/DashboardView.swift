import SwiftUI

struct DashboardView: View {
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(UsageStore.self) private var usageStore

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                StatsGridView()

                DecisionCarousel()

                ActiveProjectsSection()

                NavigationLink {
                    EnvironmentsView()
                } label: {
                    SystemHealthView()
                }
                .buttonStyle(.plain)
            }
            .padding()
        }
        .navigationTitle("Dashboard")
        .refreshable {
            await usageStore.loadTodayUsage()
            await projectStore.refresh()
            await planStore.loadPlans(projectIds: projectStore.activeProjects.map(\.id))
        }
        .task {
            await usageStore.loadTodayUsage()
            // Load plans for all active projects to populate pending decisions
            await planStore.loadPlans(projectIds: projectStore.activeProjects.map(\.id))
        }
    }
}

// MARK: - Active Projects Section

private struct ActiveProjectsSection: View {
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore

    private var runningTasksCount: Int {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.type == .task && $0.status.isActive }
            .count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Active Projects")
                    .font(.headline)
                Spacer()

                if runningTasksCount > 0 {
                    NavigationLink(value: NavigationTarget.runningTasks) {
                        HStack(spacing: 4) {
                            Image(systemName: "play.circle.fill")
                                .foregroundStyle(.blue)
                            Text("\(runningTasksCount)")
                                .font(.subheadline.weight(.medium))
                        }
                        .foregroundStyle(.blue)
                    }
                } else {
                    Text("\(projectStore.activeProjects.count)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            if projectStore.activeProjects.isEmpty {
                ContentUnavailableView("No Active Projects", systemImage: "folder")
                    .frame(height: 120)
            } else {
                ForEach(projectStore.activeProjects) { project in
                    NavigationLink(value: NavigationTarget.project(project)) {
                        ActiveProjectRow(project: project)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .navigationDestination(for: NavigationTarget.self) { target in
            switch target {
            case .project(let project):
                ProjectDetailView(projectId: project.id)
            case .runningTasks:
                MyTasksView(initialStatusFilter: [.dispatched, .inProgress, .awaitingJudgment])
            }
        }
    }
}

// MARK: - Navigation Target

private enum NavigationTarget: Hashable {
    case project(Project)
    case runningTasks
}

private struct ActiveProjectRow: View {
    let project: Project

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(healthColor)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(project.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if let progress = project.progress {
                ProgressView(value: Double(progress), total: 100)
                    .frame(width: 60)
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    private var healthColor: Color {
        switch project.health {
        case .onTrack: return .green
        case .atRisk: return .yellow
        case .offTrack: return .red
        case nil: return .gray
        }
    }
}
