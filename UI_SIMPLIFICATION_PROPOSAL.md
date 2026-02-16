# UI Simplification Proposal

## Problem
After quick start, users see too many options and complex UI when they just want a simple todo list with a repo.

## Option A: Incremental Simplification (Recommended)

### Changes:
1. **Remove view mode toggle initially**
   - Default to list view only
   - Hide Graph/Timeline/Board until user has 5+ tasks
   - Add to settings/command palette for power users

2. **Simplify empty state**
   - Primary action: "Add task" (large, clear button)
   - Secondary: Small "Generate with AI" link below
   - Remove the "Choose how to plan" framing

3. **Navigate to list view directly after quick start**
   - Already doing this: `/project/${id}/plan?view=list`
   - But hide complexity in that view

4. **Simplify project overview**
   - Remove or collapse: Milestones, Resources sections initially
   - Make plan preview optional (show only if tasks exist)
   - Focus on: Description + Task list + Add task button

5. **Better sidebar navigation**
   - Keep: Dashboard, Projects, My Tasks, Environments
   - Consider: "My Tasks" as the default landing (cross-project todo list)

## Option B: Radical Simplification

### Changes:
1. **New default route: `/tasks`**
   - Cross-project task list (like current "My Tasks" page)
   - Shows all tasks from all projects in one view
   - Each task shows which project/repo it belongs to

2. **Quick start → `/tasks` instead of project view**
   - User immediately sees their todo list
   - Can add tasks right away
   - Project/repo is just metadata (shown in sidebar/settings)

3. **Projects become "contexts" not destinations**
   - Projects page shows list of repos/contexts
   - Clicking a project filters the `/tasks` view
   - No separate project overview page initially

4. **Progressive disclosure**
   - Start simple: just tasks in a list
   - As user adds more tasks, offer: "Group by project?"
   - As complexity grows, reveal: Graph view, Milestones, etc.

## Recommendation: Start with Option A

Option A is less disruptive and preserves your current architecture:
- Keeps the project-centric model
- Just hides complexity initially
- Progressive disclosure as users need it

Option B is more aligned with "simple todo list" but requires:
- Routing changes
- Mental model shift (tasks-first vs project-first)
- More code changes

## Immediate Quick Wins (30 min)

1. **Hide view mode toggle when 0 tasks**
   ```tsx
   {projectNodes.length > 0 && (
     <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
       {/* Graph/List/Timeline/Board buttons */}
     </div>
   )}
   ```

2. **Simplify empty state**
   - Make "Add your first task" the primary, obvious action
   - Move "Generate with AI" to a small link or secondary button

3. **Remove plan preview from project overview when empty**
   - Only show the 400px plan preview if tasks exist
   - Otherwise show a simple "Add task" button

Want me to implement any of these changes?
