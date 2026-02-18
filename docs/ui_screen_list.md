# Astro UI Screens List

This document defines the complete set of UI screens for Astro, a planning-first platform for builders and scientists. The screens are organized by functional area and informed by both the product vision and Linear's established UI patterns.

---

## 1. Global Navigation & Shell

### 1.1 App Shell
- **Sidebar** - Primary navigation with main nav items (Dashboard, Projects, My Tasks, Environments) and user profile
- **Header** - Page title, breadcrumbs, and contextual actions
- **Command Palette** (Cmd+K) - Universal search, navigation, and actions

---

## 2. Home & Personal Views

### 2.1 Dashboard (Home)
**Path:** `/`
**Status:** Implemented

Primary landing page showing:
- Quick stats (pending decisions, active tasks, completed today)
- Active projects with progress indicators
- System health and environment status
- Usage metrics (cost, tokens, task counts)

### 2.2 My Tasks
**Path:** `/tasks`
**Status:** Implemented

Cross-project task list with:
- Filtering by status, project, priority
- Grouping options (by status, project, priority, milestone)
- Display settings via `DisplayPopover` (groupBy, orderBy, visible properties)
- Sortable columns

---

## 3. Project Management

### 3.1 Projects List
**Path:** `/projects`
**Status:** Implemented

All projects view:
- **Table view** - Sortable columns (name, status, progress, dates, lead)
- Grouped by initiative or status
- Search and filtering

### 3.2 New Project
**Path:** `/projects/new`
**Status:** Implemented

Project creation flow:
- Goal/vision description input
- Repository URL/path input
- AI plan generation trigger
- Generation overlay with streaming progress

### 3.3 Project Overview
**Path:** `/project/:id`
**Status:** Implemented

Project detail hub with tabs:
- **Overview tab**: Project summary, properties, health status, progress
- **Updates tab**: Project update history
- **Vision document dialog**: Persistent context document editor

### 3.4 Plan View
**Path:** `/project/:id/plan`
**Status:** Implemented

Interactive plan visualization with view toggles:
- **Graph tab**: Directed graph canvas (React Flow) with node types (milestone, task, decision, branch), status color coding, pan/zoom, mini-map
- **List tab**: Flat task list alternative with inline status and grouping
- **Timeline tab**: Gantt chart with date-based bars, dependency connectors, today marker
- **Node detail panel**: Slide-over panel for editing task properties, viewing dependencies, managing execution
- **Chat panel**: Conversational plan refinement with AI
- **Task creation**: Via popover on graph, inline in list, or dialog — uses `TaskCreationForm` component

### 3.5 Task Detail
**Path:** `/project/:id/task/:nodeId`
**Status:** Implemented

Task execution detail view:
- **Output**: Terminal-style streaming output with search, copy, auto-scroll
- **Tool Traces**: Vertical timeline of tool calls with collapsible I/O
- **File Changes**: File change list with diff display
- **Steer Chat**: Send guidance to running agent
- **Session Activity**: Session activity timeline view

---

## 4. Agent & Environment Management

### 4.1 Environments
**Path:** `/environments`
**Status:** Implemented

Environment configuration and monitoring:
- List of registered machines with online/offline status
- Add environment dialog (local, HPC, cloud)
- SLURM cluster display (partitions, jobs, queue)
- Device code flow for machine registration
- Rename/revoke machines

### 4.2 Device Auth
**Path:** `/device`
**Status:** Implemented (standalone route, no sidebar)

OAuth2 device code authorization flow:
- Displays device code for user to enter
- Polls for authorization
- Registers machine on approval

---

## 5. Chat & AI Interaction

### 5.1 Plan Refinement Chat
**Component:** Side panel within Plan View
**Status:** Implemented

Conversational plan modification:
- Chat interface for plan refinement
- AI suggestions with apply actions
- Context-aware responses (knows current plan state)

### 5.2 Task-Level Chat
**Component:** Within task detail
**Status:** Implemented

Per-task chat interface:
- Chat history persisted per task (IndexedDB-backed)
- Used for asking questions about tasks and reviewing execution

---

## 6. Settings & Onboarding

### 6.1 Settings
**Path:** `/settings`
**Status:** Implemented

Application settings:
- **Connection** - Backend URL, health check
- **Model** - AI model selection

### 6.2 Welcome / Onboarding
**Path:** `/welcome`
**Status:** Implemented (standalone route, no sidebar)

Multi-step onboarding flow:
- User type selection (builder/scientist)
- Domain/expertise input
- Repository configuration

---

## 7. Not Implemented

The following screens from the original design are **not yet built**:

| Screen | Description | Notes |
|--------|-------------|-------|
| Issues List | `/issues` — Flat issue list view | Designed in UI.pen, no code |
| Issues Board | `/issues/board` — Kanban board for issues | Designed in UI.pen, no code |
| Cross-project Timeline | Gantt view across all projects | Backlog (SUP-161) |
| Mobile Decision Cards | Swipeable decision cards for mobile | Backlog (NEX-37) |
| Mobile Progress Pulse | Quick mobile status overview | Backlog (NEX-38) |
| Strategic Decision Surface | Branch comparison and impact analysis | Not started |

---

## Implementation Status Summary

| Category | Total Screens | Implemented |
|----------|---------------|-------------|
| Home & Personal | 2 | 2 |
| Project Management | 4 | 4 |
| Task Detail | 1 | 1 |
| Environments & Auth | 2 | 2 |
| Chat & AI | 2 | 2 |
| Settings & Onboarding | 2 | 2 |
| Not Implemented | 6 | 0 |
| **Total** | **19** | **13** |

---

## Key UI Patterns

### From Linear
1. **Keyboard-first navigation** - G+key for navigation, single keys for actions
2. **Command palette** - Universal search and action hub (Cmd+K)
3. **Progressive disclosure** - Summary first, expand for details
4. **Health indicators** - Visual status for projects (on track/at risk/off track)
5. **Display settings** - Per-view groupBy/orderBy/properties via `DisplayPopover`

### Astro-Specific
1. **Graph-first planning** - Directed graph as primary plan view (not flat lists)
2. **Tiered verification** - Auto-close for verifiable tasks, human judgment for strategic decisions
3. **Vision document** - Persistent context document injected into every agent session
4. **Multi-environment status** - Real-time view across local/HPC/cloud machines
5. **Context assembly** - Vision doc + dependency outputs injected per task execution
6. **Agent steering** - Send guidance to running agents mid-execution
