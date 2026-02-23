# Workspace V2 — Backend Changes

> **Parent design:** [`docs/design/WORKSPACE_V2.md`](../design/WORKSPACE_V2.md)
> **Data model:** [`workspace-v2-data-model.md`](./workspace-v2-data-model.md)

This document specifies backend API, dispatch, and context assembly changes.

---

## 1. API Route Changes

### 1.1 `GET /api/repo/detect` — simplify response

**Current:** Returns `exists`, `isGit`, `remoteUrl`, `remoteType`, `baseBranch`, `suggestedDeliveryMode`, `dirSizeMB`.

**Change:** Update `suggestedDeliveryMode` default for non-git from `'copy'` to `'direct'`.

```typescript
// server/routes/repo.ts — detect handler
if (!isGit) {
  const sizeMB = getDirectorySizeMB(dirPath)
  return c.json({
    exists: true,
    isGit: false,
    remoteType: 'none',
    suggestedDeliveryMode: 'direct',  // was 'copy'
    dirSizeMB: sizeMB,
  })
}
```

No new fields needed. The frontend interprets `dirSizeMB` to show appropriate UI (copy checkbox, reference option for >= 1 GB).

### 1.2 `POST /api/repo/setup` — simplify

**Remove:**
- `cloneReferenceUrls()` call
- `referenceUrls` from request body
- Reference directory creation (`.astro-refs/`)

**Add:**
- Agent directory creation (`ensureAgentDir()`)
- Git init only when explicitly requested (`initGit` boolean in request body)
- `worktreeStrategy` in request body (passed through from frontend checkbox state)

```typescript
// Request body schema
const setupSchema = z.object({
  path: z.string().min(1),
  agentDirName: z.string().default('.astro'),
  initGit: z.boolean().default(false),              // user opted in
  worktreeStrategy: z.enum(['direct', 'copy', 'reference']).default('direct'),
})
```

**Response:** Same structure — returns working directory, detection results, key files. Add `agentDir` and `worktreeStrategy` to response.

### 1.3 `POST /api/dispatch/task` — update schema

**Remove from schema:**
- `references` field (array of `ProjectReference`)

**Add to schema:**
- `agentDir` (string, optional, default `.astro`)
- `worktreeStrategy` (enum, optional)
- `subdirectory` (string, optional, for monorepo)

**Update:**
- `deliveryMode` enum: add `'copy'` to allowed values

```typescript
const dispatchTaskSchema = z.object({
  // ... existing fields ...

  deliveryMode: z.enum(['pr', 'push', 'branch', 'copy', 'direct']).optional(),

  // NEW
  agentDir: z.string().max(100).default('.astro'),
  worktreeStrategy: z.enum(['direct', 'copy', 'reference']).optional(),
  subdirectory: z.string().max(500).optional(),

  // REMOVED
  // references: z.array(...).optional(),
})
```

### 1.4 Serial execution constraint — narrow to `direct` only

The existing serial check in `dispatch.ts` already checks `deliveryMode === 'direct'`. No change needed — it correctly blocks parallel dispatch for direct mode while allowing `copy` and `reference` modes to run in parallel.

```typescript
// Already correct in dispatch.ts:
if (deliveryMode === 'direct') {
  const stats = dispatchEngine.getStats()
  const activeForProject = stats.activePerProject?.[projectId] ?? 0
  if (activeForProject > 0) {
    return c.json({ success: false, error: 'Serial execution required...' }, 409)
  }
}
```

---

## 2. Context Assembly Changes

### 2.1 `ContextAssembler.assembleContext()` (`server/lib/dispatch/context-assembler.ts`)

**Current:** Reads `project.sourceDirectory ?? project.workingDirectory` for the working directory.

**Change:** Also read `project.source?.localPath` as primary, with fallback to legacy fields. Pass workspace fields through to `AssembledContext`.

```typescript
assembleContext(node, allNodes, allEdges, project): AssembledContext {
  // ... existing dependency/graph logic unchanged ...

  // V2: prefer source.localPath, fall back to legacy
  const projectDir = project?.source?.localPath
    ?? project?.sourceDirectory
    ?? project?.workingDirectory

  return {
    // ... existing fields ...
    workingDirectory: projectDir ?? project?.repository,
    originalProjectDirectory: projectDir,

    // NEW — workspace context
    agentDir: project?.agentDir ?? '.astro',
    worktreeStrategy: project?.worktreeStrategy ?? 'direct',
    deliveryMode: project?.deliveryMode,
    subdirectory: project?.source?.subdirectory,
  }
}
```

### 2.2 Reference injection — remove

**Current:** `dispatch.ts` injects reference repo paths into the agent prompt.

**Change:** Delete the reference injection block entirely. Agents clone repos themselves from task descriptions.

---

## 3. Repo Setup Changes (`server/lib/repo-setup.ts`)

### 3.1 `ensureAgentDir()` — new function

```typescript
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'

export function ensureAgentDir(
  workingDir: string,
  agentDirName: string = '.astro'
): string {
  const agentDir = join(workingDir, agentDirName)
  mkdirSync(join(agentDir, 'worktrees'), { recursive: true })
  mkdirSync(join(agentDir, 'cache'), { recursive: true })

  // Write initial config if it doesn't exist
  const configPath = join(agentDir, 'config.json')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({
      baseBranch: 'main',
      branchPrefix: 'astro/',
    }, null, 2))
  }

  // Update .gitignore if this is a git repo
  if (isGitRepo(workingDir)) {
    addToGitignore(workingDir, `${agentDirName}/worktrees/`)
    addToGitignore(workingDir, `${agentDirName}/cache/`)
  }

  return agentDir
}
```

### 3.2 `setupProjectRepo()` — simplify

**Remove:**
- `cloneReferenceUrls()` and all reference URL handling
- Eager `git clone` for repos the user doesn't have locally

**Keep:**
- Directory validation/creation
- Git detection (`isGitRepo`, `getRemoteUrl`, `getBaseBranch`)
- Key file reading (CLAUDE.md, README.md, package.json)

**Add:**
- Call `ensureAgentDir()` after directory resolution
- Optional `git init` (only when `initGit=true`)
- Return `agentDir` and `worktreeStrategy` in response

### 3.3 `cloneReferenceUrls()` — delete entirely

### 3.4 `buildProjectSource()` — simplify

Drop `type` field from returned `ProjectSource`. Drop `gitRoot` computation.

---

## 4. Git URL Validation (`server/lib/git-url-utils.ts`)

### 4.1 `validateGitUrl()` — replace

**Current:** GitHub-only regex.

**Replace with:** Generic git URL validation:

```typescript
export function validateGitUrl(url: string): { isValid: boolean; url?: string; error?: string } {
  const trimmed = url.trim()

  // SSH: git@host:path or ssh://user@host/path
  if (/^git@[^:]+:.+/.test(trimmed) || /^ssh:\/\/.+/.test(trimmed)) {
    return { isValid: true, url: trimmed }
  }

  // HTTPS: https://host/path
  if (/^https?:\/\/.+\/.+/.test(trimmed)) {
    return { isValid: true, url: trimmed }
  }

  return { isValid: false, error: 'Expected git URL (SSH or HTTPS)' }
}
```

### 4.2 `detectRemoteType()` — unchanged

Already supports GitHub, GitLab, Bitbucket, generic. No changes needed.

---

## 5. Dispatch via Relay

### 5.1 `dispatchViaRelay()` in `dispatch.ts`

**Update:** Pass workspace fields through to the `TaskDispatch` message sent to the relay:

```typescript
// In the dispatchViaRelay() call, add:
agentDir: body.agentDir ?? '.astro',
worktreeStrategy: body.worktreeStrategy,
deliveryMode: body.deliveryMode,
subdirectory: body.subdirectory,
referenceDir: body.referenceDir,       // original dir path for reference mode
```

The relay forwards these fields to the agent runner as part of the `task.dispatch` WebSocket message.

---

## 6. File Map Generation (for reference mode)

New utility function for reference folder mode. Called during dispatch when `worktreeStrategy === 'reference'`.

```typescript
// server/lib/file-map.ts (new file)
import { readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

interface FileMapEntry {
  path: string      // relative to dir root
  sizeMB: number
  category: 'code' | 'data'
}

export function generateFileMap(
  dir: string,
  opts?: { maxEntries?: number; codeSizeThresholdMB?: number }
): FileMapEntry[] {
  const maxEntries = opts?.maxEntries ?? 500
  const codeThreshold = opts?.codeSizeThresholdMB ?? 1
  const entries: FileMapEntry[] = []

  function walk(currentDir: string) {
    if (entries.length >= maxEntries) return
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entries.length >= maxEntries) return
      const fullPath = join(currentDir, entry.name)
      if (entry.name.startsWith('.')) continue  // skip hidden
      if (entry.isDirectory()) {
        walk(fullPath)
      } else {
        const stat = statSync(fullPath)
        const sizeMB = stat.size / (1024 * 1024)
        entries.push({
          path: relative(dir, fullPath),
          sizeMB: Math.round(sizeMB * 100) / 100,
          category: sizeMB < codeThreshold ? 'code' : 'data',
        })
      }
    }
  }

  walk(dir)
  return entries
}

export function formatFileMapForPrompt(dir: string, entries: FileMapEntry[]): string {
  const lines = entries.map(e => {
    const size = e.sizeMB < 1
      ? `${Math.round(e.sizeMB * 1024)} KB`
      : `${e.sizeMB.toFixed(1)} MB`
    return `  ${e.path.padEnd(50)} (${size})  — ${e.category}`
  })

  return [
    `## Reference Directory`,
    ``,
    `Your project directory at ${dir} is available as a`,
    `READ-ONLY reference. Do not modify files there directly.`,
    ``,
    `File map:`,
    ...lines,
    ``,
    `Use absolute paths to READ files from the reference directory.`,
    `Write all new or modified files in your working directory.`,
  ].join('\n')
}
```

This is injected into the agent prompt by the context assembler when `worktreeStrategy === 'reference'`.
