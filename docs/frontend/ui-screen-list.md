# Astro UI Screens List

Complete set of UI screens for Astro, organized by functional area.

---

## 1. Global Navigation & Shell

### 1.1 App Shell
- **Sidebar** — Nav items: Dashboard, Projects, My Tasks, Environments, Agents, Initiatives, Workflows, Settings. User profile section. "Local Mode" badge when in local mode. Collapsible. Each item has `data-tour-id` attribute for guided tour.
- **Command Palette** (Cmd+K) — Universal search, navigation, theme toggle, project search
- **Product Tour** (driver.js) — First-run guided tour highlighting sidebar items. 5 steps in server mode, 4 in local mode (Community skipped). Fires once per browser via `localStorage`. Component: `src/components/product-tour.tsx`.

---

## 2. Home & Personal Views

### 2.1 Dashboard
**Path:** `/dashboard` (redirects to `/welcome` if no projects)

- Quick stats (pending decisions, active tasks, completed today)
- "My Attention" section — tasks awaiting judgment/approval with execution summaries, action buttons (Approve, Retry, Prune)
- Active projects with compact cards
- System health — connection status, token spend, active agents, recent events

### 2.2 My Tasks
**Path:** `/tasks`

Cross-project task list with three view modes:
- **List view** — Sortable columns, inline node inspector (sidebar on desktop, sheet on mobile)
- **Timeline view** — Gantt-like visualization with date ranges
- **Board view** — Kanban columns
- Filtering by status, project, priority
- Grouping (none/project/status/priority), sorting (updatedAt, name, priority, status, dueDate)
- Display settings via `DisplayPopover`
- Active tasks badge, "Needs Review" badge

---

## 3. Project Management

### 3.1 Projects List
**Path:** `/projects`

Three view modes:
- **All projects** — Table with sortable columns (name, status, progress, dates, lead), grouped by initiative or status
- **Timeline** — Gantt-like visualization with date ranges
- **Board** — Kanban with columns for health statuses (On track/At risk/Off track)
- Filter bar (Status, Health, Initiative, Team)
- Import, rename (inline), color/icon customization

### 3.2 New Project
**Path:** `/projects/new`

Three creation modes:
- **Choose** — Option selection (empty project or repo-based)
- **Empty** — Empty project with description
- **Repo** — Repository-based with GitHub integration for repo browsing
- Environment selection (Local/Remote/HPC/Cloud)
- Voice input for description
- Working directory configuration
- Server mode support with machine selection

### 3.3 Plan View (unified project page)
**Path:** `/project/:id` (sub-routes: `/graph`, `/list`, `/timeline`, `/board`, `/overview`)

Unified project page with four view modes:
- **Graph** — Directed graph canvas (React Flow) with node types, status color coding, pan/zoom, mini-map
- **List** — Columns (Name, Priority, Status, Due Date, Estimate, Milestone, Labels, PR, Project), inline creation, batch actions (Execute All, Delete)
- **Timeline** — Gantt chart with startDate/endDate, dependency connectors, today marker
- **Board** — Kanban columns (by status/priority/milestone)
- **Node detail panel** — Slide-over for editing task properties, viewing dependencies, managing execution
- **Chat panel** — Sidebar on desktop, bottom sheet on mobile for plan refinement with AI
- **Vision document dialog** — Persistent context document editor
- Export functionality
- Display settings with grouping/ordering/property visibility

### 3.4 Task Detail
**Path:** `/project/:id/task/:nodeId`

- **Header**: Task title, status badge, project/type info
- **Meta row**: Execution duration, progress bar, subroutine progress, execution ID, branch name, PR link
- **Approval card**: Shown when status is `awaiting_approval`
- **Judgment banner**: Execution summary or error display
- **Plan mode data**: Plan Todos, Plan Questions, action buttons (Approve, Retry, Prune)
- **Tabs**:
  - **Activity** — Unified activity view (UnifiedActivityView)
  - **Trace** — Tool call trace viewer (TraceViewer)
  - **Files** — File changes with diff display (FileChangesView)

---

## 4. Agent & Environment Management

### 4.1 Environments
**Path:** `/environments`

- **Stats cards**: Total Machines, Connected, Active Tasks, Compute Backends
- **Local section**: LocalMachineCard with detected providers
- **Connected section**: ConnectedMachinesCard with live machines from relay
- **Registered section**: RegisteredMachinesCard (server mode only) for offline machines
- **Compute backends**: LocalBackendsCard with Docker/Kubernetes/SLURM/SSH backend status
- Inline editable machine names, backend detail dialog, machine config dialog, add environment dialog

### 4.2 Agents
**Path:** `/agents`

Real-time agent execution monitoring:
- All currently executing tasks (in_progress or dispatched)
- Agent cards with task title, status badge, progress bar
- Execution info (machineId, providerId, executionId), duration

### 4.3 Device Auth
**Path:** `/device` (standalone route, no sidebar)

OAuth2 device code authorization flow:
- Displays device code for user to enter
- Polls for authorization
- Registers machine on approval

---

## 5. Initiatives & Workflows

### 5.1 Initiatives
**Path:** `/initiatives`

Initiative/project grouping and management:
- Initiative cards with icon, color, status badge, description, goal, project count, lead
- Create/edit dialog (Name, Description, Goal, Status, Appearance, Start/Target dates, Lead)
- Manage Projects dialog for assigning/unassigning projects

### 5.2 Workflows
**Path:** `/workflows`

Workflow guide documentation:
- Two working modes (Sandbox Mode and Direct Execution Mode)
- Git vs Non-Git workflows
- Use cases with examples
- Architecture diagram with dispatch-workspace system

---

## 6. Settings & Auth

### 6.1 Settings
**Path:** `/settings`

Tab structure with personal and workspace sections:

**Personal:**
- **Preferences** — Default home view, display names, first day of week, font size, pointer cursors, theme
- **Profile** — Avatar, name, email, bio, domain expertise (chips), experience level, preferred machines, default execution settings
- **Notifications** — Notification preferences
- **Security & access** — Change password, delete account with confirmation
- **Teams** — Team selector, members list, pending invitations, invite dialog
- **Connected accounts** — GitHub (connect/disconnect, repo sync), Slack, Telegram, GitHub Webhooks, Linear

**Workspace:**
- **Environments** — Machine management
- **Plugins** — Plugin configuration
- **Skills** — Skills management
- **Keyboard shortcuts** — Shortcut configuration

Server mode additions: Encrypted API keys section with reveal/hide

### 6.2 Welcome / Onboarding
**Path:** `/welcome` (standalone route, no sidebar)

Two-option onboarding:
- "Start with empty project" or "Start with a repo"
- Theme toggle in top-right
- Machine/environment selection (different UI for single-user vs multi-tenant)
- Repository URL input with GitHub browser
- Working directory configuration
- First task input
- "Create Project & Add First Task" or "Use AI to Generate Plan"

### 6.3 Login
**Path:** `/login` (standalone route, no sidebar)

WebAuthn/passkey authentication

### 6.4 Team Invite
**Path:** `/invite/:token` (standalone route, server mode only)

Team invitation acceptance:
- Invitation details (Email, Role, Team name, Expiration)
- "Sign In & Accept" for unauthenticated, "Accept Invitation" + "Decline" for authenticated
- Auto-redirects to settings/teams after acceptance

---

## 7. Chat & AI (embedded components)

### 7.1 Plan Refinement Chat
**Component:** Side panel within Plan View (sidebar on desktop, bottom sheet on mobile)

- Chat interface for plan refinement
- AI suggestions with apply actions
- Context-aware (knows current plan state)

### 7.2 Task-Level Chat
**Component:** Within task detail

- Chat history persisted per task (API-backed)
- Questions about tasks and reviewing execution

---

## 8. Not Implemented

| Screen | Description | Notes |
|--------|-------------|-------|
| Issues List | `/issues` — Flat issue list view | Designed in UI.pen, no code |
| Issues Board | `/issues/board` — Kanban board for issues | Designed in UI.pen, no code |

---

## Route Summary

| Path | Component | Notes |
|------|-----------|-------|
| `/dashboard` | Dashboard | Auto-redirects to /welcome if no projects |
| `/projects` | Projects | Three view modes (all/timeline/board) |
| `/projects/new` | ProjectNew | Three creation modes |
| `/project/:id` | PlanView | Unified project page |
| `/project/:id/graph` | PlanView | Graph sub-route |
| `/project/:id/list` | PlanView | List sub-route |
| `/project/:id/timeline` | PlanView | Timeline sub-route |
| `/project/:id/board` | PlanView | Board sub-route |
| `/project/:id/overview` | PlanView | Overview sub-route |
| `/project/:id/task/:nodeId` | TaskDetail | Task execution detail |
| `/tasks` | MyTasks | Cross-project tasks |
| `/environments` | Environments | Machine management |
| `/agents` | Agents | Agent monitoring |
| `/initiatives` | Initiatives | Initiative grouping |
| `/workflows` | Workflows | Workflow guide |
| `/community` | Community | Browse/search shared plans (server mode only) |
| `/community/:id` | CommunityPlanDetail | Plan detail with fork/star/comments (server mode only) |
| `/settings` | Settings | Multi-tab settings |
| `/plugins/*` | PluginRoutes | Plugin pages |
| `/welcome` | Welcome | Onboarding (standalone) |
| `/login` | Login | WebAuthn (standalone) |
| `/device` | DeviceAuth | Device code flow (standalone) |
| `/invite/:token` | TeamInvite | Team invite (standalone) |

---

## Key UI Patterns

### From Linear
1. **Keyboard-first navigation** — G+key for navigation, single keys for actions
2. **Command palette** — Universal search and action hub (Cmd+K)
3. **Progressive disclosure** — Summary first, expand for details
4. **Health indicators** — Visual status for projects (on track/at risk/off track)
5. **Display settings** — Per-view groupBy/orderBy/properties via `DisplayPopover`
6. **Multi-view pages** — List/Timeline/Board views on Projects and My Tasks

### Astro-Specific
1. **Graph-first planning** — Directed graph as primary plan view
2. **Tiered verification** — Auto-close for verifiable tasks, human judgment for strategic decisions
3. **Vision document** — Persistent context document injected into every agent session
4. **Multi-environment status** — Real-time view across local/HPC/cloud machines
5. **Context assembly** — Vision doc + dependency outputs injected per task execution
6. **Agent steering** — Send guidance to running agents mid-execution
7. **Responsive layout** — Sidebar panels on desktop, sheets on mobile
