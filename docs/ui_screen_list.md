# Nexus UI Screens List

This document defines the complete set of UI screens for Nexus, a planning-first platform for builders and scientists. The screens are organized by functional area and informed by both the product vision and Linear's established UI patterns.

---

## 1. Global Navigation & Shell

### 1.1 App Shell
- **Sidebar** - Primary navigation with workspace switcher, main nav items, project list, and user profile
- **Header** - Page title, breadcrumbs, and contextual actions
- **Command Palette** (Cmd+K) - Universal search, navigation, and actions

### 1.2 Workspace Switcher
- Dropdown for switching between workspaces (future: team/lab contexts)

---

## 2. Home & Personal Views

### 2.1 Dashboard (Home)
**Path:** `/`
**Status:** Implemented (partial)

Primary landing page showing:
- Quick stats (pending decisions, active tasks, completed today)
- Pending decisions requiring attention (surfaced from Judgment Queue)
- Active projects with progress indicators
- Agent activity feed (real-time status of running agents)
- Quick actions (new project, view inbox)

### 2.2 My Tasks
**Path:** `/my-tasks`
**Status:** Not implemented

Personal task view inspired by Linear's "My Issues":
- **Tabs:**
  - Assigned - Tasks assigned to user
  - Created - Tasks user created
  - Subscribed - Tasks user is following
  - Activity - Recent changes on user's tasks
- **Focus grouping** - Automatic organization by urgency:
  - Urgent/blocking items first
  - In-progress tasks
  - Upcoming (next in dependency chain)
  - Backlog
  - Completed
- Filtering and sorting options

### 2.3 Inbox
**Path:** `/inbox`
**Status:** Not implemented

Notification and activity center:
- All notifications in chronological order
- Filter by type (decisions, updates, mentions, completions)
- Quick actions (mark read, snooze, dismiss)
- Snooze functionality with custom date/time
- Bulk actions on notifications
- Keyboard-first workflow support

---

## 3. Project Management

### 3.1 Projects List
**Path:** `/projects`
**Status:** Implemented (partial)

All projects view with multiple display modes:
- **List view** - Table with sortable columns (name, status, progress, dates, lead)
- **Board view** - Kanban by project status (planned, active, paused, completed)
- **Grid view** - Card-based visual overview
- Filtering by status, team, tags, date range
- Search within projects
- Quick project creation

### 3.2 New Project
**Path:** `/projects/new`
**Status:** Implemented

Project creation flow:
- Goal/vision description input (rich text)
- Project type selection (builder/scientist workflow)
- Timeline and constraints input
- AI plan generation trigger
- Generation overlay with streaming progress

### 3.3 Project Overview
**Path:** `/project/:id`
**Status:** Implemented (partial - needs overview tab)

Project detail hub with tabs:
- **Overview tab:**
  - Project summary and description (editable)
  - Key metrics (progress, velocity, completion estimate)
  - Health status indicator (on track / at risk / off track)
  - Project properties (status, lead, team, dates)
  - Recent activity
- **Resources section:**
  - Vision/context document (persistent, injected into agents)
  - External links
  - Attached files
- **Milestones section:**
  - Milestone list with progress
  - Target dates and status

### 3.4 Plan Graph View
**Path:** `/project/:id/graph` or `/project/:id`
**Status:** Implemented

Interactive plan visualization:
- Directed graph canvas (React Flow)
- Node types: milestone, task, decision point, branch
- Edge types: dependency, branch
- Status color coding (planned, dispatched, in_progress, auto_verified, awaiting_judgment, completed, pruned)
- Pan, zoom, fit-to-view controls
- Mini-map for large plans
- Click node to open detail panel

### 3.5 Plan Timeline (Gantt)
**Path:** `/project/:id/timeline`
**Status:** Implemented

Time-based plan visualization:
- Gantt chart with date-based bars
- Dependencies shown as connectors
- Click task to edit dates/details
- Drag to reschedule (future)
- Today marker
- Zoom levels (day, week, month)

### 3.6 Plan List View
**Path:** `/project/:id/list`
**Status:** Not implemented

Flat task list alternative to graph:
- Hierarchical list grouped by milestone/branch
- Inline status updates
- Bulk selection and actions
- Quick filters (status, assignee, date)

### 3.7 Project Updates
**Path:** `/project/:id/updates`
**Status:** Not implemented

Project update history and creation:
- Chronological update feed
- Create new update (rich text + health status)
- Auto-generated progress summaries
- Property change history
- Staleness indicators for overdue updates

---

## 4. Task Management

### 4.1 Task Detail Panel
**Component:** Slide-over panel
**Status:** Implemented (partial)

Individual task view:
- Task title and description
- Status with workflow actions
- Dependencies (blocks/blocked by)
- Environment assignment (local, HPC, cloud)
- Agent assignment and status
- Verification type (auto/manual)
- Activity log
- Comments and discussion

### 4.2 Task Creation Modal
**Component:** Modal dialog
**Status:** Not implemented

Quick task creation:
- Title and description
- Parent milestone/branch selection
- Dependency selection
- Environment selection
- Due date (optional)

---

## 5. Judgment & Decisions

### 5.1 Judgment Queue
**Path:** `/judgment`
**Status:** Implemented (UI only)

Queue of tasks requiring human judgment:
- Card-based decision interface
- Task preview/summary
- AI recommendation with reasoning
- Quick actions: approve, modify, reject, defer
- Result visualization (for scientists)
- Product preview (for builders)
- Batch decision mode

### 5.2 Strategic Decision Surface
**Path:** `/decisions` or embedded in project view
**Status:** Not implemented

Branch point decisions:
- Decision context (what's been learned)
- Branch comparison (effort, timeline, expected value)
- AI recommendation with reasoning
- Actions: choose branch, prune branch, explore both
- Impact visualization (downstream effects)

---

## 6. Agent & Environment Management

### 6.1 Agent Activity
**Path:** `/agents` or dashboard widget
**Status:** Not implemented (widget exists)

Real-time agent monitoring:
- Active agents list with status
- Task currently executing
- Environment/machine info
- Logs and output streaming
- Abort/pause controls
- History of completed tasks

### 6.2 Environments
**Path:** `/environments`
**Status:** Not implemented

Environment configuration:
- List of configured environments (local, HPC clusters, cloud)
- Connection status and health
- Add/edit environment modal
- Environment-specific settings (Slurm config, AWS credentials)
- Usage statistics

---

## 7. Chat & AI Interaction

### 7.1 Plan Refinement Chat
**Component:** Side panel
**Status:** Implemented

Conversational plan modification:
- Chat interface for plan refinement
- AI suggestions with apply actions
- Context-aware responses (knows current plan state)
- History of refinements

### 7.2 Task-Level Chat
**Component:** Within task detail
**Status:** Not implemented

Per-task AI assistance:
- Ask questions about task
- Get execution suggestions
- Review agent output with AI

---

## 8. Settings & Configuration

### 8.1 Settings
**Path:** `/settings`
**Status:** Implemented (partial)

Application settings:
- **Connection** - Backend URL, health check
- **Model** - AI model selection
- **Appearance** - Theme (light/dark/system)
- **Notifications** - Preferences
- **Keyboard shortcuts** - Customization

### 8.2 Profile
**Path:** `/profile`
**Status:** Not implemented

User profile:
- User info
- Domain/expertise (for planning personalization)
- Default preferences

---

## 9. Mobile-First Screens

### 9.1 Mobile Decision Cards
Lightweight judgment interface:
- Swipeable decision cards
- Summary + AI recommendation
- Quick approve/reject gestures
- Tap for details

### 9.2 Mobile Progress Pulse
Quick status overview:
- Tasks completed today
- Active branches
- Next decision pending
- Agent status summary

### 9.3 Mobile Notification Center
Push notification handling:
- Actionable notifications
- Quick responses
- Batch dismiss

---

## 10. Onboarding & Empty States

### 10.1 Welcome / First-Time Setup
**Path:** `/welcome`
**Status:** Not implemented

New user onboarding:
- Product introduction
- User type selection (builder/scientist)
- Domain/expertise input
- First project creation guide

### 10.2 Empty States
Contextual empty states for:
- No projects yet
- Empty inbox
- No pending decisions
- No active agents

---

## Screen Priority Matrix

| Screen | Priority | Vision Reference | Linear Pattern |
|--------|----------|------------------|----------------|
| Dashboard | P0 | Section 3.4 | - |
| Plan Graph View | P0 | Section 3.1, 3.4 | - |
| Judgment Queue | P0 | Section 3.3, 3.4 | - |
| My Tasks | P1 | Section 3.2 | My Issues |
| Inbox | P1 | Section 3.4 | Inbox |
| Project Overview | P1 | Section 3.4 | Project Overview |
| Agent Activity | P1 | Section 3.4 | - |
| Environments | P1 | Section 6 | - |
| Strategic Decisions | P1 | Section 3.3 | - |
| Project Updates | P2 | Section 3.4 | Initiative Updates |
| Plan List View | P2 | - | Issue List |
| Mobile Decision Cards | P2 | Section 3.5 | - |
| Profile | P3 | Section 5.1 | - |
| Welcome/Onboarding | P3 | - | - |

---

## Implementation Status Summary

| Category | Total Screens | Implemented | Partial | Not Started |
|----------|---------------|-------------|---------|-------------|
| Home & Personal | 3 | 1 | 0 | 2 |
| Project Management | 7 | 3 | 1 | 3 |
| Task Management | 2 | 1 | 0 | 1 |
| Judgment & Decisions | 2 | 1 | 0 | 1 |
| Agent & Environment | 2 | 0 | 1 | 1 |
| Chat & AI | 2 | 1 | 0 | 1 |
| Settings | 2 | 1 | 0 | 1 |
| Mobile | 3 | 0 | 0 | 3 |
| Onboarding | 2 | 0 | 0 | 2 |
| **Total** | **25** | **8** | **2** | **15** |

---

## Key UI Patterns to Adopt from Linear

1. **Keyboard-first navigation** - G+key for navigation, single keys for actions
2. **Command palette** - Universal search and action hub
3. **Focus grouping** - Automatic prioritization in task lists
4. **Progressive disclosure** - Summary first, expand for details
5. **Health indicators** - Visual status for projects (on track/at risk/off track)
6. **Update system** - Regular progress updates with auto-generated summaries
7. **Snooze and defer** - Temporal task management
8. **Bulk actions** - Multi-select with keyboard shortcuts
9. **Contextual menus** - Right-click for action discovery
10. **Staleness indicators** - Visual cues for overdue items

---

## Nexus-Specific UI Patterns

1. **Graph-first planning** - Directed graph as primary plan view (not flat lists)
2. **Branch pruning** - First-class operation with downstream impact visualization
3. **Tiered verification** - Visual distinction between auto-close and judgment tasks
4. **Decision cards** - Lightweight judgment interface for quick decisions
5. **Vision document** - Persistent, prominent context document
6. **Multi-environment status** - Real-time view across local/HPC/cloud
7. **AI recommendations** - Inline suggestions with apply actions
8. **Strategic decision surface** - Branch comparison and impact analysis
