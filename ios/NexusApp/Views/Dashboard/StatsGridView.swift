import SwiftUI

struct StatsGridView: View {
    @Environment(UsageStore.self) private var usageStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(RealtimeStore.self) private var realtimeStore

    var body: some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible()),
        ], spacing: 12) {
            StatCard(
                title: "Tasks Today",
                value: "\(usageStore.todayUsage.tasksCompleted)",
                subtitle: "\(usageStore.todayUsage.tasksFailed) failed",
                icon: "checkmark.circle",
                color: .green
            )

            StatCard(
                title: "Active Projects",
                value: "\(projectStore.activeProjects.count)",
                icon: "folder.fill",
                color: .blue
            )

            StatCard(
                title: "Pending Decisions",
                value: "\(planStore.pendingDecisions().count)",
                icon: "exclamationmark.triangle",
                color: .orange
            )

            StatCard(
                title: "Usage",
                value: usageStore.formattedCost,
                subtitle: "\(formatTokens(usageStore.totalTokens)) tokens",
                icon: "dollarsign.circle",
                color: .purple
            )
        }
    }

    private func formatTokens(_ count: Int) -> String {
        if count >= 1_000_000 {
            return String(format: "%.1fM", Double(count) / 1_000_000)
        } else if count >= 1_000 {
            return String(format: "%.1fK", Double(count) / 1_000)
        }
        return "\(count)"
    }
}

struct StatCard: View {
    let title: String
    let value: String
    var subtitle: String? = nil
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(color)
                Spacer()
            }

            Text(value)
                .font(.title2.bold().monospacedDigit())

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else {
                    Text(" ")
                        .font(.caption2)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding()
        .glassCard(cornerRadius: 12, material: .regularMaterial, shadowRadius: 16, shadowY: 6)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .fill(color.opacity(0.03))
        )
    }
}
