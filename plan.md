# Nexus — Implementation Plan

Tracked in Linear: [Nexus project](https://linear.app/get20/project/nexus-c5bd7d73274e) (SUP-149 through SUP-179)

## Implementation Status

### Working Features
- AI-powered plan generation with date scheduling (Claude Agent SDK + SSE streaming)
- Plan graph visualization with React Flow (custom task nodes, edges, selection)
- Plan refinement via chat panel (Claude Agent SDK with session resume)
- Timeline/Gantt chart with date-based bar positioning, dynamic week headers, today marker
- Timeline click-to-edit dialog (title, description, start/end dates with validation)
- Topological sort fallback for nodes missing dates (backward compatibility)
- Dashboard with stats, pending decisions, active projects
- Projects list with grouped table view (status, health, agents, progress, dates)
- Judgment queue page (display only)
- Settings with backend health check and model selection
- Command palette (Cmd+K) with navigation and theme toggle
- Light/dark theme with system preference support
- IndexedDB persistence for all stores

### Stubbed / Not Yet Functional
1. **Add Task button** — exists in plan view + timeline headers, no handler
2. **Approve/Defer/Prune actions** — buttons in detail panel, no handlers
3. **Vision document viewer/editor** — "Vision" button in plan view, no panel
4. **Board view toggle** — UI toggle on projects page, only list implemented
5. **Filter/Display controls** — buttons on projects page, non-functional
6. **Environments page** — sidebar nav link, no route or page component
7. **Hardcoded data** — dashboard agent activity, project metadata (health, agents, progress, dates)
8. **Vision doc upload** — button in project-new, no handler
9. **Repo linking** — button in project-new, no handler

## Gap to Vision

### Tier 1: Designed in UI.pen, Ready to Implement
These screens have full designs — implementation priority based on effort and data model readiness:

| Priority | Screen | UI.pen Frame | Effort | Key Elements |
|----------|--------|-------------|--------|--------------|
| 1 | Judgment Queue (actions) | `slkwB` | Low | Wire Approve/Defer/Prune buttons to plan-store, add tabs (All/Judgments/Decisions/Errors) as filters. No new data model needed. |
| 2 | Projects Board View | `5kGZp` | Medium | Kanban columns (Backlog/Planned/In Progress) + Display Options popover (view switcher, column/row/ordering, show/hide properties). Existing project data. |
| 3 | Projects Timeline View | `WhG7c` | Medium | Cross-project Gantt (each row = a project, not a task). Reuse `plan-timeline.tsx` date utilities. Existing project data. |
| 4 | Issues List View | `YORRp` | Medium-High | **Requires new `Issue` type + `issue-store.ts` + route + sidebar nav.** Table with Status, Priority, Project, Assignees columns; filter bar. |
| 5 | Issues Board View | `bvmJz` | Low (after #4) | Kanban with Backlog/Todo/In Progress/Done columns. Same Issue data model as #4. |

The **Issues** concept (list + board views) is a new data model not yet in the codebase. Issues are fine-grained work items within projects — distinct from PlanNodes which are higher-level graph tasks.

### Tier 2: Execution Layer (Zero-Friction Onboarding)
The critical bridge from "plan" to "do." Ordered by setup friction, lowest first:

| Step | What | Friction | Notes |
|------|------|----------|-------|
| 1 | **Zero-config local Claude Code dispatch** | Zero | Auto-detect local Claude Code, dispatch via CLI/SDK. If Claude Code works on your machine, Nexus works too. |
| 2 | **SSH remote dispatch + VS Code config reuse** | One click | Import `~/.ssh/config` or VS Code Remote/Tunnel profiles. Pick host from dropdown. Check for Claude Code on remote. |
| 3 | **One-click cloud compute (AWS/GCP)** | OAuth once | Spin up instance with Claude Code pre-installed, run task, auto-terminate. Cost guardrails (estimates, idle shutdown, daily limit). |
| 4 | **Slurm/HPC cluster integration** | Via SSH | Auto-detect Slurm on connected hosts. Submit `sbatch`, track via `squeue`/`sacct`. Map task to job parameters. |
| 5 | **Multi-environment orchestration** | — | Unified dispatch layer above adapters: environment registry, task routing, `/environments` page. |

Key principle: **reuse existing configurations** (`~/.ssh/config`, VS Code tunnels, AWS credentials) — no new config formats.

### Tier 3: Verification & Intelligence
Core product capabilities from `vision.md`:

1. **Branch pruning cascade** — prune a branch → auto-cancel all downstream tasks + prompt effort reallocation. First-class graph operation. (Vision 3.1, 4.3)
2. **Tiered verification** — auto-close for verifiable tasks (tests pass, build succeeds), human judgment only for strategic calls. (Vision 3.3, 4.5)
3. **Real agent status tracking** — live view of what each agent is doing and where it's running. (Vision 3.4)
4. **Strategic decision surface** — at branch points, surface context + AI recommendation + effort/timeline estimates per branch. (Vision 3.3, 4.7)
5. **Git integration** — task ↔ branch mapping, auto-merge on verification. (Vision 3.4)
6. **Vision document editor** — persistent, editable document injected into every agent session. Currently only a button stub. (Vision 3.4)

### Tier 4: Future / Post-Launch
From `vision.md` sections 5-9, deliberately deferred:

1. **Planning expertise system** — learning from user corrections over time via context engineering (Vision 5.2)
2. **Mobile decision interface** — decision cards, notifications, progress pulse (Vision 3.5)
3. **Team collaboration** — PI + lab model, shared plans, role-based access (Vision 7)
4. **Expert knowledge marketplace** — curated planning templates by domain (Vision 9)
5. **Time-horizon optimizer** — deadline-aware effort allocation strategy (Vision 4.7, 9)
6. **Cross-source synthesis** — GitHub, Slurm logs, calendar integration (Vision 9)
7. **Planning data pipeline** — structured traces for model training partnerships (Vision 5.3)
