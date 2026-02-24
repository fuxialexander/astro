# Astro — Implementation Pipeline

This document surveys the entire Astro system, catalogs what is implemented vs what is missing, and provides a prioritized checklist with **concrete implementation plans** for reaching an alpha (server mode + multi-user) and beta (full release) launch. Each action item includes the exact files to change, what to do in them, and what the expected result is — designed so you can vibe-code each one independently.

**Milestones**:
- **Alpha**: Server mode on Fly.io with multiple users. Backend calls NO AI directly — all through relay → agent runners. Deploy today and test with collaborators.
- **Beta**: Full release including local mode for open-source, comprehensive testing, npm publishing.

**Last updated**: 2026-02-24 (audited against commit `2fdaf27` on main)

---

## 1. Component Status Overview

```
Component         Implemented    Gaps     Beta-Ready?
──────────────────────────────────────────────────────────────────
Frontend          ███████████    ~92%     Nearly (27 stores, 16 pages, 10 component dirs)
Backend           ██████████░    ~95%     YES — relay-only architecture (execution path unified)
Relay             ██████████░    ~95%     YES (protocol fields added, PR #115 merged)
Agent Runner      ██████████░    ~95%     YES (protocol consumption working)
Data Persistence  ██████████░    ~92%     Nearly (32+ Postgres tables, IndexedDB working)
Testing           ███████░░░░    ~60%     Partial (29 vitest files, tests pass, scripts consolidated)
Deployment        █████████░░    ~85%     Nearly (Fly.io + Cloudflare configured)
──────────────────────────────────────────────────────────────────
Overall                                   YES — alpha blockers resolved
```

---

## 2. What Exists Now (Audited 2026-02-21)

### 2.1 Frontend — 27 stores, 16 pages, 10 component directories

**Pages (16)**: dashboard, projects, project-new, project-overview, plan-view, task-detail, my-tasks, environments, agents, initiatives, settings, device-auth, welcome, login, **team-invite** (new), **workflows** (new)

**Stores (27)**: project, plan, agent, execution, realtime, machines, slurm, user-profile, display-settings, usage, task-chat, activity, initiative, ui, settings, sidebar, connected-accounts, plugin, **team** (new), **auth** (new), **github** (new), **observation** (new), **session** (new), **skill** (new), **api-keys** (new), **keyboard-nav** (new), **toast** (new)

**New component directories**: `board/` (kanban), `mobile/`, `sharing/`, `views/`, `environments/`

**New hooks**: use-keyboard-nav, use-bar-drag-resize, use-voice-transcription, use-welcome-form-persistence, use-repo-setup

**New libs**: crypto-utils, git-url-utils, plugin-context, plugin-loader, skill-loader, color-icon-utils, api-url, sse-parser, realtime-sync

### 2.2 Backend — 20 route files, 30+ lib files, 28 DB tables

**Routes (20)**: agent, dispatch, events, relay, health, device-auth, data, auth, connected-accounts, **teams** (new), **observations** (new), **skills** (new), **transcribe** (new), **fs** (new), **repo** (new), **notifications** (new), **github** (new), **system** (new), **well-known** (new), **share** (new)

**New libs**: chat-session-pool, email-service, github-client, github-store, worktree-registry, repo-context, environment (validation), plugin-loader, skill-manager, signal-processor, cleanup-scheduler, error-utils, execution-event-bus, push-notifications

**New subsystems**: channel integration (5 files), observability (4 files), procedure system (executor, classifier, types), machine-selector

**DB tables (28)**: projects, initiatives, planNodes, planEdges, planNodeDependencies, userProfiles, displaySettings, usageMetrics, sessions (unified), taskChatSessions, taskChatMessages, taskExecutions, toolTraces, fileChanges, observationEvents, auditLogs, activityEvents, registeredMachines, machineUsageLogs, refreshTokens, pushTokens, connectedAccounts, passkeyCredentials, **teams** (new), **teamMembers** (new), **inviteTokens** (new), **projectMembers** (new), encryptedApiKeys (new)

### 2.3 Agent Runner — production-grade, 20+ lib files

All documented features present plus: SSH discovery/installer, 4-tier safety system (SAFE/GUARDED/RISKY/UNSAFE), token refresh with JWT expiry checks, slash command/skill discovery, dev mode fallback (unauthenticated ws://)

### 2.4 Testing — 29 vitest files, all passing

**Framework**: Vitest 4, configured in `vitest.config.ts`. Pattern: `**/__tests__/**/*.test.ts` + `tests/**/*.test.ts`.

**`tests/` (root-level, 16 vitest files)**:
- `relay-protocol-fields.test.ts` — 25 tests (relay protocol extension)
- `sse-parser.test.ts` — SSE stream parsing
- `chat-api-route.test.ts` — Chat API route tests
- `chat-hybrid-resume.test.ts` — Chat session resume
- `chat-mutations.test.ts` — Chat mutation tests
- `chat-session-flow.test.ts` — Chat session lifecycle
- `chat-session-pool.test.ts` — Session pool management
- `session-manager.test.ts` — Session management
- `execution-strategy.test.ts` — Direct/Slurm/Docker/K8s/SkyPilot strategies + registry (29 tests)
- `local-server-mode.test.ts` — App mode detection tests
- `smoke-trace-viewer.test.ts` — Trace viewer smoke tests
- `dispatch-engine.test.ts` — Dispatch queue, context assembler, result router, branch manager
- `codex-provider.test.ts` — Codex provider adapter (capabilities, context, detection)
- `claude-code-provider.test.ts` — Claude Code provider (dotenv, cache utils, session logger, config)
- `claude-code-sdk-integration.test.ts` — SDK integration (skipped without API key)
- `relay-server-integration.test.ts` — Relay server integration (skipped without running server)

**`server/lib/**/__tests__/` (co-located, 10 vitest files)**:
- `access/__tests__/user-access-control.test.ts` — Access control
- `dispatch/__tests__/procedure-executor.test.ts` — Procedure execution
- `events/__tests__/event-transport.test.ts` — Event transport system
- `events/hooks/__tests__/git-pull-hook.test.ts` — Git pull hook
- `events/hooks/__tests__/merge-queue-hook.test.ts` — Merge queue hook
- `events/hooks/__tests__/pr-creation-hook.test.ts` — PR creation hook
- `events/hooks/__tests__/usage-metrics-hook.test.ts` — Usage metrics hook
- `observability/__tests__/observation-collector.test.ts` — Observation collector
- `providers/__tests__/claude-code-adapter.test.ts` — Claude Code adapter (7 tests)
- `providers/__tests__/mcp-loader.test.ts` — MCP config loading

**`src/**/__tests__/` (frontend, 3 vitest files)**:
- `src/lib/__tests__/path-utils.test.ts` — Path utilities
- `src/stores/__tests__/session-store.test.ts` — Session store
- `src/stores/__tests__/observation-store.test.ts` — Observation store

**`scripts/` (consolidated test scripts, NOT part of vitest)**:
- `scripts/tests/` — 8 shell-based API tests used by `test-runner.sh`
- `scripts/test-approval-*` — 4 approval system test scripts (automated, integration, quick, e2e)
- `scripts/test-e2e-with-approval.sh` — Full E2E superset
- `scripts/test-*` — 6 misc test scripts (github-oauth, injection, preserve-worktrees, security, token-validation, trace-viewer)

**`tests/test-local-execution.ts`** — Manual integration test (not vitest, run with `npx tsx`)

---

## 3. The Core Problem: Server Mode Calls AI Directly

> **✅ FULLY RESOLVED** — The execution path unification (commit `01772cb`) deleted all server-side provider code and unified the architecture to relay-only. The server is now a thin web host + relay hub — all AI execution flows through agent runners via the relay.

### Historical Context

The original problem was that `server/routes/agent.ts` had 7 direct AI calls via `provider.stream()` / `provider.execute()`. This was resolved in two phases:

1. **Phase A** (commit `a11b35e`): Added `isServerMode()` guards to all 7 endpoints, routing to relay in server mode.
2. **Phase B** (commit `01772cb`): Deleted ~3500 lines of provider code entirely — `anthropic-direct.ts`, `claude-code.ts`, `codex.ts`, `mcp-loader.ts`, `session-manager.ts`, `worktree-manager.ts`, `chat-session-pool.ts`, and the procedure pipeline.

### Current State

All AI endpoints now use relay-only dispatch:

| Endpoint | Implementation |
|----------|----------------|
| `/generate-plan` | Builds `RelayTaskDispatch`, streams via relay (line 367+) |
| `/chat` | Calls `streamChatViaRelay()` directly (line 556) |
| `/task-chat` | Calls `streamChatViaRelay()` directly |
| `/compact` | Calls `streamChatViaRelay()` with type 'summarize' |
| `/dispatch` | Calls `streamChatViaRelay()` with type 'execution' |
| `/summarize` | Calls `executeViaRelay()` (non-streaming) |
| `/api/dispatch/task` | Uses `dispatchEngine` which routes through relay |

**Verification:**
```bash
# No direct provider calls remain
grep -n 'provider\.stream\|provider\.execute' server/routes/agent.ts  # → 0 matches
grep -n 'dispatchLocal' server/routes/dispatch.ts  # → 0 matches

# Relay helpers are the only execution path
grep -n 'streamChatViaRelay\|executeViaRelay\|RelayTaskDispatch' server/routes/agent.ts  # → multiple matches
```

### How It Should Work

```
┌────────────────────────────────────────────────────────────────┐
│  EVERY ENDPOINT THAT NEEDS AI                                   │
│                                                                 │
│  if (isServerMode()) {                                          │
│    → route through relay → agent runner (user's machine)        │
│    → Fly.io VM never touches AI credentials                     │
│  } else {                                                       │
│    → call provider locally (local dev, single-user)             │
│    → user's own machine has CLI tools + API keys                │
│  }                                                              │
└────────────────────────────────────────────────────────────────┘
```

### Two-Phase Fix

**Phase A (Quick Fix — Alpha):** Add `isServerMode()` guards to all 7 endpoints in `agent.ts` + the 1 in `dispatch.ts`. In server mode, build a relay `TaskDispatch` and stream results back. Keep local path untouched.

**Phase B (Long-Term — Beta):** Introduce a proper mode-aware architecture where `isServerMode()` / `isLocalMode()` is checked at the route level across all backend files, not just AI endpoints. Every file in the backend should follow the same pattern. Eventually, local mode may also route through a localhost relay for consistency.

---

## 4. Concrete Implementation Plans

### Phase 0: Merge Relay Protocol Fix (PR #115)

**Status**: ✅ DONE — merged into main (commit `4f81d69`).

Added `type`, `systemPrompt`, `messages`, `model` to `TaskDispatch` in `server/types/relay.ts`, mirrored in `packages/agent-runner/src/types.ts`, forwarded in `server/lib/relay-server.ts`, consumed in `packages/agent-runner/src/providers/claude-sdk-adapter.ts`. 25 unit tests pass.

---

### Phase A: Quick Fix — `isServerMode()` Guards (Alpha)

**Goal**: In server mode, all 7 AI-calling endpoints route through relay instead of calling providers locally. Local mode is untouched.

**Files to modify**:
1. `server/routes/agent.ts` — 6 endpoints
2. `server/routes/dispatch.ts` — 1 endpoint

**Approach**: Add a shared `streamViaRelay()` helper that builds a relay `TaskDispatch`, dispatches it, subscribes to relay events, and streams them back as SSE. Then wrap each endpoint's local path with `if (isServerMode()) { return streamViaRelay(...) }`.

**The helper pattern** (add to `agent.ts`):
```typescript
import { isServerMode } from '../lib/app-mode.js'

// Shared relay streaming helper for server mode
async function streamViaRelay(c, opts: {
  taskId: string, projectId: string, nodeId: string,
  prompt: string, systemPrompt?: string, maxTurns?: number,
  type?: 'chat' | 'plan' | 'execution' | 'summarize',
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>,
  workingDirectory?: string, targetMachineId?: string,
}) {
  const task: RelayTaskDispatch = {
    taskId: opts.taskId,
    projectId: opts.projectId,
    nodeId: opts.nodeId,
    title: opts.type || 'task',
    description: opts.prompt.slice(0, 200),
    environment: 'remote',
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    type: opts.type,
    messages: opts.messages,
    maxTurns: opts.maxTurns,
    workingDirectory: opts.workingDirectory,
  }
  // Dispatch, subscribe to relay events, stream as SSE
  // Pattern: same as generatePlanViaRelay() but generalized
}
```

**Per-endpoint changes** (each ~5 lines added):

| Endpoint | Guard location | What the guard does |
|----------|---------------|-------------------|
| `/generate-plan` (line 115) | Change `useRelay` condition | `const useRelay = isServerMode() \|\| (!!targetMachineId && !isLocalDir)` |
| `/chat` (line 644) | Add before `getChatProvider()` | `if (isServerMode()) return streamViaRelay(c, { type: 'chat', ... })` |
| `/task-chat` (line 791) | Add before `getChatProvider()` | `if (isServerMode()) return streamViaRelay(c, { type: 'chat', ... })` |
| `/compact` (line 950) | Add before `getChatProvider()` | `if (isServerMode()) return streamViaRelay(c, { type: 'summarize', ... })` |
| `/dispatch` (line 1068) | Add before `getProvider()` | `if (isServerMode()) return streamViaRelay(c, { type: 'execution', ... })` |
| `/summarize` (line 1279) | Add before `getChatProvider()` | `if (isServerMode()) return summarizeViaRelay(...)` |

For `dispatch.ts`, the guard goes at the top of the `/task` handler — in server mode, always `dispatchViaRelay()`.

**Error handling**: When `relayServer.dispatchTask()` returns false (no machine connected), return 503:
```json
{ "error": "No agent runner connected", "hint": "Run: npx astro-agent start --relay wss://..." }
```

**Verify**: `npm run build && npm run lint`

---

### Phase B: Proper Mode Separation (Long-Term / Beta)

**Goal**: Every file in the backend checks `isServerMode()` / `isLocalMode()` and follows the appropriate workflow. This is not just about AI endpoints — it's about the entire backend architecture.

**Scope**: All backend files should be mode-aware:
- Routes: AI dispatch, data persistence, auth middleware, events
- Libs: Session management, provider registry, dispatch engine
- Entry point: `server/index.ts` startup sequence

**What changes**:
1. **Remove local provider adapters entirely** — `anthropic-direct.ts`, `claude-code.ts`, `codex.ts`, `registry.ts`, `context.ts` — server never needs them
2. **Remove `initializeProviders()`** from startup — no provider detection in server mode
3. **Remove `chat-session-pool.ts`** — dead code once chat goes through relay
4. **Remove `procedure-classifier.ts`** direct AI call — move to agent runner or remove
5. **Local mode routes through localhost relay** — even local mode uses relay for consistency, with agent runner on localhost
6. **Single code path** — no `if/else` branching, just one relay-based architecture
7. **Frontend machine auto-selection** — when no `targetMachineId`, auto-select from connected machines

**This is the Option A approach** from the design doc — remove local paths entirely, require agent runner for everyone. Phase A (quick fix) is Option B — keep both paths, guard with `isServerMode()`.

---

**Phase B files to delete** (after Phase A is stable):
- `server/lib/providers/adapters/anthropic-direct.ts`
- `server/lib/providers/adapters/claude-code.ts`
- `server/lib/providers/adapters/codex.ts`
- `server/lib/providers/registry.ts`
- `server/lib/providers/context.ts`
- `server/lib/chat-session-pool.ts`
- `server/lib/dispatch/procedure-classifier.ts`

**Phase B files to modify**:
- `server/index.ts` — Remove `initializeProviders()` call
- `server/routes/agent.ts` — Remove all provider imports, remove local paths entirely
- `server/routes/dispatch.ts` — Remove `dispatchLocal()` (~480 lines)
- Frontend: auto-select machines, show "no runner" state

---

## 5. Beta Readiness Checklist (Updated)

### Legend
- `[x]` = Done
- `[~]` = Partially done
- `[ ]` = Not done
- `[!]` = BLOCKER

### 5.1 Core User Journey

```
[x] Create a project (title, description, repo URL)
[x] Generate an AI plan (graph of tasks with dependencies)
[x] Plan renders as interactive graph (React Flow)
[x] Edit plan nodes (title, description, dependencies)
[x] Add/remove nodes and edges
[x] Execute a task (dispatch to agent runner)
[x] Real-time output streaming (SSE)
[x] Tool traces, file changes, terminal output
[x] Git branch + PR on completion
[x] Cancel a running task
[x] Steer a running task (mid-execution guidance)
[x] Batch execution (auto-dispatch as deps complete)
[x] Chat with AI about a plan
[x] Chat with AI about a specific task
[x] Usage metrics (cost, tokens, task counts)
[x] Team management (create, invite, roles)
[x] Kanban board view
[x] Keyboard navigation
[x] GitHub integration (OAuth, SSH URLs)
[x] Observability (Langfuse trace export)
```

### 5.2 Architecture: Server/Local Mode Separation

```
Phase 0:
[x] Fix relay protocol: add messages, systemPrompt, type, model (PR #115, merged)

Phase A (Quick Fix — Alpha): ✅ DONE (commit a11b35e)
[x] Add isServerMode() guards + streamViaRelay() helper to agent.ts
[x]   → /generate-plan: force relay in server mode
[x]   → /chat: route through relay in server mode
[x]   → /task-chat: route through relay in server mode
[x]   → /compact: route through relay in server mode
[x]   → /dispatch: route through relay in server mode
[x]   → /summarize: route through relay in server mode
[x] Add isServerMode() guard to dispatch.ts /task endpoint
[x] 503 error handling when no agent runner connected

Phase B (Long-Term — Beta): ✅ DONE (commit 01772cb — execution path unification)
[x] Delete server-side provider adapters (anthropic-direct, claude-code, codex)
[x] Delete chat-session-pool.ts
[x] Delete procedure-classifier direct AI call
[x] Remove initializeProviders() from server/index.ts
[x] Remove dispatchLocal() from dispatch.ts (~480 lines deleted)
[ ] Frontend machine auto-selection
[ ] Local mode also routes through localhost relay
```

### 5.3 Agent Runner

```
[x] CLI setup + start + stop + status
[x] WebSocket with auto-reconnect + token refresh
[x] Claude SDK adapter (in-process, MCP, HPC context)
[x] Claude Code adapter (subprocess, steering)
[x] Codex adapter (subprocess, sandbox)
[x] Direct, Docker, SLURM, K8s Exec strategies
[x] 4-tier safety system
[x] Git worktree isolation
[x] PR creation
[x] MCP server (4 tools)
[x] SSH discovery + installer
[x] Skill/slash command discovery
[x] Handle protocol fields: type, systemPrompt, messages, model (PR #115)
```

### 5.4 Frontend

```
[x] 27 Zustand stores
[x] 16 page routes
[x] Plan graph + list + timeline + board views
[x] Task detail views (output, tools, files, steer, sessions)
[x] Chat panels (plan + task level)
[x] Approval dialogs
[x] Activity feed
[x] Command palette (Cmd+K with nested commands)
[x] Teams + invitations
[x] Environments page
[x] API key encryption
[x] Plugin system
[ ] Machine auto-selection when no targetMachineId (Plan 8)
[ ] "No agent runner" error state in execution panel (Plan 8)
```

### 5.5 Data & Persistence

```
[x] IndexedDB: all keys working
[x] Postgres: 28 tables with migrations
[x] Three-layer persistence
[x] Mode detection (local vs server)
[x] Soft-delete support
[x] Teams, team members, project members tables
[x] Encrypted API key storage
```

### 5.6 Testing

```
Vitest suite: 29 files, all passing (`npm test`)

[x] Relay integration tests (vitest, skipped without running server)
[x] Relay protocol extension tests (25 tests)
[x] SSE parser tests
[x] Chat API route tests
[x] Chat session flow/resume/mutation tests
[x] Session manager tests
[x] Claude Code adapter tests (7 tests — tool correlation, streaming)
[x] Claude Code provider tests (dotenv, cache utils, session logger, config)
[x] Claude Code SDK integration tests (vitest, skipped without API key)
[x] Codex provider tests (capabilities, context, detection)
[x] Dispatch engine tests (queue, context assembler, result router, branch manager)
[x] Hook tests (merge-queue, PR creation, git-pull, usage-metrics)
[x] Execution strategy unit tests (29 tests — Direct, Slurm, Docker, K8s, SkyPilot, Registry)
[x] Event transport tests
[x] Access control tests
[x] Procedure executor tests
[x] Observation collector tests
[x] MCP loader tests
[x] Frontend unit tests (path-utils, session-store, observation-store)
[x] App mode detection tests (local-server-mode)
[x] Trace viewer smoke tests
[x] Consolidated server/test/ into tests/ (vitest)
[x] Cleaned up redundant scripts/test-* files
[~] Shell-based API tests (scripts/tests/ — 8 scripts, not in vitest)
[~] Approval system tests (scripts/test-approval-* — 4 scripts, consolidated)
[ ] E2E smoke test (vitest-based)
[ ] CI/CD pipeline
```

### 5.7 Deployment

```
[x] Fly.io backend (Docker, fly.toml, deploy script)
[x] Cloudflare Pages frontend
[x] Cloudflare Tunnel (dev)
[x] Environment variable system (ASTRO_*)
[ ] CI/CD pipeline (GitHub Actions)
[ ] npm publish @astroanywhere/agent
```

---

## 6. Implementation Order

```
Phase 0:  Merge PR #115 (relay protocol fix)    ← DONE ✅
   │
   └─→ Phase A:  Quick Fix for Alpha (ONE PR)   ← DONE ✅ (commit a11b35e)
         │
         │  [x] Add isServerMode() import + relay type imports
         │  [x] Add streamViaRelay() shared helper
         │  [x] Guard all 7 endpoints with isServerMode()
         │  [x] 503 error when no runner connected
         │
         └─→ Phase B: Long-Term Cleanup          ← DONE ✅ (commit 01772cb)
               │
               │  Execution path unification deleted ~3500 lines:
               │  [x] Delete provider adapters + registry
               │  [x] Delete chat-session-pool + procedure-classifier
               │  [x] Remove initializeProviders()
               │  [x] Remove dispatchLocal()
               │
               └─→ Remaining work:
                     │
                     └─→ Frontend machine auto-selection

Phase A is a single PR — one shared helper + guards on 7 endpoints.
Phase B is deferred until after alpha testing validates the approach.
```

---

## 7. Alpha Version — Server Mode for Multi-User Testing

The **alpha** milestone focuses on **server mode**: deploying the Fly.io backend with Supabase, then testing with multiple users connecting their own agent runners. Local mode is deferred to the release — alpha is about validating the multi-user server architecture.

### 7.1 What Alpha Looks Like

```
┌─────────────────────────────────────────────────────────────────┐
│                         FLY.IO VM                                │
│                                                                  │
│   Hono API (3001) ─── Relay WS (3002) ─── Supabase (cloud)     │
│        ▲                    ▲         ▲                          │
│        │ HTTPS              │ WSS     │ Postgres                 │
└────────┼────────────────────┼─────────┼─────────────────────────┘
         │                    │         │
    ┌────┴────┐          ┌───┴────┐    │
    │ Browser │          │ Agent  │    │
    │ User A  │          │ Runner │    │
    └─────────┘          │ (A's   │    │
    ┌─────────┐          │ laptop)│    │
    │ Browser │          └────────┘    │
    │ User B  │          ┌────────┐    │
    └─────────┘          │ Agent  │    │
                         │ Runner │    │
                         │ (B's   │    │
                         │ laptop)│    │
                         └────────┘    │
```

- Backend on Fly.io — no AI credentials, just coordination
- Each user authenticates via WebAuthn (passkeys) on the frontend
- Each user runs `npx astro-agent start --relay wss://astro-relay.your-domain.com` on their laptop
- Agent runner authenticates via device code flow, connects to remote relay
- Users create projects, generate plans, dispatch tasks — all through relay → their own agent runner
- Multiple users can work simultaneously on the same or different projects

### 7.2 Alpha Blockers — What Must Be Done

**Critical (blocks all multi-user testing):**

| # | Blocker | Plan | Why Critical |
|---|---------|------|-------------|
| 1 | ~~Server calls AI directly for chat, task-chat, summarize, plan generation~~ | Plans 1-6 | **✅ RESOLVED** — Execution path unified (commit `01772cb`). Server-side provider code deleted (~3500 lines). All AI flows through relay. |
| 2 | `ANTHROPIC_API_KEY` treated as required in some code paths | Plan 7 | Server should never need this env var |
| 3 | ~~Merge relay protocol fix (PR #115)~~ | Plan 0 | **✅ RESOLVED** — PR #115 merged (commit `4f81d69`). Protocol fields `type`, `systemPrompt`, `messages`, `model` added to `TaskDispatch`. |

**Important (affects UX but not blockers):**

| # | Issue | Plan | Impact |
|---|-------|------|--------|
| 4 | Frontend assumes local machine for dispatch | Plan 8 | Users must manually select their machine from dropdown |
| 5 | No 503 error when agent runner disconnected | Plan 10 | Confusing errors instead of "connect your agent runner" |
| 6 | ~~Server-side provider adapters still exist~~ | Plan 7 | **✅ RESOLVED** — Deleted in execution path unification (commit `01772cb`) |

**Already Working for Server Mode:**

```
[x] Supabase Postgres — 32+ tables, migrations, RLS
[x] WebAuthn passkey auth — login page, credential storage
[x] Teams — creation, invitations, member roles
[x] Device code flow — agent runner auth against server
[x] Relay server — remote WebSocket with JWT auth
[x] Agent runner — remote connection with token refresh
[x] SSE event streaming — relay events → browser
[x] Frontend data persistence — IndexedDB cache + Supabase sync
[x] Fly.io deployment — Docker, fly.toml, deploy script
[x] Cloudflare Pages frontend — deployment configured
```

### 7.3 Alpha Implementation Order

```
Step 1: Merge PR #115 (relay protocol fix) ✅ DONE
   ↓
Step 2: Convert all 6 endpoints to relay-only (Plans 1-6) ✅ DONE
         — Completed via execution path unification (commit 01772cb)
         — Deleted ~3500 lines of server-side provider code
   ↓
Step 3: Add 503 error handling (Plan 10)
   ↓
Step 4: Deploy to Fly.io (already configured)
         — Set env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
           RELAY_JWT_SECRET, DEVICE_AUTH_JWT_SECRET, etc.
         — Deploy: npm run deploy:backend
   ↓
Step 5: Deploy frontend to Cloudflare Pages
         — Point to Fly.io API URL
   ↓
Step 6: Test with 2+ users
```

### 7.4 Alpha Testing Checklist

```
[ ] User A: Create WebAuthn passkey on login page
[ ] User A: Run agent runner, connect via device code
[ ] User A: Create project → generate plan → succeeds via relay
[ ] User A: Chat about plan → works via relay
[ ] User A: Dispatch task → executes on A's machine
[ ] User A: See real-time output in browser
[ ] User B: Repeat all of the above independently
[ ] Both: Work simultaneously without interference
[ ] Both: Can see their own projects (RLS isolation)
[ ] Edge: Stop agent runner → endpoints return 503 with clear message
[ ] Edge: Reconnect agent runner → tasks resume
```

### 7.5 Potential Multi-User Issues to Watch

| Issue | Symptom | Fix |
|-------|---------|-----|
| Machine registry doesn't distinguish users | User A's tasks dispatched to User B's runner | Ensure dispatch matches `userId` to runner ownership |
| RLS not enforced on all tables | User A can see User B's data | Audit Supabase RLS policies |
| Relay JWT shared secret is weak | Anyone can connect a runner | Use strong `RELAY_JWT_SECRET` in production |
| SSE stream cross-contamination | User A sees User B's task output | Verify SSE filtering by authenticated user |
| Agent runner reconnect drops tasks | Running task lost when WebSocket blips | Verify task resumption after reconnect |
| Passkey setup fails on non-HTTPS | WebAuthn requires secure context | Ensure Fly.io serves HTTPS |

### 7.6 Not Needed for Alpha

- Local mode (that's for the open-source release)
- Channel integrations (Slack, Telegram)
- Push notifications
- Comprehensive test coverage
- SkyPilot / K8s strategies
- npm publishing
- CI/CD pipeline

---

## 8. What "Beta Ready" Means (Full Release)

A beta user should be able to:

1. **Server mode (team)**: Deploy backend → invite team → each member connects agent runner → collaborate on plans
2. **Local mode (solo)**: `npm run dev` → `npx astro-agent start` → create project → generate plan → execute tasks
3. Generate AI plans, execute tasks, see real-time output
4. Get PRs created automatically
5. Chat about plans and tasks
6. Not encounter crashes or data loss

### Not needed for beta

- SkyPilot cloud provisioning
- Native AWS/GCP/Azure strategies
- K8s batch Job strategy
- Comprehensive test coverage (core path tests sufficient)

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Removing local fallback breaks users with no agent runner | High | High | Clear 503 error message + documentation (Plan 10) |
| Chat quality differs when routed through relay | Low | Medium | Same Claude SDK on agent runner; test before/after |
| `dispatchLocal()` deletion misses edge cases | Medium | Medium | Thorough `npm run build` after deletion; existing tests catch regressions |
| Agent runner not auto-starting with `npm run dev` | Medium | Medium | Add to `concurrently` in package.json dev script |

---

## 10. Post-Beta Roadmap

After beta, these are the next priorities:

| Feature | Effort | Notes |
|---------|--------|-------|
| K8s Job strategy (batch workloads) | M | `kubectl apply -f job.yaml` + polling |
| SSH host classification in Environments | S | HPC vs compute vs storage labels |
| "Install Agent Runner" button | M | Wire to `ssh-installer.ts` |
| Rented VM setup wizard | M | Guided flow in UI |
| CI/CD pipeline (GitHub Actions) | M | Build + lint + test on PRs |
| npm publish `@astroanywhere/agent` | S | Package on npm registry |
| Supabase stress testing | M | Multi-device concurrent load |
| SkyPilot strategy completion | L | Experimental → stable |
