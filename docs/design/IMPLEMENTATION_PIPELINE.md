# Astro — Implementation Pipeline

This document surveys the entire Astro system, catalogs what is implemented vs what is missing, and provides a prioritized checklist with **concrete implementation plans** for reaching an alpha (server mode + multi-user) and beta (full release) launch. Each action item includes the exact files to change, what to do in them, and what the expected result is — designed so you can vibe-code each one independently.

**Milestones**:
- **Alpha**: Server mode on Fly.io with multiple users. Backend calls NO AI directly — all through relay → agent runners. Deploy today and test with collaborators.
- **Beta**: Full release including local mode for open-source, comprehensive testing, npm publishing.

**Last updated**: 2026-02-21 (audited against commit `15f0327` on main)

---

## 1. Component Status Overview

```
Component         Implemented    Gaps     Beta-Ready?
──────────────────────────────────────────────────────────────────
Frontend          ███████████    ~92%     Nearly (27 stores, 16 pages, 10 component dirs)
Backend           ████████░░░    ~75%     NO — still calls AI directly for chat/plan/summarize
Relay             █████████░░    ~88%     Nearly (protocol fix in PR #115)
Agent Runner      ██████████░    ~90%     Nearly (protocol consumption in PR #115)
Data Persistence  ██████████░    ~92%     Nearly (28 Postgres tables, IndexedDB working)
Testing           ███░░░░░░░░    ~25%     NO — some tests exist but coverage low
Deployment        █████████░░    ~85%     Nearly (Fly.io + Cloudflare configured)
──────────────────────────────────────────────────────────────────
Overall                                   NO — 2 blockers remain
```

---

## 2. What Exists Now (Audited 2026-02-21)

### 2.1 Frontend — 27 stores, 16 pages, 10 component directories

**Pages (16)**: dashboard, projects, project-new, project-overview, plan-view, task-detail, my-tasks, environments, agents, initiatives, settings, device-auth, welcome, login, **team-invite** (new), **workflows** (new)

**Stores (27)**: project, plan, agent, execution, realtime, machines, slurm, user-profile, display-settings, usage, task-chat, activity, initiative, ui, settings, sidebar, connected-accounts, plugin, **team** (new), **auth** (new), **github** (new), **observation** (new), **session** (new), **skill** (new), **api-keys** (new), **keyboard-nav** (new), **toast** (new)

**New component directories**: `board/` (kanban), `mobile/`, `sharing/`, `views/`, `environments/` (machine-config-dialog)

**New hooks**: use-keyboard-nav, use-bar-drag-resize, use-voice-transcription, use-welcome-form-persistence, use-repo-setup

**New libs**: crypto-utils, git-url-utils, plugin-context, plugin-loader, skill-loader, color-icon-utils, api-url, sse-parser, realtime-sync

### 2.2 Backend — 20 route files, 30+ lib files, 28 DB tables

**Routes (20)**: agent, dispatch, events, relay, health, device-auth, data, auth, connected-accounts, **teams** (new), **observations** (new), **skills** (new), **transcribe** (new), **fs** (new), **repo** (new), **notifications** (new), **github** (new), **system** (new), **well-known** (new), **share** (new)

**New libs**: chat-session-pool, email-service, github-client, github-store, worktree-registry, repo-context, environment (validation), plugin-loader, skill-manager, signal-processor, cleanup-scheduler, error-utils, execution-event-bus, push-notifications

**New subsystems**: channel integration (5 files), observability (4 files), procedure system (executor, classifier, types), machine-selector

**DB tables (28)**: projects, initiatives, planNodes, planEdges, planNodeDependencies, userProfiles, displaySettings, usageMetrics, sessions (unified), taskChatSessions, taskChatMessages, taskExecutions, toolTraces, fileChanges, observationEvents, auditLogs, activityEvents, registeredMachines, machineUsageLogs, refreshTokens, pushTokens, connectedAccounts, passkeyCredentials, **teams** (new), **teamMembers** (new), **inviteTokens** (new), **projectMembers** (new), encryptedApiKeys (new)

### 2.3 Agent Runner — production-grade, 20+ lib files

All documented features present plus: SSH discovery/installer, 4-tier safety system (SAFE/GUARDED/RISKY/UNSAFE), token refresh with JWT expiry checks, slash command/skill discovery, dev mode fallback (unauthenticated ws://)

### 2.4 Testing — improved from before

**Tests that exist now** (in `tests/`):
- `relay-protocol-fields.test.ts` — 25 tests (relay protocol extension)
- `sse-parser.test.ts` — SSE stream parsing
- `chat-api-route.test.ts` — Chat API route tests
- `chat-hybrid-resume.test.ts` — Chat session resume
- `chat-mutations.test.ts` — Chat mutation tests
- `chat-session-flow.test.ts` — Chat session lifecycle
- `chat-session-pool.test.ts` — Session pool management
- `session-manager.test.ts` — Session management

**Tests in `server/test/`**:
- `relay-server.test.ts` — Relay integration
- `claude-code-provider.test.ts` — Provider adapter tests
- `claude-code-sdk-integration.test.ts` — SDK integration

**Hook tests**: `server/lib/events/hooks/__tests__/merge-queue-hook.test.ts`, `pr-creation-hook.test.ts`

---

## 3. The 2 Remaining Blockers

### Blocker A: Server Still Calls AI Directly

The backend calls AI providers directly for chat, task-chat, summarize, and parts of plan generation / dispatch. The target architecture routes ALL AI through relay → agent runner.

**Status of the fix**: PR #115 (`zhuoran/relay-protocol-fix`) adds the 4 missing protocol fields (`type`, `systemPrompt`, `messages`, `model`). Once merged, the endpoint conversions can proceed.

### Blocker B: No Error Recovery Path When Agent Runner Is Down

When no agent runner is connected, chat/plan/dispatch endpoints currently fall back to calling AI locally. After removing that fallback, we need clean error handling so users get a clear message instead of a crash.

---

## 4. Concrete Implementation Plans

Each plan below is self-contained and can be vibe-coded independently. They are in dependency order.

---

### Plan 0: Merge Relay Protocol Fix (PR #115)

**Status**: PR open, ready to merge.

**What to do**: Merge PR #115 into main. This adds `type`, `systemPrompt`, `messages`, `model` to `TaskDispatch` in `server/types/relay.ts`, mirrors them in `packages/agent-runner/src/types.ts`, forwards them in `server/lib/relay-server.ts`, and consumes them in `packages/agent-runner/src/providers/claude-sdk-adapter.ts`.

**Verify**: `npm run build && npx vitest run tests/relay-protocol-fields.test.ts`

---

### Plan 1: Convert `/api/agent/chat` to relay-only

**Goal**: Remove local AI calls from the chat endpoint. All chat goes through relay → agent runner.

**Files to modify**:
1. `server/routes/agent.ts` — the `/chat` endpoint handler

**Current behavior** (what to find in agent.ts):
- The `/chat` endpoint builds a prompt from conversation history
- It calls `getChatProvider()` → `provider.stream()` to get a response
- It streams the response back via SSE

**What to change**:
1. Open `server/routes/agent.ts`
2. Find the `/chat` POST handler (search for `'/chat'`)
3. Instead of calling `getChatProvider()` / `provider.stream()`, build a `TaskDispatch` object:
   ```typescript
   const task: TaskDispatch = {
     taskId: `chat-${Date.now()}`,
     projectId: req.body.projectId,
     nodeId: '',  // chat has no specific node
     title: 'Chat',
     description: lastUserMessage,
     environment: 'local',
     type: 'chat',
     systemPrompt: buildChatSystemPrompt(project),  // reuse existing prompt from prompt-templates.ts
     messages: req.body.messages,  // pass conversation history
     model: req.body.model,
     maxTurns: 1,  // single-turn response
     workingDirectory: project.workingDirectory,
   };
   ```
4. Dispatch via relay: `relayServer.dispatchTask(task, targetMachineId)`
5. Stream relay events back to the client via SSE (reuse the pattern from `generatePlanViaRelay()`)
6. If no agent runner is connected, return `{ error: "No agent runner connected. Start one with: npx astro-agent start" }` with HTTP 503

**Key function to reuse**: Look at how `generatePlanViaRelay()` in agent.ts dispatches and streams — the chat endpoint should follow the same pattern.

**Error case**: If `machineRegistry.findBestMachine()` returns null, respond with 503 and a clear message. Do NOT fall back to local AI.

**Test**: Start backend without agent runner → POST to `/api/agent/chat` → should get 503 error, not a crash.

**Verify**: `npm run build && npm run lint`

---

### Plan 2: Convert `/api/agent/task-chat` to relay-only

**Goal**: Same as Plan 1 but for task-specific chat.

**Files to modify**: `server/routes/agent.ts` — the `/task-chat` endpoint

**What to change**: Nearly identical to Plan 1, but:
- The `nodeId` comes from the request body (it's chat about a specific task)
- The system prompt should include task context (execution output, tool traces)
- Use `type: 'chat'` on the TaskDispatch

**Implementation**: Follow the exact same pattern as Plan 1. The only difference is the system prompt construction — task-chat includes task output context.

---

### Plan 3: Convert `/api/agent/summarize` to relay-only

**Goal**: Remove the direct Anthropic API call for summarization.

**Files to modify**: `server/routes/agent.ts` — the `/summarize` endpoint

**Current behavior**: Calls Anthropic Messages API directly with a summarization prompt.

**What to change**:
1. Find the `/summarize` POST handler in agent.ts
2. Build a TaskDispatch:
   ```typescript
   const task: TaskDispatch = {
     taskId: `summarize-${Date.now()}`,
     projectId,
     nodeId,
     title: 'Summarize task output',
     description: 'Generate a concise summary of the task execution output.',
     environment: 'local',
     type: 'summarize',
     systemPrompt: 'Summarize the following task execution output concisely...',
     prompt: taskOutput,  // the text to summarize
     maxTurns: 1,
     model: 'claude-haiku',  // use fast model for summarization
   };
   ```
3. Dispatch via relay, collect result, return summary text
4. If no agent runner, return 503

**Note**: This is the simplest conversion — single-turn, no streaming needed, just collect the result.

---

### Plan 4: Convert `/api/agent/generate-plan` local fallback to relay-only

**Goal**: Remove the local execution path from plan generation. Currently, if no `targetMachineId` is provided, it calls AI locally.

**Files to modify**: `server/routes/agent.ts` — the `/generate-plan` endpoint

**Current behavior**: Has two paths:
- If `targetMachineId` → `generatePlanViaRelay()` (correct)
- Else → `providerRegistry.getProvider()` → `provider.stream()` (wrong)

**What to change**:
1. Find the `/generate-plan` handler in agent.ts
2. Remove the local execution path (the `else` branch that calls provider.stream)
3. When no `targetMachineId`, auto-select: `machineRegistry.findBestMachine('local')`
4. If no machine found, return 503 with message
5. Always call `generatePlanViaRelay()` with the auto-selected or provided machineId
6. Add `type: 'plan'` and `systemPrompt` to the TaskDispatch inside `generatePlanViaRelay()`

**The relay path already works** — this is just deleting the fallback and adding auto-selection.

---

### Plan 5: Convert `/api/dispatch/task` to relay-only

**Goal**: Remove `dispatchLocal()` from dispatch.ts. All task execution goes through relay.

**Files to modify**: `server/routes/dispatch.ts`

**Current behavior**: Has two paths:
- If relay has a machine → `dispatchViaRelay()` (correct)
- Else → `dispatchLocal()` (wrong — ~480 lines of local execution code)

**What to change**:
1. Find the `/task` POST handler in dispatch.ts
2. Remove the `dispatchLocal()` function call entirely
3. Always call `dispatchViaRelay()`
4. If no agent runner connected, return 503
5. Delete the `dispatchLocal()` function (large block, ~480 lines)
6. Delete the `classifyTask()` call if it calls Anthropic API directly
7. Remove imports that are only used by `dispatchLocal()`

**This is the biggest deletion** — removing ~480 lines of local execution code. Be careful to preserve the relay path.

**Verify**: `npm run build` (many imports may become unused — clean them up)

---

### Plan 6: Convert `/api/agent/dispatch` to relay-only

**Goal**: The agent.ts dispatch endpoint also has a local path.

**Files to modify**: `server/routes/agent.ts`

**What to change**: Same pattern as Plans 1-5. Find the dispatch handler, remove local path, always use relay.

---

### Plan 7: Delete server-side provider adapters

**Goal**: Remove all code that allows the server to call AI directly.

**Files to delete**:
- `server/lib/providers/adapters/anthropic-direct.ts`
- `server/lib/providers/adapters/claude-code.ts`
- `server/lib/providers/adapters/codex.ts`
- `server/lib/providers/registry.ts`
- `server/lib/providers/context.ts`

**Files to keep**:
- `server/lib/providers/types.ts` (StreamEvent, TaskDispatch types used by relay)
- `server/lib/providers/cache-utils.ts` (if used elsewhere)
- `server/lib/providers/session-logger.ts` (if used elsewhere)

**Files to modify**:
- `server/index.ts` — Remove `initializeProviders()` call and import
- `server/routes/agent.ts` — Remove all imports from providers (getProvider, providerRegistry, etc.)
- `server/routes/dispatch.ts` — Remove provider imports
- `server/lib/dispatch/procedure-classifier.ts` — If this calls Anthropic API directly, either delete the file or move the classification to the agent runner

**How to verify nothing breaks**: After deletion, run `npm run build`. Any remaining references to deleted files will show as TypeScript errors. Fix each one by either removing the import or replacing with relay dispatch.

**Verify**: `npm run build && npm run lint`

---

### Plan 8: Frontend machine auto-selection

**Goal**: When user dispatches a task without selecting a machine, frontend auto-selects.

**Files to modify**:
1. `src/stores/execution-store.ts` — Add auto-selection logic before dispatch
2. `src/stores/agent-store.ts` — Same for plan generation
3. `src/components/execution/execution-panel.tsx` — Show "No agent runner connected" state

**What to change in execution-store.ts**:
1. Find the `dispatchTask()` or equivalent function
2. Before making the API call, if no `targetMachineId`:
   ```typescript
   if (!targetMachineId) {
     const res = await fetch('/api/relay/best-machine');
     const data = await res.json();
     if (!data.machine) {
       // Show error: "No agent runner connected"
       return;
     }
     targetMachineId = data.machine.machineId;
   }
   ```

**What to change in execution-panel.tsx**:
- When machine list is empty, show a banner: "No agent runner connected. Run `npx astro-agent start` to connect."
- Use `useMachinesStore()` to check connected machines

---

### Plan 9: Clean up `chat-session-pool.ts` and `procedure-classifier.ts`

**Goal**: These files call AI directly from the server process.

**`server/lib/chat-session-pool.ts`**: This pools Claude SDK sessions for chat. After Plans 1-2 (chat via relay), this becomes dead code.
- **Action**: Delete the file
- **Update**: Remove import from any file that references it

**`server/lib/dispatch/procedure-classifier.ts`**: Calls Anthropic Haiku to classify tasks into procedure types.
- **Option A**: Delete it entirely — let the agent runner handle procedure classification as part of task execution
- **Option B**: Move the classification call into the agent runner's task executor, so it runs on the user's machine with their credentials
- **Recommendation**: Option A is simpler. The procedure system can still work — just don't auto-classify. Let the user or the plan generation choose the procedure type.

---

### Plan 10: Add "no agent runner" error handling across all endpoints

**Goal**: After removing all local fallbacks, every endpoint that needs an agent runner should return a clear 503 error.

**Files to modify**: `server/routes/agent.ts`, `server/routes/dispatch.ts`

**What to add**: A shared helper function:

```typescript
// server/lib/require-runner.ts
import { machineRegistry } from './machine-registry';

export function requireRunner(environment: string = 'local', provider?: string) {
  const machine = machineRegistry.findBestMachine(environment, provider);
  if (!machine) {
    return null;
  }
  return machine;
}
```

Then in each endpoint:
```typescript
const machine = requireRunner();
if (!machine) {
  return c.json({
    error: 'No agent runner connected',
    hint: 'Start one with: npx astro-agent start',
  }, 503);
}
```

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
[x] Fix relay protocol: add messages, systemPrompt, type, model (PR #115)
[!] Convert /api/agent/chat to relay-only (Plan 1)
[!] Convert /api/agent/task-chat to relay-only (Plan 2)
[!] Convert /api/agent/summarize to relay-only (Plan 3)
[!] Convert /api/agent/generate-plan local fallback (Plan 4)
[!] Convert /api/dispatch/task — delete dispatchLocal (Plan 5)
[!] Convert /api/agent/dispatch to relay-only (Plan 6)
[ ] Delete server-side provider adapters (Plan 7)
[ ] Delete procedure-classifier direct AI call (Plan 9)
[ ] Remove chat-session-pool (Plan 9)
[ ] Frontend machine auto-selection (Plan 8)
[ ] Add 503 error handling for no runner (Plan 10)
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
[x] Relay integration tests
[x] Relay protocol extension tests (25 tests)
[x] SSE parser tests
[x] Chat API route tests
[x] Chat session flow/resume/mutation tests
[x] Session manager tests
[x] Claude Code provider tests
[x] Hook tests (merge-queue, PR creation)
[ ] Execution strategy unit tests
[ ] E2E smoke test
[ ] CI/CD pipeline
```

### 5.7 Deployment

```
[x] Fly.io backend (Docker, fly.toml, deploy script)
[x] Cloudflare Pages frontend
[x] Cloudflare Tunnel (dev)
[x] Environment variable system (ASTRO_*)
[ ] CI/CD pipeline (GitHub Actions)
[ ] npm publish @astro/agent
```

---

## 6. Implementation Order

```
Plan 0:  Merge PR #115 (relay protocol fix)     ← do first
   │
   ├─→ Plan 1:  Convert /chat to relay-only
   ├─→ Plan 2:  Convert /task-chat to relay-only
   ├─→ Plan 3:  Convert /summarize to relay-only
   ├─→ Plan 4:  Convert /generate-plan (remove local fallback)
   ├─→ Plan 5:  Convert /dispatch/task (delete dispatchLocal)
   └─→ Plan 6:  Convert /agent/dispatch to relay-only
         │
         ├─→ Plan 7:  Delete provider adapters + registry
         ├─→ Plan 9:  Delete chat-session-pool + procedure-classifier
         └─→ Plan 10: Add 503 error handling
               │
               └─→ Plan 8: Frontend machine auto-selection

Plans 1-6 can be done in any order (all depend only on Plan 0).
Plans 7, 9, 10 can be done after Plans 1-6 are all complete.
Plan 8 can be done after Plan 10.
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
- Each user runs `npx astro-agent start --relay wss://astro-relay.fuxialexander.work` on their laptop
- Agent runner authenticates via device code flow, connects to remote relay
- Users create projects, generate plans, dispatch tasks — all through relay → their own agent runner
- Multiple users can work simultaneously on the same or different projects

### 7.2 Alpha Blockers — What Must Be Done

**Critical (blocks all multi-user testing):**

| # | Blocker | Plan | Why Critical |
|---|---------|------|-------------|
| 1 | Server calls AI directly for chat, task-chat, summarize, plan generation | Plans 1-6 | Fly.io VM has no Claude credentials. These endpoints will FAIL in server mode. |
| 2 | `ANTHROPIC_API_KEY` treated as required in some code paths | Plan 7 | Server should never need this env var |
| 3 | Merge relay protocol fix (PR #115) | Plan 0 | Prerequisite for Plans 1-6 |

**Important (affects UX but not blockers):**

| # | Issue | Plan | Impact |
|---|-------|------|--------|
| 4 | Frontend assumes local machine for dispatch | Plan 8 | Users must manually select their machine from dropdown |
| 5 | No 503 error when agent runner disconnected | Plan 10 | Confusing errors instead of "connect your agent runner" |
| 6 | Server-side provider adapters still exist | Plan 7 | Dead code, confusing, but doesn't block |

**Already Working for Server Mode:**

```
[x] Supabase Postgres — 28 tables, migrations, RLS
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
Step 1: Merge PR #115 (relay protocol fix)
   ↓
Step 2: Convert all 6 endpoints to relay-only (Plans 1-6)
         — This is the one big push. Each is independent.
         — Minimal effort per endpoint: ~30 lines changed each
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
| npm publish `@astro/agent` | S | Package on npm registry |
| Supabase stress testing | M | Multi-device concurrent load |
| SkyPilot strategy completion | L | Experimental → stable |
