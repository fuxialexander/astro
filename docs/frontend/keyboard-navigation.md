# Keyboard Navigation System

## Overview

A global keyboard navigation system that enables users to navigate lists, tables, and graph nodes using arrow keys across all major views in the Astro application.

## Features

- **Arrow Key Navigation**: Up/Down (or j/k Vim-style) to move focus between items
- **Enter Activation**: Press Enter to activate/click the focused item
- **Escape Reset**: Press Escape to deactivate keyboard navigation
- **Visual Feedback**: Focused items get an elegant drop shadow highlight with smooth CSS transitions
- **Command Palette Integration**: Automatically disabled when command palette is open
- **Input Safety**: Disabled when typing in text inputs to prevent conflicts

## Architecture

### Core Components

1. **`keyboard-nav-store.ts`** (Zustand store)
   - Manages global keyboard navigation state
   - Tracks focused item ID and all navigable items
   - Provides actions for focus movement and item registration

2. **`use-keyboard-nav.ts`** (React hook)
   - Handles global keyboard event listeners
   - Integrates with command palette state
   - Calls onActivate callback when Enter is pressed
   - Supports custom enable/disable logic

### Integration Points

The keyboard navigation system is integrated into:

1. **ItemListView** (`src/components/views/item-list-view.tsx`)
   - All list-based views inherit keyboard navigation
   - Includes: Projects list, Tasks list, Plan list view

2. **ItemTimelineView** (`src/components/views/item-timeline-view.tsx`)
   - Timeline views get keyboard navigation on left column items
   - Includes: Project timeline, Tasks timeline, Plan timeline

3. **PlanCanvas** (`src/components/plan-graph/plan-canvas.tsx`)
   - Graph nodes are keyboard-navigable
   - Focus state synced with selected node

4. **TaskNode** (`src/components/plan-graph/task-node.tsx`)
   - Individual graph nodes show focus highlight

## Visual Design

### Highlight Style

Focused items receive:
- Drop shadow: `shadow-[0_0_0_2px_rgba(var(--primary),0.3)]` (list items)
- Drop shadow: `shadow-[0_0_0_3px_rgba(var(--primary),0.4)]` (graph nodes)
- Background tint: `bg-accent/20`
- Subtle scale: `scale-[1.005]` (list) or `scale-[1.05]` (nodes)
- Smooth transitions: `transition-all duration-200`

### Design Principles

- Uses CSS variables for theming (`var(--primary)`)
- Non-intrusive visual feedback
- Smooth animations via CSS transitions
- Maintains accessibility standards

## Usage

### For Developers

The system works automatically for views that use `ItemListView`, `ItemTimelineView`, or `PlanCanvas`. No additional code needed.

For custom views:

```tsx
import { useKeyboardNav } from "@/hooks/use-keyboard-nav"
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store"

function MyCustomView() {
  const setItems = useKeyboardNavStore((s) => s.setItems)
  const clear = useKeyboardNavStore((s) => s.clear)

  const { focusedId } = useKeyboardNav({
    onActivate: (id) => {
      // Handle Enter key on focused item
      handleItemClick(id)
    },
    enabled: true,
  })

  useEffect(() => {
    // Register navigable items
    const items = myItems.map(item => ({
      id: item.id,
      type: "task",
      element: itemRefs.current.get(item.id),
    }))
    setItems(items)
  }, [myItems])

  useEffect(() => {
    return () => clear() // Cleanup on unmount
  }, [])
}
```

### For Users

1. Navigate to any list view (Projects, Tasks, etc.)
2. Press `↓` or `j` to move focus down
3. Press `↑` or `k` to move focus up
4. Press `Enter` to activate the focused item
5. Press `Escape` to exit keyboard navigation mode

## Accessibility

- Follows standard keyboard navigation patterns
- Compatible with screen readers
- Disabled during text input to prevent conflicts
- Visual focus indicator meets WCAG contrast requirements

## Future Enhancements

Potential improvements:
- Home/End keys for first/last item
- Page Up/Down for jumping by page
- Type-ahead search (press letter to jump to item)
- Multi-select with Shift+arrows
- Custom key bindings configuration
