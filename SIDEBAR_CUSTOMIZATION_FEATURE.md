# Sidebar Customization Feature ✅

## Overview
Users can now customize their sidebar navigation by reordering items and showing/hiding optional sections.

## How It Works

### Entering Edit Mode
**Long press** (500ms) anywhere on the navigation section to enter edit mode.
- Desktop: Click and hold
- Mobile: Touch and hold

### Edit Mode Features

1. **Drag to Reorder** 🔄
   - Grab items by the grip handle (⋮⋮)
   - Drag and drop to reorder
   - Changes save automatically

2. **Show/Hide Items** 👁️
   - **Visible items**: Red badge with minus (-) to hide
   - **Hidden items**: Greyed out with green badge and plus (+) to show
   - Click badge to toggle visibility

3. **Protected Items** 🔒
   - **Tasks**: Cannot be removed (core feature)
   - **Environments**: Cannot be removed (core feature)
   - Protected items don't show +/- badges

4. **Done Button** ✓
   - Click "Done" to exit edit mode
   - All changes are persisted to IndexedDB

## Available Items

### Default (Visible):
- ✅ **Tasks** (protected) - Your main task list
- ✅ **Projects** - Project management
- ✅ **Environments** (protected) - Machine/environment management

### Optional (Hidden by default):
- **Dashboard** - Overview stats and metrics
- **Initiatives** - Strategic groupings
- **Agents** - Agent management

## Technical Details

### Store: `src/stores/sidebar-store.ts`
- Manages sidebar items configuration
- Persists to IndexedDB
- Loads on app startup

### Component: `src/components/layout/sidebar.tsx`
- Long press detection (500ms)
- HTML5 drag-and-drop
- Visual edit mode UI

### Data Structure:
```typescript
interface SidebarItem {
  id: string          // Unique identifier
  to: string          // Route path
  icon: string        // Icon name (from lucide-react)
  label: string       // Display label
  visible: boolean    // Show/hide state
  protected: boolean  // Cannot be removed
}
```

## User Experience

### Normal Mode
- Clean, simple navigation
- Only visible items shown
- Click to navigate

### Edit Mode
- All items shown (visible + hidden)
- Hidden items greyed out (40% opacity)
- Dashed borders around items
- Grip handles for dragging
- +/- badges for visibility toggle
- "Done" button to exit

## Example Use Cases

1. **Minimalist User**:
   - Hide: Dashboard, Initiatives, Agents
   - Show: Tasks, Projects, Environments
   - Result: Ultra-clean 3-item sidebar

2. **Power User**:
   - Show: Everything
   - Reorder: Tasks → Dashboard → Projects → Agents → Initiatives → Environments
   - Result: Full-featured navigation

3. **Project Manager**:
   - Show: Tasks, Projects, Initiatives
   - Hide: Dashboard, Agents, Environments
   - Result: Focus on planning and execution

## Future Enhancements

- [ ] Add more optional items (Settings, Search, etc.)
- [ ] Custom item names
- [ ] Import/export sidebar configurations
- [ ] Keyboard shortcuts for edit mode (Cmd+E)
- [ ] Undo/redo for customization
- [ ] Reset to default button in edit mode
- [ ] Visual feedback for drag (shadow, highlight)
- [ ] Touch gestures (swipe to hide/show)

## Testing

Try it out:
```bash
npm run dev
```

1. Navigate to the sidebar
2. Long press on the navigation area
3. See edit mode activate
4. Drag items to reorder
5. Click +/- badges to show/hide
6. Click "Done" to save
7. Refresh page - your changes persist!
