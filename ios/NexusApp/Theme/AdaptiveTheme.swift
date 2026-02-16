import SwiftUI

// MARK: - Adaptive Theme for Light & Dark Modes
// Automatically adapts based on system color scheme

enum AdaptiveColors {
    // MARK: - Backgrounds

    static func background(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? colorFromHex( "0A0E1A") : colorFromHex( "F8FAFC")
    }

    static func surface(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? colorFromHex( "111827") : Color.white
    }

    static func surfaceElevated(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? colorFromHex( "1E293B") : colorFromHex( "F1F5F9")
    }

    // MARK: - Borders & Dividers

    static func border(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? colorFromHex( "1E293B").opacity(0.25)
            : colorFromHex( "E2E8F0")
    }

    static func borderSubtle(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? colorFromHex( "1E293B").opacity(0.15)
            : colorFromHex( "E2E8F0").opacity(0.5)
    }

    // MARK: - Status Colors (Same across themes)

    static let statusCompleted = colorFromHex( "16A34A")
    static let statusInProgress = colorFromHex( "3B82F6")
    static let statusAwaiting = colorFromHex( "F59E0B")
    static let statusError = colorFromHex( "EF4444")
    static let statusPruned = colorFromHex( "9CA3AF")

    // MARK: - Semantic Colors

    static let primary = colorFromHex( "3B82F6")
    static let success = colorFromHex( "16A34A")
    static let warning = colorFromHex( "F59E0B")
    static let danger = colorFromHex( "EF4444")

    // MARK: - Text Colors

    static func textPrimary(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? .white : colorFromHex( "0F172A")
    }

    static func textSecondary(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? colorFromHex( "94A3B8") : colorFromHex( "64748B")
    }

    static func textTertiary(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? colorFromHex( "64748B") : colorFromHex( "94A3B8")
    }
}

// MARK: - Adaptive View Extensions

extension View {
    func adaptiveCard(padding: CGFloat = NexusTheme.Spacing.lg, colorScheme: ColorScheme) -> some View {
        self
            .padding(padding)
            .background(AdaptiveColors.surface(colorScheme))
            .cornerRadius(NexusTheme.CornerRadius.md)
            .shadow(
                color: colorScheme == .dark
                    ? NexusTheme.Shadow.card.color
                    : Color.black.opacity(0.08),
                radius: NexusTheme.Shadow.card.radius,
                x: NexusTheme.Shadow.card.x,
                y: NexusTheme.Shadow.card.y
            )
    }

    func adaptiveCardElevated(padding: CGFloat = NexusTheme.Spacing.lg, colorScheme: ColorScheme) -> some View {
        self
            .padding(padding)
            .background(AdaptiveColors.surface(colorScheme))
            .cornerRadius(NexusTheme.CornerRadius.lg)
            .shadow(
                color: colorScheme == .dark
                    ? NexusTheme.Shadow.cardElevated.color
                    : Color.black.opacity(0.1),
                radius: NexusTheme.Shadow.cardElevated.radius,
                x: NexusTheme.Shadow.cardElevated.x,
                y: NexusTheme.Shadow.cardElevated.y
            )
    }

    func adaptiveScrollFade(colorScheme: ColorScheme) -> some View {
        self.overlay(alignment: .bottom) {
            LinearGradient(
                colors: [
                    AdaptiveColors.background(colorScheme).opacity(0),
                    AdaptiveColors.background(colorScheme).opacity(0.5),
                    AdaptiveColors.background(colorScheme)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 100)
            .allowsHitTesting(false)
        }
    }
}

// MARK: - Adaptive Components

// These are adaptive versions of the Nexus components that respond to color scheme

struct AdaptiveStatusIndicator: View {
    let status: PlanNode.NodeStatus
    var size: CGFloat = 28

    @Environment(\.colorScheme) private var colorScheme

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
                Circle()
                    .fill(statusColor)
                    .frame(width: size * 0.35, height: size * 0.35)
                    .overlay(
                        Circle()
                            .stroke(statusColor.opacity(0.3), lineWidth: 1)
                            .scaleEffect(1.5)
                            .opacity(0.5)
                    )
            }
        }
    }

    private var statusColor: Color {
        switch status {
        case .planned:
            return AdaptiveColors.textTertiary(colorScheme)
        case .dispatched:
            return AdaptiveColors.statusInProgress
        case .inProgress:
            return AdaptiveColors.statusInProgress
        case .autoVerified, .completed:
            return AdaptiveColors.statusCompleted
        case .awaitingJudgment:
            return AdaptiveColors.statusAwaiting
        case .pruned:
            return AdaptiveColors.statusPruned
        }
    }
}

struct AdaptiveTaskRow: View {
    let node: PlanNode
    let projectName: String?

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(alignment: .top, spacing: NexusTheme.Spacing.md) {
            AdaptiveStatusIndicator(status: node.status)

            VStack(alignment: .leading, spacing: NexusTheme.Spacing.xs) {
                Text(node.title)
                    .font(NexusTheme.Typography.bodyMedium)
                    .foregroundColor(AdaptiveColors.textPrimary(colorScheme))
                    .lineLimit(2)

                if !node.description.isEmpty {
                    Text(node.description)
                        .font(NexusTheme.Typography.caption1)
                        .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                        .lineLimit(2)
                }

                HStack(spacing: NexusTheme.Spacing.sm) {
                    if let projectName = projectName {
                        Text(projectName)
                            .font(NexusTheme.Typography.caption2Medium)
                            .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                    }

                    if let estimate = node.estimate {
                        Text(estimate.rawValue)
                            .font(NexusTheme.Typography.caption2Medium.monospaced())
                            .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                    }

                    Spacer()

                    if let priority = node.priority {
                        NexusPriorityBadge(priority: priority)
                    }
                }
            }
        }
        .adaptiveCard(padding: NexusTheme.Spacing.lg, colorScheme: colorScheme)
    }
}

struct AdaptiveProjectCard: View {
    let project: Project
    let isGenerating: Bool

    @Environment(\.colorScheme) private var colorScheme

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
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                    Spacer()

                    if isGenerating {
                        ProgressView()
                            .scaleEffect(0.7)
                            .tint(AdaptiveColors.primary)
                    } else if let health = project.health {
                        NexusHealthIndicator(health: health)
                    }
                }

                Text(project.description)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
                    .lineLimit(2)

                HStack(spacing: NexusTheme.Spacing.sm) {
                    if isGenerating {
                        Text("Generating plan...")
                            .font(NexusTheme.Typography.caption2Medium)
                            .foregroundColor(AdaptiveColors.primary)
                    } else if let progress = project.progress {
                        HStack(spacing: 4) {
                            ProgressView(value: Double(progress), total: 100)
                                .frame(width: 50)
                                .tint(AdaptiveColors.primary)
                            Text("\(progress)%")
                                .font(NexusTheme.Typography.caption2)
                                .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                        }
                    }

                    Spacer()

                    Text(project.updatedAt.relativeString)
                        .font(NexusTheme.Typography.caption2)
                        .foregroundColor(AdaptiveColors.textTertiary(colorScheme))
                }
            }
        }
        .adaptiveCard(padding: NexusTheme.Spacing.lg, colorScheme: colorScheme)
    }
}

struct AdaptiveStatsCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    @Environment(\.colorScheme) private var colorScheme

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
                    .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                Text(title)
                    .font(NexusTheme.Typography.caption1)
                    .foregroundColor(AdaptiveColors.textSecondary(colorScheme))
            }
        }
        .adaptiveCard(padding: NexusTheme.Spacing.lg, colorScheme: colorScheme)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
