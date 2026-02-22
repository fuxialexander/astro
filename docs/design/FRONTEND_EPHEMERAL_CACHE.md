# Frontend Ephemeral Cache Architecture

## Problem

Machine-derived metadata — file trees, skills, slash commands — is volatile, machine-scoped, and potentially large. Storing this data in Postgres/PGlite creates sync issues:

1. **Machine-specific**: Different machines have different file trees and installed skills
2. **Frequently stale**: Files change during development, skills are installed/removed
3. **Large**: File trees for large repos can be tens of thousands of entries
4. **Derived state**: Always reproducible from the source (filesystem on the machine)

Persisting this data in the database conflates ephemeral cache with source of truth.

## Solution: Ephemeral Auto-Fetch

All machine-derived metadata lives **only in Zustand memory**. It is fetched on-demand when a project page loads, cached for a configurable TTL, and invalidated on:

- **TTL expiry** (5 minutes default)
- **Machine change** (`project.defaultMachineId` differs from cached `machineId`)
- **Post-execution** (agent may have changed files or installed skills)
- **Manual refresh** (user action)

On page refresh, data is gone — but re-fetched within ~100-300ms on next project page load.

## Data Categories

### File Tree (existing, working)

| Property | Value |
|----------|-------|
| Source | `git ls-files` via `/api/repo/file-tree` (local) or `/api/fs/files` (remote relay) |
| Cache location | `project-store.ts` — `project.fileTree: string[]` |
| Staleness fields | `fileTreeUpdatedAt`, `fileTreeMachineId` |
| TTL | 5 minutes (`FILE_TREE_STALE_MS`) |
| Invalidation | Machine change, post-execution, TTL |
| Consumers | `FileCompletionTextarea` (@-mention autocomplete), `@codebase` enrichment, plan generation prompt |

### Skills / Slash Commands (new)

| Property | Value |
|----------|-------|
| Source | `GET /api/skills` (server-side) merged with `GET /api/relay/slash-commands` (machine-specific via relay) |
| Cache location | `project-store.ts` — `project.skills: Array<{ name, description, source }>` |
| Staleness fields | `skillsUpdatedAt`, `skillsMachineId` |
| TTL | 5 minutes |
| Invalidation | Machine change, post-execution, TTL |
| Consumers | Settings UI, command palette, chat skill injection, agent execution prompt |

### Future: Git Status, Environment Variables

Same pattern — Zustand-only, auto-fetch on page load, machine-scoped with TTL.

## Shared Hook: `useProjectMetadata()`

A single hook manages all per-project ephemeral data, replacing duplicated `useEffect` blocks in `plan-view.tsx` and `project-overview.tsx`.

```typescript
export function useProjectMetadata(projectId: string | undefined): void
```

### Behavior

1. On mount or dependency change `[projectId, workingDirectory, defaultMachineId]`:
   - Check staleness for file tree and skills
   - If stale or machine mismatch, fetch from appropriate source
   - Store via `updateFileTree()` / `updateProjectSkills()` on project-store
2. Uses `AbortController` to cancel stale in-flight requests
3. Fire-and-forget — errors are silently ignored (cache stays empty, fallback paths handle it)

### Fetch Sources

```
┌──────────────────────────────────────────────────────────┐
│ useProjectMetadata(projectId)                            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  File Tree:                                              │
│    Local:  GET /api/repo/file-tree?workingDirectory=X    │
│    Remote: GET /api/fs/files?machineId=Y&...             │
│                                                          │
│  Skills (merged):                                        │
│    Server: GET /api/skills                               │
│    Machine: GET /api/relay/slash-commands?machineId=Y     │
│    → Merge: server skills + machine skills (deduped)     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Merge Strategy for Skills

1. Fetch server-side skills (`GET /api/skills`) — full `OpenClawSkill` objects with instructions
2. Fetch machine-specific skills (`GET /api/relay/slash-commands`) — `{ name, description }` only
3. Merge by name, machine skills override server skills for name collisions
4. Mark source: `'server'` or `'machine'`
5. If no machine connected: server-only skills (graceful degradation)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No machine connected | Server-side skills only, file tree requires `workingDirectory` to be local |
| Machine disconnects mid-fetch | 10s timeout, cache stays empty, fallback paths handle it |
| Multiple machines registered | Only fetch for `project.defaultMachineId` |
| Concurrent fetches | AbortController cancels previous fetch on dependency change |
| Skills change mid-session | Manual refresh or post-execution invalidation triggers re-fetch |
| Page refresh | Data is gone, re-fetched on next project page visit (~100-300ms) |

## Relationship to PGlite Migration

PGlite replaces IndexedDB for **persistent** data (projects, plans, sessions, chat history). Ephemeral data intentionally skips PGlite:

- `fileTree` has no database column — it's Zustand-only, was previously saved to IndexedDB as part of project state
- `skills` similarly has no database column
- The `updateFileTree()` / `updateProjectSkills()` methods only call `set()` on Zustand, not `dataClient.save()`
- This is by design: ephemeral cache is volatile and machine-specific, not user data

## Existing File Tree Flow (for reference)

```
User opens project page
         │
         ▼
useProjectMetadata() checks staleness
  - Is fileTreeUpdatedAt > 5 min old?
  - Is fileTreeMachineId ≠ defaultMachineId?
         │
    (if stale)
         ▼
Fetch from appropriate source
  - Local: /api/repo/file-tree (git ls-files)
  - Remote: /api/fs/files (relay → agent runner)
         │
         ▼
updateFileTree(projectId, files, machineId)
  - Stores in Zustand memory
  - Sets fileTreeUpdatedAt = now
  - Sets fileTreeMachineId
         │
    ┌────┴────────────┐
    ▼                 ▼
@-mention          @codebase
autocomplete       enrichment
(instant filter)   (append to message)
         │
         ▼
After task completes:
  - Re-fetch file tree (fire-and-forget)
  - Invalidate skills cache
```

## Missing Pieces to Implement

1. **`GET /api/relay/slash-commands` endpoint** — frontend calls it but it doesn't exist in `server/routes/relay.ts`
2. **Skill cache fields on Project type** — `skills`, `skillsUpdatedAt`, `skillsMachineId`
3. **`updateProjectSkills()` on project-store** — parallel to `updateFileTree()`
4. **`useProjectMetadata()` hook** — extracts duplicated logic from plan-view and project-overview
5. **`fetchSlashCommands()` URL bug** — uses `${apiUrl}` as string instead of function call
