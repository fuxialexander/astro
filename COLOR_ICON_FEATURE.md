# Color & Icon Customization Feature

## Overview
This feature adds customizable color and icon fields to both Projects and Initiatives, allowing users to visually distinguish and personalize their work items.

## Changes Made

### 1. Database Schema
**File: `server/lib/db/schema.ts`**
- Added `color` (text, default: '#3b82f6') and `icon` (text, default: '📋') fields to `projects` table
- Added `icon` (text, default: '🎯') field to `initiatives` table (color already existed)

**Migration: `supabase/migrations/00000000000001_add_project_initiative_icons.sql`**
- Added columns to both tables with appropriate defaults
- Updates existing rows to have default values

### 2. TypeScript Types
**File: `src/types/index.ts`**
- Added `color?: string` and `icon?: string` to `Project` interface
- Added `icon?: string` to `Initiative` interface

### 3. Color & Icon Utilities
**File: `src/lib/color-icon-utils.ts`** (NEW)
- Defines 16-color palette for visual consistency
- Provides curated emoji sets for projects (30 icons) and initiatives (24 icons)
- Helper functions:
  - `getRandomColor()` - Returns a random color from the palette
  - `getRandomProjectIcon()` - Returns a random project icon
  - `getRandomInitiativeIcon()` - Returns a random initiative icon
  - `getDistinctColor(existingColors)` - Finds unused colors

### 4. UI Components
**File: `src/components/color-icon-picker.tsx`** (NEW)
- `ColorIconPicker` - Full picker component with separate icon and color selectors
- `ColorIconBadge` - Compact badge that displays icon and color, can be made editable
- Uses Radix UI Popover for selection interfaces
- Grid layouts for easy browsing (6 columns for icons, 8 for colors)

### 5. Project Creation
**File: `src/pages/project-new.tsx`**
- Imports `getRandomColor()` and `getRandomProjectIcon()`
- Assigns random color and icon when creating new projects

### 6. Initiative Management
**File: `src/pages/initiatives.tsx`**
- Imports color/icon utilities and `ColorIconPicker` component
- Creates new initiatives with random color and icon
- Replaced native HTML color picker with `ColorIconPicker` in the dialog
- Updated initiative cards to display emoji icon with color tint

### 7. Project Overview
**File: `src/pages/project-overview.tsx`**
- Imports `ColorIconBadge` component
- Replaces static Rocket icon in header with editable color/icon badge
- Enables inline editing of project color and icon

### 8. Projects List
**File: `src/pages/projects.tsx`**
- Updated "Name" column to display project icon (with color) instead of generic Folder icon
- Shows personalized icons for each project in the list view

### 9. API Routes
**File: `server/routes/data.ts`**
- **Projects POST**: Added `color` and `icon` to row creation with defaults
- **Projects PATCH**: Added `color` and `icon` to patch handler
- **Initiatives POST**: Added `icon` to row creation (color already existed)
- **Initiatives PATCH**: Added `icon` to patch handler

## Design Decisions

### Why Emojis?
- Native support across all platforms
- No external dependencies required
- Lightweight (no icon font downloads)
- Instantly recognizable
- Wide variety available

### Why Predefined Palettes?
- Ensures visual consistency across the app
- Prevents color clash issues
- Provides accessible color choices
- Easier to maintain than free-form color input
- Can be expanded in the future

### Default Values
- Projects: Blue (#3b82f6) + 📋 clipboard
- Initiatives: Blue (#3b82f6) + 🎯 target
- Random assignment on creation for variety
- Fallback to defaults if values missing

## User Experience

### Creating New Items
- Color and icon are automatically assigned from the curated sets
- Ensures immediate visual variety without user effort

### Editing Color/Icon
- **Projects**: Click the icon/color badge in the project header
- **Initiatives**: Use the appearance picker in the create/edit dialog
- Instant preview of changes
- Simple grid-based selection

### Visual Display
- **Project cards**: Icon shows with color tint next to name
- **Initiative cards**: Large emoji icon with color accent on left border
- **Lists**: Icon appears in name column for quick identification

## Testing

1. **Create a new project** - Should get random color and icon
2. **Edit project color** - Click badge in project overview header, select new color
3. **Edit project icon** - Click badge in project overview header, select new emoji
4. **Create initiative** - Should get random color and icon
5. **Edit initiative** - Open edit dialog, use appearance picker
6. **View projects list** - Icons should display consistently
7. **Migration** - Existing projects/initiatives get default values

## Future Enhancements

- Add more color options (currently 16 colors)
- Allow custom hex color input as fallback
- Support for custom image uploads
- Color themes/palettes per workspace
- Icon search functionality
- Favorite/recent icons
