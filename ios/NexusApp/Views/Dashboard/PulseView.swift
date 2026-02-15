import SwiftUI

/// Pulse screen - Focuses on pending decisions that need human judgment
struct PulseView: View {
    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore

    private var pendingDecisions: [PlanNode] {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.status == .awaitingJudgment }
            .sorted { ($0.executionCompletedAt ?? Date.distantPast) > ($1.executionCompletedAt ?? Date.distantPast) }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Pulse")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(.primary)

                    Text("\(pendingDecisions.count) decisions pending")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 12)

            // Decision cards
            ScrollView {
                LazyVStack(spacing: 20) {
                    ForEach(pendingDecisions) { node in
                        DecisionCard(node: node)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 100) // Extra padding for tab bar
            }
        }
        .background(Color(hex: "0A0E1A"))
        .task {
            await planStore.loadPlans(projectIds: projectStore.projects.map(\.id))
        }
    }
}

// MARK: - Decision Card

private struct DecisionCard: View {
    let node: PlanNode
    @Environment(PlanStore.self) private var planStore

    private var timeAgo: String {
        guard let completedAt = node.executionCompletedAt else { return "now" }
        let interval = Date().timeIntervalSince(completedAt)
        let minutes = Int(interval / 60)
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        return "\(days)d ago"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header: badge + time
            HStack {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color(hex: "F59E0B"))
                        .frame(width: 8, height: 8)

                    Text("Awaiting Judgment")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color(hex: "F59E0B"))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color(hex: "F59E0B").opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))

                Spacer()

                Text(timeAgo)
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: "475569"))
            }

            // Title
            Text(node.title)
                .font(.custom("Fraunces", size: 18).weight(.semibold))
                .tracking(-0.2)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            // AI Recommendation box
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 14))
                        .foregroundStyle(Color(hex: "3B82F6"))

                    Text("AI Recommendation")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color(hex: "3B82F6"))
                }

                Text(node.executionOutput ?? "Review the execution results and approve or reject this change.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: "64748B"))
                    .lineSpacing(6)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .background(Color(hex: "1E293B"))
            .clipShape(RoundedRectangle(cornerRadius: 12))

            // Actions
            HStack(spacing: 10) {
                // Approve
                Button {
                    planStore.updateNodeStatus(
                        id: node.id,
                        projectId: node.projectId ?? "",
                        status: .completed
                    )
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 16))
                        Text("Approve")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color(hex: "16A34A"))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                // Reject
                Button {
                    planStore.updateNodeStatus(
                        id: node.id,
                        projectId: node.projectId ?? "",
                        status: .pruned
                    )
                } label: {
                    Text("Reject")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color(hex: "64748B"))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color(hex: "1E293B"))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(Color(hex: "1E293B").opacity(0.25), lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                // Defer
                Button {
                    // TODO: Implement defer action
                } label: {
                    Text("Defer")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color(hex: "64748B"))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color(hex: "1E293B"))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(Color(hex: "1E293B").opacity(0.25), lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(20)
        .background(Color(hex: "111827"))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .shadow(color: .black.opacity(0.25), radius: 16, x: 0, y: 4)
    }
}

// MARK: - Color Extension

private extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
