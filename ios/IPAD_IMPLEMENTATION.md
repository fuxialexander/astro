# iPad Layout Implementation

This document describes the iPad-optimized layout system for Nexus iOS app.

## Overview

The iPad implementation provides adaptive layouts that take full advantage of the larger screen size, featuring:
- **Three-column layouts** (sidebar + main + inspector)
- **Adaptive grid layouts** (2-column, 3-column based on size class)
- **Split view containers** with detail panels
- **Size class-aware components** that adapt between iPhone and iPad

## Architecture

### Size Class Detection

```swift
enum DeviceSizeClass {
    case iPhone          // iPhone or iPad split view (narrow)
    case iPadCompact     // iPad portrait or split view
    case iPadRegular     // iPad landscape (full width)
}
```

The system automatically detects the current size class using `horizontalSizeClass` and adapts layouts accordingly.

### Core Layout Components

#### 1. **ThreeColumnLayout**
Used for: Plan Graph, Agents, Environments
- Fixed-width sidebar (260pt)
- Flexible main content area
- Optional inspector panel (320-340pt)

```swift
ThreeColumnLayout(
    sidebar: { SidebarView() },
    content: { MainContentView() },
    inspector: { InspectorPanel() }
)
```

#### 2. **TwoColumnLayout**
Used for: Project List, Task List with detail
- Fixed-width sidebar or list (configurable)
- Flexible detail area

```swift
TwoColumnLayout(
    sidebar: { ProjectListView() },
    content: { ProjectDetailView() }
)
```

#### 3. **SplitViewContainer**
Master-detail pattern with optional resizable divider:

```swift
SplitViewContainer(
    defaultMasterWidth: 340,
    master: { MasterListView() },
    detail: { DetailView() }
)
```

#### 4. **AdaptiveGridContainer**
Responsive grid that adapts column count:
- iPhone: 1 column
- iPad Compact: 2 columns
- iPad Regular: 2-3 columns (configurable)

```swift
AdaptiveGridContainer(
    items: projects,
    sizeClass: sizeClass,
    columnCount: 2,
    itemBuilder: { ProjectCard($0) }
)
```

### Layout Constants

```swift
// Sidebar & panel widths
iPadLayout.sidebarWidth           // 260pt
iPadLayout.inspectorWidth         // 320pt
iPadLayout.inspectorWidthWide     // 340pt
iPadLayout.agentListWidth         // 340pt

// Toolbar heights
iPadLayout.toolbarHeight          // 52pt
iPadLayout.toolbarHeightLarge     // 56pt

// Grid columns
iPadLayout.gridColumns2           // 2-column grid
iPadLayout.gridColumns3           // 3-column grid
iPadLayout.adaptiveGridColumns()  // Auto-selects based on size class
```

## iPad-Optimized Views

### 1. **DashboardViewiPad**
Location: `ios/NexusApp/Views/Dashboard/DashboardViewiPad.swift`

Features:
- Multi-column stats grid (2-3 columns)
- Expanded decision carousel
- Project grid layout (2 columns)
- System health card with expanded metrics

Adaptive behavior:
- iPad Regular: 3-column stats + 6 stats cards
- iPad Compact: 2-column stats + 3 stats cards
- iPhone: Falls back to standard DashboardView

### 2. **ProjectListViewiPad**
Location: `ios/NexusApp/Views/Projects/ProjectListViewiPad.swift`

Features:
- Project grid (2 columns)
- Right-side detail panel (340pt)
- Project stats and plan summary in panel
- Quick actions (View Project, View Plan)

Layout:
- Main area: Project grid with search/filter toolbar
- Inspector: Project details with stats, progress, plan summary

### 3. **MyTasksViewiPad**
Location: `ios/NexusApp/Views/Tasks/MyTasksViewiPad.swift`

Features:
- Task list with search and filtering
- Right-side task detail panel (340pt)
- Status filter menu
- Metadata display in detail panel

Layout:
- Main area: Scrollable task list with search bar
- Inspector: Task details with output, metadata, actions

### 4. **PlanGraphViewiPad**
Location: `ios/NexusApp/Views/Projects/PlanViews/PlanGraphViewiPad.swift`

Status: Placeholder (uses ProjectDetailView)
Future implementation will use ThreeColumnLayout:
- Sidebar: Navigation + projects
- Main: Graph canvas with zoom/pan
- Inspector: Node detail editor

### 5. **EnvironmentsViewiPad**
Location: `ios/NexusApp/Views/Environments/EnvironmentsViewiPad.swift`

Status: Already implemented ✓
Features:
- Machine list with search
- Right-side detail panel
- Device code authentication flow

### 6. **AgentsViewiPad**
Location: `ios/NexusApp/Views/Tasks/AgentsViewiPad.swift`

Status: Placeholder (uses AgentsView)
Future implementation will use ThreeColumnLayout:
- Sidebar: Navigation
- List: Agent sessions (340pt)
- Detail: Execution output + tools

## Theme Integration

All iPad layouts use the existing `AdaptiveTheme.swift` system:
- `AdaptiveColors` for light/dark mode
- `NexusTheme` constants for spacing, typography
- `.adaptiveCard()` modifier for consistent card styling

## View Extensions

```swift
// Adaptive layout selection
.adaptiveLayout(horizontalSizeClass,
    iPhone: { iPhoneView() },
    iPad: { iPadView() }
)

// Adaptive padding based on size class
.adaptivePadding(sizeClass)

// Adaptive grid spacing
.adaptiveGridSpacing(sizeClass)
```

## Drag and Drop Support (Preparation)

The `iPadLayouts.swift` file includes drag and drop infrastructure:

```swift
// Make a plan node draggable
.draggableNode(node)

// Make a view accept dropped nodes
.dropTarget { node in
    // Handle drop
}
```

This is prepared for future implementation but not yet active.

## Design Reference

iPad designs are documented in `ios.pen`:
- **iPad — Plan Graph**: Three-column with canvas
- **iPad — Agents**: Three-column with agent list + execution detail
- **iPad — Environments**: Two-column with machine list + detail
- **iPad — Plan List**: Three-column with list + inspector
- **iPad — Plan Timeline V2**: Three-column with timeline + inspector

All designs include both light and dark mode variants.

## Usage Patterns

### Basic Three-Column Layout

```swift
struct MyViewiPad: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selectedItem: Item?

    var body: some View {
        ThreeColumnLayout(
            sidebar: {
                // Fixed sidebar (260pt)
                NavigationSidebar()
            },
            content: {
                // Main content (flexible)
                MainContentArea()
            },
            inspector: {
                // Conditional inspector (320pt)
                if let item = selectedItem {
                    InspectorPanel(
                        title: "Details",
                        onClose: { selectedItem = nil }
                    ) {
                        DetailContent(item: item)
                    }
                }
            }
        )
    }
}
```

### Adaptive Grid

```swift
struct GridViewiPad: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var sizeClass: DeviceSizeClass {
        DeviceSizeClass.current(horizontalSizeClass)
    }

    var body: some View {
        ScrollView {
            LazyVGrid(
                columns: iPadLayout.adaptiveGridColumns(sizeClass, columnCount: 2),
                spacing: 16
            ) {
                ForEach(items) { item in
                    ItemCard(item)
                }
            }
            .adaptivePadding(sizeClass)
        }
    }
}
```

### Inspector Panel

```swift
InspectorPanel(
    title: "Task Details",
    onClose: { selectedNode = nil }
) {
    // Panel content
    VStack(alignment: .leading, spacing: 24) {
        DetailSection1()
        Divider()
        DetailSection2()
        Divider()
        ActionButtons()
    }
}
.frame(width: iPadLayout.inspectorWidthWide)
.transition(.move(edge: .trailing))
```

## Files Created

1. **Theme/iPadLayouts.swift** (561 lines)
   - Core layout components
   - Size class detection
   - Layout containers
   - View extensions
   - Drag and drop preparation

2. **Views/Dashboard/DashboardViewiPad.swift** (467 lines)
   - Multi-column stats grid
   - Decision carousel
   - Project grid
   - System health expanded

3. **Views/Projects/ProjectListViewiPad.swift** (393 lines)
   - Project grid with detail panel
   - Project detail panel with stats
   - Quick actions

4. **Views/Tasks/MyTasksViewiPad.swift** (525 lines)
   - Task list with filtering
   - Task detail panel
   - Search and status filters
   - Metadata display

**Total: 4 new files, ~1,946 lines of code**

## Integration with Existing App

The iPad views are designed to work alongside existing views:

1. **Conditional rendering**: Use `.adaptiveLayout()` to show iPad views on larger devices
2. **Shared stores**: All views use existing Zustand-style stores (ProjectStore, PlanStore, etc.)
3. **Consistent theming**: Uses AdaptiveTheme and NexusTheme
4. **Navigation**: Compatible with NavigationStack and NavigationLink

Example integration:

```swift
struct ProjectListView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        Group {
            if DeviceSizeClass.current(horizontalSizeClass) == .iPhone {
                ProjectListViewiPhone()
            } else {
                ProjectListViewiPad()
            }
        }
    }
}
```

## Next Steps

1. **Implement remaining placeholders**:
   - PlanGraphViewiPad (graph canvas)
   - AgentsViewiPad (three-column agent execution)

2. **Add interactions**:
   - Resizable dividers for split views
   - Drag and drop for plan nodes
   - Keyboard shortcuts for iPad

3. **Testing**:
   - Test on iPad Air (10.9")
   - Test on iPad Pro (12.9")
   - Test split view multitasking
   - Test size class transitions

4. **Refinements**:
   - Add haptic feedback
   - Optimize scroll performance for large lists
   - Add iPad-specific gestures

## References

- ios.pen: iPad design screens (Plan Graph, Agents, Environments, Plan List, Timeline)
- AdaptiveTheme.swift: Color scheme and theming
- NexusTheme.swift: Typography and spacing constants
- NexusComponents.swift: Reusable UI components
