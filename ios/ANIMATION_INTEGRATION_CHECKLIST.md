# Animation System Integration Checklist

Quick reference for integrating the new animation system into existing iOS views.

## ✅ Completed

- [x] Core animation system (`NexusAnimations.swift`)
- [x] Animated components (status, stats, progress, health indicators)
- [x] Haptic feedback manager
- [x] View modifiers (press, slide, reveal, shimmer)
- [x] Transition effects
- [x] Example view (`AnimationExamples.swift`)
- [x] Documentation (`ANIMATION_GUIDE.md`)

## 📋 Integration Tasks

### High Priority (Recommended)

- [ ] **DashboardView.swift**
  - [ ] Replace `NexusStatsCard` with `AnimatedStatsCard` in `StatsGridView`
  - [ ] Add `.slideInEffect()` to stats cards with staggered delays
  - [ ] Add `.pressEffect()` to `ActiveProjectRow`
  - [ ] Add haptic feedback on navigation

- [ ] **ProjectListView.swift**
  - [ ] Add `.listItemAnimation(index:)` to project rows
  - [ ] Add `.pressEffect()` to `ProjectRow`
  - [ ] Add haptic feedback on row tap
  - [ ] Use `AnimatedHealthIndicator` in `HealthBadge`

- [ ] **TaskDetailView.swift**
  - [ ] Replace status indicator with `AnimatedStatusIndicator`
  - [ ] Add `AnimatedProgressBar` for execution progress
  - [ ] Show `AnimatedCheckmark` on task completion
  - [ ] Add haptic feedback for all actions

- [ ] **DecisionCarousel.swift**
  - [ ] Add `.pressEffect()` to decision cards
  - [ ] Add success haptic on approve
  - [ ] Add warning haptic on reject
  - [ ] Animate card transitions

### Medium Priority

- [ ] **MyTasksView.swift**
  - [ ] Add `.listItemAnimation(index:)` to task list
  - [ ] Use `AnimatedStatusIndicator` for task status
  - [ ] Add `.shimmer()` for loading states
  - [ ] Add `.pressEffect()` to task rows

- [ ] **ProjectDetailView.swift**
  - [ ] Use `AnimatedHealthIndicator` for project health
  - [ ] Add `AnimatedProgressBar` for project progress
  - [ ] Add `.shimmer()` to loading skeletons
  - [ ] Animate tab transitions

- [ ] **NewProjectView.swift**
  - [ ] Add `.pressEffect()` to form buttons
  - [ ] Add haptic feedback on submit
  - [ ] Show `AnimatedCheckmark` on successful creation
  - [ ] Add `.slideInEffect()` to form sections

### Low Priority (Nice to Have)

- [ ] **EnvironmentsView.swift**
  - [ ] Add `.listItemAnimation(index:)` to machine list
  - [ ] Add status pulse animations
  - [ ] Add haptic on connection/disconnection

- [ ] **SettingsView.swift**
  - [ ] Add `.pressEffect()` to toggle rows
  - [ ] Add selection haptic on picker changes

## 🎯 Quick Wins (< 5 minutes each)

### 1. Stats Cards (Dashboard)
```swift
// In StatsGridView
AnimatedStatsCard(
    title: "Active Tasks",
    value: activeTasksCount,
    icon: "checkmark.circle",
    color: .blue
)
.slideInEffect(delay: 0)
```

### 2. Press Effects
```swift
// Add to any NavigationLink or Button
.pressEffect()
```

### 3. List Animations
```swift
// In any List/ForEach
ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
    ItemRow(item: item)
        .listItemAnimation(index: index)
}
```

### 4. Status Indicators
```swift
// Replace NexusStatusIndicator
AnimatedStatusIndicator(status: task.status)
```

### 5. Progress Bars
```swift
// Replace ProgressView
AnimatedProgressBar(
    value: Double(progress) / 100.0,
    color: .blue
)
```

## 🧪 Testing Checklist

After integrating animations:

- [ ] Visual Review
  - [ ] Animations play smoothly (60 fps)
  - [ ] Timing feels natural
  - [ ] No visual glitches or jank
  - [ ] Transitions are fluid

- [ ] Haptic Testing (on device)
  - [ ] Haptics fire at correct times
  - [ ] Intensity feels appropriate
  - [ ] No double-firing
  - [ ] Works on all devices

- [ ] Performance
  - [ ] No frame drops during animations
  - [ ] Scrolling remains smooth
  - [ ] Memory usage stable
  - [ ] Battery impact minimal

- [ ] Accessibility
  - [ ] Reduce Motion respected
  - [ ] VoiceOver compatible
  - [ ] High Contrast mode works
  - [ ] Haptics remain for tactile cues

## 📝 Implementation Notes

### Common Patterns

**Dashboard Stats:**
```swift
LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())]) {
    ForEach(Array(stats.enumerated()), id: \.offset) { index, stat in
        AnimatedStatsCard(
            title: stat.title,
            value: stat.value,
            icon: stat.icon,
            color: stat.color
        )
        .slideInEffect(delay: Double(index) * 0.1)
    }
}
```

**Interactive List:**
```swift
List {
    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
        ItemRow(item: item)
            .listItemAnimation(index: index)
            .pressEffect()
            .onTapGesture {
                HapticManager.shared.light()
                // Navigate
            }
    }
}
```

**Loading State:**
```swift
@State private var isLoading = true

var body: some View {
    if isLoading {
        SkeletonView()
            .shimmer(active: true)
    } else {
        ContentView()
            .transition(.slideFromBottom)
    }
}
```

**Success Feedback:**
```swift
@State private var showSuccess = false

Button("Complete") {
    completeTask()
}

if showSuccess {
    AnimatedCheckmark()
        .transition(.scaleWithFade)
}

func completeTask() {
    // Task logic...
    withAnimation(NexusAnimations.smooth) {
        showSuccess = true
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        withAnimation(NexusAnimations.smooth) {
            showSuccess = false
        }
    }
}
```

## 🚀 Deployment

### Before Merging
1. Review all animations in `AnimationExamplesView`
2. Test on device (not just simulator)
3. Verify haptics work correctly
4. Check Reduce Motion compatibility
5. Run performance profiler

### After Merging
1. Monitor crash reports
2. Check battery usage metrics
3. Gather user feedback
4. Iterate on timing if needed

## 📚 Resources

- **Main Implementation**: `ios/NexusApp/Theme/NexusAnimations.swift`
- **Examples**: `ios/NexusApp/Theme/AnimationExamples.swift`
- **Full Guide**: `ios/ANIMATION_GUIDE.md`
- **Summary**: `ios/IOS_ANIMATION_SYSTEM.md`

---

**Last Updated**: 2026-02-15
**Status**: Ready for integration
