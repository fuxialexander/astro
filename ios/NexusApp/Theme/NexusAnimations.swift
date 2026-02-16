import SwiftUI
import UIKit

// MARK: - Animation Presets
/// Predefined spring animations for consistent feel throughout the app

struct NexusAnimations {
    // MARK: - Spring Animations

    /// Bouncy spring for playful interactions (buttons, cards)
    static let bouncy = Animation.spring(response: 0.4, dampingFraction: 0.65, blendDuration: 0)

    /// Smooth spring for general UI transitions
    static let smooth = Animation.spring(response: 0.35, dampingFraction: 0.8, blendDuration: 0)

    /// Snappy spring for quick feedback
    static let snappy = Animation.spring(response: 0.25, dampingFraction: 0.7, blendDuration: 0)

    /// Gentle spring for subtle animations
    static let gentle = Animation.spring(response: 0.5, dampingFraction: 0.9, blendDuration: 0)

    // MARK: - Easing Animations

    /// Smooth ease in-out for fades
    static let fade = Animation.easeInOut(duration: 0.2)

    /// Quick ease for instant feedback
    static let quick = Animation.easeOut(duration: 0.15)

    /// Slow ease for emphasis
    static let slow = Animation.easeInOut(duration: 0.4)
}

// MARK: - Haptic Feedback Manager
/// Centralized haptic feedback with consistent patterns

class HapticManager {
    static let shared = HapticManager()

    private let impact = UIImpactFeedbackGenerator(style: .medium)
    private let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private let heavyImpact = UIImpactFeedbackGenerator(style: .heavy)
    private let selectionFeedback = UISelectionFeedbackGenerator()
    private let notification = UINotificationFeedbackGenerator()

    private init() {
        // Prepare generators for reduced latency
        impact.prepare()
        lightImpact.prepare()
        selectionFeedback.prepare()
    }

    /// Light tap for navigation, selection
    func light() {
        lightImpact.impactOccurred()
    }

    /// Medium tap for button presses, card interactions
    func medium() {
        impact.impactOccurred()
    }

    /// Heavy tap for important actions, completions
    func heavy() {
        heavyImpact.impactOccurred()
    }

    /// Selection feedback for toggles, pickers
    func selection() {
        selectionFeedback.selectionChanged()
    }

    /// Success notification (task completed, approval accepted)
    func success() {
        notification.notificationOccurred(.success)
    }

    /// Warning notification (at-risk status, approaching deadline)
    func warning() {
        notification.notificationOccurred(.warning)
    }

    /// Error notification (task failed, network error)
    func error() {
        notification.notificationOccurred(.error)
    }
}

// MARK: - View Modifiers

/// Adds spring-based press animation with haptic feedback
/// Usage: `.pressEffect()`
struct PressEffect: ViewModifier {
    @State private var isPressed = false
    let haptic: Bool

    func body(content: Content) -> some View {
        content
            .scaleEffect(isPressed ? 0.96 : 1.0)
            .opacity(isPressed ? 0.85 : 1.0)
            .animation(NexusAnimations.bouncy, value: isPressed)
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        if !isPressed {
                            isPressed = true
                            if haptic {
                                HapticManager.shared.light()
                            }
                        }
                    }
                    .onEnded { _ in
                        isPressed = false
                    }
            )
    }
}

extension View {
    /// Adds press animation with optional haptic feedback
    /// - Parameter haptic: Enable haptic feedback on press (default: true)
    func pressEffect(haptic: Bool = true) -> some View {
        modifier(PressEffect(haptic: haptic))
    }
}

/// Adds slide-in animation from bottom with fade
/// Usage: `.slideInEffect(delay: 0.1)`
struct SlideInEffect: ViewModifier {
    @State private var isVisible = false
    let delay: Double

    func body(content: Content) -> some View {
        content
            .offset(y: isVisible ? 0 : 20)
            .opacity(isVisible ? 1 : 0)
            .onAppear {
                withAnimation(NexusAnimations.smooth.delay(delay)) {
                    isVisible = true
                }
            }
    }
}

extension View {
    /// Adds slide-in animation from bottom
    /// - Parameter delay: Animation delay in seconds (default: 0)
    func slideInEffect(delay: Double = 0) -> some View {
        modifier(SlideInEffect(delay: delay))
    }
}

/// Adds scroll-based reveal animation
/// Usage: `.scrollReveal()`
struct ScrollRevealEffect: ViewModifier {
    @State private var isVisible = false

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .scaleEffect(isVisible ? 1 : 0.95)
            .onAppear {
                withAnimation(NexusAnimations.smooth) {
                    isVisible = true
                }
            }
    }
}

extension View {
    /// Adds scroll-based reveal animation
    func scrollReveal() -> some View {
        modifier(ScrollRevealEffect())
    }
}

/// Adds shimmer loading effect
/// Usage: `.shimmer(active: isLoading)`
struct ShimmerEffect: ViewModifier {
    @State private var isAnimating = false
    let active: Bool

    func body(content: Content) -> some View {
        content
            .overlay(
                LinearGradient(
                    gradient: Gradient(colors: [
                        .clear,
                        Color.white.opacity(active ? 0.3 : 0),
                        .clear
                    ]),
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .offset(x: isAnimating ? 300 : -300)
                .animation(
                    active ? Animation.linear(duration: 1.5).repeatForever(autoreverses: false) : .default,
                    value: isAnimating
                )
            )
            .onAppear {
                if active {
                    isAnimating = true
                }
            }
            .onChange(of: active) { _, newValue in
                isAnimating = newValue
            }
    }
}

extension View {
    /// Adds shimmer loading effect
    /// - Parameter active: Enable shimmer animation
    func shimmer(active: Bool = true) -> some View {
        modifier(ShimmerEffect(active: active))
    }
}

// MARK: - Animated Components

/// Animated status indicator with smooth color transitions and pulse effect
/// Usage: `AnimatedStatusIndicator(status: .inProgress)`
struct AnimatedStatusIndicator: View {
    let status: PlanNode.NodeStatus
    var size: CGFloat = 28

    @State private var isPulsing = false

    var body: some View {
        ZStack {
            // Outer ring
            Circle()
                .strokeBorder(statusColor, lineWidth: 2.5)
                .frame(width: size, height: size)

            // Inner fill for completed states
            if status == .completed || status == .autoVerified {
                Circle()
                    .fill(statusColor)
                    .frame(width: size * 0.45, height: size * 0.45)
                    .transition(.scale.combined(with: .opacity))
            }

            // Pulsing animation for active states
            if status == .inProgress || status == .dispatched {
                Circle()
                    .fill(statusColor)
                    .frame(width: size * 0.35, height: size * 0.35)

                Circle()
                    .stroke(statusColor.opacity(0.3), lineWidth: 1.5)
                    .scaleEffect(isPulsing ? 1.8 : 1.0)
                    .opacity(isPulsing ? 0 : 0.6)
            }
        }
        .animation(NexusAnimations.smooth, value: status)
        .onAppear {
            if status == .inProgress || status == .dispatched {
                withAnimation(
                    Animation.easeInOut(duration: 1.5).repeatForever(autoreverses: false)
                ) {
                    isPulsing = true
                }
            }
        }
        .onChange(of: status) { _, newStatus in
            if newStatus == .inProgress || newStatus == .dispatched {
                withAnimation(
                    Animation.easeInOut(duration: 1.5).repeatForever(autoreverses: false)
                ) {
                    isPulsing = true
                }
            } else {
                isPulsing = false
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

/// Animated stats card with number count-up animation
/// Usage: `AnimatedStatsCard(title: "Tasks", value: 42, icon: "checkmark.circle", color: .blue)`
struct AnimatedStatsCard: View {
    let title: String
    let value: Int
    let icon: String
    let color: Color

    @State private var displayValue = 0

    var body: some View {
        VStack(alignment: .leading, spacing: NexusTheme.Spacing.md) {
            HStack {
                Image(systemName: icon)
                    .font(NexusTheme.Typography.title3)
                    .foregroundColor(color)
                    .symbolEffect(.bounce, value: displayValue)

                Spacer()
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("\(displayValue)")
                    .font(NexusTheme.Typography.title2)
                    .foregroundColor(NexusTheme.Colors.textPrimary)
                    .contentTransition(.numericText(value: Double(displayValue)))

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
        .onAppear {
            animateValue()
        }
        .onChange(of: value) { _, _ in
            animateValue()
        }
    }

    private func animateValue() {
        let steps = min(value, 30) // Cap animation steps for performance
        let stepDuration = 0.03

        withAnimation(NexusAnimations.smooth) {
            displayValue = value
        }
    }
}

/// Animated progress bar with smooth transitions
/// Usage: `AnimatedProgressBar(value: 0.75, color: .blue)`
struct AnimatedProgressBar: View {
    let value: Double // 0.0 to 1.0
    let color: Color
    var height: CGFloat = 4

    @State private var displayValue: Double = 0

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                // Background track
                Capsule()
                    .fill(Color.gray.opacity(0.15))
                    .frame(height: height)

                // Animated fill
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [color, color.opacity(0.8)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: geometry.size.width * displayValue, height: height)
            }
        }
        .frame(height: height)
        .onAppear {
            withAnimation(NexusAnimations.smooth.delay(0.1)) {
                displayValue = value
            }
        }
        .onChange(of: value) { _, newValue in
            withAnimation(NexusAnimations.smooth) {
                displayValue = newValue
            }
        }
    }
}

/// Animated health indicator with color transitions
/// Usage: `AnimatedHealthIndicator(health: .atRisk)`
struct AnimatedHealthIndicator: View {
    let health: Project.ProjectHealth

    @State private var isAnimating = false

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

    private var shouldAnimate: Bool {
        health == .atRisk || health == .offTrack
    }

    var body: some View {
        let color = healthColor
        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
                .scaleEffect(isAnimating ? 1.2 : 1.0)

            Text(displayName)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(color)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.15))
        .cornerRadius(8)
        .onAppear {
            if shouldAnimate {
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                    isAnimating = true
                }
            }
        }
    }
}

// MARK: - Transition Effects

extension AnyTransition {
    /// Slide from bottom with fade
    static var slideFromBottom: AnyTransition {
        .asymmetric(
            insertion: .move(edge: .bottom).combined(with: .opacity),
            removal: .move(edge: .bottom).combined(with: .opacity)
        )
    }

    /// Slide from trailing with fade
    static var slideFromTrailing: AnyTransition {
        .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .trailing).combined(with: .opacity)
        )
    }

    /// Scale with fade (for cards, modals)
    static var scaleWithFade: AnyTransition {
        .scale(scale: 0.9).combined(with: .opacity)
    }

    /// Blur with fade (using scale as approximation since blur transition isn't available)
    static var blurWithFade: AnyTransition {
        .opacity.combined(with: .scale(scale: 0.98))
    }
}

// MARK: - Navigation Transition Modifier

/// Custom navigation transition for project detail views
struct NavigationTransition: ViewModifier {
    func body(content: Content) -> some View {
        content
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
    }
}

extension View {
    /// Adds custom navigation transition
    func navigationZoomTransition(id: String) -> some View {
        modifier(NavigationTransition())
    }
}

// MARK: - Success/Error Feedback Animations

/// Animated checkmark for success states
struct AnimatedCheckmark: View {
    @State private var isAnimating = false

    var body: some View {
        Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 60))
            .foregroundColor(NexusTheme.Colors.success)
            .scaleEffect(isAnimating ? 1.0 : 0.5)
            .opacity(isAnimating ? 1.0 : 0)
            .onAppear {
                withAnimation(NexusAnimations.bouncy) {
                    isAnimating = true
                }
                HapticManager.shared.success()
            }
    }
}

/// Animated error indicator
struct AnimatedErrorIndicator: View {
    @State private var isAnimating = false

    var body: some View {
        Image(systemName: "xmark.circle.fill")
            .font(.system(size: 60))
            .foregroundColor(NexusTheme.Colors.danger)
            .rotationEffect(.degrees(isAnimating ? 0 : -90))
            .scaleEffect(isAnimating ? 1.0 : 0.5)
            .opacity(isAnimating ? 1.0 : 0)
            .onAppear {
                withAnimation(NexusAnimations.bouncy) {
                    isAnimating = true
                }
                HapticManager.shared.error()
            }
    }
}

// MARK: - List Animation Helper

extension View {
    /// Adds staggered animation for list items
    /// - Parameter index: Item index in list
    /// - Parameter total: Total number of items
    func listItemAnimation(index: Int, total: Int = 10) -> some View {
        let delay = min(Double(index) * 0.05, 0.3) // Cap delay at 0.3s
        return self
            .slideInEffect(delay: delay)
            .transition(.slideFromBottom)
    }
}

// MARK: - Usage Examples

/*
 EXAMPLE 1: Press Effect on Cards

 NexusTaskRow(node: task, projectName: "Project")
     .pressEffect()
     .onTapGesture {
         // Navigate to detail
     }


 EXAMPLE 2: Animated Stats Grid

 LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())]) {
     AnimatedStatsCard(
         title: "Active Tasks",
         value: 12,
         icon: "checkmark.circle",
         color: .blue
     )

     AnimatedStatsCard(
         title: "Completed",
         value: 45,
         icon: "checkmark.circle.fill",
         color: .green
     )
 }


 EXAMPLE 3: List with Staggered Animation

 List {
     ForEach(Array(projects.enumerated()), id: \.element.id) { index, project in
         ProjectRow(project: project)
             .listItemAnimation(index: index)
     }
 }


 EXAMPLE 4: Animated Status Indicator

 AnimatedStatusIndicator(status: task.status)


 EXAMPLE 5: Progress Bar

 AnimatedProgressBar(
     value: Double(project.progress ?? 0) / 100.0,
     color: .blue,
     height: 6
 )


 EXAMPLE 6: Success Feedback

 if taskCompleted {
     AnimatedCheckmark()
         .transition(.scaleWithFade)
 }


 EXAMPLE 7: Custom Button with Haptics

 Button("Submit") {
     HapticManager.shared.medium()
     // Submit action
 }
 .pressEffect()


 EXAMPLE 8: Shimmer Loading State

 TaskRow(task: task)
     .shimmer(active: isLoading)


 EXAMPLE 9: Scroll Reveal

 ScrollView {
     ForEach(items) { item in
         ItemRow(item: item)
             .scrollReveal()
     }
 }


 EXAMPLE 10: Health Indicator

 AnimatedHealthIndicator(health: project.health ?? .onTrack)
 */
