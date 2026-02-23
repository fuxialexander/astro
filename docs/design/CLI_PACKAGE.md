# CLI Package Design — @astro/cli

> Phase 2 of the monorepo architecture plan. Depends on Phase 0 (monorepo infra) and Phase 1 (@astro/core extraction).

## Overview

`@astro/cli` is a local-first CLI for managing Astro projects, plans, tasks, environments, and observability traces. It operates directly against the local PGlite database via `@astro/core`, bypassing the Hono HTTP server for data operations. Task dispatch goes through the server API (default: deployed production server, configurable).

### Dual-Mode Output

The CLI serves **both humans and AI agents**:

- **Interactive mode** (default): colored output, spinners, aligned tables, relative timestamps
- **Non-interactive mode** (`--json`): raw JSON for piping to `jq` or programmatic consumption

### Agent Workflow Example

```bash
# 1. List projects, pick one
astro-cli project list --json | jq '.[0].id'

# 2. Get project details (working dir, etc.)
astro-cli project show <id> --json | jq '.workingDirectory'

# 3. List tasks, find one to dispatch
astro-cli task list --project-id <id> --json | jq '.[] | select(.status=="planned")'

# 4. Dispatch it
astro-cli task dispatch <nodeId> --project-id <id>

# 5. Check execution trace
astro-cli trace list --execution-id <execId> --json

# Or: fuzzy search across everything
astro-cli search "authentication" --json
```

---

## Architecture

```
Terminal
  └── @astro/cli (Commander.js)
        ├── Direct DB access via @astro/core (PGlite + Drizzle)
        │     └── project, plan, task, search, activity, trace, env queries
        └── Server API calls (HTTP + SSE)
              └── task dispatch, env remove (require relay/auth)
```

### Key Design Decisions

1. **No `serve` command**: The Hono backend is not bundled. Dispatch calls the deployed server API. A future Tauri app will use IPC directly, not Hono as sidecar (see `TAURI_APP.md`).

2. **Server URL defaults to production**: `https://astro-api.fuxialexander.work`. Overridable via `--server-url` flag, `ASTRO_SERVER_URL` env var, or `~/.astro/config.json`.

3. **Direct Drizzle queries**: CLI reads/writes PGlite directly using `@astro/core` DB exports. No HTTP overhead for local data operations.

4. **Commander.js**: Already used in the agent-runner submodule, consistent across the monorepo.

---

## Command Reference

### Global Options

```
--json        Machine-readable JSON output (for agents/pipes)
--quiet       Suppress spinners and decorative output
```

### Commands

| Command | Description |
|---------|-------------|
| `project` | Project management (list, show, create, delete) |
| `plan` | Plan graph operations (list, show, tree) |
| `task` | Task management (list, show, dispatch) |
| `env` | Environment/machine management (list, show, remove, set-default) |
| `search` | Fuzzy search across projects and tasks |
| `activity` | Activity feed (list) |
| `trace` | Observability traces (list, show) |
| `config` | View/set CLI config (server-url, default-machine, auth-token) |

---

## Implementation Steps

### Step 1: Package Scaffold

**`packages/cli/package.json`**

```json
{
  "name": "@astro/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "astro-cli": "./src/index.ts" },
  "dependencies": {
    "@astro/core": "workspace:*",
    "commander": "^12.1.0",
    "chalk": "^5.3.0",
    "ora": "^8.1.1"
  }
}
```

**`packages/cli/tsconfig.json`**: Extends `../../tsconfig.node.json`, `noEmit: true`.

**Root config updates:**
- `tsconfig.json`: Add `{ "path": "./packages/cli/tsconfig.json" }` to references
- `package.json`: Add `"astro-cli": "tsx packages/cli/src/index.ts"` script

---

### Step 2: Entry Point and DB Init

**`packages/cli/src/index.ts`** — Commander program with global `--json`/`--quiet` flags, registers all subcommands.

**`packages/cli/src/db.ts`** — DB initialization helper:

```typescript
export async function ensureDb() {
  process.env.APP_MODE = 'local'
  await initDb()
  await runMigrations(migrationsFolder)  // configurable path
  await bootstrapLocalMode()
}
```

**Modify:** `packages/core/src/db/migrate.ts` — add optional `migrationsFolder` param. Update re-export stub at `server/lib/db/migrate.ts`.

---

### Step 3: Output Formatter

**`packages/cli/src/output.ts`**

```typescript
// Human-readable table
export function formatTable(rows: Record<string, unknown>[], columns: ColumnDef[]): string

// JSON output
export function formatJson(data: unknown): string

// Smart printer: respects --json global flag
export function print(data: unknown, opts: { json?: boolean, columns?: ColumnDef[] }): void

interface ColumnDef { key: string; label: string; width?: number; format?: (v: unknown) => string }
```

**Human output:**
```
ID           NAME               STATUS    WORK DIR            UPDATED
abc12345     My Project         active    /Users/me/project   2 hours ago
def67890     Research Paper     active    /Users/me/paper     1 day ago
```

**JSON output** (`--json`):
```json
[{"id":"abc12345","name":"My Project","status":"active","workingDirectory":"/Users/me/project","updatedAt":"2026-02-23T07:00:00Z"}]
```

---

### Step 4: Project Commands

**`packages/cli/src/commands/project.ts`**

| Command | Description |
|---------|-------------|
| `project list` | List all projects (id, name, status, workdir, updated) |
| `project show <id>` | Full project details (all fields including visionDoc, workdir, sourceDir, repository, deliveryMode) |
| `project create --name <n> [--description <d>] [--dir <path>]` | Create project |
| `project delete <id>` | Delete project + plan + executions (transaction) |

Direct Drizzle queries with `LOCAL_TEAM_ID`. Pattern from `server/routes/data.ts`.

**Key imports:** `db` from `@astro/core/db`, schema tables from `@astro/core/db/schema`, `LOCAL_USER_ID, LOCAL_TEAM_ID` from `@astro/core/db/bootstrap-local`.

---

### Step 5: Plan Commands

**`packages/cli/src/commands/plan.ts`**

| Command | Description |
|---------|-------------|
| `plan list --project-id <id>` | List plan nodes (id, title, status, type, startDate, endDate) |
| `plan show <nodeId>` | Full node details (title, description, status, dependencies, executionOutput, worktree info) |
| `plan tree --project-id <id>` | ASCII dependency tree |

**Tree output:**
```
├── n1: Setup dev environment [completed]
│   ├── n2: Install dependencies [in_progress]
│   └── n3: Configure CI [planned]
└── n4: Write API layer [planned]
    └── n5: Add tests [planned]
```

**JSON tree** (`--json`): nested objects with `children` arrays.

---

### Step 6: Task Commands (with Dispatch)

**`packages/cli/src/commands/task.ts`**

| Command | Description |
|---------|-------------|
| `task list [--project-id <id>] [--status <s>]` | List tasks across all projects (or filtered) |
| `task show <nodeId>` | Full task details: title, description, status, latest execution, worktree location, file changes |
| `task dispatch <nodeId> --project-id <id> [--force] [--server-url <url>]` | Dispatch via server API |

**`task list` without `--project-id`**: Lists ALL tasks across all projects (cross-project view, equivalent to My Tasks page). Supports `--status planned|in_progress|completed|...` filtering.

**`task dispatch`**: Calls server API at configured URL. Assembles payload from DB (project workdir, node description, dependency outputs). Streams SSE to stdout.

**`packages/cli/src/api-client.ts`** — HTTP + SSE client for dispatch:

```typescript
export async function dispatchTask(serverUrl: string, payload: object): Promise<void>
// Streams: text→stdout, tool_use→[tool] prefix, result→summary
```

---

### Step 7: Search Command

**`packages/cli/src/commands/search.ts`**

| Command | Description |
|---------|-------------|
| `search <query>` | Fuzzy search across projects, plan nodes, and executions |

Searches using SQL `ILIKE` across `projects` (name, description), `planNodes` (title, description), `taskExecutions` (executionId, streamText).

**Human output:**
```
Projects (2 matches):
  abc123  My Auth Project       active    /Users/me/auth

Tasks (5 matches):
  n1      Setup authentication  completed   (My Auth Project)
  n3      Add OAuth provider    planned     (My Auth Project)
```

**JSON mode**: `{ projects: [...], tasks: [...], executions: [...] }`

---

### Step 8: Activity Command

**`packages/cli/src/commands/activity.ts`**

| Command | Description |
|---------|-------------|
| `activity list [--project-id <id>] [--limit <n>]` | List recent activities |

Queries `activityEvents` table. Shows: timestamp, type, title, project, nodeId.

---

### Step 9: Trace Command (Observability)

**`packages/cli/src/commands/trace.ts`**

| Command | Description |
|---------|-------------|
| `trace list --execution-id <id>` | List tool traces for an execution |
| `trace show --execution-id <id>` | Full trace details (tool calls, file changes, timing, tokens) |

Queries `toolTraces`, `fileChanges`, `observationEvents` tables.

**`trace list`** shows a timeline:
```
TIME         TOOL              DURATION   STATUS
07:48:01     Read              12ms       ✓
07:48:02     Edit              45ms       ✓
07:48:03     Bash              1.2s       ✓
07:48:05     Write             8ms        ✓

Files changed: 3 (2 modified, 1 created)
Total: 4 tool calls, 1.3s, 15k tokens
```

**`trace show`** (JSON only) outputs the full observation tree including input/output of each tool call, token usage per generation.

---

### Step 10: Environment Commands

**`packages/cli/src/commands/env.ts`**

| Command | Description |
|---------|-------------|
| `env list` | List registered machines (id, name, hostname, platform, providers, connected, lastSeen) |
| `env show <id>` | Full machine details (provider configs, metadata, workspace) |
| `env remove <id>` | Revoke/remove a registered machine (calls server API) |
| `env set-default <id>` | Set default target machine for dispatch (saved to config) |

Queries `registeredMachines` table. For `env remove`, calls server API (`DELETE /api/device/machines/:id`) since revocation requires server-side token invalidation.

---

### Step 11: Config Management

**`packages/cli/src/config.ts`**

Manages `~/.astro/config.json`:

```typescript
interface CliConfig {
  serverUrl: string       // default: 'https://astro-api.fuxialexander.work'
  defaultMachineId?: string
  authToken?: string      // for authenticated server calls
}

export function loadConfig(): CliConfig
export function saveConfig(updates: Partial<CliConfig>): void
export function getServerUrl(cliOverride?: string): string
```

**Server URL resolution order:**
1. `--server-url` CLI flag (highest priority)
2. `ASTRO_SERVER_URL` env var
3. `~/.astro/config.json` `serverUrl` field
4. Default: `https://astro-api.fuxialexander.work`

---

### Step 12: Tests

**`tests/cli-commands.test.ts`**

```typescript
describe('project commands', () => {
  it('list returns empty on fresh DB')
  it('create inserts project')
  it('show returns created project with all fields')
  it('delete removes project and cascades')
})

describe('plan commands', () => {
  it('list returns nodes for project')
  it('tree renders ASCII dependency tree')
  it('show returns node with execution data')
})

describe('task commands', () => {
  it('list shows cross-project tasks')
  it('list filters by status')
  it('show includes latest execution and file changes')
})

describe('search', () => {
  it('finds projects by name')
  it('finds tasks by title')
  it('returns grouped results')
})

describe('output formatting', () => {
  it('formatTable aligns columns')
  it('formatJson outputs valid JSON')
  it('--json flag switches output mode')
})
```

Tests init PGlite in-memory, run migrations, seed data, call handler functions directly.

---

### Step 13: Verify

1. `pnpm install` — link workspace deps
2. `pnpm run build` — tsc passes
3. `pnpm test` — CLI tests pass
4. Manual testing (human + agent modes, dispatch, env management)

---

## File Manifest

### Files to Create

| File | Purpose |
|------|---------|
| `packages/cli/package.json` | Package manifest |
| `packages/cli/tsconfig.json` | TypeScript config |
| `packages/cli/src/index.ts` | Entry point (Commander, global opts) |
| `packages/cli/src/db.ts` | DB initialization helper |
| `packages/cli/src/output.ts` | Table/JSON formatting |
| `packages/cli/src/api-client.ts` | HTTP + SSE for dispatch |
| `packages/cli/src/commands/project.ts` | Project CRUD |
| `packages/cli/src/commands/plan.ts` | Plan list/show/tree |
| `packages/cli/src/commands/task.ts` | Task list/show/dispatch |
| `packages/cli/src/commands/search.ts` | Cross-entity fuzzy search |
| `packages/cli/src/commands/activity.ts` | Activity feed |
| `packages/cli/src/commands/trace.ts` | Observability traces |
| `packages/cli/src/commands/env.ts` | Environment/machine management |
| `packages/cli/src/config.ts` | CLI config (~/.astro/config.json) |
| `tests/cli-commands.test.ts` | CLI unit tests |

### Files to Modify

| File | Change |
|------|--------|
| `tsconfig.json` (root) | Add CLI tsconfig reference |
| `package.json` (root) | Add `astro-cli` script |
| `packages/core/src/db/migrate.ts` | Add optional `migrationsFolder` param |
| `server/lib/db/migrate.ts` | Update re-export stub |
