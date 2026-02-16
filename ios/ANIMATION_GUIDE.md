# Nexus iOS Animation Guide

Comprehensive guide to using the custom animation system in the Nexus iOS app.

## Overview

The Nexus animation system provides:
- **Predefined spring animations** for consistent feel
- **Haptic feedback** for tactile responses
- **Animated components** ready to use
- **View modifiers** for common animation patterns
- **Transition effects** for navigation and state changes

All animations use physics-based springs for natural, fluid motion.

---

## Animation Presets

Use these predefined animations for consistency:

```swift
// Bouncy spring - playful interactions (buttons, cards)
.animation(NexusAnimations.bouncy, value: someState)

// Smooth spring - general UI transitions
.animation(NexusAnimations.smooth, value: someState)

// Snappy spring - quick feedback
.animation(NexusAnimations.snappy, value: someState)

// Gentle spring - subtle animations
.animation(NexusAnimations.gentle, value: someState)

// Fade - smooth opacity changes
.animation(NexusAnimations.fade, value: someState)

// Quick - instant feedback
.animation(NexusAnimations.quick, value: someState)

// Slow - emphasis
.animation(NexusAnimations.slow, value: someState)
```

---

## Haptic Feedback

### Basic Usage

```swift
// Light tap - navigation, selection
HapticManager.shared.light()

// Medium tap - button presses, card interactions
HapticManager.shared.medium()

// Heavy tap - important actions, completions
HapticManager.shared.heavy()

// Selection - toggles, pickers
HapticManager.shared.selection()

// Success - task completed, approval accepted
HapticManager.shared.success()

// Warning - at-risk status, approaching deadline
HapticManager.shared.warning()

// Error - task failed, network error
HapticManager.shared.error()
```

### Button Example

```swift
Button("Submit") {
    HapticManager.shared.medium()
    // Submit action
}
.pressEffect() // Adds both animation and haptic
```

---

## View Modifiers

### Press Effect

Adds scale + opacity animation with haptic feedback on press.

```swift
NexusTaskRow(task: task)
    .pressEffect() // With haptic
    .onTapGesture {
        // Navigate
    }

// Disable haptic
.pressEffect(haptic: false)
```

### Slide In Effect

Animates view entering from bottom with fade.

```swift
TaskRow(task: task)
    .slideInEffect() // No delay

TaskRow(task: task)
    .slideInEffect(delay: 0.1) // 0.1s delay
```

### Scroll Reveal

Animates view appearing when scrolled into view.

```swift
ScrollView {
    ForEach(items) { item in
        ItemRow(item: item)
            .scrollReveal()
    }
}
```

### Shimmer Effect

Loading skeleton animation.

```swift
TaskRow(task: task)
    .shimmer(active: isLoading)
```

### List Item Animation

Staggered animation for list items (combines slide-in with automatic delay).

```swift
List {
    ForEach(Array(projects.enumerated()), id: \.element.id) { index, project in
        ProjectRow(project: project)
            .listItemAnimation(index: index)
    }
}
```

---

## Animated Components

### AnimatedStatusIndicator

Status indicator with pulsing animation for active states.

```swift
AnimatedStatusIndicator(status: task.status)

// Custom size
AnimatedStatusIndicator(status: task.status, size: 32)
```

**Features:**
- Smooth color transitions when status changes
- Pulsing animation for `.inProgress` and `.dispatched`
- Scale transition for completion states

### AnimatedStatsCard

Stats card with number count-up animation and symbol effects.

```swift
AnimatedStatsCard(
    title: "Active Tasks",
    value: 12,
    icon: "checkmark.circle",
    color: .blue
)
```

**Features:**
- Count-up animation when value changes
- Bounce symbol effect on value change
- Smooth numeric transitions

### AnimatedProgressBar

Progress bar with smooth fill animation.

```swift
AnimatedProgressBar(
    value: 0.75, // 0.0 to 1.0
    color: .blue,
    height: 4
)

// Bind to dynamic value
AnimatedProgressBar(
    value: Double(task.executionProgress ?? 0) / 100.0,
    color: NexusTheme.Colors.primary
)
```

**Features:**
- Smooth fill animation
- Gradient fill effect
- Automatic transition on value change

### AnimatedHealthIndicator

Health indicator with pulsing for at-risk states.

```swift
AnimatedHealthIndicator(health: project.health ?? .onTrack)
```

**Features:**
- Color-coded status (.onTrack, .atRisk, .offTrack)
- Pulse animation for at-risk/off-track states
- Smooth color transitions

### AnimatedCheckmark

Success feedback animation.

```swift
if taskCompleted {
    AnimatedCheckmark()
        .transition(.scaleWithFade)
}
```

**Features:**
- Scale + fade entrance
- Success haptic feedback
- Auto-plays on appear

### AnimatedErrorIndicator

Error feedback animation.

```swift
if error != nil {
    AnimatedErrorIndicator()
        .transition(.scaleWithFade)
}
```

**Features:**
- Rotation + scale entrance
- Error haptic feedback
- Auto-plays on appear

---

## Transition Effects

Use these for navigation and state changes:

```swift
// Slide from bottom with fade
.transition(.slideFromBottom)

// Slide from trailing with fade
.transition(.slideFromTrailing)

// Scale with fade (cards, modals)
.transition(.scaleWithFade)

// Blur with fade
.transition(.blurWithFade)
```

### Example

```swift
if showModal {
    ModalView()
        .transition(.scaleWithFade)
}
```

---

## Common Patterns

### 1. Dashboard Stats Grid

```swift
LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
    AnimatedStatsCard(
        title: "Active Tasks",
        value: activeTasks,
        icon: "checkmark.circle",
        color: .blue
    )
    .slideInEffect(delay: 0)

    AnimatedStatsCard(
        title: "Completed",
        value: completedTasks,
        icon: "checkmark.circle.fill",
        color: .green
    )
    .slideInEffect(delay: 0.1)
}
```

### 2. Interactive Task List

```swift
List {
    ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
        HStack {
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
        .listItemAnimation(index: index)
        .pressEffect()
        .onTapGesture {
            HapticManager.shared.light()
            // Navigate to detail
        }
    }
}
```

### 3. Task Completion Feedback

```swift
struct TaskDetailView: View {
    @State private var showSuccess = false

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

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation(NexusAnimations.smooth) {
                showSuccess = false
            }
        }
    }
}
```

### 4. Loading State

```swift
struct ProjectDetailView: View {
    @State private var isLoading = true

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
```

### 5. Decision Approval Flow

```swift
struct DecisionCardView: View {
    let decision: PlanNode
    @State private var showFeedback = false
    @State private var approved = false

    var body: some View {
        VStack {
            // Decision content...

            HStack {
                Button("Reject") {
                    HapticManager.shared.warning()
                    handleReject()
                }
                .buttonStyle(NexusSecondaryButtonStyle())
                .pressEffect()

                Button("Approve") {
                    approved = true
                    HapticManager.shared.success()
                    handleApprove()
                }
                .buttonStyle(NexusPrimaryButtonStyle())
                .pressEffect()
            }

            if showFeedback {
                if approved {
                    AnimatedCheckmark()
                        .transition(.scaleWithFade)
                } else {
                    AnimatedErrorIndicator()
                        .transition(.scaleWithFade)
                }
            }
        }
    }

    private func handleApprove() {
        withAnimation(NexusAnimations.smooth) {
            showFeedback = true
        }
        // Submit approval...
    }

    private func handleReject() {
        withAnimation(NexusAnimations.smooth) {
            showFeedback = true
        }
        // Submit rejection...
    }
}
```

### 6. Project Card with Health Indicator

```swift
struct ProjectCard: View {
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(project.icon)
                    .font(.title3)

                Spacer()

                AnimatedHealthIndicator(health: project.health ?? .onTrack)
            }

            Text(project.name)
                .font(.headline)

            if let progress = project.progress {
                AnimatedProgressBar(
                    value: Double(progress) / 100.0,
                    color: NexusTheme.Colors.primary,
                    height: 6
                )
            }
        }
        .padding()
        .background(NexusTheme.Colors.surface)
        .cornerRadius(NexusTheme.CornerRadius.md)
        .pressEffect()
    }
}
```

---

## Best Practices

### 1. Choose the Right Animation

- **Bouncy**: Buttons, cards, interactive elements
- **Smooth**: General UI transitions, navigation
- **Snappy**: Quick feedback, toggles
- **Gentle**: Subtle background changes

### 2. Haptic Feedback Guidelines

- **Light**: Frequent actions (scrolling, selection)
- **Medium**: Standard buttons, card taps
- **Heavy**: Important completions, confirmations
- **Success/Warning/Error**: Match with visual feedback

### 3. Performance Tips

- Use `.animation()` modifier with specific values instead of implicit animations
- Avoid animating expensive layouts
- Limit simultaneous animations
- Use `.drawingGroup()` for complex animations

### 4. Accessibility

- Respect `UIAccessibility.isReduceMotionEnabled`
- Provide non-animated alternatives when needed
- Don't rely solely on animation for important feedback

### 5. Consistency

- Use animation presets instead of custom durations
- Follow existing patterns in the codebase
- Match animation timing with haptic feedback

---

## Testing

Use `AnimationExamplesView` to preview all animations:

```swift
// In development builds, add to navigation
NavigationLink("Animation Examples") {
    AnimationExamplesView()
}
```

This view demonstrates:
- All status indicators
- Stats cards with count-up
- Progress bars
- Press effects
- Feedback animations
- Shimmer loading
- Health indicators
- List animations
- Haptic feedback

---

## Migration Guide

### Updating Existing Components

#### Before (Basic Animation)

```swift
Button("Submit") {
    // Action
}
.scaleEffect(isPressed ? 0.98 : 1.0)
.opacity(isPressed ? 0.8 : 1.0)
```

#### After (Press Effect)

```swift
Button("Submit") {
    // Action
}
.pressEffect() // Adds scale, opacity, and haptic
```

#### Before (Status Indicator)

```swift
NexusStatusIndicator(status: task.status)
```

#### After (Animated Status)

```swift
AnimatedStatusIndicator(status: task.status)
// Adds pulsing for active states
```

#### Before (Progress Bar)

```swift
ProgressView(value: Double(progress), total: 100)
```

#### After (Animated Progress)

```swift
AnimatedProgressBar(
    value: Double(progress) / 100.0,
    color: .blue
)
// Adds smooth fill animation
```

---

## Additional Resources

- **NexusAnimations.swift**: Full implementation
- **AnimationExamples.swift**: Interactive demo view
- **NexusTheme.swift**: Design system integration

For questions or suggestions, see the iOS team documentation.
