# Workspace V2 — Data Model Changes

> **Parent design:** [`docs/design/WORKSPACE_V2.md`](../design/WORKSPACE_V2.md)

This document specifies the exact type, schema, and storage changes needed to implement Workspace V2.

---

## 1. Type Changes (`src/types/index.ts`)

### 1.1 `ProjectSource` — simplified

```typescript
// BEFORE (v1)
export type SourceType = 'local-git' | 'cloned-git' | 'local-dir'

export interface ProjectSource {
  type: SourceType
  localPath: string
  gitRoot?: string
  subdirectory?: string
  remoteUrl?: string
  remoteType: RemoteType
  baseBranch: string
  isGit: boolean
}

// AFTER (v2) — drop `type`, drop `gitRoot`
export interface ProjectSource {
  localPath: string            // absolute path on disk
  isGit: boolean
  remoteUrl?: string           // auto-detected from git remote
  remoteType: RemoteType       // auto-detected from URL
  baseBranch: string           // auto-detected, default 'main'
  subdirectory?: string        // monorepo: path relative to git root
}
```

**Migration:** `SourceType` can be deleted. `gitRoot` is derivable at runtime (`git rev-parse --show-toplevel`). Existing `source.type` values in stored data are simply ignored.

### 1.2 `DeliveryMode` — add `copy`

```typescript
// BEFORE
export type DeliveryMode = 'pr' | 'push' | 'branch' | 'direct'

// AFTER — add 'copy'
export type DeliveryMode = 'pr' | 'push' | 'branch' | 'copy' | 'direct'
```

### 1.3 `WorktreeStrategy` — new type

```typescript
export type WorktreeStrategy = 'direct' | 'copy' | 'reference'
```

### 1.4 `Project` — add workspace fields, drop references

```typescript
export interface Project {
  // ... existing fields unchanged ...

  // Workspace V2 fields
  source?: ProjectSource           // auto-detected at creation
  deliveryMode?: DeliveryMode      // derived from source
  agentDir?: string                // default '.astro', configurable
  worktreeStrategy?: WorktreeStrategy  // non-git only; default 'direct'

  // REMOVED
  // references?: ProjectReference[]  — feature dropped
  // repository?: string             — use source.remoteUrl
  // workingDirectory?: string       — use source.localPath (legacy read-only)
  // sourceDirectory?: string        — use source.localPath (legacy read-only)
}
```

**Backward compatibility:** `workingDirectory`, `sourceDirectory`, and `repository` remain in the interface as `@deprecated` read-only fields. `resolveProjectSource()` in `src/lib/project-source.ts` already falls back to these.

### 1.5 `ProjectReference` — deleted

```typescript
// REMOVED entirely
// export interface ProjectReference {
//   id: string
//   url: string
//   localPath: string
//   purpose: string
// }
```

### 1.6 `RemoteType` — unchanged

```typescript
export type RemoteType = 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none'
// No change needed
```

---

## 2. Database Schema Changes (`server/lib/db/schema.ts`)

### 2.1 `projects` table

**Add columns:**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `agentDir` | `text` | `'.astro'` | Agent directory name |
| `worktreeStrategy` | `text` | `'direct'` | `'direct'` \| `'copy'` \| `'reference'` |
| `deliveryMode` | `text` | `null` | `'pr'` \| `'push'` \| `'branch'` \| `'copy'` \| `'direct'` |
| `sourceLocalPath` | `text` | `null` | Absolute path on disk |
| `sourceIsGit` | `boolean` | `false` | Whether directory is a git repo |
| `sourceRemoteUrl` | `text` | `null` | Git remote URL |
| `sourceRemoteType` | `text` | `'none'` | Remote forge type |
| `sourceBaseBranch` | `text` | `'main'` | Default branch |
| `sourceSubdirectory` | `text` | `null` | Monorepo subdirectory |

**Keep (deprecated, read-only):**
- `workingDirectory` — existing column, still readable
- `repository` — existing column, still readable

**Drop (deferred):**
- No columns are dropped immediately. Deprecated columns remain for backward compatibility.

### 2.2 `planNodes` table — no changes

The `branchName`, `prUrl`, `prNumber`, `mergeQueueStatus` fields already exist and cover delivery results. No new columns needed.

### 2.3 `taskExecutions` table — add workspace fields

**Add columns:**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `worktreeStrategy` | `text` | `null` | Strategy used for this execution |
| `worktreePath` | `text` | `null` | Absolute path to worktree (if created) |
| `deliveryMode` | `text` | `null` | Delivery mode used |

These are denormalized from the project for auditing — the strategy used at execution time may differ from the project's current setting.

---

## 3. Supabase Migration

```sql
-- Workspace V2: Add project source and workspace fields
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS agent_dir text DEFAULT '.astro',
  ADD COLUMN IF NOT EXISTS worktree_strategy text DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS delivery_mode text,
  ADD COLUMN IF NOT EXISTS source_local_path text,
  ADD COLUMN IF NOT EXISTS source_is_git boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_remote_url text,
  ADD COLUMN IF NOT EXISTS source_remote_type text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS source_base_branch text DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS source_subdirectory text;

-- Workspace V2: Add execution workspace tracking
ALTER TABLE task_executions
  ADD COLUMN IF NOT EXISTS worktree_strategy text,
  ADD COLUMN IF NOT EXISTS worktree_path text,
  ADD COLUMN IF NOT EXISTS delivery_mode text;
```

---

## 4. Data Access Layer

Frontend stores use `dataClient` (`src/lib/data-client.ts`) which calls `/api/data/*` endpoints. There is no direct IndexedDB handling in stores — all persistence goes through the backend API, which uses Drizzle/Postgres (or PGlite in local mode).

New fields (`agentDir`, `worktreeStrategy`, `deliveryMode`, `source.*`) are added to the Drizzle schema and automatically available through the existing data API. Missing fields on read default to:

- `agentDir` → `'.astro'`
- `worktreeStrategy` → `'direct'`
- `deliveryMode` → derived from `source` via `deriveDeliveryMode()`

---

## 5. Relay Protocol (`server/types/relay.ts`)

### 5.1 `TaskDispatch` — update delivery modes, add workspace fields

```typescript
export interface TaskDispatch {
  // ... existing fields unchanged ...

  // UPDATED — add 'copy' to union
  deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct';

  // NEW — workspace context
  agentDir?: string;            // '.astro' by default
  worktreeStrategy?: 'direct' | 'copy' | 'reference';
  referenceDir?: string;        // original dir path when strategy=reference
  subdirectory?: string;        // monorepo: agent CWD relative to worktree root

  // REMOVED
  // references field is dropped (was never in relay types, only in dispatch route schema)
}
```

### 5.2 `TaskResult` — unchanged

`branchName`, `prUrl`, `prNumber` already present. Copy/reference results use `output` for diff summary. No new fields needed.

---

## 6. Dispatch Types (`server/lib/dispatch/types.ts`)

### 6.1 `AssembledContext` — add workspace fields

```typescript
export interface AssembledContext {
  // ... existing fields ...

  // NEW — workspace context passed to agent runner
  agentDir?: string
  worktreeStrategy?: 'direct' | 'copy' | 'reference'
  deliveryMode?: string
  referenceDir?: string          // for reference mode: original dir path
  subdirectory?: string          // for monorepo: CWD within worktree
}
```

### 6.2 `DispatchRequest` — add workspace override

```typescript
export interface DispatchRequest {
  // ... existing fields ...

  // NEW — workspace override (rarely used, mainly for re-dispatch)
  worktreeStrategy?: 'direct' | 'copy' | 'reference'
}
```

---

## 7. Frontend Lib (`src/lib/project-source.ts`)

### 7.1 `deriveDeliveryMode()` — update for new modes

```typescript
export function deriveDeliveryMode(
  source: ProjectSource,
  worktreeStrategy?: WorktreeStrategy
): DeliveryMode {
  if (!source.isGit) {
    // Non-git: depends on user's worktree strategy choice
    if (worktreeStrategy === 'copy' || worktreeStrategy === 'reference') return 'copy'
    return 'direct'
  }
  switch (source.remoteType) {
    case 'github':
    case 'gitlab':
    case 'bitbucket':
      return 'pr'
    case 'generic':
      return 'push'
    case 'none':
    default:
      return 'branch'
  }
}
```

### 7.2 `resolveProjectSource()` — unchanged logic, narrower type

The function already handles fallback from `workingDirectory`/`sourceDirectory`/`repository`. No changes needed. The return type narrows to the v2 `ProjectSource` (without `type` and `gitRoot`).

---

## 8. What Gets Deleted

| Item | Location | Reason |
|------|----------|--------|
| `SourceType` | `src/types/index.ts` | Replaced by `isGit` boolean |
| `ProjectReference` | `src/types/index.ts` | Feature dropped |
| `references` field | `Project` interface | Feature dropped |
| `references` | dispatch route schema (`server/routes/dispatch.ts`) | Feature dropped |
| `cloneReferenceUrls()` | `server/lib/repo-setup.ts` | Feature dropped |
| `validateGitUrl()` | `server/lib/git-url-utils.ts` | Replaced by generic validation |
