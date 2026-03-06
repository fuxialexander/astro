# State Management

Zustand stores and API persistence.

## Store Overview

All stores live in `src/stores/` and use Zustand 5. Stores persist via `dataClient` which calls `/api/data/*` endpoints backed by Drizzle ORM (PGlite in local mode, Postgres in server mode).

### Core Data

- `project-store.ts` - Projects CRUD, API persistence
- `plan-store.ts` - Plan nodes/edges per project, bulk updates, graph layout
- `initiative-store.ts` - Initiatives/projects grouping
- `session-store.ts` - Unified session data: project chat, task chat, steer messages, execution sessions
- `task-chat-store.ts` - Task-level chat history (per-node conversations)
- `activity-store.ts` - Activity tracking and history (task/project/milestone events)

### Execution & Agents

- `execution-store.ts` - Task execution state, SSE stream processing, provider/machine management
- `agent-store.ts` - AI generation state, SSE streaming, abort, multi-session generation tracking
- `realtime-store.ts` - Real-time events from SSE bridge: machines, activity feed, task streams
- `machines-store.ts` - Registered machines (fetch, revoke, rename, provider configs)
- `slurm-store.ts` - HPC/Slurm cluster state (clusters, jobs, queue tracking)
- `observation-store.ts` - Trace observation data (generations, tool calls, spans) for execution inspection

### User & Auth

- `auth-store.ts` - Supabase session/user state, WebAuthn initialization, sign-out
- `user-profile-store.ts` - User identity and preferences (name, email, domains, API keys)
- `team-store.ts` - Teams CRUD, team members, role checks
- `api-keys-store.ts` - Encrypted API keys for external services (client-side encryption via Web Crypto)
- `connected-accounts-store.ts` - Connected external accounts (Slack, Telegram, GitHub webhook, Linear)

### UI & Navigation

- `ui-store.ts` - Sidebar collapsed, command palette open, command history/breadcrumbs
- `sidebar-store.ts` - Sidebar item configuration, visibility, ordering, external items
- `display-settings-store.ts` - Per-view display settings (groupBy, orderBy, properties, column/zoom)
- `keyboard-nav-store.ts` - Keyboard navigation state (focused item, navigable items, arrow-key movement)
- `toast-store.ts` - Toast notification queue (info, success, warning, error)

### Settings & Configuration

- `settings-store.ts` - Model selection, default provider, backend connection health
- `usage-store.ts` - Session usage metrics (cost, tokens, task counts)

### Integrations & Plugins

- `github-store.ts` - GitHub connection, repositories, and sync state
- `plugin-store.ts` - Plugin registry, lifecycle (register, enable, disable), contributions
- `skill-store.ts` - OpenClaw skill registry and prompt injection

## Persistence

- `dataClient` calls `/api/data/*` endpoints (Drizzle ORM → PGlite or Postgres)
- Stores load from backend on mount via `DataLoader` component (`dataClient.load()` → `GET /api/data/*`)
- State changes persisted via `dataClient` → `POST /api/data/*`

## Related Documentation
- [Real-time Sync](./realtime-sync.md)
- [Database Schema](../backend/database-schema.md)
