# Hierarchical Memory System

> **Status:** Design draft
> **Author:** Claude Code
> **Date:** 2026-03-16
> **Scope:** Agent-runner (local-first), then Astro web platform

Why the current flat `project_knowledge` system hits a wall, and how a tree-structured memory replaces it.

Related: [KNOWLEDGE_SHARING.md](KNOWLEDGE_SHARING.md) (current system), [AGENTIC_WORKFLOW.md](AGENTIC_WORKFLOW.md) (execution pipeline).

---

## 1. Problem

The current system stores knowledge as flat `(key, value)` pairs per project.

| Limitation | Consequence |
|---|---|
| No structure | 100 entries become a wall of text. Agent can't ask "what do we know about the database?" |
| Global budget (16K chars) | Old-but-important entries evicted by recent-but-trivial ones |
| No selective retrieval | Every task receives ALL knowledge, regardless of relevance |
| No cross-project memory | User preferences, coding style, tool choices must be re-learned per project |
| No agent write during chat | `store_knowledge` MCP tool only available during task execution, not project chat |
| No hierarchy for organizing | "findings_setup_db" and "preferences_typescript" live at the same level |

These limitations compound as projects grow. A 50-task project generates ~100+ knowledge entries, consuming the full 16K budget. The agent receives a soup of facts with no organization or relevance signal.

---

## 2. Design Principles

1. **Path-addressed** — Human-readable paths like `project/architecture/data_flow`, not UUIDs. Agents and users can both navigate intuitively.

2. **Auto-vivifying** — Writing to `architecture/database/schema` creates intermediate nodes automatically. No "mkdir" step.

3. **Local-first** — Works entirely on the agent-runner machine without server connectivity. Syncs to Astro server when available.

4. **Scoped injection** — Instead of dumping all knowledge into every prompt, selectively inject relevant subtrees based on task context.

5. **Backward compatible** — Existing flat `project_knowledge` entries map cleanly to leaf nodes. No migration breakage.

6. **Budget per subtree** — Each subtree gets a token budget, so important categories aren't crowded out.

---

## 3. Data Model

### 3.1 Memory Node

```typescript
interface MemoryNode {
  id: string                          // UUID
  parentId: string | null             // null = root child
  key: string                         // path segment (e.g., "database", "coding_style")
  value: string | null                // leaf content (null for branch nodes)
  nodeType: 'namespace' | 'fact' | 'decision' | 'preference' | 'observation' | 'plan'
  scope: 'global' | 'project' | 'task'
  projectId: string | null            // null for global scope
  source: string | null               // taskId, sessionId, or 'user'
  tags: string[]                      // for filtering/search
  priority: number                    // 0=normal, 1=important, 2=critical (affects budget allocation)
  createdAt: string                   // ISO timestamp
  updatedAt: string                   // ISO timestamp
}
```

**Path resolution:** A node's full path is derived by walking up to root:
```
node.key = "schema"
parent.key = "database"
grandparent.key = "architecture"
→ path = "architecture/database/schema"
```

### 3.2 Tree Structure

```
(root)
├── _global/                          scope=global
│   ├── preferences/
│   │   ├── coding_style              "TypeScript strict, functional patterns, no classes"
│   │   ├── tools                     "bun over npm, vitest over jest"
│   │   └── communication             "concise, no emojis, no time estimates"
│   ├── patterns/
│   │   ├── error_handling            "fail fast, descriptive errors, surface to user"
│   │   └── testing                   "integration > unit for API routes"
│   └── environment/
│       ├── machine_darwin            "macOS, M-series, 64GB RAM"
│       └── tools_available           "gh, git, node 22, bun 1.x, docker"
│
├── _project:{id}/                    scope=project
│   ├── architecture/
│   │   ├── overview                  "Vite + React 19 frontend, Hono backend, PGlite/Postgres"
│   │   ├── data_flow                 "stores → dataClient → /api/data → Drizzle ORM"
│   │   └── database/
│   │       ├── schema                "5 core tables: projects, plan_nodes, plan_edges, ..."
│   │       └── migrations            "Supabase migrations in supabase/migrations/"
│   ├── decisions/
│   │   ├── auth_strategy             "Passkey + WebAuthn, no passwords"  [priority=2]
│   │   └── state_management          "Zustand 5 with dataClient persistence"
│   ├── findings/
│   │   ├── from:{nodeId}/
│   │   │   ├── key_findings          "- JWT tokens expire after 24h\n- ..."
│   │   │   └── summary               "Implemented JWT auth with refresh tokens..."
│   │   └── from:{nodeId2}/
│   │       └── key_findings          "- Rate limit at 100 req/min..."
│   └── blockers/
│       └── api_rate_limits           "GitHub API: 5000/hr, need caching layer"
│
└── _task:{id}/                       scope=task (ephemeral)
    ├── plan                          "1. Read schema 2. Add migration 3. Update types"
    └── progress                      "Step 1 complete. Schema has 12 tables..."
```

### 3.3 Scoping Rules

| Scope | Lifetime | Shared across | Storage |
|---|---|---|---|
| `global` | Permanent | All projects on this machine | `~/.astro/memory.db` |
| `project` | Permanent | All tasks in the project | `~/.astro/memory.db` (keyed by projectId) |
| `task` | Ephemeral | Single task execution | Deleted on task completion (or kept if flagged) |

**Global scope** is new — it doesn't exist in the current system. It stores user preferences, machine capabilities, and cross-project patterns that every agent session should know.

---

## 4. Storage Layer

### 4.1 Agent-Runner: SQLite

The agent-runner uses a single SQLite database at `~/.astro/memory.db`:

```sql
CREATE TABLE memory_nodes (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES memory_nodes(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT,
  node_type   TEXT NOT NULL DEFAULT 'fact',
  scope       TEXT NOT NULL DEFAULT 'project',
  project_id  TEXT,
  source      TEXT,
  tags        TEXT DEFAULT '[]',  -- JSON array
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,

  UNIQUE(parent_id, key)  -- siblings must have unique keys
);

CREATE INDEX idx_memory_scope ON memory_nodes(scope, project_id);
CREATE INDEX idx_memory_parent ON memory_nodes(parent_id);

-- Full-text search index
CREATE VIRTUAL TABLE memory_fts USING fts5(
  key, value, tags,
  content=memory_nodes,
  content_rowid=rowid
);
```

**Why SQLite:**
- Single file, no daemon, no Docker
- Recursive CTEs for tree traversal (`WITH RECURSIVE`)
- FTS5 for text search
- Transactions for atomic subtree operations
- Works on every platform (macOS, Linux, HPC nodes)
- `better-sqlite3` is synchronous — no async complexity in the agent-runner

### 4.2 Astro Server: Postgres Extension

Extend the existing `project_knowledge` table or add a new `memory_nodes` table:

```sql
-- Option A: New table (clean, no migration risk)
CREATE TABLE memory_nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES memory_nodes(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT,
  node_type   TEXT NOT NULL DEFAULT 'fact',
  scope       TEXT NOT NULL DEFAULT 'project',
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id),  -- for RLS
  owner_id    UUID REFERENCES auth.users(id),  -- for RLS
  source      TEXT,
  tags        JSONB DEFAULT '[]',
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),

  UNIQUE(parent_id, key)
);

-- RLS: users can only access their team's memory
ALTER TABLE memory_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_team_access ON memory_nodes
  USING (team_id = current_setting('app.team_id')::uuid);

-- Recursive path resolution function
CREATE OR REPLACE FUNCTION memory_path(node_id UUID)
RETURNS TEXT AS $$
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id, key, 0 as depth
    FROM memory_nodes WHERE id = node_id
    UNION ALL
    SELECT m.id, m.parent_id, m.key, a.depth + 1
    FROM memory_nodes m JOIN ancestors a ON m.id = a.parent_id
  )
  SELECT string_agg(key, '/' ORDER BY depth DESC)
  FROM ancestors;
$$ LANGUAGE sql STABLE;
```

**Option B: Extend project_knowledge** — Add `parent_id` column to existing table. Simpler migration but mixes old flat entries with new hierarchical ones. Not recommended.

### 4.3 Backward Compatibility

Existing flat `project_knowledge` entries map to the new tree as:

```
Flat: { key: "findings_setup_db", value: "...", sourceNodeId: "abc" }
  →
Tree: _project:{id}/findings/from:abc/key_findings = "..."
```

Migration strategy:
1. New `memory_nodes` table coexists with `project_knowledge`
2. A migration script copies flat entries into the tree
3. Both systems read from `memory_nodes`; writes go to both during transition
4. Drop `project_knowledge` once all consumers are migrated

---

## 5. MCP Tools

Six tools exposed to the agent during execution:

### 5.1 `memory_read`

```typescript
{
  name: 'memory_read',
  description: 'Read memory at a path. Returns the node value and its children (1 level deep). '
    + 'Use "/" to see the top-level tree. Use "project/architecture" to see architecture subtree.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to read. "/" for root, "project/architecture" for subtree. '
          + 'Supports glob: "project/findings/*" for all findings.',
      },
      depth: {
        type: 'number',
        description: 'How many levels deep to return (default: 1, max: 5).',
      },
    },
  },
}
```

**Output format:**
```
## project/architecture (namespace)
Children:
  - overview: "Vite + React 19 frontend, Hono backend..." (fact, updated 2h ago)
  - data_flow: "stores → dataClient → /api/data → Drizzle" (fact, updated 1d ago)
  - database/ (namespace, 2 children)
```

### 5.2 `memory_write`

```typescript
{
  name: 'memory_write',
  description: 'Write a value to memory at the given path. Creates intermediate nodes automatically. '
    + 'If the path already exists, updates the value. Use this to store learned facts, '
    + 'architecture decisions, or important observations.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to write. "project/architecture/tech_stack" or "global/preferences/tools".',
      },
      value: {
        type: 'string',
        description: 'The content to store. Keep concise (under 2000 chars).',
      },
      type: {
        type: 'string',
        enum: ['fact', 'decision', 'preference', 'observation', 'plan'],
        description: 'Node type (default: fact). Decisions are preserved longer under budget pressure.',
      },
      priority: {
        type: 'number',
        enum: [0, 1, 2],
        description: '0=normal, 1=important, 2=critical. Higher priority entries survive budget trimming.',
      },
    },
    required: ['path', 'value'],
  },
}
```

### 5.3 `memory_delete`

```typescript
{
  name: 'memory_delete',
  description: 'Delete a memory node and all its children.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to delete.' },
    },
    required: ['path'],
  },
}
```

### 5.4 `memory_search`

```typescript
{
  name: 'memory_search',
  description: 'Search memory by text content. Returns matching nodes with their paths.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (full-text search across keys and values).' },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'all'],
        description: 'Scope to search (default: project).',
      },
      limit: { type: 'number', description: 'Max results (default: 10).' },
    },
    required: ['query'],
  },
}
```

### 5.5 `memory_list`

```typescript
{
  name: 'memory_list',
  description: 'List the tree structure at a path. Lighter than memory_read — returns only keys and types, not values.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to list (default: root).' },
      depth: { type: 'number', description: 'Depth (default: 2).' },
    },
  },
}
```

**Output:**
```
project/
  architecture/
    overview (fact)
    data_flow (fact)
    database/ (2 children)
  decisions/
    auth_strategy (decision, priority=2)
    state_management (decision)
  findings/ (15 children)
  blockers/ (1 child)
global/
  preferences/ (3 children)
  patterns/ (2 children)
```

### 5.6 `memory_import`

```typescript
{
  name: 'memory_import',
  description: 'Import structured content into memory. Parses markdown headers as hierarchy.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Markdown content. H1 → level 1, H2 → level 2, etc.' },
      basePath: { type: 'string', description: 'Base path to import under (default: "project").' },
    },
    required: ['content'],
  },
}
```

---

## 6. Context Injection (Selective Retrieval)

The key improvement over flat injection. Instead of dumping all knowledge:

### 6.1 Always-inject layer

Every task prompt receives:

```
## Global Preferences
<contents of global/preferences/* — typically ~500 chars>

## Project Overview
<contents of project/architecture/overview — typically ~500 chars>

## Active Decisions
<all nodes with type=decision, sorted by priority DESC — typically ~1K chars>

## Active Blockers
<contents of project/blockers/* — typically ~200 chars>
```

Budget: ~3K chars fixed overhead. Much smaller than the current 16K dump.

### 6.2 Task-relevant layer

Based on the task title and description, inject relevant subtrees:

```typescript
function selectRelevantMemory(task: Task, tree: MemoryTree): MemoryNode[] {
  const relevant: MemoryNode[] = []

  // 1. Direct dependency findings
  for (const depId of task.dependencyIds) {
    relevant.push(...tree.getChildren(`project/findings/from:${depId}`))
  }

  // 2. Keyword matching against task description
  const keywords = extractKeywords(task.title + ' ' + task.description)
  const matches = tree.search(keywords.join(' OR '), { scope: 'project', limit: 10 })
  relevant.push(...matches)

  // 3. Budget cap: 8K chars for task-relevant, sorted by priority + recency
  return capByBudget(relevant, 8000)
}
```

### 6.3 On-demand via tools

The agent can always call `memory_read` or `memory_search` to retrieve more context mid-execution. This is the key shift: **memory is pull-based, not push-based.** The agent decides what it needs, rather than receiving everything upfront.

### 6.4 Budget Allocation

| Category | Budget | Priority |
|---|---|---|
| Global preferences | 1K chars | Always included |
| Project overview + decisions | 2K chars | Always included |
| Blockers | 500 chars | Always included |
| Task-relevant findings | 8K chars | Keyword + dependency matched |
| **Total injected** | **~11.5K chars** | |
| **Available via tools** | Unlimited | Agent pulls on demand |

Compare to current system: 16K chars of flat, unfiltered knowledge.

---

## 7. Sync Protocol

### 7.1 Agent-Runner → Server

After task completion, the agent-runner syncs memory changes to the Astro server:

```typescript
interface MemorySync {
  machineId: string
  projectId: string
  operations: MemorySyncOp[]
  timestamp: string
}

type MemorySyncOp =
  | { type: 'upsert'; path: string; value: string; nodeType: string; priority: number; source: string }
  | { type: 'delete'; path: string }
```

**Sync endpoint:** `POST /api/data/memory/sync`

The server resolves paths to `memory_nodes` rows, applying the operations with upsert semantics. Conflicts resolve by latest `updatedAt` wins (last-writer-wins).

### 7.2 Server → Agent-Runner

Before task dispatch, the relay includes a memory snapshot:

```typescript
interface RelayTaskDispatch {
  // ... existing fields ...
  memorySnapshot?: {
    global: MemoryNode[]     // user's global preferences
    project: MemoryNode[]    // project memory tree
  }
}
```

The agent-runner merges this into its local SQLite, preferring the server version for conflicts (server is source of truth for project-scoped memory).

### 7.3 Conflict Resolution

| Scenario | Resolution |
|---|---|
| Same path, different values | Latest `updatedAt` wins |
| Server has node, local deleted | Server wins (restore) |
| Local has node, server deleted | Server wins (delete) |
| Both created same path simultaneously | Server wins (consistent) |

For `global` scope, the local machine is authoritative (preferences are per-machine). For `project` scope, the server is authoritative (shared across team).

---

## 8. Implementation Plan

### Phase 1: Agent-Runner Local Memory (standalone, no server sync)

**Files to create in `packages/agent-runner/`:**

```
src/lib/memory/
  store.ts           — MemoryStore class wrapping better-sqlite3
  types.ts           — MemoryNode, MemoryPath types
  path.ts            — Path parsing, resolution, glob matching
  inject.ts          — Context injection logic (selective retrieval)
src/mcp/
  memory-tools.ts    — MCP tool definitions + handlers
```

**Changes:**
- `src/lib/task-executor.ts` — Initialize memory store, inject memory into task context
- `src/mcp/server.ts` — Register memory tools
- `package.json` — Add `better-sqlite3` dependency

**Deliverable:** Agent can `memory_write`, `memory_read`, `memory_search`, `memory_list`, `memory_delete` during any execution. Memory persists in `~/.astro/memory.db`.

### Phase 2: Auto-extraction → Memory Tree

Replace `extractKnowledgeFromSummary()` with tree-structured writes:

```typescript
// Before (flat):
// key: "findings_setup_db", value: "..."

// After (tree):
// path: "project/findings/from:{nodeId}/key_findings", value: "..."
// path: "project/findings/from:{nodeId}/summary", value: "..."
```

### Phase 3: Server-Side Memory Table + API

- Add `memory_nodes` table to Postgres (Drizzle schema + Supabase migration)
- Add REST endpoints: `GET/POST/DELETE /api/data/memory`
- Add sync endpoint: `POST /api/data/memory/sync`
- Migrate existing `project_knowledge` entries into `memory_nodes`

### Phase 4: Web UI

- Replace `KnowledgePanel` with `MemoryPanel` — tree view with expand/collapse
- Add inline editing, drag-drop reorganization
- Add memory viewer in project chat (agent can reference paths in messages)

### Phase 5: Selective Injection

- Replace flat 16K injection with scoped injection (always + task-relevant + on-demand)
- Keyword extraction from task descriptions
- Priority-based budget allocation

---

## 9. Agent-Runner MemoryStore API

```typescript
class MemoryStore {
  constructor(dbPath: string)

  // Core CRUD
  write(path: string, value: string, opts?: {
    type?: NodeType
    priority?: 0 | 1 | 2
    source?: string
    projectId?: string
    tags?: string[]
  }): MemoryNode

  read(path: string, opts?: {
    depth?: number        // default 1
    includeValues?: boolean  // default true
  }): MemoryNode & { children: MemoryNode[] }

  delete(path: string): number  // returns count of deleted nodes

  // Search
  search(query: string, opts?: {
    scope?: 'global' | 'project' | 'all'
    projectId?: string
    limit?: number
    nodeType?: NodeType
  }): Array<MemoryNode & { path: string; rank: number }>

  // Tree operations
  list(path?: string, depth?: number): MemoryTreeSummary
  move(fromPath: string, toPath: string): void
  getPath(nodeId: string): string

  // Bulk
  import(content: string, basePath: string, format: 'markdown' | 'json'): number
  export(path: string, format: 'markdown' | 'json'): string

  // Context injection
  getInjectionContext(opts: {
    projectId: string
    taskTitle?: string
    taskDescription?: string
    dependencyIds?: string[]
    budgets?: { global: number; overview: number; relevant: number }
  }): string  // formatted markdown for prompt injection

  // Sync
  getChangesSince(timestamp: string): MemorySyncOp[]
  applySync(ops: MemorySyncOp[]): void
}
```

---

## 10. Example Agent Session

A task "Add rate limiting to API endpoints" runs. Here's how the agent uses memory:

```
[Agent starts, receives prompt with injected memory context]

> Global Preferences: "TypeScript strict, fail fast on errors..."
> Project Overview: "Hono.js backend on port 3001..."
> Decisions: "Auth via passkey/WebAuthn", "Zustand for state"

[Agent reads more context]
→ memory_read("project/architecture/database")
  Returns: schema info, migration patterns

[Agent discovers something important]
→ memory_write("project/findings/from:node-xyz/key_findings",
    "- API has no rate limiting\n- 47 public endpoints\n- Using Hono middleware chain",
    { type: "observation" })

[Agent makes a decision]
→ memory_write("project/decisions/rate_limiting",
    "redis-based sliding window, 100 req/min per user, applied via Hono middleware",
    { type: "decision", priority: 1 })

[Agent finishes. Memory persists. Next task can read these entries.]
```

---

## 11. Key Design Tradeoffs

| Tradeoff | Choice | Rationale |
|---|---|---|
| SQLite vs JSON files | SQLite | FTS, recursive queries, transactions, battle-tested |
| Path-based vs ID-based addressing | Path-based | Human-readable, agents navigate naturally, like a filesystem |
| Push vs pull injection | Hybrid (push essentials, pull details) | Keeps prompt small, agent decides what else it needs |
| Single DB vs per-project DB | Single DB with projectId column | Simpler sync, global scope lives alongside project scope |
| Conflict resolution | Last-writer-wins | Simple, predictable, good enough for knowledge (not financial data) |
| FTS engine | SQLite FTS5 (local), `to_tsvector` (Postgres) | Native, no external dependency |
| Max value size | 4000 chars (double current) | Larger entries for richer context, but still bounded |
| Tree depth limit | 8 levels | Prevents pathological nesting, plenty for practical use |

---

## 12. Relationship to Existing Systems

```
Current:
  project_knowledge (flat KV)
    ↓ injected as 16K blob
  Task prompt

Proposed:
  memory_nodes (tree)
    ↓ selective injection
    ├── global preferences (~1K, always)
    ├── project overview + decisions (~2.5K, always)
    ├── task-relevant findings (~8K, keyword-matched)
    └── on-demand via memory_read/search (unlimited, agent pulls)
  Task prompt
```

The memory system subsumes:
- `project_knowledge` → `memory_nodes` with `scope=project`
- `store_knowledge` MCP tool → `memory_write`
- `query_knowledge` MCP tool → `memory_read` + `memory_search`
- Vision document → remains separate (user-authored strategic context, not agent memory)
- Dependency outputs → remains separate (direct data flow, not persistent memory)

---

## 13. Files Reference

| File | Description |
|---|---|
| `packages/agent-runner/src/lib/memory/store.ts` | MemoryStore class (SQLite) |
| `packages/agent-runner/src/lib/memory/types.ts` | MemoryNode, MemoryPath, NodeType |
| `packages/agent-runner/src/lib/memory/path.ts` | Path parsing, glob matching |
| `packages/agent-runner/src/lib/memory/inject.ts` | Selective context injection |
| `packages/agent-runner/src/mcp/memory-tools.ts` | MCP tool definitions |
| `packages/core/src/db/schema.ts` | `memoryNodes` table (Phase 3) |
| `server/routes/data.ts` | Memory REST API (Phase 3) |
| `src/components/memory-panel.tsx` | Tree view UI (Phase 4) |
| `src/stores/memory-store.ts` | Frontend Zustand store (Phase 4) |
