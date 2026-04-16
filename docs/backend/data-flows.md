# Data Flows

How data moves through the Astro system from user interaction to database storage.

## Plan Generation Flow

```
User Action (New Project)
  ↓
Frontend: project-new-plan.tsx
  ↓ POST /api/dispatch/task (isInteractivePlan: true)
Backend: server/routes/dispatch.ts
  ↓ Relay → Agent Runner
AI Planning Session
  ├─ Repo context injection (CLAUDE.md, README, file tree)
  ├─ Tool use (Read, Glob, Grep for exploration)
  ├─ Structured output (plan JSON)
  └─ SSE streaming → Frontend
  ↓
Backend: Extract plan JSON → Emit plan_result SSE event
  ↓
Frontend: useStreamEvents() hook
  ├─ Receive SSE events via global SSE → realtime-store taskStreams
  ├─ Apply plan via plan-extraction.ts → plan-store (nodes + edges)
  └─ Persist via dataClient → /api/data/*
  ↓
User navigates to /project/:id/plan
  ↓
Frontend: plan-view.tsx renders React Flow graph
```

**Key Points:**
- **Repo-aware**: If repository URL provided, backend clones repo → reads key files → injects into system prompt
- **Tool-augmented**: Agent can explore codebase with Read/Glob/Grep tools
- **Streaming**: Partial results stream via SSE for immediate feedback
- **Persistence**: Data persisted via dataClient → /api/data/* → Drizzle ORM

## Task Dispatch Flow

```
User Action (Play button on task node)
  ↓
Frontend: plan-canvas.tsx
  ↓ POST /api/dispatch/task
Backend: server/lib/dispatch/dispatch-engine.ts
  ├─ Context assembly
  │   ├─ Vision doc from project
  │   ├─ Dependency outputs (parent task results)
  │   └─ Repository context (file tree, CLAUDE.md)
  ├─ Provider selection (claude-code, codex, slurm)
  └─ Machine selection (via relay or local)
  ↓
Relay Server: server/lib/relay-server.ts
  ├─ WebSocket message: task.dispatch
  └─ → Agent Runner (via WS)
  ↓
Agent Runner: packages/agent-runner
  ├─ Prepare workspace (git worktree)
  ├─ Execute provider (Claude Code SDK, SLURM, etc.)
  └─ Stream events back to relay
  ↓
Relay → Backend SSE Bridge (unified pipeline)
  ├─ Relay-server persists to streaming_events table (seq-indexed)
  ├─ Global SSE via /api/events/stream (project-ownership filtered)
  └─ Event types: init, session_init, text, tool_use, tool_result,
     file_change, progress, result, approval_request, steer_message
  ↓
Frontend: useStreamEvents() hook (unified)
  ├─ Receives events via global SSE → realtime-store taskStreams
  ├─ Groups into DisplayBlocks, derives StreamStatus
  ├─ On disconnect/refresh: hydrateFromCatchUp() from streaming_events DB
  └─ On completion: updates plan-store node status
  ↓
Backend: Result writeback
  ├─ Update plan_nodes.executionOutput
  ├─ Insert task_executions record
  ├─ Insert tool_traces, file_changes
  ├─ Update usage_metrics
  └─ Create activity_event
```

**Key Points:**
- **Context injection**: Every task gets vision doc + dependency context
- **Workspace isolation**: Git worktrees prevent concurrent task conflicts
- **Streaming events**: Real-time progress via SSE; all structural events persisted to `streaming_events` table for reconnect/refresh recovery
- **Automatic writeback**: Results stored in database after completion
- **Future**: WebSocket transport will replace SSE (persistence layer unchanged). See [WebSocket Roadmap](../websocket.md)

## Real-time Sync Flow (Server Mode)

```
User A (Browser 1): Creates project
  ↓
Frontend: project-store.ts
  ├─ Optimistic update (immediate UI feedback)
  ├─ POST /api/data/projects (Supabase)
  └─ API persistence
  ↓
Supabase: projects table INSERT
  ├─ RLS policy check (user is owner)
  ├─ Write to Postgres
  └─ Realtime broadcast (projects:INSERT)
  ↓
User B (Browser 2): Realtime subscription active
  ↓
Frontend: realtime-store.ts
  ├─ Receives Supabase Realtime event
  ├─ Updates project-store
  └─ UI re-renders automatically (Zustand subscription)
```

**Key Points:**
- **Optimistic updates**: UI updates immediately, syncs in background
- **Conflict resolution**: Last-write-wins based on `updated_at` timestamp
- **API-backed**: All data persisted via backend API
- **Multi-device**: Changes sync across all logged-in sessions

## Approval Flow

```
Task Execution: Agent calls Claude SDK's AskUserQuestion tool
  ↓
Agent runner: packages/agent-runner/src/providers/claude-sdk-adapter.ts (canUseTool)
  ├─ Validates question payload
  └─ Forwards approval request via relay
  ↓
Backend: server/lib/dispatch/procedure-executor.ts
  ├─ Pauses execution
  ├─ Stores approval state
  └─ SSE event: approval.requested → Frontend
  ↓
Frontend: realtime-store.ts
  ├─ Receives SSE event
  ├─ Shows approval dialog
  └─ User responds (approve/deny with optional message)
  ↓ POST /api/approval/respond
Backend: Approval handler
  ├─ Validates user has access
  ├─ Resumes execution with approval result
  └─ SSE event: approval.responded
  ↓
Agent Execution: Receives approval tool_result
  └─ Continues with user's decision
```

**Key Points:**
- **Dynamic approvals**: Agent requests approval mid-execution via MCP tool
- **Execution pause**: Task pauses until user responds
- **Context preserved**: Approval includes question text + options
- **Audit trail**: All approvals logged in activity_events

## Activity Feed Flow

```
Backend Event: Task completion, approval, PR creation, etc.
  ↓
Event Transport: server/lib/events/astro-event-transport.ts
  ├─ INSERT activity_events (Supabase)
  ├─ SSE broadcast: activity.created
  └─ Optional: Push notification
  ↓
Frontend: activity-store.ts
  ├─ Receives SSE event
  ├─ Adds to in-memory activity list
  └─ Persists via dataClient
  ↓
User opens Activity Dialog
  ↓
Frontend: activity-dialog.tsx
  ├─ Reads from activity-store
  ├─ Groups by date
  └─ Renders timeline view
```

**Key Points:**
- **Automatic tracking**: All significant events auto-logged
- **SSE distribution**: Real-time activity feed updates
- **Persistent**: Activity history stored via API
- **Project-scoped**: Activity filtered by project ID

## Usage Metrics Flow

```
Task Execution Completes
  ↓
Backend: Result handler
  ├─ Extracts metrics from execution result
  │   ├─ inputTokens, outputTokens
  │   ├─ model, turnsUsed
  │   └─ estimatedCostUsd (from provider)
  └─ Updates usage_metrics table (daily aggregate)
  ↓
Frontend: Dashboard loads
  ↓ GET /api/data/usage?range=weekly
Backend: Query usage_metrics
  ├─ SUM(total_cost_usd)
  ├─ SUM(total_input_tokens)
  ├─ SUM(total_output_tokens)
  └─ SUM(tasks_completed + tasks_failed)
  ↓
Frontend: dashboard.tsx
  └─ Renders usage charts
```

**Key Points:**
- **Automatic aggregation**: Usage tracked per session date
- **Provider-agnostic**: Works with Claude, OpenAI, etc.
- **Cost tracking**: Estimated USD cost based on provider pricing
- **Historical view**: Query by date range (daily/weekly/monthly)

## GitHub Integration Flow

```
User creates task with auto_pr: true
  ↓
Task Execution Completes
  ↓
Backend: Post-execution hook
  ├─ Check node.autoPr === true
  ├─ Check for file changes
  └─ Trigger PR creation
  ↓
Backend: server/lib/github/pr-creator.ts
  ├─ Reads connected_accounts for GitHub token
  ├─ POST /repos/:owner/:repo/pulls (GitHub API)
  └─ Updates plan_nodes.prUrl, prNumber
  ↓
Frontend: Realtime sync
  ├─ Receives plan_nodes update
  └─ Shows PR badge on task node
```

**Key Points:**
- **Automatic PR**: Created on task completion if enabled
- **Branch tracking**: Each task has optional branchName field
- **Merge queue**: Integration with GitHub merge queue API
- **OAuth scoped**: Uses user's GitHub credentials from connected_accounts

## Cache Hierarchy

### Local Mode (PGlite)
```
User Action → Zustand Store → dataClient → /api/data/* → PGlite
```

### Server Mode (Supabase)
```
User Action
  ↓
Zustand Store (optimistic update)
  └─ dataClient → /api/data/* → Postgres (Supabase)
      ↓
  Success: Confirmed
  Failure: Show error state
```

**Data Refresh:**
- **On login**: Fetch fresh from API
- **On conflict**: Last-write-wins (updated_at comparison)
- **On realtime event**: Merge into store

## Related Documentation

- [API Reference](./api-reference.md) - API endpoint details
- [Database Schema](./database-schema.md) - Table structures
- [Real-time Sync](../../REALTIME_SYNC.md) - Supabase Realtime setup
- [Relay System](../relay/overview.md) - Agent runner communication
- [Approval System](../../APPROVAL_SYSTEM.md) - Approval architecture
