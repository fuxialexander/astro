# Nexus Architecture

This document provides a comprehensive overview of the Nexus system architecture, the persistence migration plan (IndexedDB → Drizzle+SQLite → Supabase), and the native iOS client design.

## Table of Contents

- [System Overview](#system-overview)
- [Current Architecture](#current-architecture)
- [Core Components](#core-components)
- [Design Patterns](#design-patterns)
- [Data Flow](#data-flow)
- [Persistence Migration Plan](#persistence-migration-plan)
- [Native iOS Client](#native-ios-client)
- [Implementation Phases](#implementation-phases)

---

## System Overview

Nexus is a planning-first platform for builders (software developers) and scientists (researchers). It provides an AI-assisted planning layer that sits above execution tools (coding agents, analysis tools) to help users decompose complex goals, manage dependencies across environments, and focus human attention on strategic decisions.

### Key Capabilities

- **Intelligent Task Planning**: AI-powered task decomposition with dependency tracking, repo-aware context injection
- **Multi-Environment Execution**: Support for local machines, remote servers, and HPC clusters
- **Real-time Monitoring**: Live progress tracking via Server-Sent Events (SSE)
- **Context-Aware Execution**: Automatic injection of project vision, codebase context, and dependency outputs
- **Provider Abstraction**: Pluggable execution adapters (Claude Code, Codex, SLURM)

---

## Current Architecture

### What exists today

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (React + Vite)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   UI Layer   │  │  Zustand     │  │   React Router v7    │  │
│  │  (shadcn/ui) │  │  Stores      │  │                      │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────────┘  │
│                           │                                     │
│                    ┌──────▼───────┐                             │
│                    │  IndexedDB   │  ← ALL persistence here    │
│                    │  (idb-keyval)│    (per-browser, volatile)  │
│                    └──────────────┘                             │
│                           │                                     │
│                    ┌──────▼───────┐                             │
│                    │  API Client  │                             │
│                    │  (SSE/fetch) │                             │
│                    └──────┬───────┘                             │
└───────────────────────────┼─────────────────────────────────────┘
                            │ HTTP/SSE
┌───────────────────────────┼─────────────────────────────────────┐
│                    ┌──────▼───────┐     Backend (Hono + Node)   │
│                    │  Hono Server │                              │
│                    │  port 3001   │                              │
│                    └──────┬───────┘                              │
│                           │                                     │
│  ┌────────────────────────┴──────────────────────┐             │
│  │         Dispatch Engine + Providers            │             │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐│             │
│  │  │ Claude   │  │  Codex   │  │  SLURM (HPC) ││             │
│  │  │  Code    │  │          │  │              ││             │
│  │  └──────────┘  └──────────┘  └──────────────┘│             │
│  └───────────────────────────────────────────────┘             │
│                           │                                     │
│                    ┌──────▼───────┐                             │
│                    │  WS Relay    │                             │
│                    │  port 3002   │                             │
│                    └──────┬───────┘                             │
└───────────────────────────┼─────────────────────────────────────┘
                            │ WebSocket
                     ┌──────▼───────┐
                     │ Agent Runners│
                     │ (user machines)
                     └──────────────┘
```

### Current limitations

- **IndexedDB is per-browser-origin** — Chrome and Safari have different data, no cross-browser sync
- **No server-side persistence** — Hono backend is pure orchestration (AI sessions, dispatch, relay)
- **No user auth** — Single-user local mode only
- **No multi-device** — Native iOS/iPadOS/macOS client impossible without shared data layer

---

## Core Components

### Frontend Layer

- **Framework**: React 19 + TypeScript (strict mode)
- **Routing**: React Router v7 (`react-router` package)
- **State**: Zustand 5 stores + `idb-keyval` for IndexedDB persistence
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite` plugin)
- **Graph**: @xyflow/react for plan graph visualization
- **UI**: shadcn/ui pattern (Radix primitives), lucide-react icons, cmdk palette

### Backend Layer

- **Server**: Hono.js on Node.js (port 3001), proxied via Vite `/api` → localhost:3001
- **AI**: @anthropic-ai/claude-agent-sdk for plan generation + task execution
- **Relay**: WebSocket server (port 3002) for agent runner communication
- **Providers**: Pluggable adapters — Claude Code, Codex, SLURM

### State Stores (Zustand)

| Store | Purpose | Persistence |
|-------|---------|-------------|
| project-store | Projects CRUD, seed data | IndexedDB |
| plan-store | Plan nodes/edges per project | IndexedDB |
| agent-store | AI generation state, SSE streaming | Memory only |
| execution-store | Task execution, SSE stream processing | Memory only |
| realtime-store | Live events (machines, activity, task streams) | Memory only |
| machines-store | Registered machines | Memory (fetch from API) |
| slurm-store | HPC cluster state | Memory (fetch from API) |
| user-profile-store | User identity, preferences | IndexedDB |
| display-settings-store | Per-view groupBy/orderBy/properties | IndexedDB |
| usage-store | Session metrics (cost, tokens, tasks) | IndexedDB |
| task-chat-store | Task-level chat history | IndexedDB |
| settings-store | Model selection, backend health | IndexedDB |
| ui-store | Sidebar collapsed, palette open | Memory only |

---

## Design Patterns

### 1. SSE Bridge Pattern
```
Provider Events → EventEmitter → SSE Endpoint → EventSource → Zustand Store
```
Native browser reconnection, `Last-Event-ID` for replay via ring buffer.

### 2. Dual Dispatch
- **Local**: Direct SSE stream from provider (Claude Code SDK)
- **Relay**: WebSocket → Server → SSE bridge (remote machines)

### 3. Provider Abstraction
Common `AgentProvider` interface with `detect()`, `stream()`, `cancel()`. Adapters for Claude Code, Codex, SLURM.

### 4. Context Assembly
Vision doc + dependency outputs + codebase context (CLAUDE.md, README, file tree) injected per task. Repo-aware plan generation reads key files and gives the agent tool access.

### 5. Event Replay
Ring buffer stores last N events per session. `Last-Event-ID` header enables seamless reconnection.

---

## Data Flow

### Plan Generation (repo-aware)
1. User creates project with repo URL/path
2. Frontend awaits repo setup (clone + file tree)
3. Backend reads repo context (CLAUDE.md, README, package info, file tree)
4. Context injected into planning system prompt
5. Agent explores codebase with tools (Read, Glob, Grep) if repo present
6. Final JSON plan streamed via SSE → stored in plan-store

### Task Execution
1. User dispatches task from plan graph
2. Dispatch engine selects provider, assembles context
3. Provider streams events: text, tool_use, tool_result, file_change, progress
4. Events flow through SSE bridge → Zustand stores → UI re-renders
5. Result event includes usage metrics (cost, tokens, model, turns)

### Device Authentication
OAuth2 Device Authorization Grant (RFC 8628) for machine registration. Device code displayed → user authorizes on web → tokens issued → machine registered.

---

## Persistence Migration Plan

### Problem

IndexedDB is per-browser-origin. Switching between Chrome and Safari (or clearing cache) loses all data. No shared data layer means no multi-device, no iOS app, no collaboration.

### Solution: Three-Phase Migration

```
Phase 0 (NOW)           Phase 1 (Multi-device)    Phase 2 (iOS)
┌──────────────┐        ┌──────────────────┐      ┌──────────────────┐
│ Drizzle ORM  │        │ Drizzle ORM      │      │ Drizzle ORM      │
│ + SQLite     │  ───►  │ + Postgres       │  ──► │ + Postgres       │
│ (local file) │        │ (Supabase Cloud) │      │ (Supabase Cloud) │
│              │        │ + Auth (Passkeys)│      │ + Auth + RLS     │
│ IndexedDB as │        │ + Realtime sync  │      │ + Realtime sync  │
│ offline cache│        │ IndexedDB cache  │      │ SwiftData cache  │
└──────────────┘        └──────────────────┘      └──────────────────┘
```

**Key insight**: Drizzle ORM is driver-agnostic. Same schema, same queries — only the 3-line driver init changes between SQLite and Postgres.

### Phase 0: Local Persistence with Drizzle + SQLite

**Goal**: Solve the cross-browser problem. All browsers hit the same Hono API → same SQLite file.

#### New dependencies
```
better-sqlite3          # SQLite driver for Node.js
drizzle-orm             # Type-safe ORM
drizzle-kit             # Schema migrations CLI
@types/better-sqlite3   # TypeScript types
```

#### Drizzle Schema (single source of truth)

```
server/db/
├── index.ts            # Database connection (SQLite driver)
├── schema.ts           # All table definitions (Drizzle schema)
├── migrate.ts          # Run migrations on server start
└── migrations/         # Generated SQL migration files
```

##### Core tables

```typescript
// server/db/schema.ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const userProfiles = sqliteTable('user_profiles', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email'),
  userType: text('user_type'),  // 'builder' | 'scientist'
  domains: text('domains'),      // JSON array
  preferences: text('preferences'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').references(() => userProfiles.id),
  name: text('name').notNull(),
  description: text('description'),
  visionDoc: text('vision_doc'),
  status: text('status').notNull().default('active'),
  health: text('health'),
  progress: real('progress'),
  repository: text('repository'),
  workingDirectory: text('working_directory'),
  startDate: text('start_date'),
  targetDate: text('target_date'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

export const planNodes = sqliteTable('plan_nodes', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  type: text('type').notNull(),          // milestone | task | branch | decision
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  parentId: text('parent_id'),
  dependencies: text('dependencies'),     // JSON array of node IDs
  environment: text('environment').default('local'),
  verification: text('verification'),
  position: text('position'),             // JSON {x, y}
  priority: text('priority'),
  estimate: text('estimate'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  dueDate: text('due_date'),
  milestoneId: text('milestone_id'),
  executionId: text('execution_id'),
  executionOutput: text('execution_output'),
  executionError: text('execution_error'),
  executionStartedAt: integer('execution_started_at', { mode: 'timestamp' }),
  executionCompletedAt: integer('execution_completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
}, (table) => ({
  pk: { columns: [table.id, table.projectId] },  // composite PK
}))

export const planEdges = sqliteTable('plan_edges', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  source: text('source').notNull(),
  target: text('target').notNull(),
  type: text('type').notNull(),           // dependency | branch
}, (table) => ({
  pk: { columns: [table.id, table.projectId] },
}))

export const taskExecutions = sqliteTable('task_executions', {
  id: text('id').primaryKey(),
  nodeId: text('node_id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  status: text('status').notNull(),
  streamText: text('stream_text'),
  providerId: text('provider_id'),
  model: text('model'),
  turnsUsed: integer('turns_used'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  estimatedCostUsd: real('estimated_cost_usd'),
  durationMs: integer('duration_ms'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
})

export const toolTraces = sqliteTable('tool_traces', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull().references(() => taskExecutions.id),
  toolName: text('tool_name').notNull(),
  input: text('input'),                   // JSON
  result: text('result'),                 // JSON
  success: integer('success', { mode: 'boolean' }),
  durationMs: integer('duration_ms'),
  timestamp: integer('timestamp', { mode: 'timestamp' }),
})

export const fileChanges = sqliteTable('file_changes', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull().references(() => taskExecutions.id),
  path: text('path').notNull(),
  action: text('action').notNull(),       // create | modify | delete
  diff: text('diff'),
  linesAdded: integer('lines_added'),
  linesRemoved: integer('lines_removed'),
})

export const taskChatMessages = sqliteTable('task_chat_messages', {
  id: text('id').primaryKey(),
  nodeId: text('node_id').notNull(),
  projectId: text('project_id').notNull(),
  sessionId: text('session_id'),
  role: text('role').notNull(),           // user | assistant
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
})

export const displaySettings = sqliteTable('display_settings', {
  viewKey: text('view_key').primaryKey(),  // e.g., 'my-tasks', 'project-{id}'
  userId: text('user_id'),
  settings: text('settings'),              // JSON
})

export const usageMetrics = sqliteTable('usage_metrics', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  sessionDate: text('session_date'),       // YYYY-MM-DD
  totalCostUsd: real('total_cost_usd'),
  totalInputTokens: integer('total_input_tokens'),
  totalOutputTokens: integer('total_output_tokens'),
  taskCount: integer('task_count'),
})

export const registeredMachines = sqliteTable('registered_machines', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  name: text('name').notNull(),
  hostname: text('hostname'),
  platform: text('platform'),
  environmentType: text('environment_type'),
  providers: text('providers'),            // JSON array
  isConnected: integer('is_connected', { mode: 'boolean' }),
  isRevoked: integer('is_revoked', { mode: 'boolean' }),
  refreshTokenHash: text('refresh_token_hash'),
  registeredAt: integer('registered_at', { mode: 'timestamp' }),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),                    // JSON
})
```

#### Driver swap (the whole point)

```typescript
// server/db/index.ts — Phase 0: SQLite
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const sqlite = new Database('.nexus/nexus.db')
sqlite.pragma('journal_mode = WAL')        // Better concurrent read performance
export const db = drizzle(sqlite, { schema })

// --- When ready for Supabase (Phase 1), change ONLY this file: ---
// import postgres from 'postgres'
// import { drizzle } from 'drizzle-orm/postgres-js'
// import * as schema from './schema.js'
// const client = postgres(process.env.DATABASE_URL!)
// export const db = drizzle(client, { schema })
```

#### New API endpoints (Hono)

```
server/routes/data.ts

GET    /api/data/projects              # List user's projects
GET    /api/data/projects/:id          # Get project
POST   /api/data/projects              # Create project
PATCH  /api/data/projects/:id          # Update project
DELETE /api/data/projects/:id          # Delete project

GET    /api/data/projects/:id/plan     # Get nodes + edges for project
PUT    /api/data/projects/:id/plan     # Bulk set nodes + edges

GET    /api/data/user-profile          # Get current user profile
PUT    /api/data/user-profile          # Update user profile

GET    /api/data/settings              # Get all settings
PUT    /api/data/settings/:key         # Set a setting

GET    /api/data/display-settings/:key # Get display settings for view
PUT    /api/data/display-settings/:key # Set display settings for view

GET    /api/data/usage                 # Get usage metrics
POST   /api/data/usage                 # Record usage

GET    /api/data/task-chat/:nodeId     # Get chat messages for node
POST   /api/data/task-chat/:nodeId     # Add chat message
```

#### Frontend store changes

Store interfaces stay identical. Only internal load/save implementation changes:

```typescript
// Before (IndexedDB):
load: async () => {
  const data = await get('projects')
  if (data) set({ projects: data })
}

// After (API-backed + IndexedDB cache):
load: async () => {
  try {
    const res = await fetch('/api/data/projects')
    const projects = await res.json()
    set({ projects })
    await idbSet('projects', projects)   // cache for fast reload
  } catch {
    const cached = await idbGet('projects')
    if (cached) set({ projects: cached }) // offline fallback
  }
}
```

**No component changes needed.** Store selectors and actions remain the same.

#### Migration tool

One-time import of existing IndexedDB data to SQLite on first connect:

```
POST /api/data/import   # Accepts full IndexedDB dump, inserts into SQLite
```

Frontend detects empty API response + existing IndexedDB data → triggers import.

### Phase 1: Supabase Migration

**When**: Ready for multi-device, iOS app, or collaboration.

**What changes**:

1. **Drizzle driver swap**: `better-sqlite3` → `postgres-js` pointing at Supabase (3 lines in `server/db/index.ts`)
2. **Schema migration**: `drizzle-kit generate:pg` generates Postgres migration SQL from the same schema
3. **Add `owner_id` columns**: Projects, nodes, etc. get user ownership
4. **Auth**: Supabase GoTrue + Passkeys/WebAuthn
5. **RLS policies**: `user_has_project_access()` helper for project-scoped tables
6. **Realtime subscriptions**: Supabase Realtime for cross-device sync
7. **IndexedDB becomes offline cache** (web), SwiftData (iOS)

#### Target architecture

```
                      +------------------------+
                      |    SwiftUI iOS App     |
                      | (supabase-swift + SSE) |
                      +-----------+------------+
                                  |
                       Supabase Auth (Passkeys)
                       Supabase Realtime (WS)
                       Supabase PostgREST
                                  |
+------------------+  +-----------v---------+  +------------------+
|  React Web App   |  |                     |  |  Hono Backend    |
| (Vite + Zustand) +->+   Supabase Cloud    +<-+  (port 3001)    |
|                  |  |                     |  |                  |
| - supabase-js    |  | - PostgreSQL (RLS)  |  | - /api/agent/*   |
| - IndexedDB      |  | - GoTrue Auth       |  | - /api/dispatch/*|
|   (offline cache)|  | - Realtime (WS)     |  | - /api/events/*  |
+------------------+  +-----------+---------+  | - /api/relay/*   |
                                  |            | - /api/auth/*    |
                                  |            +--------+---------+
                                  |                     |
                                  |             +-------v--------+
                                  |             | WebSocket Relay |
                                  +------------>| (port 3002)    |
                                                +-------+--------+
                                                        |
                                                +-------v--------+
                                                | Agent Runners   |
                                                | (user machines) |
                                                +----------------+
```

#### Data flow split

| Operation | Channel | Why |
|-----------|---------|-----|
| Project/plan/task CRUD | Client → Supabase directly | RLS handles authz, PostgREST is fast |
| User profile, display settings, usage | Client → Supabase directly | User-scoped data |
| AI plan generation | Client → Hono /api/agent/* → Claude SDK | SSE streaming, server-side SDK |
| Task dispatch/execution | Client → Hono /api/dispatch/* → Relay | Orchestration, provider routing |
| Execution results writeback | Hono → Supabase (service role) | Server writes after execution completes |
| Live execution events (stdout, tools) | Hono → SSE /api/events/stream | Ephemeral high-frequency data |
| Data sync across devices | Supabase Realtime | Postgres changes broadcast to all clients |

#### Auth: Passkeys/WebAuthn

Supabase GoTrue doesn't natively support passkeys. Custom implementation on Hono using `@simplewebauthn/server`:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/webauthn/register-options` | Generate challenge for new user |
| `POST /api/auth/webauthn/register-verify` | Verify attestation, create user, store credential |
| `POST /api/auth/webauthn/login-options` | Generate assertion challenge |
| `POST /api/auth/webauthn/login-verify` | Verify assertion, return Supabase session tokens |

Both web (`navigator.credentials`) and iOS (`ASAuthorizationController`) use the same endpoints.

#### Additional Supabase tables

```sql
-- extends auth.users
CREATE TABLE project_members (
  project_id TEXT REFERENCES projects(id),
  user_id UUID REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member | viewer
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE passkey_credentials (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  public_key BYTEA NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  machine_id TEXT REFERENCES registered_machines(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### Sync strategy

- **Source of truth**: Supabase PostgreSQL
- **Offline cache**: IndexedDB (web), SwiftData (iOS)
- **Live sync**: Supabase Realtime subscriptions on projects, plan_nodes, plan_edges, task_executions, registered_machines
- **Execution streams**: Stay on Hono SSE (ephemeral, high-frequency) — written to Supabase in bulk after completion
- **Conflict resolution**: Last-write-wins with `updated_at` timestamps

---

## Native iOS Client

### Architecture: TCA (The Composable Architecture)

TCA maps well to the existing Zustand store pattern (state + actions + effects). Better than MVVM for complex side effects (SSE streaming, Supabase Realtime, background task monitoring).

### Swift Package Layout

```
NexusApp/
├── NexusApp/                  # App entry point, WindowGroup
├── Packages/
│   ├── NexusCore/             # Domain models (port of src/types/index.ts)
│   │   ├── Models/            # Project, PlanNode, PlanEdge, TaskExecution, etc.
│   │   ├── Graph/             # GraphLayout.swift (port of graph-utils.ts)
│   │   └── Utilities/
│   ├── NexusNetworking/       # API client + SSE
│   │   ├── APIClient.swift    # HTTP client for Hono endpoints
│   │   ├── SSEClient.swift    # Port of readSSE() from api-client.ts
│   │   ├── RealtimeClient.swift  # SSE for /api/events/stream
│   │   ├── SupabaseClient.swift  # supabase-swift wrapper
│   │   ├── AuthClient.swift   # Passkey + Supabase Auth
│   │   └── Endpoints/         # Per-route endpoint definitions
│   ├── NexusPersistence/      # SwiftData models + offline sync
│   │   ├── SwiftDataModels/   # @Model definitions with syncStatus field
│   │   └── OfflineSyncEngine.swift
│   ├── NexusFeatures/         # TCA features (one per screen)
│   │   ├── App/               # Root reducer, tab nav, auth gate
│   │   ├── Auth/              # Passkey sign-in/sign-up
│   │   ├── Dashboard/         # Stats, pending decisions, health
│   │   ├── Projects/          # List, detail, new project
│   │   ├── PlanGraph/         # Graph view, timeline, list view
│   │   ├── TaskDetail/        # Output stream, tool traces, file changes, steer
│   │   ├── MyTasks/           # Cross-project task list
│   │   ├── Environments/      # Machine list, online/offline status
│   │   └── Settings/
│   └── NexusUI/               # Design system components
│       ├── Theme/             # Colors, typography, spacing
│       ├── Components/        # StatusBadge, ProgressBar, TerminalOutputView
│       └── Layout/            # Sidebar, header
```

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Graph visualization | SwiftUI Canvas + custom gestures | No mature Swift graph library exists. Port layoutGraph from graph-utils.ts |
| SSE on iOS | URLSession.bytes + AsyncThrowingStream | Parses same event protocol as web app |
| Background monitoring | APNs push notifications | iOS kills SSE connections ~30s after backgrounding. Reconnect with Last-Event-ID on foreground |
| Offline sync | Write-ahead log pattern | Mutations go to SwiftData + sync queue. Background replay when online |
| Auth | ASAuthorizationPlatformPublicKeyCredentialProvider | iOS 16+. Same Hono WebAuthn endpoints serve both web and iOS |

### Dependencies

```swift
// Package.swift
.package(url: "https://github.com/pointfreeco/swift-composable-architecture", from: "1.15.0"),
.package(url: "https://github.com/supabase/supabase-swift", from: "2.20.0"),
.package(url: "https://github.com/kishikawakatsumi/KeychainAccess", from: "4.2.2"),
```

### iOS Capabilities and Limitations

**Can**: List/create/edit projects, view/edit plan graphs, dispatch tasks to registered remote machines, stream execution output, manage machines, offline drafting

**Cannot**: Execute tasks locally (no agent runner), use `environment: 'local'` dispatch, maintain SSE connections in background

---

## Implementation Phases

### Phase 0: Drizzle + SQLite Local Persistence

**Goal**: Solve cross-browser problem. Zero external dependencies.

1. Install `better-sqlite3`, `drizzle-orm`, `drizzle-kit`
2. Create `server/db/schema.ts` with all table definitions
3. Create `server/db/index.ts` with SQLite connection (`~/.nexus/nexus.db`)
4. Auto-run migrations on server start
5. Create `server/routes/data.ts` with CRUD endpoints
6. Migrate Zustand stores to API-backed (IndexedDB as offline cache)
7. One-time IndexedDB → SQLite import flow
8. **Verify**: Same data in Chrome and Safari

### Phase 1: Supabase Auth + Cloud Persistence

1. Create Supabase project, run schema migrations (from Drizzle → Postgres)
2. Swap Drizzle driver: `better-sqlite3` → `postgres-js` with `DATABASE_URL`
3. Enable RLS policies and Realtime on key tables
4. Implement `server/routes/auth.ts` (WebAuthn endpoints)
5. Add `requireAuth` middleware to all Hono routes
6. Create `src/pages/login.tsx` with passkey UI
7. Add `AuthGuard` to app.tsx
8. Frontend stores → Supabase direct (via `supabase-js`), IndexedDB as cache
9. Add Supabase Realtime subscriptions for cross-device sync
10. Execution results writeback: Hono → Supabase after completion
11. **Verify**: Data syncs across browsers, across devices, survives cache clear

### Phase 2: iOS Foundation

1. Xcode project + Swift Package structure
2. Port domain models from `src/types/index.ts`
3. Implement networking: APIClient, SSEClient, Supabase client
4. Auth flow with passkeys (`ASAuthorizationController`)
5. Basic navigation: `TabView` (iPhone) / `NavigationSplitView` (iPad/Mac)
6. Projects list + project detail screens
7. **Verify**: iOS app can sign in, list projects, create new project

### Phase 3: iOS Plan Graph

1. Canvas-based graph renderer with nodes and edges
2. Port `layoutGraph` algorithm from `graph-utils.ts`
3. Gesture handling: pan, zoom, drag nodes, draw connections
4. AI plan generation via SSE (`POST /api/agent/generate-plan`)
5. Node detail panel on tap
6. List view and Gantt timeline view
7. **Verify**: Full plan graph interaction matches web functionality

### Phase 4: iOS Execution + Environments

1. Task dispatch to remote machines (`POST /api/dispatch/task`)
2. SSE streaming for execution output
3. Task detail: output, tool traces, file changes, steer chat
4. Environments screen: machine list with real-time status
5. Push notifications for background task monitoring
6. **Verify**: Dispatch task from iPhone, monitor on iPad, results sync to web

### Phase 5: Polish

1. Offline sync engine with conflict resolution
2. iPad sidebar layout optimization
3. macOS native optimizations
4. Dashboard with stats and health indicators
5. My Tasks cross-project view
6. Widgets (active tasks on Lock Screen)
7. Accessibility audit

---

## Technology Stack

### Frontend
- **React 19** + TypeScript (strict mode)
- **React Router v7** (`react-router` package)
- **Zustand 5** + `idb-keyval` (IndexedDB cache)
- **Tailwind CSS v4** (`@tailwindcss/vite`)
- **Vite 7** (dev server + build)
- **@xyflow/react** (plan graph)
- **Radix UI** (shadcn/ui pattern)
- **cmdk** (command palette)

### Backend
- **Hono.js** on Node.js (port 3001)
- **Drizzle ORM** + **better-sqlite3** (Phase 0) → **postgres-js** (Phase 1+)
- **@anthropic-ai/claude-agent-sdk** (AI)
- **ws** (WebSocket relay, port 3002)
- **Redis** (optional, horizontal scaling only)

### iOS
- **SwiftUI** (iOS 17+)
- **TCA** (The Composable Architecture)
- **supabase-swift** (auth + data)
- **SwiftData** (offline cache)

### Infrastructure
- **Cloudflare Pages** (frontend hosting)
- **Fly.io** (backend + relay, production)
- **Supabase Cloud** (auth + database, Phase 1+)

---

## References

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Hono Documentation](https://hono.dev/)
- [React Flow Documentation](https://reactflow.dev/)
- [Supabase Documentation](https://supabase.com/docs)
- [TCA Documentation](https://pointfreeco.github.io/swift-composable-architecture/)
- [Server-Sent Events Spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [WebAuthn Spec](https://www.w3.org/TR/webauthn-3/)
