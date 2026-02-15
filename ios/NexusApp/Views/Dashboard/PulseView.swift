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
        .background(
            LinearGradient(
                colors: [
                    Color.black.opacity(0.85),
                    Color(hex: "0A0E1A").opacity(0.9)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
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
                        .fill(Color.nexusAmber)
                        .frame(width: 8, height: 8)

                    Text("Awaiting Judgment")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.nexusAmber)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color.nexusAmber.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.nexusAmber.opacity(0.3), lineWidth: 1)
                )
                .glow(color: .nexusAmber, radius: 4)

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
                        .foregroundStyle(Color.nexusBlue)

                    Text("AI Recommendation")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.nexusBlue)
                }

                Text(node.executionOutput ?? "Review the execution results and approve or reject this change.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .lineSpacing(6)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .glassCard(cornerRadius: 12, material: .regularMaterial, shadowRadius: 8, shadowY: 4)

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
                    .background(Color.nexusGreen)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(color: Color.nexusGreen.opacity(0.3), radius: 12, x: 0, y: 4)
                    .glow(color: .nexusGreen, radius: 6)
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
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.thinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(.glassStroke, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .shadow(color: .glassShadow, radius: 8, x: 0, y: 2)
                }

                // Defer
                Button {
                    // TODO: Implement defer action
                } label: {
                    Text("Defer")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.thinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(.glassStroke, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .shadow(color: .glassShadow, radius: 8, x: 0, y: 2)
                }
            }
        }
        .padding(20)
        .glassCard(cornerRadius: 20, material: .ultraThinMaterial, shadowRadius: 24, shadowY: 8)
    }
}
