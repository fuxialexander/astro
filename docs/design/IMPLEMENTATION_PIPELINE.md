# Astro — Implementation Pipeline

This document surveys the entire Astro system across all design documents, catalogs what is implemented vs what is missing, and provides a prioritized checklist for reaching a beta launch.

**Last updated**: 2026-02-21

---

## 1. Component Status Overview

A high-level snapshot of each component's readiness.

```
Component         Implemented    Partial    Gaps     Beta-Ready?
─────────────────────────────────────────────────────────────────
Frontend          ██████████░    ~90%       Minor    Nearly
Backend           ███████░░░░    ~70%       Major    NO — calls AI directly
Relay             █████████░░    ~85%       Medium   Nearly (protocol gaps)
Agent Runner      █████████░░    ~85%       Medium   Nearly
Data Persistence  ██████████░    ~90%       Minor    Nearly
Deployment        ████████░░░    ~80%       Minor    Nearly
Testing           █░░░░░░░░░░    ~10%       Major    NO — almost no tests
─────────────────────────────────────────────────────────────────
Overall                                              NO — 3 blockers
```

---

## 2. Frontend Status

**Design doc**: `FRONTEND.md`

### 2.1 Implemented (working)

| Feature | Files | Notes |
|---------|-------|-------|
| All 18 Zustand stores | `src/stores/*.ts` | project, plan, execution, realtime, settings, machines, slurm, user-profile, display-settings, usage, task-chat, activity, initiative, ui, agent, settings |
| 14 route pages | `src/pages/*.tsx` | dashboard, projects, project-new, project-overview, plan-view, task-detail, my-tasks, environments, agents, initiatives, settings, device-auth, welcome, login |
| IndexedDB persistence | `src/lib/db.ts` | idb-keyval wrapper, 11 keys |
| SSE event consumption | `src/lib/realtime-client.ts`, `src/stores/realtime-store.ts` | Persistent EventSource + action SSE |
| React Flow plan graph | `src/components/plan-graph/` | Custom nodes, edges, layout, detail panel |
| Task detail views | `src/components/task-detail/` | Output, tool traces, file changes, steer chat, session activity |
| Chat panels | `src/components/agent/chat-panel.tsx` | Plan-level and task-level chat |
| Approval UI | `src/components/approval-card.tsx` | Dynamic approval dialogs via SSE |
| Activity feed | `src/stores/activity-store.ts` | 1000-event history, IndexedDB persistence |
| Usage metrics | `src/stores/usage-store.ts` | Cost, tokens, task counts |
| Task creation | `src/components/task-creation-form.tsx` | Inline, popover, dialog modes |
| Command palette | `src/components/command-palette.tsx` | Cmd+K navigation + search |
| Theme system | `src/components/theme-provider.tsx` | Light/dark/system |
| Display settings | `src/components/display-popover.tsx` | Per-view groupBy, orderBy, properties |
| Timeline view | `src/components/plan-graph/plan-timeline-tab.tsx` | Gantt-style with topological sort |

### 2.2 Partially implemented

| Feature | Issue | Impact |
|---------|-------|--------|
| Supabase sync layer | Three-layer persistence exists but not stress-tested in production | May have sync bugs under concurrent multi-device use |
| Machine list in Environments | Shows machines from API, but "Install Agent Runner" button not wired | Users see SSH hosts but can't act on them |
| Async strategy UX | No "queued, waiting for resources" state for SLURM/SkyPilot tasks | Users expect immediate output, see nothing |

### 2.3 Gaps (not implemented)

| Gap | Priority | Effort | Notes |
|-----|----------|--------|-------|
| SSH host classification in Environments page | Medium | S | All SSH hosts look identical — need HPC vs compute vs storage labels |
| "Install Agent Runner" one-click button | High | M | Wire to `ssh-installer.ts`, show progress |
| Rented cloud VM setup flow | Medium | M | Guided setup: paste SSH address → install → verify connection |
| Async strategy progress UI | Medium | S | Show "Queued (position 3/12)" or "Provisioning VM..." |
| Machine auto-selection (no targetMachineId) | High | S | Frontend should call `/api/relay/best-machine` before dispatch |

---

## 3. Backend Status

**Design doc**: `BACKEND.md`

### 3.1 Implemented (working)

| Feature | Files | Notes |
|---------|-------|-------|
| Hono HTTP server | `server/index.ts` | CORS, middleware, 22 route files |
| REST API (all endpoints) | `server/routes/*.ts` | agent, dispatch, events, relay, health, device-auth, data, etc. |
| Authentication (dual mode) | `server/middleware/` | WebAuthn+JWT (server mode), no-auth (local mode) |
| Database layer | `server/lib/db/` | Drizzle ORM, 24 Postgres tables, migrations |
| IndexedDB-only mode | `server/lib/app-mode.ts` | Auto-detected from env vars |
| Event transport (7 hooks) | `server/lib/events/astro-event-transport.ts` | SSE, audit, usage, PR, git-pull, channel, observability |
| Dispatch engine | `server/lib/dispatch/` | Queue, context assembly, result routing, batch execution |
| Procedure pipeline | `server/lib/dispatch/dispatch-engine.ts` | 5 subroutines: implement → verify → commit → PR → summarize |
| Observability | `server/lib/observability/` | Langfuse exporter, observation collector, turn grouping |
| Relay server (WebSocket hub) | `server/lib/relay-server.ts` | Machine registry, task routing, heartbeat |
| Machine registry | `server/lib/machine-registry.ts` | In-memory connected machines, best-machine selection |
| Device auth (RFC 8628) | `server/routes/device-auth.ts`, `server/lib/device-code-store.ts` | Full device code flow for machine registration |
| Health check | `server/routes/health.ts` | Provider detection, backend status |
| Compute backend detection | `server/lib/local-backends.ts` | Docker, SSH, K8s, SLURM detection for UI display |

### 3.2 Partially implemented

| Feature | Issue | Impact |
|---------|-------|--------|
| **Relay-only execution** | `/generate-plan`, `/chat`, `/task-chat`, `/dispatch`, `/summarize` all have LOCAL fallback paths that call AI directly | **CRITICAL** — violates target architecture |
| Provider system | `server/lib/providers/` adapters exist and work but should be deleted | Dead code after migration |
| Task classification | `server/lib/dispatch/procedure-classifier.ts` calls Anthropic API directly | Should move to agent runner or be removed |

### 3.3 Gaps (not implemented)

| Gap | Priority | Effort | Blocker? | Notes |
|-----|----------|--------|----------|-------|
| **Remove all local AI execution paths** | **CRITICAL** | L | **YES** | Lines 131-351 of agent.ts, ~480 lines of dispatchLocal in dispatch.ts, all of `/chat`, `/task-chat`, `/summarize` local paths |
| **Delete server-side provider adapters** | **CRITICAL** | S | **YES** (after above) | `anthropic-direct.ts`, `claude-code.ts`, `codex.ts`, `registry.ts`, `context.ts` |
| Remove `initializeProviders()` from startup | High | XS | After above | `server/index.ts` line 30 |
| Replace backend detection with agent runner capabilities | Medium | M | No | Backend shows what IT detects; should show what agent runners report |
| SSH remote install API endpoint | Medium | S | No | Expose `ssh-installer.ts` via HTTP |

### 3.4 The Critical Issue: Server Calls AI Directly

This is the single biggest architectural gap. The backend is supposed to be a **coordination layer** that never touches AI. Currently:

```
CURRENT STATE (broken):

  /api/agent/generate-plan
    ├─ if targetMachineId → relay → agent runner     ✓ CORRECT
    └─ else → providerRegistry.getProvider().stream() ✗ WRONG — server calls AI

  /api/agent/chat
    └─ getChatProvider() → provider.stream()          ✗ WRONG — server calls AI

  /api/agent/task-chat
    └─ getChatProvider() → provider.stream()          ✗ WRONG — server calls AI

  /api/dispatch/task
    ├─ if relay available → dispatchViaRelay()         ✓ CORRECT
    └─ else → dispatchLocal()                         ✗ WRONG — server calls AI

  /api/agent/summarize
    └─ Anthropic direct API call                      ✗ WRONG — server calls AI
```

```
TARGET STATE (after migration):

  /api/agent/generate-plan
    └─ always → relay → agent runner                  ✓

  /api/agent/chat
    └─ always → relay → agent runner                  ✓

  /api/agent/task-chat
    └─ always → relay → agent runner                  ✓

  /api/dispatch/task
    └─ always → dispatchViaRelay()                    ✓

  /api/agent/summarize
    └─ always → relay → agent runner                  ✓
```

**Dependency**: This migration requires fixing the relay protocol gaps first (Section 5.3).

---

## 4. Relay Status

**Design doc**: `RELAY.md`

### 4.1 Implemented (working)

| Feature | Notes |
|---------|-------|
| WebSocket server (port 3002) | ws library, configurable port |
| Connection handshake | `machine.register` / `machine.register.ack` |
| Task dispatch + streaming | `task.dispatch` → agent runner → stream events back |
| Heartbeat (30s) | ping/pong with resource updates |
| Machine registry | In-memory, tracks connections + capabilities |
| All 20+ message types | Defined in `server/types/relay.ts` |
| Event forwarding | relay → executionEventBus → hooks → SSE |
| Redis pub/sub | Optional horizontal scaling |
| Task operations | Cancel, steer, approval response, safety decision |
| File operations | `file_list.request`, `repo_setup.request` |
| Auth modes | JWT (server), open (local) |

### 4.2 Protocol Gaps

The relay protocol (`TaskDispatch` message) is missing 4 fields that prevent full migration of chat and planning endpoints:

| Missing Field | Type | Why Needed | Impact |
|---------------|------|-----------|--------|
| `messages` | `SessionMessage[]` | Chat history for `/chat` and `/task-chat` | Chat history must be flattened into single `prompt` string (loses structure) |
| `systemPrompt` | `string` | System prompt for planning/chat | System prompts concatenated into user prompt (loses role separation) |
| `type` | `'plan' \| 'chat' \| 'execution' \| 'summarize'` | Task type for agent runner optimization | Agent runner can't distinguish task types |
| `model` | `string` | Explicit model selection | Model selection is implicit only |

**These 4 gaps are the #1 dependency** for the server/local mode separation. They must be fixed before chat endpoints can be converted to relay-only.

---

## 5. Agent Runner Status

**Design doc**: `AGENT_RUNNER.md`

### 5.1 Implemented (working)

| Feature | Notes |
|---------|-------|
| CLI (10 commands) | setup, start, stop, status, auth, config, providers, resources, hosts, mcp |
| WebSocket client | Auto-reconnect, exponential backoff, heartbeat |
| Task executor | Queue (max 4 concurrent), abort, timeout |
| Claude Code adapter | Subprocess, JSON parsing, steering via stdin |
| Claude SDK adapter | In-process, approval interception, HPC context, MCP loading |
| Codex adapter | Subprocess, sandbox modes |
| Direct strategy | Local process execution |
| Docker strategy | Container with volume mounts |
| SLURM strategy | sbatch submit, squeue poll, scancel |
| K8s Exec strategy | kubectl exec into existing pods |
| Safety system | 4 tiers (SAFE/GUARDED/RISKY/UNSAFE) |
| Git worktree management | Create, cleanup, branch naming |
| PR creation | Push branch + `gh pr create` |
| MCP server | 4 tools (astro_attach/detach/status/send) |
| Configuration | Cross-platform, `conf` package |
| Hardware ID | MAC → random fallback |

### 5.2 Partially implemented

| Feature | Issue | Impact |
|---------|-------|--------|
| SkyPilot strategy | Code exists (388 lines) but marked experimental | Not usable for beta |
| SSH host discovery | `hosts` command works, `ssh-installer.ts` exists | Not exposed in UI, requires manual SSH |

### 5.3 Gaps

| Gap | Priority | Effort | Notes |
|-----|----------|--------|-------|
| Handle new relay protocol fields (`messages`, `systemPrompt`, `type`, `model`) | **CRITICAL** | M | Agent runner must consume these to support chat/planning via relay |
| K8s Job strategy (batch workloads) | Medium | M | Only `kubectl exec` exists; need `kubectl apply -f job.yaml` + poll |
| One-click remote install via UI | Medium | M | `ssh-installer.ts` exists, needs UI + API endpoint |
| Rented VM quick-setup flow | Medium | S | Guided: paste SSH address → auto-install → verify |
| Capability-based routing | Low | M | Auto-select machine based on task requirements (GPU, memory, etc.) |
| Multi-machine distributed training | Low | L | Coordinating tasks across interconnected VMs |

---

## 6. Data Persistence Status

**Design doc**: `DATA_MODEL.md`

### 6.1 Implemented (working)

| Feature | Notes |
|---------|-------|
| IndexedDB (11 keys) | projects, plan-nodes, plan-edges, executions, sessions, settings, user-profile, task-chats, usage-metrics, activities, display-settings |
| Postgres (24 tables) | Full Drizzle ORM schema with migrations |
| Three-layer persistence | Zustand → IndexedDB → Supabase API |
| Mode-aware data access | Local = IndexedDB primary; Server = Postgres primary + IndexedDB cache |
| Soft-delete support | `deletedAt` + `deletionActionId` fields |
| Execution history cap | 100 in IndexedDB, unlimited in Postgres |

### 6.2 Gaps

| Gap | Priority | Notes |
|-----|----------|-------|
| Supabase sync stress-testing | Medium | Not tested under concurrent multi-device load |
| Conflict resolution edge cases | Low | Optimistic updates may lose changes under race conditions |

---

## 7. Testing Status

### 7.1 Current state

| Scope | Tests | Coverage |
|-------|-------|----------|
| Relay integration | `server/test/relay-server.test.ts` | ~60% of relay |
| Frontend stores | None | 0% |
| Backend routes | None | 0% |
| Provider adapters | None | 0% |
| Execution strategies | None | 0% |
| Agent runner | None | 0% |
| E2E | None | 0% |

### 7.2 What's needed for beta

| Test Area | Priority | Effort | What to Test |
|-----------|----------|--------|-------------|
| Backend route tests | **CRITICAL** | M | `/generate-plan`, `/dispatch/task`, `/chat` — verify relay-only paths |
| Agent runner task executor | High | M | Task lifecycle, queue, timeout, cancellation |
| Execution strategy tests | High | M | Direct, Docker, SLURM (with mocked binaries) |
| Frontend store tests | Medium | M | project-store, plan-store, execution-store CRUD + persistence |
| E2E smoke test | High | M | Create project → generate plan → execute task → view results |
| Relay message tests | Medium | S | All 20+ message types serialize/deserialize correctly |

---

## 8. Deployment Status

### 8.1 Current state

| Component | Status | Target |
|-----------|--------|--------|
| Frontend (Cloudflare Pages) | Configured, deployable | `npm run deploy:frontend` |
| Backend (Fly.io) | Just deployed (commit 587555a) | `npm run deploy:backend` |
| Relay (same Fly.io VM) | Included in backend deploy | Port 3002 |
| Agent runner (npm package) | Publishable | `npx astro-agent` |
| Cloudflare Tunnel | Working for dev | `scripts/start-tunnel.sh` |
| CI/CD | Not configured | Need GitHub Actions |

### 8.2 Gaps

| Gap | Priority | Notes |
|-----|----------|-------|
| CI/CD pipeline (GitHub Actions) | High | Build + lint + test on every PR |
| Fly.io load testing | Medium | Unknown performance under concurrent users |
| npm package publishing | High | `@astro/agent` needs to be on npm for `npx` |

---

## 9. Beta Readiness Checklist

### Legend
- `[x]` = Done
- `[~]` = Partially done
- `[ ]` = Not done
- `[!]` = BLOCKER — must be fixed before beta

### 9.1 Core User Journey: Create Project → Plan → Execute → Results

```
[x] User can create a project (title, description, repo URL)
[x] User can generate an AI plan (graph of tasks)
[x] Plan renders as interactive graph (React Flow)
[x] User can edit plan nodes (title, description, dependencies)
[x] User can add/remove nodes and edges
[x] User can execute a task (dispatch to agent runner)
[x] Task execution streams output in real time (SSE)
[x] User can see tool traces, file changes, terminal output
[x] Task creates git branch and PR on completion
[x] User can cancel a running task
[x] User can steer a running task (mid-execution guidance)
[x] Batch execution: auto-dispatch ready tasks as dependencies complete
[x] Chat with AI about a plan
[x] Chat with AI about a specific task
[x] Usage metrics tracked (cost, tokens, task counts)
```

### 9.2 Architecture: Server/Local Mode Separation

```
[!] Fix relay protocol: add messages, systemPrompt, type, model fields
[!] Convert /api/agent/generate-plan to relay-only (remove local fallback)
[!] Convert /api/agent/chat to relay-only
[!] Convert /api/agent/task-chat to relay-only
[!] Convert /api/agent/dispatch to relay-only
[!] Convert /api/agent/summarize to relay-only
[!] Convert /api/dispatch/task to relay-only (remove dispatchLocal)
[ ] Delete server-side provider adapters (anthropic-direct, claude-code, codex)
[ ] Delete provider registry, context, initializeProviders()
[ ] Delete procedure-classifier.ts direct AI call
[ ] Remove ANTHROPIC_API_KEY from backend requirements
```

### 9.3 Agent Runner

```
[x] CLI setup flow (setup, start, stop, status)
[x] WebSocket connection with auto-reconnect
[x] Task execution with Claude SDK adapter
[x] Task execution with Claude Code adapter
[x] Task execution with Codex adapter
[x] Direct execution strategy
[x] Docker execution strategy
[x] SLURM execution strategy
[x] K8s Exec strategy
[~] SkyPilot strategy (experimental, not supported)
[x] Safety system (4 tiers)
[x] Git worktree isolation
[x] PR creation
[x] MCP server integration
[ ] Handle new protocol fields (messages, systemPrompt, type, model)
[ ] K8s Job strategy (batch workloads with autoscaler)
[ ] Rented VM quick-setup documentation
```

### 9.4 Frontend UX

```
[x] Dashboard with stats, pending decisions, active projects
[x] Project list (grouped, sortable)
[x] Plan graph view with node editing
[x] Plan list view
[x] Plan timeline (Gantt) view
[x] Task detail: output, tool traces, file changes
[x] Task steering chat
[x] Activity feed
[x] Approval dialogs
[x] Environments page (machine list)
[x] Command palette (Cmd+K)
[x] Theme (light/dark/system)
[x] Settings (model selection, backend health)
[ ] Machine auto-selection when no targetMachineId
[ ] "Install Agent Runner" button on Environments page
[ ] SSH host classification (HPC vs compute vs storage labels)
[ ] Async strategy UX ("queued, waiting for resources")
[ ] Rented VM setup wizard
```

### 9.5 Data & Persistence

```
[x] IndexedDB: all 11 keys working
[x] Postgres: 24 tables with migrations
[x] Three-layer persistence (Zustand → IndexedDB → API)
[x] Mode detection (local vs server)
[x] Soft-delete support
[ ] Supabase sync stress-test under concurrent load
```

### 9.6 Deployment & Operations

```
[x] Fly.io backend deployment configured
[x] Cloudflare Pages frontend configured
[x] Cloudflare Tunnel for dev
[x] Environment variable system (ASTRO_* prefix)
[ ] CI/CD pipeline (GitHub Actions)
[ ] npm publish @astro/agent package
[ ] Production monitoring/alerting
```

### 9.7 Testing

```
[x] Relay integration tests
[ ] Backend route unit tests
[ ] Agent runner unit tests
[ ] Frontend store unit tests
[ ] Execution strategy unit tests
[ ] E2E smoke test
[ ] CI/CD running tests on every PR
```

---

## 10. Prioritized Implementation Roadmap

### Phase 0: Protocol Fix (dependency for everything else)

| # | Task | Effort | Files | Blocked By |
|---|------|--------|-------|------------|
| 0.1 | Add `messages`, `systemPrompt`, `type`, `model` to `TaskDispatch` type | XS | `server/types/relay.ts` | — |
| 0.2 | Update relay server to forward new fields | S | `server/lib/relay-server.ts` | 0.1 |
| 0.3 | Update agent runner to consume new fields in task executor | M | `packages/agent-runner/src/lib/task-executor.ts`, provider adapters | 0.1 |
| 0.4 | Update `dispatchToRunner()` helper to populate new fields | S | `server/routes/agent.ts` | 0.1 |

### Phase 1: Server/Local Mode Separation (critical path)

| # | Task | Effort | Files | Blocked By |
|---|------|--------|-------|------------|
| 1.1 | Convert `/api/agent/generate-plan` to relay-only | M | `server/routes/agent.ts` | Phase 0 |
| 1.2 | Convert `/api/agent/chat` to relay-only | M | `server/routes/agent.ts` | Phase 0 |
| 1.3 | Convert `/api/agent/task-chat` to relay-only | M | `server/routes/agent.ts` | Phase 0 |
| 1.4 | Convert `/api/agent/dispatch` to relay-only | S | `server/routes/agent.ts` | Phase 0 |
| 1.5 | Convert `/api/agent/summarize` to relay-only | S | `server/routes/agent.ts` | Phase 0 |
| 1.6 | Convert `/api/dispatch/task` to relay-only, delete `dispatchLocal()` | M | `server/routes/dispatch.ts` | Phase 0 |
| 1.7 | Delete provider adapters and registry | S | `server/lib/providers/` | 1.1-1.6 |
| 1.8 | Delete `procedure-classifier.ts` direct AI call | XS | `server/lib/dispatch/` | 1.7 |
| 1.9 | Remove `initializeProviders()` from startup | XS | `server/index.ts` | 1.7 |
| 1.10 | Frontend: auto-select machine when no targetMachineId | S | `src/stores/execution-store.ts`, `src/stores/agent-store.ts` | 1.1 |

### Phase 2: Test Infrastructure

| # | Task | Effort | Files | Blocked By |
|---|------|--------|-------|------------|
| 2.1 | Set up Jest + testing config | S | `jest.config.ts`, `package.json` | — |
| 2.2 | Backend route tests (agent.ts, dispatch.ts) | M | `server/test/` | Phase 1 |
| 2.3 | Agent runner executor tests | M | `packages/agent-runner/test/` | Phase 0 |
| 2.4 | Execution strategy tests (mock binaries) | M | `packages/agent-runner/test/` | — |
| 2.5 | Frontend store tests | M | `src/__tests__/` | — |
| 2.6 | E2E smoke test (create → plan → execute → result) | L | `e2e/` | Phase 1 |

### Phase 3: Remote Machine UX

| # | Task | Effort | Files | Blocked By |
|---|------|--------|-------|------------|
| 3.1 | SSH host classification (HPC/compute/storage/rented) | S | `server/lib/local-backends.ts`, `src/pages/environments.tsx` | — |
| 3.2 | "Install Agent Runner" button on Environments page | M | `src/pages/environments.tsx`, new API endpoint | — |
| 3.3 | Wire to `ssh-installer.ts` via backend API | M | `server/routes/`, `packages/agent-runner/src/lib/ssh-installer.ts` | 3.2 |
| 3.4 | Async strategy UX ("waiting for resources" state) | S | `src/components/execution/execution-panel.tsx` | — |
| 3.5 | Rented VM quick-setup documentation | S | `docs/` | — |

### Phase 4: Polish & Deploy

| # | Task | Effort | Files | Blocked By |
|---|------|--------|-------|------------|
| 4.1 | CI/CD pipeline (GitHub Actions) | M | `.github/workflows/` | Phase 2 |
| 4.2 | Publish `@astro/agent` to npm | S | `packages/agent-runner/package.json` | — |
| 4.3 | Fly.io load testing | M | — | Phase 1 |
| 4.4 | Bug fixes from testing | M | — | Phase 2, 3 |
| 4.5 | Beta launch | — | — | Phase 1-4 |

---

## 11. Effort Estimates

| Size | Meaning |
|------|---------|
| XS | < 1 hour of focused work |
| S | 1-4 hours |
| M | 4-16 hours (1-2 days) |
| L | 16-40 hours (3-5 days) |
| XL | 40+ hours (1+ weeks) |

### Phase totals

| Phase | Total Effort | Description |
|-------|-------------|-------------|
| **Phase 0** | S-M | Protocol fix (4 fields + forwarding) |
| **Phase 1** | L-XL | Server/local mode separation (the big refactor) |
| **Phase 2** | L | Test infrastructure + core tests |
| **Phase 3** | M-L | Remote machine UX improvements |
| **Phase 4** | M | CI/CD, npm publish, load testing, bugs |

---

## 12. Dependency Graph

```
Phase 0: Protocol Fix
  │
  ├──→ Phase 1: Server/Local Mode Separation
  │       │
  │       ├──→ Phase 2: Test Infrastructure (tests the new architecture)
  │       │       │
  │       │       └──→ Phase 4: Polish & Deploy
  │       │
  │       └──→ Phase 4: Load testing (needs relay-only paths)
  │
  └──→ Phase 3: Remote Machine UX (independent, can run in parallel with Phase 1)

Legend: ──→ means "must complete before"
```

**Phase 3 can run in parallel with Phase 1.** SSH host classification, rented VM docs, and async UX don't depend on the server/local mode separation.

---

## 13. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Server/local separation introduces regressions | High | High | Write tests (Phase 2) in parallel with migration |
| Relay protocol changes break existing agent runners | Medium | High | Version the protocol; backward-compatible field additions |
| Supabase sync fails under load | Medium | Medium | Stress-test before beta; IndexedDB serves as safety net |
| npm publish delays | Low | Medium | Can distribute agent runner as tarball if needed |
| Chat quality degrades through relay (extra serialization hop) | Low | Medium | Test chat quality before/after migration |
| Users can't set up rented VMs | Medium | Medium | Good documentation + quick-setup flow (Phase 3) |

---

## 14. What "Beta Ready" Means

A beta user should be able to:

1. **Install and start** Astro backend locally (`npm run dev`)
2. **Install and connect** an agent runner (`npx astro-agent setup && astro-agent start -f`)
3. **Create a project** from the UI (title + repo URL)
4. **Generate an AI plan** that produces a task graph
5. **Execute tasks** from the plan (auto-dispatched through relay to agent runner)
6. **See real-time output** (terminal, tool traces, file changes)
7. **Get PRs created** automatically for completed tasks
8. **Chat** about plans and tasks
9. **Set up rented VMs** (Lambda Labs, Hyperbolic AI) by installing agent runners via SSH
10. **Dispatch tasks to remote machines** from the UI
11. **Not encounter crashes** or data loss in normal use

### What's NOT needed for beta

- Supabase/multi-user (local mode is sufficient for beta)
- SkyPilot cloud provisioning
- Native AWS/GCP/Azure strategies
- K8s batch Job strategy
- Comprehensive test coverage (but core path tests are needed)
- CI/CD (nice to have, not blocking)

---

## 15. Current Work In Progress

As of 2026-02-21, the server/local mode separation is actively being worked on (branch: `zhuoran/server-local-mode-separation`). Current status:

| Step | Status | Notes |
|------|--------|-------|
| Create `dispatchToRunner()` helper | Done | General-purpose relay dispatch helper |
| Convert `/generate-plan` to relay-only | Done | Local fallback removed |
| Convert `/chat` and `/task-chat` to relay-only | In Progress | Requires protocol changes |
| Convert `/dispatch` and `/summarize` to relay-only | Pending | Depends on protocol changes |
| Convert `/api/dispatch/task` to relay-only | Pending | Delete `dispatchLocal()` |
| Delete provider adapters | Pending | After all endpoints converted |
| Frontend machine auto-selection | Pending | After backend conversion |
| Build verification | Pending | Final step |
