import SwiftUI

// MARK: - Enhanced Status Indicator
// Matches ios.pen design with filled dots and colored rings

struct NexusStatusIndicator: View {
    let status: PlanNode.NodeStatus
    var size: CGFloat = 28

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(statusColor, lineWidth: 2.5)
                .frame(width: size, height: size)

            if status == .completed || status == .autoVerified {
                Circle()
                    .fill(statusColor)
                    .frame(width: size * 0.45, height: size * 0.45)
            } else if status == .inProgress || status == .dispatched {
                // Animated pulsing dot for in-progress
                Circle()
                    .fill(statusColor)
                    .frame(width: size * 0.35, height: size * 0.35)
                    .overlay(
                        Circle()
                            .stroke(statusColor.opacity(0.3), lineWidth: 1)
                            .scaleEffect(1.5)
                            .opacity(0.5)
                    )
                    .animation(
                        .easeInOut(duration: 1.5).repeatForever(autoreverses: true),
                        value: status
                    )
            }
        }
    }

    private var statusColor: Color {
        switch status {
        case .planned:
            return NexusTheme.Colors.textTertiary
        case .dispatched:
            return NexusTheme.Colors.statusInProgress
        case .inProgress:
            return NexusTheme.Colors.statusInProgress
        case .autoVerified, .completed:
            return NexusTheme.Colors.statusCompleted
        case .awaitingJudgment:
            return NexusTheme.Colors.statusAwaiting
        case .pruned:
            return NexusTheme.Colors.statusPruned
        }
    }
}

// MARK: - Enhanced Task Row
// Matches ios.pen TaskRow design with better hierarchy

struct NexusTaskRow: View {
    let node: PlanNode
    let projectName: String?

    var body: some View {
        HStack(alignment: .top, spacing: NexusTheme.Spacing.md) {
            NexusStatusIndicator(status: node.status)

            VStack(alignment: .leading, spacing: NexusTheme.Spacing.xs) {
                Text(node.title)
                    .font(NexusTheme.Typography.bodyMedium)
                    .foregroundColor(NexusTheme.Colors.textPrimary)
                    .lineLimit(2)

                if !node.description.isEmpty {
                    Text(node.description)
                        .font(NexusTheme.Typography.caption1)
                        .foregroundColor(NexusTheme.Colors.textSecondary)
                        .lineLimit(2)
                }

                HStack(spacing: NexusTheme.Spacing.sm) {
                    if let projectName = projectName {
                        Text(projectName)
                            .font(NexusTheme.Typography.caption2Medium)
                            .foregroundColor(NexusTheme.Colors.textTertiary)
                    }

                    if let estimate = node.estimate {
                        Text(estimate.rawValue)
                            .font(NexusTheme.Typography.caption2Medium.monospaced())
                            .foregroundColor(NexusTheme.Colors.textTertiary)
                    }

                    Spacer()

                    if let priority = node.priority {
                        NexusPriorityBadge(priority: priority)
                    }
                }
            }
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

// MARK: - Enhanced Decision Card
// Matches ios.pen DecisionCard design with AI recommendation section

struct NexusDecisionCard: View {
    let decision: PlanNode
    let projectName: String
    let aiRecommendation: String?

    var body: some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.lg) {
            // Header
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(NexusTheme.Typography.footnote)
                    .foregroundColor(NexusTheme.Colors.statusAwaiting)

                Text("Awaiting Judgment")
                    .font(NexusTheme.Typography.caption2Medium)
                    .foregroundColor(NexusTheme.Colors.statusAwaiting)

                Spacer()

                Text(decision.createdAt.relativeString)
                    .font(NexusTheme.Typography.caption2)
                    .foregroundColor(NexusTheme.Colors.textTertiary)
            }

            // Title & Description
            VStack(alignment: .leading, spacing: NexusTheme.Spacing.sm) {
                Text(decision.title)
                    .font(NexusTheme.Typography.headline)
                    .foregroundColor(NexusTheme.Colors.textPrimary)
                    .lineLimit(2)

                Text(decision.description)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(NexusTheme.Colors.textSecondary)
                    .lineLimit(3)
            }

            // AI Recommendation
            if let recommendation = aiRecommendation {
                VStack(alignment: .leading, spacing: NexusTheme.Spacing.sm) {
                    HStack(spacing: NexusTheme.Spacing.xs) {
                        Image(systemName: "sparkles")
                            .font(NexusTheme.Typography.caption2)
                        Text("AI Recommendation")
                            .font(NexusTheme.Typography.caption2Medium)
                    }
                    .foregroundColor(NexusTheme.Colors.primary)

                    Text(recommendation)
                        .font(NexusTheme.Typography.caption1)
                        .foregroundColor(NexusTheme.Colors.textSecondary)
                        .lineLimit(3)
                }
                .padding(NexusTheme.Spacing.md)
                .background(NexusTheme.Colors.surfaceElevated)
                .cornerRadius(NexusTheme.CornerRadius.md)
            }

            // Actions
            HStack(spacing: NexusTheme.Spacing.md) {
                Button("Reject") {
                    // Action
                }
                .buttonStyle(NexusSecondaryButtonStyle())

                Button("Approve") {
                    // Action
                }
                .buttonStyle(NexusPrimaryButtonStyle())
            }
        }
        .padding(NexusTheme.Spacing.xl)
        .frame(width: 320)
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

// MARK: - Priority Badge

struct NexusPriorityBadge: View {
    let priority: Priority

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: iconName)
                .font(.system(size: 9, weight: .semibold))
            Text(priority.displayName)
                .font(NexusTheme.Typography.caption2Medium)
        }
        .padding(.horizontal, NexusTheme.Spacing.sm)
        .padding(.vertical, 4)
        .background(priorityColor.opacity(0.15))
        .foregroundColor(priorityColor)
        .cornerRadius(NexusTheme.CornerRadius.sm)
    }

    private var iconName: String {
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
        case .urgent: return NexusTheme.Colors.danger
        case .high: return NexusTheme.Colors.warning
        case .medium: return colorFromHex( "FCD34D")
        case .low: return NexusTheme.Colors.primary
        case .none: return NexusTheme.Colors.textTertiary
        }
    }
}

// MARK: - Project Card
// Enhanced project row with icon, color, and better hierarchy

struct NexusProjectCard: View {
    let project: Project
    let isGenerating: Bool

    var body: some View {
        HStack(spacing: NexusTheme.Spacing.md) {
            // Project icon
            Text(project.icon)
                .font(.system(size: 24))
                .frame(width: 48, height: 48)
                .background(
                    RoundedRectangle(cornerRadius: NexusTheme.CornerRadius.md)
                        .fill(colorFromHex( project.color).opacity(0.15))
                )

            VStack(alignment: .leading, spacing: NexusTheme.Spacing.xs) {
                HStack {
                    Text(project.name)
                        .font(NexusTheme.Typography.bodyMedium)
                        .foregroundColor(NexusTheme.Colors.textPrimary)

                    Spacer()

                    if isGenerating {
                        ProgressView()
                            .scaleEffect(0.7)
                            .tint(NexusTheme.Colors.primary)
                    } else if let health = project.health {
                        NexusHealthIndicator(health: health)
                    }
                }

                Text(project.description)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(NexusTheme.Colors.textSecondary)
                    .lineLimit(2)

                HStack(spacing: NexusTheme.Spacing.sm) {
                    if isGenerating {
                        Text("Generating plan...")
                            .font(NexusTheme.Typography.caption2Medium)
                            .foregroundColor(NexusTheme.Colors.primary)
                    } else if let progress = project.progress {
                        HStack(spacing: 4) {
                            ProgressView(value: Double(progress), total: 100)
                                .frame(width: 50)
                                .tint(NexusTheme.Colors.primary)
                            Text("\(progress)%")
                                .font(NexusTheme.Typography.caption2)
                                .foregroundColor(NexusTheme.Colors.textTertiary)
                        }
                    }

                    Spacer()

                    Text(project.updatedAt.relativeString)
                        .font(NexusTheme.Typography.caption2)
                        .foregroundColor(NexusTheme.Colors.textTertiary)
                }
            }
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

// MARK: - Health Indicator

struct NexusHealthIndicator: View {
    let health: Project.ProjectHealth

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(healthColor)
                .frame(width: 6, height: 6)

            Text(displayName)
                .font(NexusTheme.Typography.caption2Medium)
                .foregroundColor(healthColor)
        }
        .padding(.horizontal, NexusTheme.Spacing.sm)
        .padding(.vertical, 4)
        .background(healthColor.opacity(0.15))
        .cornerRadius(NexusTheme.CornerRadius.sm)
    }

    private var displayName: String {
        switch health {
        case .onTrack: return "On Track"
        case .atRisk: return "At Risk"
        case .offTrack: return "Off Track"
        }
    }

    private var healthColor: Color {
        switch health {
        case .onTrack: return NexusTheme.Colors.success
        case .atRisk: return NexusTheme.Colors.warning
        case .offTrack: return NexusTheme.Colors.danger
        }
    }
}

// MARK: - Button Styles

struct NexusPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NexusTheme.Typography.footnoteMedium)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, NexusTheme.Spacing.md)
            .background(NexusTheme.Colors.success)
            .cornerRadius(NexusTheme.CornerRadius.md)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

struct NexusSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NexusTheme.Typography.footnoteMedium)
            .foregroundColor(NexusTheme.Colors.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, NexusTheme.Spacing.md)
            .background(NexusTheme.Colors.surfaceElevated)
            .cornerRadius(NexusTheme.CornerRadius.md)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: - Stats Card
// For dashboard statistics

struct NexusStatsCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.md) {
            HStack {
                Image(systemName: icon)
                    .font(NexusTheme.Typography.title3)
                    .foregroundColor(color)

                Spacer()
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(NexusTheme.Typography.title2)
                    .foregroundColor(NexusTheme.Colors.textPrimary)

                Text(title)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(NexusTheme.Colors.textSecondary)
            }
        }
        .padding(NexusTheme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
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

// MARK: - Section Header

struct NexusSectionHeader: View {
    let title: String
    let count: Int?
    let action: (() -> Void)?
    @Environment(\.colorScheme) private var colorScheme

    init(title: String, count: Int? = nil, action: (() -> Void)? = nil) {
        self.title = title
        self.count = count
        self.action = action
    }

    var body: some View {
        HStack {
            Text(title)
                .font(NexusTheme.Typography.headline)
                .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

            if let count = count {
                Text("\(count)")
                    .font(NexusTheme.Typography.caption2Medium)
                    .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                    .padding(.horizontal, NexusTheme.Spacing.sm)
                    .padding(.vertical, 4)
                    .background(NexusTheme.Colors.surfaceElevated)
                    .cornerRadius(NexusTheme.CornerRadius.sm)
            }

            Spacer()

            if let action = action {
                Button(action: action) {
                    Image(systemName: "arrow.right")
                        .font(NexusTheme.Typography.footnote)
                        .foregroundColor(NexusTheme.Colors.primary)
                }
            }
        }
    }
}
