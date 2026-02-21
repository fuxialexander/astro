# Component Architecture

UI component organization and patterns.

## Directory Structure

See CLAUDE.md Project Structure section for complete component tree.

## Component Categories

### UI Primitives (`src/components/ui/`)
Shadcn/ui Radix primitives: button, input, badge, card, dialog, sheet, etc.

### Layout Components
- `app-layout.tsx` - Sidebar + Outlet wrapper
- `sidebar.tsx` - Navigation + user profile
- `header.tsx` - Reusable page header

### Specialized Components
- `task-creation-form.tsx` - Inline/popover/dialog task creation
- `display-popover.tsx` - Display settings (groupBy, orderBy, properties)
- `vision-doc-dialog.tsx` - Vision document editor

## Related Documentation
- [Page Structure](./page-structure.md)
- [State Management](./state-management.md)
