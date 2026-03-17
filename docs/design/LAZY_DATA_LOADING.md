# Lazy Data Loading

## Problem

Page load takes 30+ seconds because the app loads **all data for all projects** on startup.

### What loads on every page refresh

The `DataLoader` in `src/app.tsx` fires two phases:

**Phase 1** — Teams (blocks everything else)
| Endpoint | Query | Payload |
|----------|-------|---------|
| `GET /api/teams` | `team_members` JOIN `teams` | ~1KB |

**Phase 2** — Everything at once (fires after teams load)
| Endpoint | Table | What it loads | Payload estimate |
|----------|-------|---------------|------------------|
| `GET /projects` | `projects` (38 cols) | All projects, all columns including `vision`, `description` | ~50-200KB |
| `GET /plan` | `plan_nodes` (54 cols) + `plan_edges` | **All nodes across all projects** | 200KB-50MB* |
| `GET /sessions` | `sessions` (22 cols) | All sessions + `jsonb_array_elements` subquery per row | ~100KB-1MB |
| `GET /executions` | `task_executions` | All executions across all projects | 100KB-50MB* |
| `GET /chat` | `task_chat_sessions` + `task_chat_messages` (counts) | All chat sessions | ~50KB |
| `GET /activities` | `activity_events` | Last 100 activities | ~50KB |
| `GET /settings` | `user_profiles` | User settings | ~1KB |
| `GET /profile` | `user_profiles` | User profile | ~1KB |
| `GET /display-settings` | `display_settings` | View preferences | ~1KB |
| `GET /usage/today` | `usage_metrics` | Today's usage | ~1KB |
| `GET /initiatives` | `initiatives` | All initiatives | ~5KB |
| `GET /skills` | skills directory scan | Skill manifests | ~10KB |

*Before PRs #1028/#1029 — `executionOutput` and `streamText` were included.

### The heavy columns (now removed from list endpoints)

| Column | Table | Size per row | Used for |
|--------|-------|-------------|----------|
| `execution_output` | `plan_nodes` | 10-100KB | Full agent output text |
| `stream_text` | `task_executions` | 10-100KB | Full agent streaming text |
| `content` | `plan_nodes` | 1-50KB | Rich task content/notes |
| `messages` | `sessions` | 10-500KB | Full chat message history |

With 358 executions and hundreds of plan nodes, these columns produced **10-50MB payloads** on every page load.

### Additional issues

1. **Redundant project queries**: 5 endpoints (`/plan`, `/sessions`, `/executions`, `/chat`, `/activities`) each query `projects` first for team scoping — that's 5 identical queries per page load.

2. **No pagination**: All endpoints return every row. As the user accumulates more projects and tasks, load times grow linearly.

3. **Correlated subqueries**: The sessions endpoint ran `jsonb_array_elements` to scan all messages per session for a title preview (fixed in PR #1029 to use direct index access).

## Immediate Fixes (PRs #1028, #1029)

Removed heavy columns from list endpoints — return empty strings, load on demand:

```
GET /executions     → removed streamText (was 10-50MB total)
GET /plan           → removed executionOutput, content (was 10-50MB total)
GET /sessions       → replaced jsonb_array_elements with direct index
GET /executions/:id → added ?full=true param for on-demand detail loading
```

## Proposed Architecture: Lazy Loading

### Principle

**Load only what the current view needs.** Each page/component fetches its own data, scoped to what's visible.

### Phase 1: Project-scoped loading (recommended next step)

Instead of loading all data for all projects at startup, load per-project when the user navigates:

```
Page load:
  → GET /teams              (same as today)
  → GET /projects           (lightweight: id, name, status, icon, color, updatedAt)
  → GET /profile            (same as today)
  → GET /settings           (same as today)

Navigate to /project/:id:
  → GET /plan/:projectId    (nodes + edges for this project only)
  → GET /executions?projectId=:id
  → GET /sessions?projectId=:id

Open task detail panel:
  → GET /executions/:nodeId?full=true   (includes streamText)
  → GET /plan/nodes/:nodeId             (includes executionOutput, content)

Open playground session:
  → GET /sessions/:sessionId            (includes full messages)
```

### Phase 2: Pagination + virtual scrolling

For users with many projects/tasks:

```
GET /projects?page=1&limit=20&status=active
GET /plan/:projectId?page=1&limit=50
GET /executions?projectId=:id&page=1&limit=20
```

### Phase 3: Cache project IDs server-side

Eliminate the 5x redundant `SELECT * FROM projects WHERE team_scope` by caching the user's project IDs in middleware:

```typescript
// In auth middleware or a per-request cache
const projectIds = await getTeamProjectIds(user.teamId, user.id)
c.set('projectIds', projectIds)
```

### Implementation approach

1. **Backend**: Add `?projectId=` filter param to `/plan`, `/executions`, `/sessions`, `/chat`
2. **Frontend stores**: Change `load()` to `load(projectId?)` — global load returns lightweight list, project-scoped load returns full data
3. **Route-level loading**: Use React Router loaders or `useEffect` on route params to trigger project-scoped fetches
4. **Zustand selectors**: Components select only the data they need from the store

### Migration path

This can be done incrementally:
1. Add `?projectId=` param to each endpoint (backward compatible — without param, returns all)
2. Update one store at a time to use project-scoped loading
3. Remove global "load everything" pattern from `DataLoader`

## What is streamText?

`streamText` is the **full accumulated output** from an agent execution. When the agent runs a task, it streams text back via SSE events. The backend accumulates this into the `stream_text` column of `task_executions`.

It contains:
- Agent reasoning and tool calls
- Code generation output
- Build/test results
- Executive summary

A single execution can produce 10-100KB of streamText. With 358 executions loaded at once, that's 3.5-35MB transferred on every page refresh — this was the primary cause of the 30+ second load times.

After the fix: streamText is empty in list responses and loaded on demand when the user views a specific task's execution panel.
