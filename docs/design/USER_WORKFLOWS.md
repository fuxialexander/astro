# Astro User Workflows — Design Document

## 1. Overview

This document describes the end-to-end user workflows in Astro, tracing how data flows between the four components (Frontend, Backend, Relay, Agent Runner) for each major operation.

For a summary of component responsibilities and mode differences, see `ARCHITECTURE.md`.

```
┌──────────────────────────────────────────────────────────────────┐
│  ASTRO WORKFLOW MAP                                              │
│                                                                  │
│  Setup ────► Create Project ────► Generate Plan ────► Execute    │
│                                       │                  │       │
│                                       │                  │       │
│                                       ▼                  ▼       │
│                                  Chat About Plan    Monitor Task  │
│                                       │                  │       │
│                                       │                  ├─ Steer │
│                                       │                  ├─ Chat  │
│                                       ▼                  ▼       │
│                                  Modify Plan       Approve/Judge │
│                                       │                  │       │
│                                       └──────┬───────────┘       │
│                                              │                   │
│                                              ▼                   │
│                                    Execute Next Tasks            │
│                                    (batch or manual)             │
│                                              │                   │
│                                              ▼                   │
│                                    Project Complete               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Setup and First Run

### 2.1 Local Mode Setup

| Step | Component | Action |
|------|-----------|--------|
| 1 | **User** | Run `npm run dev` |
| 2 | **Backend** | Starts Hono server on port 3001 |
| 3 | **Relay** | Starts WebSocket server on port 3002 (inside same process) |
| 4 | **User** | Run `npx astro-agent start -f` |
| 5 | **Agent Runner** | Detect providers (Claude CLI, Claude SDK, Codex) |
| 6 | **Agent Runner** | Detect execution strategies (Direct, Docker, SLURM, K8s, SkyPilot) |
| 7 | **Agent Runner** | Connect to `ws://localhost:3002` |
| 8 | **Agent Runner** | Send `machine.register` with capabilities, resources, providers |
| 9 | **Relay** | Add machine to registry, send `machine.register.ack` |
| 10 | **Backend** | Broadcast `machine:connected` via `/api/events/stream` SSE |
| 11 | **User** | Open `http://localhost:5173` in browser |
| 12 | **Frontend** | `DataLoader` triggers API fetches for all stores from the Hono backend (no auth required in local mode) |
| 13 | **Frontend** | `realtime-store` connects to `/api/events/stream`, receives `machine:connected` |
| 14 | **Frontend** | Dashboard shows connected machine |

### 2.2 Server Mode Setup

**Phase 1 — Server deployment:**

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Ops** | Deploy Backend + Relay to Fly.io. Provision Postgres (Supabase). Set env vars. |
| 2 | **Ops** | Deploy Frontend to Cloudflare Pages. |

**Phase 2 — User registration:**

| Step | Component | Action |
|------|-----------|--------|
| 3 | **User** | Open `https://astro.domain` in browser |
| 4 | **Frontend** | Show login page |
| 5 | **User** | Register/login via WebAuthn passkey |
| 6 | **Frontend** | Supabase Auth session established. JWT stored. |

**Phase 3 — Machine registration (device code flow, RFC 8628):**

| Step | Component | Action |
|------|-----------|--------|
| 7 | **User** | Run `npx astro-agent setup --api https://astro-api.domain --relay wss://astro-relay.domain` |
| 8 | **Agent Runner** | Detect providers and resources |
| 9 | **Agent Runner** | `POST /api/device/authorize` → receive `{ user_code: "ABCD-1234", device_code: "xxx" }` |
| 10 | **Agent Runner** | Display: "Enter code ABCD-1234 at https://astro.domain/device" |
| 11 | **User** | Open `/device` in browser, enter code, authenticate via WebAuthn, approve device |
| 12 | **Agent Runner** | Polling `POST /api/device/token` every 5s → eventually receives `{ access_token, refresh_token, machine_id }` |
| 13 | **Agent Runner** | Store tokens in `~/.config/astro-agent/config.json` |
| 14 | **User** | Run `npx astro-agent start -f` |
| 15 | **Agent Runner** | Connect to `wss://astro-relay.domain` with JWT in `Authorization` header |
| 16 | **Agent Runner** | Send `machine.register` with capabilities |
| 17 | **Relay** | Verify JWT, add to registry, send `machine.register.ack` |
| 18 | **Backend** | Persist machine to `registeredMachines` Postgres table |
| 19 | **Backend** | Broadcast `machine:connected` via SSE |
| 20 | **Frontend** | Machine appears in Environments page |

---

## 3. Workflow: Create Project and Generate Plan

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Frontend** | User fills form: description, optional repo URL, optional working directory, optional environment |
| 2 | **Frontend** | Create `Project` object: `{ id: uuid(), name: "New Project", description, status: "active", color: random, icon: random }` |
| 3 | **Frontend** | `projectStore.addProject(project)` → Zustand (optimistic) + API call |
| 4 | **Frontend** | Navigate to `/project/{id}/plan` |
| 5 | **Frontend** | If repo URL provided: `POST /api/repo/setup` → Relay → Agent Runner clones repo, returns `git ls-files` → update `project.fileTree` |
| 6 | **Frontend** | `agentStore.startGeneration()` → `POST /api/agent/generate-plan` |
| 7 | **Backend** | Validate input (Zod: description ≤ 50K, fileTree ≤ 10K items, visionDoc ≤ 100K) |
| 8 | **Backend** | Build system prompt: `buildPlanSystemPrompt(visionDoc, repoContext)` |
| 9 | **Backend** | Route to Agent Runner via Relay (or call AI directly in current state) |
| 10 | **Agent Runner** | Claude SDK `query()` with plan prompt. Stream text chunks back. |
| 11 | **Frontend** | Receive SSE `"text"` events → append to `agentStore.session.streamText` (live preview in generation overlay) |
| 12 | **Frontend** | Receive `"plan_result"` event → JSON with `{ projectName, nodes[], edges[] }` |
| 13 | **Frontend** | Parse nodes/edges. Prefix all node IDs with `projectId[:8]` for global uniqueness. |
| 14 | **Frontend** | Auto-assign milestones via backward BFS through dependency edges |
| 15 | **Frontend** | `planStore.setProjectPlan(projectId, nodes, edges)` → `reorganizeProject()` for auto-layout |
| 16 | **Frontend** | Persist via API call to Hono backend (Drizzle ORM to PGlite or Postgres) |
| 17 | **Frontend** | Plan graph rendered in React Flow (`plan-canvas.tsx`) |

### Plan JSON Format

The AI generates a structured JSON plan:

```json
{
  "projectName": "Project Name",
  "nodes": [
    {
      "id": "node-1", "type": "milestone", "title": "Phase 1 Complete",
      "description": "...", "status": "planned", "verification": "human",
      "position": { "x": 40, "y": 40 },
      "startDate": "2026-03-01", "endDate": "2026-03-01",
      "priority": "high", "estimate": "M"
    },
    {
      "id": "node-2", "type": "task", "title": "Implement feature X",
      "description": "...", "status": "planned", "verification": "auto",
      "position": { "x": 40, "y": 140 },
      "milestoneId": "node-1", "priority": "medium", "estimate": "S",
      "environment": "local"
    }
  ],
  "edges": [
    { "id": "edge-1", "source": "node-2", "target": "node-1", "type": "dependency" }
  ]
}
```

---

## 4. Workflow: Execute a Task

Covered in detail in `ARCHITECTURE.md` Section 3 (dispatch, execution, streaming, completion phases).

Summary of the key steps:

| Phase | Steps | What happens |
|-------|-------|-------------|
| **Dispatch** | Frontend validates → Backend assembles context → Relay routes to Agent Runner | Task goes from browser click to agent runner |
| **Execution** | Agent Runner: safety check → create worktree → start AI session | AI begins working |
| **Streaming** | Agent Runner → Relay → Backend → Frontend (SSE) | Live updates: text, tools, files, progress |
| **Completion** | Agent Runner: PR creation → cleanup → result | Status, metrics, branch/PR info returned |
| **Post-completion** | Frontend: update plan node status, accumulate metrics, persist, trigger next batch | UI reflects final state |

### SSE Event Types During Execution

| Event | Data | Frontend Action |
|-------|------|-----------------|
| `init` | `{ executionId, machineId, providerId }` | Set status=running, store IDs |
| `session_init` | `{ sessionId, model }` | Store for multi-turn continuity |
| `text` | `{ content }` | Append to terminal output view |
| `tool_use` | `{ toolName, toolInput }` | Add to tool trace timeline |
| `tool_result` | `{ toolName, result, success, duration }` | Update tool trace with result |
| `file_change` | `{ path, action, linesAdded, linesRemoved, diff }` | Add to file changes list |
| `progress` | `{ progress, message }` | Update progress bar |
| `result` | `{ status, output, branchName, prUrl, metrics }` | Update node status, accumulate metrics |
| `error` | `{ error }` | Set status=awaiting_judgment |

### Plan Node Status After Execution

| Condition | New Status |
|-----------|-----------|
| Success + `verification: 'auto'` | `auto_verified` |
| Success + `verification: 'human'` | `awaiting_judgment` |
| Failure | `awaiting_judgment` |

---

## 5. Workflow: Chat About Plan

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Frontend** | User types message in plan-level chat panel |
| 2 | **Frontend** | `POST /api/agent/chat` with `{ message, sessionId, projectId, visionDoc, planNodes, planEdges, messages }` |
| 3 | **Backend** | Build system prompt: `buildChatSystemPrompt(visionDoc, planNodes, planEdges)` |
| 4 | **Backend** | Select provider, stream response via SSE |
| 5 | **Frontend** | Receive `"text"` chunks → append to conversation |
| 6 | **Frontend** | If response contains modification blocks, apply mutations: |

### Plan Modification Blocks

The AI can return structured blocks to modify the plan:

| Block | Format | Frontend Action |
|-------|--------|-----------------|
| `` ```astro-updates `` | `[{ "nodeId": "xxx", "title": "New title", "priority": "high" }]` | `planStore.updateNode(nodeId, updates)` |
| `` ```astro-edges `` | `[{ "action": "add", "source": "a", "target": "b", "type": "dependency" }]` | `planStore.addEdge()` or `removeEdge()` |
| `` ```astro-add-nodes `` | `[{ "title": "Sub-task", "description": "...", "milestoneId": "..." }]` | `planStore.addNode()` for each |

| Step | Component | Action |
|------|-----------|--------|
| 7 | **Frontend** | Receive `"done"` → extract `sessionId` for multi-turn continuity |

---

## 6. Workflow: Steer a Running Task

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Frontend** | User types guidance message in steer chat while task is running |
| 2 | **Frontend** | `POST /api/dispatch/steer` with `{ nodeId, projectId, message }` |
| 3 | **Backend** | Find running execution |
| 4 | **Backend** | If relay task: `relayServer.steerTask(taskId, machineId, message)` |
| 5 | **Relay** | Send `task.steer` WebSocket message to Agent Runner |
| 6 | **Agent Runner** | `adapter.injectMessage(message)` — Claude SDK: `Query.interrupt()` + `Query.streamInput(message)` |
| 7 | **Agent Runner** | Send `task.steer_ack` back through Relay → Backend → SSE |
| 8 | **Frontend** | Display acknowledgment in steer chat. Agent processes guidance in next turn. |

---

## 7. Workflow: Approval Request (Dynamic)

When an AI agent needs a user decision during execution (e.g., "Should I delete this file?"):

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Agent Runner** | AI calls `AskUserQuestion` tool (intercepted by claude-sdk-adapter) |
| 2 | **Agent Runner** | Send `task.approval_request` via WebSocket: `{ taskId, requestId, question, options, timeout: 60s }` |
| 3 | **Relay** | Forward to Backend |
| 4 | **Backend** | Broadcast via SSE: `task:approval_request` |
| 5 | **Frontend** | `realtime-store` adds to `dynamicApprovals` map. UI shows approval dialog. |
| 6 | **User** | Selects answer from options |
| 7 | **Frontend** | `POST /api/dispatch/approve` with `{ taskId, requestId, answer }` |
| 8 | **Backend** | Forward via Relay WebSocket: `task.approval_response` |
| 9 | **Agent Runner** | Resolve pending approval promise. Return answer to SDK. Agent continues. |

**Timeout**: If user doesn't respond within 60 seconds, Agent Runner resolves with default/timeout response. Task may continue with conservative default.

---

## 8. Workflow: Batch Execution

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Frontend** | User clicks "Execute All" on a project |
| 2 | **Frontend** | `executeAllProject()`: Find all `"planned"` nodes with met dependencies |
| 3 | **Frontend** | Create `BatchExecution` state: `{ projectId, nodeIds, dispatched, active: true }` |
| 4 | **Frontend** | Dispatch all ready nodes in parallel (each follows the task execution flow from Section 4) |
| 5 | **Frontend** | On each task completion: check for newly-unblocked nodes (dependencies now all met) |
| 6 | **Frontend** | If newly-ready nodes exist: auto-dispatch them (with small delay to avoid race conditions) |
| 7 | **Frontend** | Batch continues until: all tasks done, no more planned nodes with met deps, or user stops |

---

## 9. Workflow: Task Chat

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Frontend** | User types message about a specific task (context: title, description, execution output) |
| 2 | **Frontend** | `POST /api/agent/task-chat` with `{ message, sessionId, nodeId, projectId, taskTitle, taskDescription, taskOutput, visionDoc, model, messages }` |
| 3 | **Backend** | Build prompt: `buildTaskChatSystemPrompt(context)`. Select provider, stream response. |
| 4 | **Frontend** | Receive `"text"` → append to task chat conversation |
| 5 | **Frontend** | Receive `"done"` → store `sessionId` for multi-turn |
| 6 | **Frontend** | Persist: `taskChatStore` → API call |

---

## 10. Workflow: Branch Pruning

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Frontend** | User triggers branch pruning on a plan node |
| 2 | **Frontend** | `POST /api/dispatch/prune-branch` with `{ nodeId, projectId }` |
| 3 | **Backend** | Find target node |
| 4 | **Backend** | Walk dependency graph downstream: find all nodes that transitively depend on this node |
| 5 | **Backend** | For each downstream node: if running → cancel execution; set status → `pruned` |
| 6 | **Backend** | Set target node status → `pruned` |
| 7 | **Backend** | Clean up worktrees for cancelled tasks |
| 8 | **Frontend** | `planStore`: update all affected nodes to `pruned` |
| 9 | **Frontend** | `executionStore`: remove cancelled executions |
| 10 | **Frontend** | Graph view: pruned nodes shown with visual indicator (dimmed/struck-through) |

---

## 11. Workflow: Machine Registration (Device Auth)

See Section 2.2 steps 7–20 for the complete device code flow.

Summary:

1. **Agent Runner** requests device code from Backend
2. **User** enters code in browser, authenticates via WebAuthn
3. **Agent Runner** polls for token, receives JWT + refresh token
4. **Agent Runner** stores credentials, connects to Relay via WSS
5. **Relay** verifies JWT, registers machine
6. **Backend** persists registration, broadcasts connection event
7. **Frontend** shows machine in Environments page

---

## 12. Local vs Server Mode — Comparison Table

| Aspect | Local Mode | Server Mode |
|--------|-----------|-------------|
| **Physical location** | All on one machine | Frontend: CDN. Backend+Relay: cloud. Agent Runner: user's machine(s). |
| **Auth (HTTP)** | None or `X-User-Id` header | `Authorization: Bearer <JWT>` (WebAuthn) |
| **Auth (WebSocket)** | None | JWT in `Authorization` header |
| **Frontend → Backend** | `http://localhost:3001` | `https://astro-api.domain` |
| **Relay → Agent Runner** | `ws://localhost:3002` | `wss://astro-relay.domain` |
| **Primary data store** | PGlite (local) or Postgres (server), via Drizzle ORM | Postgres (Supabase) via Drizzle ORM |
| **IndexedDB** | Not used (removed) | Not used (removed) |
| **Machine registration** | In-memory only | Persisted to Postgres, device code auth |
| **Multi-user** | No | Yes, data isolated by Postgres RLS |
| **Observability hooks** | Enabled | Enabled |
| **Redis** | Not needed | Optional (horizontal scaling) |

---

## 13. Procedure Pipeline Flow (Current State)

The procedure pipeline is a multi-step execution workflow that runs inside `dispatchLocal()` on the Backend. It is targeted for migration to the Agent Runner.

| Step | Action |
|------|--------|
| 1 | **Classify task**: Backend calls Claude Haiku via direct Anthropic API: "Is this full-development, bug-fix, research, or simple?" |
| 2 | **If simple**: Single execution with provider. No subroutine pipeline. |
| 3 | **If full-development**: Run 5 subroutines in sequence: |

### Full-Development Procedure (5 subroutines)

| # | Subroutine | Tools | Key Behavior |
|---|-----------|-------|-------------|
| 1 | **implement** | Full tool access | Write code. If `usesValidationLoop`: run `npm run build`, retry up to 3x on failure. |
| 2 | **verify** | Read-only tools | Review code changes. Single-turn. |
| 3 | **git-commit** | Git tools only | Stage and commit with conventional commit message. Single-turn. |
| 4 | **gh-pr** | `gh` tool only | Create GitHub PR. Single-turn. `requiresApproval: true`. |
| 5 | **summary** | No tools (text-only) | Summarize work done. Returns structured JSON. |

### Bug-Fix Procedure (3 subroutines)

| # | Subroutine | Tools | Key Behavior |
|---|-----------|-------|-------------|
| 1 | **diagnose-and-fix** | Full tool access | Investigate and fix the bug. Validation loop. |
| 2 | **git-commit** | Git tools only | Commit fix. Single-turn. |
| 3 | **summary** | No tools | Summarize fix. |

### Research Procedure (2 subroutines)

| # | Subroutine | Tools | Key Behavior |
|---|-----------|-------|-------------|
| 1 | **investigate** | Full tool access | Research and analyze. |
| 2 | **summary** | No tools | Summarize findings. |

Session threading: Each subroutine can share `sessionId` with previous subroutines, carrying conversational context forward. The Frontend shows subroutine progress via `subroutineProgress: { name, index, total, status }` in the `TaskExecution` object.
