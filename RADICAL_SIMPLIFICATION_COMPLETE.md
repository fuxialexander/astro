# Radical UI Simplification - Complete ✅

## What Changed

### 1. **Tasks-First Experience**
- **Old**: Dashboard → Projects → Project → Plan → Tasks
- **New**: Tasks (immediately) → Projects (secondary)

### 2. **Default Route Changed**
- **Old**: `/` → Dashboard
- **New**: `/` → Tasks (My Tasks page)
- Dashboard moved to `/dashboard` (still accessible but not default)

### 3. **Quick Start Flow**
- **Old**: Welcome → Setup → `/project/{id}/plan?view=list`
- **New**: Welcome → Setup → `/tasks` (cross-project task list)

Users now see ALL their tasks immediately after setup, not isolated to one project.

### 4. **Simplified Navigation**
- **Desktop Sidebar** (reduced from 6 to 3 items):
  - ✅ Tasks (default home)
  - ✅ Projects (contexts/filters)
  - ✅ Environments
  - ❌ Removed: Pulse/Dashboard, My Tasks (redundant), Initiatives, Agents

- **Mobile Bottom Bar** (same 3 items):
  - Tasks | Projects | Search | Environments

### 5. **Tasks Page Improvements**
- **Title**: "My Tasks" → "Tasks" (simpler)
- **View toggles**: Hidden when 0 tasks (progressive disclosure)
- **Empty state**: More actionable
  - No projects: "Create Project" button
  - Has projects: "View Projects" to add tasks
- **Display settings**: Hidden when 0 tasks

### 6. **Projects Become Contexts**
Projects are now filtering mechanisms, not destinations:
- Click a project → filters task list to show that project's tasks
- `/project/:id/plan` still exists for power users
- But the primary interface is the cross-project task list

## User Flow Now

### First-Time User:
1. Welcome page → Set up project (repo/dir)
2. Land directly on `/tasks` (cross-project task list)
3. See empty state: "Create Project" or "View Projects"
4. Can immediately add tasks to any project
5. Simple, flat hierarchy

### Returning User:
1. Open Nexus → See `/tasks` immediately
2. All tasks from all projects in one view
3. Can filter by project, status, priority
4. View modes (list/timeline/board) available when tasks exist
5. Projects in sidebar for context/filtering

## What's Still Available (But Hidden)

- **Graph view**: Available in `/project/:id/plan`
- **Timeline/Board**: Available when tasks exist
- **Dashboard**: Available at `/dashboard`
- **Project details**: Available at `/project/:id`

## What's Next (Future Enhancements)

1. **Quick task creation**: Add "+ New Task" button at top of Tasks page
2. **Inline task creation**: Add task directly from list view
3. **Project as metadata**: Show project badge on each task (not a destination)
4. **Progressive disclosure**:
   - Reveal Graph/Timeline views when user has 10+ tasks
   - Show "Power user mode" toggle for advanced features
5. **AI integration**: "Generate tasks with AI" as secondary action

## File Changes

### Routing (`src/app.tsx`):
- Changed `index` route from `Dashboard` to `MyTasks`
- Moved Dashboard to `/dashboard` route

### Welcome Flow (`src/pages/welcome.tsx`):
- Changed all `navigate(/project/{id}/plan?view=list)` → `navigate(/tasks)`

### Sidebar (`src/components/layout/sidebar.tsx`):
- Simplified `navItems` from 6 to 3
- Updated icons and labels
- Removed unused imports

### Mobile Nav (`src/components/layout/mobile-layout.tsx`):
- Updated tabs to match simplified sidebar
- Consistent 3-item navigation

### Tasks Page (`src/pages/my-tasks.tsx`):
- Title: "My Tasks" → "Tasks"
- Hide view toggles when 0 tasks
- Hide display settings when 0 tasks
- Improved empty state messaging
- Better CTAs for new users

## Benefits

✅ **Simpler mental model**: Tasks, not projects, are primary
✅ **Faster onboarding**: See value immediately
✅ **Less decision paralysis**: One clear path
✅ **Progressive disclosure**: Complexity revealed when needed
✅ **Cross-project view**: See all work in one place
✅ **Repo is just metadata**: Associated with tasks, not a destination

## Try It Out

```bash
npm run dev
```

1. Go to `/welcome` (or it will auto-redirect if no projects)
2. Create a project with quick start
3. You'll land on `/tasks` immediately
4. Clean, simple task list interface
5. Projects in sidebar for filtering/context

The transformation is complete! 🎉
