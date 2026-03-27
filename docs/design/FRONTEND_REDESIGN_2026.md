# Frontend Redesign 2026: Ambient Intelligence Interface

> Design plan for reducing cognitive overhead through AI-driven intent routing,
> inbox-first home experience, and progressive disclosure.

## Philosophy: "Ambient Intelligence"

The UI should feel like a calm control tower, not a cockpit full of buttons.
AI runs tasks in the background and only surfaces to the user when genuine
human judgment is required. Drawn from three principles:

1. **Topology Compression** (MAS Theory) → Plan as document outline, not graph-first
2. **Scope Isolation** → Full-screen task focus, scoped chat, no global noise
3. **Verification Gates** → Asymmetric approval: reject=1 click, approve=review first

Reference: [Hierarchical MAS Theory](https://xinmingtu.cn/blog/2026/hierarchical-mas-theory/)

---

## Decision 1: Merge Plan + Playground → Unified "Start"

### Verdict: YES — merge them

### Rationale

| Factor | Plan View (current) | Playground (current) | Merged (proposed) |
|--------|---------------------|---------------------|-------------------|
| Entry point | `/project/:id` | `/playground` | Universal input on Home |
| User decision required upfront | "I want to plan" (create project first) | "I want to do a task" | None — AI infers from prompt |
| AI behavior | Decomposes into task graph | Single execution | Classifies intent, routes automatically |
| Output view | Graph / list / timeline / board | Activity stream | Adapts: outline for plans, stream for tasks |
| Chat model | Project-scoped multi-session | Steer (during) + chat (after) | Unified: steer during, chat after, plan-scoped |
| Machine selection | From project settings | Landing form | Auto-detected or inline below input |
| Code overlap | ~60% shared stores/hooks | ~60% shared stores/hooks | Single codebase |

### Intent Classification Heuristic

The AI determines whether to create a **plan** (multi-step decomposition) or
run a **direct execution** (single task):

```
Plan triggers:
  - "Build X", "Create X from scratch", "Add feature X"
  - "Design a system for...", "Implement X with Y, Z components"
  - Multiple verbs or sequential goals in one prompt
  - Mentions of architecture, phases, milestones

Direct execution triggers:
  - "Fix bug in...", "Run tests", "Deploy X"
  - "Review PR #N", "Check the logs"
  - Single, specific action with clear scope
  - Estimated completion < 10 minutes
```

### User Override

If the AI misclassifies:
- In plan view: user can say "just do it directly, don't decompose"
- In activity view: user can say "break this into separate tasks"
- Both transitions are conversational, not button-based

### Implementation Notes

1. Both Plan and Playground already create a `project` under the hood
   (Playground uses `projectType: "playground"`)
2. The merged view keeps this — every goal becomes a project
3. `projectType` drives the default view: `"playground"` → activity stream,
   `"plan"` → outline view
4. The Playground landing form (machine + workdir selectors) becomes
   contextual metadata below the universal input, shown only when
   >1 machine is connected

---

## Decision 2: Kill Dashboard → Inbox as Home Page

### Verdict: YES — replace dashboard with attention-focused inbox

### Current Dashboard Breakdown (791 lines, 12+ panels)

| Component | Lines | Purpose | New Location |
|-----------|-------|---------|-------------|
| Greeting | 5 | Time-aware welcome | **Remove** |
| CommandStrip | 12 | Status bar (approvals, pulse, cost) | **Remove** (cost → Settings) |
| NotificationCards | 1 | System notifications | **Inbox** → top section |
| WhatsNewSection | 1 | Announcements | **Remove** → changelog modal |
| Attention Cards (approvals) | 200+ | Pending human decisions | **Inbox** → "Needs You" section |
| MachineFleetPanel | 12 | Connected machine status | **Ambient** → status bar dot |
| Running Tasks (TaskTimeline) | 40 | Active executions by category | **Inbox** → "Running" section |
| Project Health Cards | 30 | Recent project summaries | **Inbox** → "Your Projects" section |
| Playground Health Cards | 20 | Recent playground sessions | **Merged into projects** |
| Activity Heatmap + Stats | 20 | Usage visualization | **Profile** page |
| Achievements / Level | 10 | Gamification | **Profile** page |
| Live Feed | 10 | Real-time activity stream | **Activity** page (⌥A) |

### New Inbox Structure

```
Home Page (replaces / route)
├── Universal Input         — "What do you want to build or do?"
│   └── Machine/dir hint   — shown only when multiple machines connected
│
├── Section: "Needs You"    — ⚠️ amber border, always on top
│   ├── Dynamic approvals   (agent questions)
│   ├── Awaiting judgment    (task verification requests)
│   └── Awaiting approval    (procedure-level approvals)
│
├── Section: "Running"      — ambient, collapsed if empty
│   ├── Plan generation      (active decomposition)
│   ├── Task execution       (project tasks running)
│   └── Direct sessions      (ex-playground sessions)
│
├── Section: "Your Projects" — compact list, sorted by last activity
│   ├── Project cards        (name + progress + health dot)
│   └── "See all" link       → full project list
│
└── System alerts           — persistent notifications (rare)
```

### What Gets Removed Entirely

| Component | Why |
|-----------|-----|
| Greeting ("Good morning, Alex") | Nice but zero information density |
| Command Strip | Replaced by inbox sections providing the same info |
| What's New | Use changelog modal triggered by ⌘K or first-visit |
| Achievement panel | Ego metric — belongs in Profile, not on every launch |
| Activity heatmap | Analytics — belongs in Profile/Settings |
| Brag Stats | Gamification — belongs in Profile |
| Machine Fleet Panel | Only relevant during issues — show as ambient status dot in nav |

---

## New Page Architecture

### Before: 8+ top-level pages

```
/dashboard        → Activity hub (12 panels)
/projects         → Project listing
/project/:id      → Plan view (graph/list/timeline/board)
/playground       → Ad-hoc AI session
/tasks            → My tasks
/active           → Active tasks
/task-detail/:id  → Task inspector (5 tabs)
/settings         → Preferences
/community        → Marketplace
```

### After: 4 core pages

```
/                 → Home (Inbox + universal Start input)
/project/:id      → Project (adapts: outline OR activity stream)
/project/:id/task/:nodeId → Task Focus (single scroll: context→activity→verify)
/settings         → Settings + Profile + Stats + Machines
```

### Sidebar: 3 navigation items (down from 8+)

```
[Home icon]       → / (inbox + start)
[Projects icon]   → projects list (within home, or standalone)
[Settings icon]   → /settings
[Avatar]          → profile (within settings)
```

Plus `⌘K` command palette for everything else (community, workflows, etc.)

---

## Unified "Start" Input UX

The top of the Home page has a single text input, similar to Spotlight/Alfred:

```
┌─────────────────────────────────────────────────┐
│ ✦  What do you want to build or do?         [→] │
│    Machine: local  ·  Dir: ~/projects           │
└─────────────────────────────────────────────────┘
```

### Behavior:

1. **User types**: "Build an authentication system with OAuth and magic links"
2. **AI classifies**: multi-step goal → plan
3. **Project created**: navigates to `/project/:id` showing outline view
4. **User sees**: expandable task hierarchy, "Run All" button at bottom

Or:

1. **User types**: "Fix the CSS overflow bug in the header component"
2. **AI classifies**: single task → direct execution
3. **Project created**: navigates to `/project/:id` showing activity stream
4. **User sees**: real-time agent activity (like current Playground)

### Machine/Directory Selection

- **0-1 machines**: hidden (auto-uses local or only available machine)
- **2+ machines**: subtle inline selector below input
- **Working directory**: remembers last-used per machine, overridable

---

## Tauri App Design

### Menubar/Tray Mode (primary)

Compact popover (~300×400px) activated by clicking tray icon:

```
┌──────────────────────────────┐
│ ✦ Astro                      │
├──────────────────────────────┤
│ ⚠ 2 items need attention     │
│   ○ Approve: DB migration    │
│   ○ Review: API endpoints    │
├──────────────────────────────┤
│ Running: 3 tasks             │
│   ● Auth system  ~4m         │
│   ● Test suite   ~12m        │
│   ○ Deploy prep  queued      │
├──────────────────────────────┤
│ [Open full view]  [⌘⇧A]     │
└──────────────────────────────┘
```

### Global Hotkeys

| Shortcut | Action |
|----------|--------|
| ⌘⇧A | Open Astro inbox popover |
| ⌘⇧R | Quick approve top pending item |
| ⌘⇧X | Quick reject top pending item |
| ⌘⇧N | Open quick task input |

### Focused Window (secondary)

For deeper work, opens a minimal window (~900×700px):
- Single task in focus mode (no sidebar, no nav)
- Context → Activity → Verify layout
- Scoped chat for that task
- Window title: "Astro — [Task Name]"

---

## Implementation Phases

| Phase | Scope | Files Changed | Risk |
|-------|-------|---------------|------|
| 1. Inbox Home | Replace dashboard with inbox layout | `dashboard.tsx` → `home.tsx`, router | Medium |
| 2. Universal Input | Add compose input to home page | New component, project creation flow | Low |
| 3. Intent Classifier | AI routes to plan vs direct execution | Backend: new classification endpoint | Medium |
| 4. Sidebar Simplification | Strip to 3 items | `sidebar.tsx` (1073→~200 lines) | Low |
| 5. Plan/Playground Merge | Unified project view adapts by type | `plan-view.tsx`, delete `playground.tsx` | High |
| 6. Task Focus Scroll | Replace 5-tab detail with single scroll | `task-detail.tsx` | Medium |
| 7. Tauri Compact | Menubar popover + global hotkeys | New Tauri components | Medium |

Each phase is independently shippable behind a feature flag.

---

## Key Metrics to Track

| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Time to first action (new user) | Unknown | < 10 seconds |
| Sidebar items visible | 8+ | 3 |
| Buttons visible per task card | 4-6 | 0 (idle), 1 (hover) |
| Dashboard panels | 12 | 3 inbox sections |
| Pages in top-level nav | 8+ | 4 |
| Lines of code: sidebar.tsx | 1073 | ~200 |
| Lines of code: dashboard.tsx | 791 | ~300 (as inbox) |
