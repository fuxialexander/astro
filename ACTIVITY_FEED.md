# Activity Feed Implementation

## Overview
Implemented a functioning recent activity feed for the project overview page that tracks and displays project-level events in real-time.

## Changes Made

### 1. Activity Store (`src/stores/activity-store.ts`)
- **New store** for managing activity events
- Tracks 13 activity types:
  - Task events: `task.created`, `task.started`, `task.completed`, `task.failed`, `task.cancelled`
  - Project events: `project.created`, `project.updated`, `plan.refined`
  - Milestone events: `milestone.created`, `milestone.updated`, `milestone.deleted`
  - Resource events: `vision.updated`, `repo.configured`
- Features:
  - IndexedDB persistence
  - Keeps last 1000 activities
  - Project-filtered queries
  - Auto-cleanup for deleted projects

### 2. Activity Dialog (`src/components/activity-dialog.tsx`)
- **New component** for viewing full activity history
- Features:
  - Filter by activity type (All, Tasks, Project, Milestones, Resources)
  - Shows up to 100 recent activities
  - Color-coded icons per activity type
  - Relative timestamps ("2h ago", "3d ago")
  - Responsive design with overflow scrolling

### 3. Project Overview Updates (`src/pages/project-overview.tsx`)
- Replaced hardcoded activity items with real data from activity store
- Added "View all" dialog functionality
- Integrated activity tracking for:
  - Milestone creation/updates/deletion
  - Vision document updates (via `VisionDocDialog`)
  - Repository configuration (via `RepoConfigDialog`)
- Shows last 3 activities with proper icons and timestamps
- Empty state when no activity exists

### 4. Date Utilities (`src/lib/date-utils.ts`)
- Enhanced `formatRelativeTime()` to support:
  - Days: "3d ago"
  - Weeks: "2w ago"
  - Months: "5mo ago"
  - Years: "1y ago"

### 5. App Loader (`src/app.tsx`)
- Integrated activity store into DataLoader
- Loads activities on app startup alongside other stores

### 6. Component Integration
- **VisionDocDialog** (`src/components/vision-doc-dialog.tsx`)
  - Tracks when vision document is updated
  - Includes excerpt in activity description

- **RepoConfigDialog** (`src/components/repo-config-dialog.tsx`)
  - Tracks when repository or working directory is configured
  - Shows configured path in activity description

## Activity Tracking Coverage

### ✅ Currently Tracked
- Milestone creation, updates, deletion
- Vision document updates
- Repository/directory configuration

### 🔄 Future Integration Points
To make the feed fully comprehensive, integrate activity tracking in:

1. **Task Execution Events** (`src/stores/execution-store.ts`)
   - Add activity when tasks start/complete/fail/cancel
   - Hook into execution result events

2. **Plan Refinement** (`src/pages/plan-view.tsx`)
   - Track when AI refines the plan
   - Hook into chat panel submissions

3. **Project Updates** (`src/stores/project-store.ts`)
   - Track project creation
   - Track project property updates (description, status, dates)

4. **Task Creation** (`src/components/task-creation-form.tsx`)
   - Track when new tasks are added to the plan

## Usage

```typescript
// In any component
import { useActivityStore } from "@/stores/activity-store"

// Add an activity
const addActivity = useActivityStore((s) => s.addActivity)
addActivity({
  projectId: project.id,
  type: "milestone.created",
  title: "Created milestone: MVP Launch",
  description: "Complete core features for initial release",
  nodeId: milestoneId, // optional
})

// Get recent activities
const recentActivities = useActivityStore((s) =>
  s.getProjectActivities(projectId, 5)
)
```

## Design Decisions

1. **IndexedDB Storage**: Activities persist locally for offline access
2. **Ring Buffer**: Keep last 1000 activities to prevent unbounded growth
3. **Project-Scoped**: All activities tied to specific projects
4. **Relative Timestamps**: More intuitive than absolute dates
5. **Type Safety**: Strict ActivityType enum prevents invalid events
6. **Lightweight**: No external dependencies beyond idb-keyval

## Next Steps

To complete the activity feed:
1. Integrate execution event tracking (task.started, task.completed, etc.)
2. Add plan refinement tracking
3. Add project creation/update tracking
4. Consider adding user attribution (userId field)
5. Add activity filtering by date range
6. Consider real-time sync across tabs using BroadcastChannel
