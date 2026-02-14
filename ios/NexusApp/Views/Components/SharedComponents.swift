import SwiftUI

// MARK: - Status Badge

struct StatusBadge: View {
    let status: PlanNode.NodeStatus
    var large: Bool = false

    var body: some View {
        Text(status.displayName)
            .font(large ? .footnote.weight(.medium) : .caption2.weight(.medium))
            .padding(.horizontal, large ? 12 : 6)
            .padding(.vertical, large ? 6 : 2)
            .background(backgroundColor.opacity(0.15), in: Capsule())
            .foregroundStyle(backgroundColor)
    }

    private var backgroundColor: Color {
        switch status {
        case .planned: return .gray
        case .dispatched: return .blue
        case .inProgress: return .blue
        case .autoVerified: return .green
        case .awaitingJudgment: return .orange
        case .completed: return .green
        case .pruned: return .red
        }
    }
}

// MARK: - Priority Badge

struct PriorityBadge: View {
    let priority: Priority
    var large: Bool = false

    var body: some View {
        HStack(spacing: large ? 4 : 2) {
            Image(systemName: priorityIcon)
                .font(.system(size: large ? 10 : 8))
            Text(priority.displayName)
                .font(large ? .footnote : .caption2)
        }
        .padding(.horizontal, large ? 12 : 6)
        .padding(.vertical, large ? 6 : 2)
        .background(priorityColor.opacity(0.1), in: Capsule())
        .foregroundStyle(priorityColor)
    }

    private var priorityIcon: String {
        switch priority {
        case .urgent: return "exclamationmark.3"
        case .high: return "arrow.up"
        case .medium: return "minus"
        case .low: return "arrow.down"
        case .none: return "minus"
        }
    }

    private var priorityColor: Color {
        switch priority {
        case .urgent: return .red
        case .high: return .orange
        case .medium: return .yellow
        case .low: return .blue
        case .none: return .gray
        }
    }
}

// MARK: - Estimate Badge

struct EstimateBadge: View {
    let estimate: Estimate
    var large: Bool = false

    var body: some View {
        Text(estimate.rawValue)
            .font(large ? .footnote.weight(.bold).monospaced() : .caption2.weight(.bold).monospaced())
            .padding(.horizontal, large ? 12 : 6)
            .padding(.vertical, large ? 6 : 2)
            .background(.secondary.opacity(0.1), in: Capsule())
            .foregroundStyle(.secondary)
    }
}

// MARK: - Environment Badge

struct EnvironmentBadge: View {
    let environment: TaskEnvironment
    var large: Bool = false

    var body: some View {
        HStack(spacing: large ? 4 : 3) {
            Image(systemName: icon)
                .font(.system(size: large ? 11 : 9))
            Text(environment.rawValue.capitalized)
                .font(large ? .footnote : .caption2)
        }
        .padding(.horizontal, large ? 12 : 6)
        .padding(.vertical, large ? 6 : 2)
        .background(.tint.opacity(0.1), in: Capsule())
    }

    private var icon: String {
        switch environment {
        case .local: return "laptopcomputer"
        case .remote: return "server.rack"
        case .hpc: return "cpu"
        case .cloud: return "cloud"
        }
    }
}

// MARK: - Node Type Icon

struct NodeTypeIcon: View {
    let type: PlanNode.NodeType

    var body: some View {
        Image(systemName: iconName)
            .font(.caption)
            .foregroundStyle(iconColor)
    }

    private var iconName: String {
        switch type {
        case .milestone: return "flag.fill"
        case .task: return "checkmark.circle"
        case .branch: return "arrow.triangle.branch"
        case .decision: return "questionmark.diamond.fill"
        }
    }

    private var iconColor: Color {
        switch type {
        case .milestone: return .purple
        case .task: return .blue
        case .branch: return .green
        case .decision: return .orange
        }
    }
}

// MARK: - Loading Overlay

struct LoadingOverlay: View {
    let message: String

    var body: some View {
        ZStack {
            Color.black.opacity(0.3)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.5)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(32)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

// MARK: - Relative Date

extension Date {
    var relativeString: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: .now)
    }
}
