import SwiftUI

struct DecisionCarousel: View {
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
        VStack(spacing: 16) {
            // Pending Approvals Section
            if !pendingApprovals.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text("Approval Required")
                            .font(.headline)
                        Spacer()
                        Text("\(pendingApprovals.count)")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(.orange.opacity(0.2), in: Capsule())
                    }

                    ForEach(pendingApprovals, id: \.id) { approval in
                        ApprovalCard(approval: approval) { approved, selectedOption in
                            try await realtimeStore.respondToApproval(
                                approval.approvalId!,
                                approved: approved,
                                selectedOption: selectedOption
                            )
                        }
                    }
                }
                .padding()
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }

            // Pending Decisions Section
            if !decisions.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Image(systemName: "questionmark.diamond.fill")
                            .foregroundStyle(.orange)
                        Text("Pending Decisions")
                            .font(.headline)
                        Spacer()
                        Text("\(decisions.count)")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(.orange.opacity(0.2), in: Capsule())
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(decisions) { decision in
                                NavigationLink(value: DecisionDestination(nodeId: decision.id, projectId: decision.projectId)) {
                                    DecisionCard(
                                        decision: decision,
                                        projectName: projectStore.project(id: decision.projectId)?.name ?? ""
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding()
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                .navigationDestination(for: DecisionDestination.self) { dest in
                    TaskDetailView(nodeId: dest.nodeId, projectId: dest.projectId)
                }
            }
        }
    }
}

struct DecisionDestination: Hashable {
    let nodeId: String
    let projectId: String
}

private struct DecisionCard: View {
    let decision: PlanNode
    let projectName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "questionmark.diamond.fill")
                    .foregroundStyle(.orange)
                Text(decision.type.rawValue.capitalized)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.orange)
            }

            Text(decision.title)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)

            Text(decision.description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)

            if !projectName.isEmpty {
                Text(projectName)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            HStack(spacing: 8) {
                StatusBadge(status: decision.status)
                Spacer()
                if let priority = decision.priority {
                    PriorityBadge(priority: priority)
                }
            }
        }
        .padding()
        .frame(width: 260, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(.orange.opacity(0.3), lineWidth: 1)
        )
    }
}
