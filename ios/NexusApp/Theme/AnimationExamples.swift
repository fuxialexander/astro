import SwiftUI

// MARK: - Animation Examples View
/// Demonstration view showcasing all animation patterns
/// Use this as a reference for implementing animations in your views

struct AnimationExamplesView: View {
    @State private var showSuccess = false
    @State private var showError = false
    @State private var isLoading = false
    @State private var progressValue = 0.0

    var body: some View {
        ScrollView {
            VStack(spacing: NexusTheme.Spacing.xl) {
                // MARK: - Status Indicators
                sectionHeader("Status Indicators")

                HStack(spacing: 16) {
                    AnimatedStatusIndicator(status: .planned)
                    AnimatedStatusIndicator(status: .dispatched)
                    AnimatedStatusIndicator(status: .inProgress)
                    AnimatedStatusIndicator(status: .completed)
                    AnimatedStatusIndicator(status: .awaitingJudgment)
                }

                // MARK: - Stats Cards
                sectionHeader("Stats Cards with Count-up")

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    AnimatedStatsCard(
                        title: "Active Tasks",
                        value: 12,
                        icon: "checkmark.circle",
                        color: NexusTheme.Colors.primary
                    )

                    AnimatedStatsCard(
                        title: "Completed",
                        value: 45,
                        icon: "checkmark.circle.fill",
                        color: NexusTheme.Colors.success
                    )
                }

                // MARK: - Progress Bar
                sectionHeader("Animated Progress Bar")

                VStack(spacing: 12) {
                    AnimatedProgressBar(
                        value: progressValue,
                        color: NexusTheme.Colors.primary,
                        height: 6
                    )

                    Slider(value: $progressValue, in: 0...1)
                        .tint(NexusTheme.Colors.primary)
                }

                // MARK: - Press Effects
                sectionHeader("Press Effect Examples")

                VStack(spacing: 12) {
                    Button("Primary Button") {
                        HapticManager.shared.medium()
                    }
                    .buttonStyle(NexusPrimaryButtonStyle())
                    .pressEffect()

                    // Card with press effect
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Interactive Card")
                            .font(NexusTheme.Typography.bodyMedium)
                        Text("Tap to feel the spring animation")
                            .font(NexusTheme.Typography.caption1)
                            .foregroundColor(NexusTheme.Colors.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(NexusTheme.Spacing.lg)
                    .background(NexusTheme.Colors.surface)
                    .cornerRadius(NexusTheme.CornerRadius.md)
                    .shadow(
                        color: NexusTheme.Shadow.card.color,
                        radius: NexusTheme.Shadow.card.radius,
                        x: NexusTheme.Shadow.card.x,
                        y: NexusTheme.Shadow.card.y
                    )
                    .pressEffect()
                    .onTapGesture {
                        print("Card tapped")
                    }
                }

                // MARK: - Feedback Animations
                sectionHeader("Success/Error Feedback")

                HStack(spacing: 20) {
                    Button("Show Success") {
                        showSuccess = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            showSuccess = false
                        }
                    }
                    .buttonStyle(NexusPrimaryButtonStyle())

                    Button("Show Error") {
                        showError = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            showError = false
                        }
                    }
                    .buttonStyle(NexusSecondaryButtonStyle())
                }

                if showSuccess {
                    AnimatedCheckmark()
                        .transition(.scaleWithFade)
                }

                if showError {
                    AnimatedErrorIndicator()
                        .transition(.scaleWithFade)
                }

                // MARK: - Shimmer Effect
                sectionHeader("Shimmer Loading State")

                VStack(spacing: 8) {
                    Toggle("Loading", isOn: $isLoading)

                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.gray.opacity(0.2))
                            .frame(height: 20)

                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.gray.opacity(0.2))
                            .frame(height: 20)
                            .frame(width: 200)
                    }
                    .shimmer(active: isLoading)
                    .padding()
                    .background(NexusTheme.Colors.surface)
                    .cornerRadius(NexusTheme.CornerRadius.md)
                }

                // MARK: - Health Indicators
                sectionHeader("Animated Health Indicators")

                VStack(spacing: 12) {
                    AnimatedHealthIndicator(health: .onTrack)
                    AnimatedHealthIndicator(health: .atRisk)
                    AnimatedHealthIndicator(health: .offTrack)
                }

                // MARK: - List Item Animations
                sectionHeader("Staggered List Animation")

                VStack(spacing: 8) {
                    ForEach(0..<5, id: \.self) { index in
                        HStack {
                            Circle()
                                .fill(NexusTheme.Colors.primary)
                                .frame(width: 8, height: 8)
                            Text("List Item \(index + 1)")
                                .font(NexusTheme.Typography.body)
                            Spacer()
                        }
                        .padding()
                        .background(NexusTheme.Colors.surface)
                        .cornerRadius(NexusTheme.CornerRadius.md)
                        .listItemAnimation(index: index)
                    }
                }

                // MARK: - Haptic Feedback
                sectionHeader("Haptic Feedback Examples")

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    hapticButton("Light", action: HapticManager.shared.light)
                    hapticButton("Medium", action: HapticManager.shared.medium)
                    hapticButton("Heavy", action: HapticManager.shared.heavy)
                    hapticButton("Selection", action: HapticManager.shared.selection)
                    hapticButton("Success", action: HapticManager.shared.success)
                    hapticButton("Warning", action: HapticManager.shared.warning)
                    hapticButton("Error", action: HapticManager.shared.error)
                }
            }
            .padding()
        }
        .navigationTitle("Animation Examples")
        .background(NexusTheme.Colors.background)
    }

    private func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title)
                .font(NexusTheme.Typography.headline)
                .foregroundColor(NexusTheme.Colors.textPrimary)
            Spacer()
        }
        .padding(.top, NexusTheme.Spacing.lg)
    }

    private func hapticButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(label) {
            action()
        }
        .font(NexusTheme.Typography.caption1Medium)
        .foregroundColor(NexusTheme.Colors.textPrimary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(NexusTheme.Colors.surface)
        .cornerRadius(NexusTheme.CornerRadius.md)
        .pressEffect()
    }
}

// MARK: - Preview
#Preview {
    NavigationStack {
        AnimationExamplesView()
    }
}

// MARK: - Integration Examples for Common Views

/*
 EXAMPLE 1: Dashboard Stats Grid with Animated Cards

 struct DashboardView: View {
     @Environment(UsageStore.self) private var usageStore

     var body: some View {
         ScrollView {
             VStack(spacing: 20) {
                 LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                     AnimatedStatsCard(
                         title: "Active Tasks",
                         value: usageStore.activeTasks,
                         icon: "checkmark.circle",
                         color: .blue
                     )
                     .slideInEffect(delay: 0)

                     AnimatedStatsCard(
                         title: "Completed Today",
                         value: usageStore.completedToday,
                         icon: "checkmark.circle.fill",
                         color: .green
                     )
                     .slideInEffect(delay: 0.1)
                 }
             }
             .padding()
         }
     }
 }


 EXAMPLE 2: Project List with Press Effects

 struct ProjectListView: View {
     @Environment(ProjectStore.self) private var projectStore

     var body: some View {
         List {
             ForEach(Array(projectStore.activeProjects.enumerated()), id: \.element.id) { index, project in
                 NavigationLink(value: project) {
                     ProjectRow(project: project)
                 }
                 .listItemAnimation(index: index)
                 .pressEffect()
                 .onTapGesture {
                     HapticManager.shared.light()
                 }
             }
         }
     }
 }


 EXAMPLE 3: Task Row with Animated Status

 struct TaskRow: View {
     let task: PlanNode

     var body: some View {
         HStack(spacing: 12) {
             AnimatedStatusIndicator(status: task.status, size: 28)

             VStack(alignment: .leading, spacing: 4) {
                 Text(task.title)
                     .font(.body.weight(.medium))

                 if let progress = task.executionProgress {
                     AnimatedProgressBar(
                         value: Double(progress) / 100.0,
                         color: .blue,
                         height: 4
                     )
                 }
             }
         }
         .padding()
         .background(Color(.systemBackground))
         .cornerRadius(12)
         .pressEffect()
     }
 }


 EXAMPLE 4: Task Completion Feedback

 struct TaskDetailView: View {
     @State private var showSuccess = false
     let task: PlanNode

     var body: some View {
         VStack {
             // Task content...

             Button("Complete Task") {
                 completeTask()
             }
             .buttonStyle(NexusPrimaryButtonStyle())
             .pressEffect()

             if showSuccess {
                 AnimatedCheckmark()
                     .transition(.scaleWithFade)
             }
         }
     }

     private func completeTask() {
         // Complete task logic
         withAnimation(NexusAnimations.smooth) {
             showSuccess = true
         }
         HapticManager.shared.success()

         DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
             withAnimation(NexusAnimations.smooth) {
                 showSuccess = false
             }
         }
     }
 }


 EXAMPLE 5: Loading State with Shimmer

 struct ProjectDetailView: View {
     @State private var isLoading = true
     let projectId: String

     var body: some View {
         VStack {
             if isLoading {
                 VStack(spacing: 12) {
                     RoundedRectangle(cornerRadius: 8)
                         .fill(Color.gray.opacity(0.2))
                         .frame(height: 100)
                     RoundedRectangle(cornerRadius: 8)
                         .fill(Color.gray.opacity(0.2))
                         .frame(height: 200)
                 }
                 .shimmer(active: true)
             } else {
                 // Actual content
             }
         }
         .task {
             await loadProject()
         }
     }

     private func loadProject() async {
         // Load project...
         withAnimation(NexusAnimations.fade) {
             isLoading = false
         }
     }
 }


 EXAMPLE 6: Decision Approval with Haptics

 struct DecisionCardView: View {
     let decision: PlanNode
     let onApprove: () -> Void
     let onReject: () -> Void

     var body: some View {
         VStack {
             // Decision content...

             HStack {
                 Button("Reject") {
                     HapticManager.shared.warning()
                     onReject()
                 }
                 .buttonStyle(NexusSecondaryButtonStyle())
                 .pressEffect()

                 Button("Approve") {
                     HapticManager.shared.success()
                     onApprove()
                 }
                 .buttonStyle(NexusPrimaryButtonStyle())
                 .pressEffect()
             }
         }
     }
 }
 */
