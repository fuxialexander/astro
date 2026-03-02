# Astro API Surface & Multi-Platform Roadmap

> **Strategy + inventory document.** For detailed request/response examples, see [API Reference](./backend/api-reference.md).

## Overview

Astro exposes a RESTful HTTP API via [Hono.js](https://hono.dev/) on port 3001. The Vite dev server proxies `/api` requests automatically.

| Mode | Base URL | Auth |
|------|----------|------|
| Local | `http://localhost:5173/api` (via Vite proxy) | None — single user |
| Dev | `https://<tunnel-domain>/api` | Supabase JWT or device token |
| Prod | `https://<fly-app>.fly.dev/api` | Supabase JWT or device token |

All three modes share the same route definitions and Drizzle ORM schema. Mode detection: `isLocalMode()` from `packages/core/src/app-mode.ts`.

## Authentication

Three auth methods, resolved in order by `requireAuth` middleware (`server/middleware/auth.ts`):

| Method | Header | When Used |
|--------|--------|-----------|
| Local mode | `X-User-Id` (optional) | No auth required, falls back to `LOCAL_USER_ID` |
| Supabase JWT | `Authorization: Bearer <jwt>` | Web app (dev/prod) |
| Device token | `Authorization: Bearer <device-jwt>` | CLI, registered machines |

**Additional headers:**

| Header | Purpose |
|--------|---------|
| `X-Team-Id` | Active team scope (validated against membership) |
| `X-User-Id` | Local mode only — override user identity |
| `Last-Event-ID` | SSE reconnect — resume from last received event |
| `?token=<jwt>` | SSE query param (EventSource can't send custom headers) |

## Endpoint Inventory

**201 endpoints** across 19 route files. All paths prefixed with `/api` unless noted.

### Health & Providers (12 endpoints) — `server/routes/health.ts`

No auth required (except `/backends/remote`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + connected runners count |
| GET | `/providers` | List connected agent runners |
| GET | `/providers/:providerId` | Specific machine details |
| POST | `/providers/:providerId/detect` | No-op (relay mode) |
| POST | `/providers/detect-all` | No-op (relay mode) |
| GET | `/machine` | Machine registration info |
| GET | `/sessions` | Relay session stats |
| GET | `/backends` | List execution backends from all machines |
| POST | `/backends/detect` | No-op / returns current state |
| GET | `/backends/:id` | Get backend by ID |
| GET | `/backends/remote/:machineId/:strategyId` | Remote backend context (auth required) |
| POST | `/test/auth-token` | Dev-only: generate test auth token |

### Authentication (9 endpoints) — `server/routes/auth.ts`

WebAuthn endpoints are rate-limited (30 req / 15 min per IP).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/webauthn/check-user` | None | Check if email exists |
| POST | `/auth/webauthn/register-options` | None | Get registration challenge |
| POST | `/auth/webauthn/register-verify` | None | Verify registration |
| POST | `/auth/webauthn/login-options` | None | Get login challenge |
| POST | `/auth/webauthn/login-verify` | None | Verify login, return session |
| POST | `/auth/webauthn/add-passkey` | Required | Add passkey to existing account |
| GET | `/auth/session` | Optional | Check session status |
| POST | `/auth/ensure-profile` | Required | Ensure profile + team exist |
| DELETE | `/auth/delete-account` | Required | Delete account + all data |

### Device Authorization (15 endpoints) — `server/routes/device-auth.ts`

OAuth2 Device Authorization Grant (RFC 8628) for machine registration.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/device/authorize` | None | Request device code (step 1) |
| POST | `/device/token` | None | Poll for access token (step 2) |
| POST | `/device/register` | Machine token | Register machine (step 3) |
| POST | `/device/refresh` | None | Refresh access token |
| POST | `/device/revoke` | None | Revoke refresh token |
| GET | `/device/code/:code` | None | Get device code info |
| POST | `/device/code/:code/authorize` | Required | Authorize device from web UI |
| POST | `/device/code/:code/deny` | Required | Deny device from web UI |
| GET | `/device/machines` | Required | List user's registered machines |
| GET | `/device/machines/:id` | Required | Get specific machine |
| PATCH | `/device/machines/:id` | Required | Update machine settings |
| DELETE | `/device/machines/:id` | Required | Revoke machine |
| POST | `/device/simulate-machine` | Required | Dev-only: create simulated machine |
| GET | `/device/stats` | Required | Device auth stats |
| POST | `/device/test/auto-approve` | Required | Dev-only: auto-approve for e2e |

Token polling is rate-limited: 10 req/min per IP, 5 failed attempts before 5-min lockout.

### Agent & AI (13 endpoints) — `server/routes/agent.ts`

All auth required. SSE-streaming endpoints return `text/event-stream`.

| Method | Path | Streaming | Description |
|--------|------|-----------|-------------|
| POST | `/agent/generate-plan` | SSE | Generate AI plan |
| POST | `/agent/chat` | SSE | General project chat |
| POST | `/agent/plan-chat` | SSE | Plan-focused chat (defaults to haiku) |
| POST | `/agent/task-chat` | SSE | Task-specific chat with execution context |
| POST | `/agent/abort` | — | Abort active session |
| POST | `/agent/compact` | SSE | Summarize conversation history |
| POST | `/agent/dispatch` | SSE | Dispatch task execution |
| POST | `/agent/summarize` | — | Generate task summary |
| POST | `/agent/generate-title` | — | Generate short title from description |
| POST | `/agent/refine` | — | Refine task title/description |
| POST | `/agent/suggest-labels` | — | Suggest label IDs for task |
| GET | `/agent/providers` | — | List connected agent runners |
| POST | `/agent/providers/detect` | — | No-op detect in relay mode |

### Task Dispatch & Execution (14 endpoints) — `server/routes/dispatch.ts`

All auth required.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/dispatch/task` | Dispatch task for execution (SSE) |
| POST | `/dispatch/steer` | Send steering message to running agent |
| POST | `/dispatch/approval` | Respond to approval request |
| POST | `/dispatch/safety-decision` | Respond to safety prompt |
| POST | `/dispatch/cancel` | Cancel running execution |
| POST | `/dispatch/prune` | Prune branch (cancel + downstream) |
| POST | `/dispatch/approve` | Simple approve for running task |
| POST | `/dispatch/request-dynamic-approval` | Create on-demand approval request |
| GET | `/dispatch/status` | Dispatch engine status |
| GET | `/dispatch/ready/:projectId` | Check if nodes are ready to dispatch |
| POST | `/dispatch/engine/start` | Start dispatch engine |
| POST | `/dispatch/engine/stop` | Stop dispatch engine |
| POST | `/dispatch/reset` | Reset execution state for a node |
| POST | `/dispatch/cleanup` | Clean up stale execution state |

### Data CRUD (63 endpoints) — `server/routes/data.ts`

All auth required. Standard CRUD over 15+ resource types.

**Projects & Initiatives**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/projects` | List team projects |
| POST | `/data/projects` | Create project |
| GET | `/data/projects/:id` | Get project |
| PATCH | `/data/projects/:id` | Update project |
| DELETE | `/data/projects/:id` | Soft-delete project |
| GET | `/data/initiatives` | List initiatives |
| POST | `/data/initiatives` | Create initiative |
| GET | `/data/initiatives/:id` | Get initiative |
| PATCH | `/data/initiatives/:id` | Update initiative |
| DELETE | `/data/initiatives/:id` | Delete initiative |

**Plan Graph (Nodes & Edges)**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/plan` | Get plan for all projects (legacy) |
| GET | `/data/plan/:projectId` | Get plan (nodes + edges) for project |
| PUT | `/data/plan/:projectId` | Bulk update plan |
| POST | `/data/plan/nodes` | Create plan node |
| PATCH | `/data/plan/nodes/:id` | Update plan node |
| DELETE | `/data/plan/nodes/:id` | Delete plan node |
| POST | `/data/plan/edges` | Create plan edge |
| DELETE | `/data/plan/edges/:id` | Delete plan edge |

**User Profile & Settings**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/profile` | Get user profile |
| PUT | `/data/profile` | Update user profile |
| GET | `/data/display-settings` | Get all display settings |
| PATCH | `/data/display-settings/:view` | Update display settings for a view |
| GET | `/data/settings` | Get all user settings |
| PATCH | `/data/settings` | Update settings (bulk patch) |

**Usage Metrics**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/usage/today` | Get today's usage metrics |
| POST | `/data/usage/increment` | Increment usage counter |

**Chat & Sessions**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/chat` | List all task chat sessions |
| GET | `/data/chat/:nodeId` | Get chat for a node |
| POST | `/data/chat/:nodeId/session` | Create chat session for node |
| POST | `/data/chat/:nodeId/messages` | Add message to chat |
| PATCH | `/data/chat/:nodeId/session` | Update chat session |
| DELETE | `/data/chat/:nodeId` | Delete chat for node |
| GET | `/data/sessions` | List all sessions |
| GET | `/data/sessions/:sessionId` | Get session |
| POST | `/data/sessions` | Create session |
| PATCH | `/data/sessions/:sessionId` | Update session |
| DELETE | `/data/sessions/:sessionId` | Delete session |
| POST | `/data/sessions/:sessionId/messages` | Add message to session |

**Executions & Traces**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/executions` | List task executions |
| POST | `/data/executions` | Record execution |
| DELETE | `/data/executions/:nodeId` | Delete execution for node |
| GET | `/data/tool-traces` | List tool traces |
| GET | `/data/file-changes` | List file changes |

**Search & Export**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/search` | Global search across nodes/projects |
| GET | `/data/export` | Export project bundle |

**Activities**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/activities` | List activity events |
| POST | `/data/activities` | Create activity event |
| DELETE | `/data/activities/:projectId` | Delete activities for project |

**Teams (via data routes)**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/teams` | List user's teams |
| POST | `/data/teams` | Create team |
| PATCH | `/data/teams/:id` | Update team |
| DELETE | `/data/teams/:id` | Delete team |
| POST | `/data/teams/:teamId/members` | Add member |
| DELETE | `/data/teams/:teamId/members/:userId` | Remove member |
| PATCH | `/data/teams/:teamId/members/:userId` | Update member role |

**Blobs**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/data/blobs` | Store binary blob |
| GET | `/data/blobs/:id` | Retrieve blob |
| DELETE | `/data/blobs/:id` | Delete blob |

**Comments**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/comments` | List node comments |
| POST | `/data/comments` | Create comment |
| DELETE | `/data/comments/:id` | Delete comment |

**Environment Configs**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/environment-configs` | List environment configs |
| POST | `/data/environment-configs` | Create environment config |
| DELETE | `/data/environment-configs/:id` | Delete environment config |

### Real-Time Events (2 endpoints) — `server/routes/events.ts`

All auth required.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/events/stream` | SSE event stream (real-time relay bridge) |
| GET | `/events/catch-up` | DB catch-up for missed streaming events |

### Relay & Machines (15 endpoints) — `server/routes/relay.ts`

All auth required. Proxy to the WebSocket relay server.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/relay/health` | Relay + Redis health check |
| GET | `/relay/status` | Detailed relay server status |
| GET | `/relay/machines` | List connected machines (user-filtered) |
| GET | `/relay/machines/:machineId` | Machine details |
| GET | `/relay/machines/provider/:provider` | Machines by provider type |
| DELETE | `/relay/machines/:machineId` | Force disconnect machine |
| POST | `/relay/dispatch` | Low-level task dispatch via relay |
| POST | `/relay/cancel` | Cancel task via relay |
| GET | `/relay/tasks/:taskId/machine` | Get machine running a task |
| GET | `/relay/best-machine` | Find best machine for a task |
| GET | `/relay/sessions` | List Claude Code sessions from machines |
| GET | `/relay/slurm/clusters` | List HPC-capable machines |
| GET | `/relay/slurm/clusters/:machineId` | Specific Slurm cluster info |
| GET | `/relay/slurm/jobs` | Active Slurm jobs (stub) |
| POST | `/relay/slurm/dispatch` | Dispatch to HPC/Slurm |

### File System (3 endpoints) — `server/routes/fs.ts`

All auth required. Proxied via relay to connected machines.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/fs/files` | File listing for @-completion |
| GET | `/fs/directories` | Directory listing |
| POST | `/fs/directories` | Create directory |

### Repository Operations (4 endpoints) — `server/routes/repo.ts`

All auth required. Proxied via relay.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/repo/detect` | Detect git repo at path |
| GET | `/repo/branches` | List branches |
| POST | `/repo/setup` | Set up project repo |
| POST | `/repo/git-init` | Initialize git repo |

### Skills (5 endpoints) — `server/routes/skills.ts`

All auth required.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/skills` | List all skills with eligibility |
| POST | `/skills/register` | Bulk register skills (relay/Tauri) |
| POST | `/skills/install` | Install from ClawHub (501 stub) |
| DELETE | `/skills/:name` | Remove skill |
| PUT | `/skills/:name/config` | Update skill config |

### Observations (4 endpoints) — `server/routes/observations.ts`

All auth required.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/observations` | List observations with filters |
| GET | `/observations/stats` | Aggregate stats |
| GET | `/observations/:traceId` | All observations for a trace |
| GET | `/observations/:traceId/summary` | Markdown summary for a trace |

### Teams (12 endpoints) — `server/routes/teams.ts`

All auth required. Not available in local mode.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/teams` | List user's teams |
| POST | `/teams` | Create team |
| PATCH | `/teams/:teamId` | Update team name/description |
| DELETE | `/teams/:teamId` | Delete team |
| POST | `/teams/invite` | Create invite + send email |
| GET | `/teams/:teamId/invites` | List pending invites |
| DELETE | `/teams/invites/:inviteId` | Revoke invite |
| GET | `/teams/invite/:token` | Get invite details |
| POST | `/teams/accept/:token` | Accept invitation |
| GET | `/teams/:teamId/members` | List team members |
| DELETE | `/teams/:teamId/members/:memberId` | Remove member |
| PATCH | `/teams/:teamId/members/:userId` | Change member role |

### Notifications (4 endpoints) — `server/routes/notifications.ts`

All auth required.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/notifications/register` | Register push token |
| DELETE | `/notifications/unregister` | Unregister push token |
| PATCH | `/notifications/preferences` | Update notification preferences |
| GET | `/notifications/tokens` | List tokens for user |

### GitHub Integration (14 endpoints) — `server/routes/github.ts`

Auth required except OAuth callback.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/github/status` | Required | Check GitHub connection status |
| POST | `/github/connect` | Required | Initiate OAuth flow |
| GET | `/github/callback` | None | OAuth redirect handler |
| POST | `/github/disconnect` | Required | Disconnect GitHub |
| GET | `/github/repos` | Required | List repositories |
| POST | `/github/repos/sync` | Required | Manual repo sync |
| GET | `/github/repos/selected` | Required | Get selected repo IDs |
| POST | `/github/repos/select` | Required | Update selected repos |
| GET | `/github/repo/:owner/:name` | Required | Get specific repo |
| GET | `/github/branches/:owner/:name` | Required | List branches |
| POST | `/github/projects` | Required | Create GitHub-linked project |
| GET | `/github/projects` | Required | List GitHub-linked projects |
| POST | `/github/projects/:projectId/sync-issues` | Required | Sync issues to plan nodes |
| DELETE | `/github/projects/:projectId` | Required | Delete GitHub-linked project |

### Connected Accounts (5 endpoints) — `server/routes/connected-accounts.ts`

All auth required.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/connected-accounts` | List accounts (credentials masked) |
| POST | `/connected-accounts` | Add connected account |
| PUT | `/connected-accounts/:id` | Update account settings |
| DELETE | `/connected-accounts/:id` | Remove account |
| POST | `/connected-accounts/:id/test` | Test connection |

### Content Sharing (2 endpoints) — `server/routes/share.ts`

No auth required.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/share` | Store export bundle, return share ID |
| GET | `/share/:id` | Retrieve shared bundle |

### System Info (2 endpoints) — `server/routes/system.ts`

No auth required.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/system/hostname` | Server hostname |
| GET | `/system/info` | OS platform, arch, uptime |

### Well-Known (1 endpoint) — `server/routes/well-known.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/apple-app-site-association` | Apple AASA for passkey sync |

## Conventions

### Error Format

All error responses follow a consistent structure:

```json
{
  "error": "Human-readable error message"
}
```

HTTP status codes used: `400` (validation), `401` (auth), `403` (permissions), `404` (not found), `409` (conflict), `429` (rate limited), `500` (internal), `501` (not implemented), `503` (service unavailable).

### Rate Limiting

| Scope | Window | Limit | Enforcement |
|-------|--------|-------|-------------|
| WebAuthn endpoints | 15 min | 30 req / IP | `hono-rate-limiter` middleware |
| Device token polling | 1 min | 10 req / IP | Custom in-memory tracker |
| Device auth failures | — | 5 attempts | 5-min lockout |

No global rate limiter is currently enforced.

### Timestamps

All timestamps are ISO 8601 strings (`YYYY-MM-DDTHH:mm:ss.sssZ`). Date-only fields (e.g., `startDate`, `dueDate`) use `YYYY-MM-DD`.

### Team Scoping

Most authenticated endpoints are team-scoped:
- Active team set via `X-Team-Id` header (validated against user's team memberships)
- If omitted, defaults to user's first team
- Personal team auto-created on first auth if no memberships exist
- Team resolution handled by `resolveTeams()` in auth middleware

### Soft Deletes

Projects use soft delete (`deletedAt` timestamp). Other resources use hard delete.

### Audit Logging

Server mode only. Writes to `audit_logs` table via `auditMiddleware()`. Tracked actions: `account.create/login/logout/delete`, `api_key.create/delete/revoke`, `machine.register/revoke/rename`, `project.create/delete/share/access`, `data.export/delete`. Skipped in local/PGlite mode.

## Real-Time Protocols

Astro uses three complementary real-time systems:

### Server-Sent Events (SSE)

**Endpoint:** `GET /api/events/stream`

Primary channel for streaming execution and chat events from the server to the web client.

**Event types (execution):** `init`, `session_init`, `text`, `tool_use`, `tool_result`, `file_change`, `progress`, `result`, `error`, `aborted`, `heartbeat`, `done`

**Event types (chat):** `text`, `tool_use`, `tool_result`, `session_init`, `plan_result`, `done`, `error`, `aborted`, `heartbeat`

**Reconnect:** Client sends `Last-Event-ID` header or `?lastEventId=` query param. Server catches up from `streaming_events` DB table via `/api/events/catch-up`.

**Auth:** JWT passed as `?token=` query param (EventSource limitation).

### WebSocket Relay

The relay server (`server/lib/relay/`) provides bidirectional communication between the Hono API server and remote agent runners (machines).

- Machines connect via WebSocket to the relay
- API server dispatches tasks through the relay to connected machines
- Results flow back through the relay to the API server → SSE → client
- See [Relay Protocol](./relay/protocol.md) for message types

### Supabase Realtime (Server Mode Only)

Change Data Capture subscriptions for multi-device sync:
- Tables: `projects`, `plan_nodes`, `plan_edges`, `sessions`, `task_chat_sessions`
- Used for optimistic UI updates and conflict resolution
- See [Realtime Sync](./features/realtime-sync.md)

## Multi-Platform Readiness

Current status of API capabilities needed for each client platform:

| Capability | Web | CLI | Desktop (Tauri) | Mobile | Status |
|------------|-----|-----|-----------------|--------|--------|
| Auth | Supabase JWT | Device auth | JWT / Device auth | JWT | Done |
| Data CRUD | Full | Full (via device token) | Full | Full | Done |
| SSE streaming | Full | Full | Full | Full | Done |
| Relay dispatch | Full | Via agent-runner | Via Tauri plugin | N/A | Done |
| API versioning | N/A | Critical | Critical | Critical | Missing |
| Pagination | N/A | Needed | Needed | Needed | Missing |
| Filtering/sorting | Partial | Needed | Needed | Needed | Partial |
| Offline sync | N/A | N/A | Needed | Needed | Missing |
| Batch operations | N/A | Nice | Nice | Nice | Missing |
| Webhooks | N/A | N/A | N/A | Nice | Missing |
| OpenAPI spec | N/A | SDK gen | SDK gen | SDK gen | Missing |
| Caching headers | N/A | Nice | Needed | Needed | Missing |
| Client WebSocket | N/A | Nice | Needed | Needed | Missing |

> For a detailed WebSocket migration plan, see [WebSocket Roadmap](./websocket.md).

## Roadmap: What to Add

### Phase 1: Foundation

- **API versioning** — Prefix all routes with `/api/v1/`. Current routes become v1, enabling breaking changes in future versions.
- **Standard pagination** — Add `limit`, `offset`, `total`, `hasMore` to all list endpoints. Currently most list endpoints return all matching rows.
- **Filtering & sorting** — Standardize query params (`?status=in_progress&orderBy=createdAt&order=desc`) on list endpoints.
- **Rate limit headers** — Add `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` to all responses. Implement global per-user rate limiting.

### Phase 2: Multi-Client Support

- **OpenAPI 3.1 spec** — Auto-generate from route definitions. Enables SDK generation for TypeScript, Python, Swift, Kotlin.
- **ETag / Cache-Control / Last-Modified** — HTTP caching headers on GET endpoints for efficient polling.
- **Batch endpoints** — `POST /api/data/batch` for bulk create/update/delete across resource types in a single request.
- **TypeScript SDK** — Generated from OpenAPI spec, published as `@astroanywhere/sdk`.

### Phase 3: Offline & Sync

- **Sync endpoint** — `POST /api/data/sync` with vector clock or CRDT-based conflict resolution for offline-first clients.
- **Incremental sync** — Changes-since-timestamp queries (`?updatedSince=<ISO>`), returning only modified rows.
- **Client version tracking** — Server tracks last-known client state for efficient delta sync.

### Phase 4: Integrations

- **Outbound webhooks** — Event subscriptions (`project.updated`, `task.completed`, etc.) with configurable URLs.
- **Partial responses** — `?fields=id,name,status` to reduce payload size for bandwidth-constrained clients.

## Related Documentation

- [WebSocket Roadmap](./websocket.md) — Backend ↔ frontend WebSocket plan for mobile/desktop support
- [API Reference](./backend/api-reference.md) — Detailed request/response examples per endpoint
- [Database Schema](./backend/database-schema.md) — Drizzle schema (38 tables), relationships
- [Data Flows](./backend/data-flows.md) — How data moves through the system
- [Authentication](./backend/authentication.md) — WebAuthn/passkey implementation details
- [Device Authorization](./backend/device-authorization.md) — OAuth2 device code flow
- [Relay Protocol](./relay/protocol.md) — WebSocket message types and flows
- [Realtime Sync](./features/realtime-sync.md) — Supabase Realtime integration
- [ARCHITECTURE](./design/ARCHITECTURE.md) — System structure and protocols
- [TAURI_APP](./design/TAURI_APP.md) — Desktop app vision and plugin architecture
