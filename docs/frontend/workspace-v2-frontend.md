# Workspace V2 — Frontend Changes

> **Parent design:** [`docs/design/WORKSPACE_V2.md`](../design/WORKSPACE_V2.md)
> **Data model:** [`../backend/workspace-v2-data-model.md`](../backend/workspace-v2-data-model.md)

This document specifies frontend store, component, and page changes.

---

## 1. Project Creation Form (`src/pages/project-new.tsx`)

### 1.1 Simplification: 859 lines → ~200 lines

The entire form reduces to two inputs:

1. **Description** — "What are you working on?" (textarea)
2. **Directory** — Project directory path with file picker, defaults to `~/.astro/projects/{id}/`

Everything else (repo URL, reference repos, environment selector) is removed from the creation form.

### 1.2 Directory detection feedback

Inline feedback below the directory input, driven by `useDirectoryDetection()` hook:

| State | UI |
|-------|-----|
| Git + forge remote | Badge: "Git repo · github.com:user/repo · PRs enabled" |
| Git + generic remote | Badge: "Git repo · remote detected · branch push mode" |
| Git + no remote | Badge: "Local git repo · changes saved as branches" |
| Non-git, < 1 GB | Badge + unchecked checkbox: "☐ Copy files before each task" + [Init Git] link |
| Non-git, >= 1 GB | Badge + checkboxes: "☐ Copy files (⚠ {X} GB)" + "☐ Use as reference" + [Init Git] |
| Doesn't exist | Badge: "Will be created" + "☐ Initialize git" + "☐ Copy files" |
| Default path | Badge: "Default location" + "☐ Initialize git" + "☐ Copy files" |

### 1.3 Form state

```typescript
interface ProjectNewState {
  description: string
  directory: string                   // defaults to ~/.astro/projects/{uuid}/
  // From detection
  detection: DetectionResult | null
  // User choices (checkboxes)
  initGit: boolean                    // false by default
  worktreeStrategy: 'direct' | 'copy' | 'reference'  // 'direct' by default
}
```

### 1.4 Submission

On submit, the form calls `POST /api/repo/setup` with:

```typescript
{
  path: directory,
  agentDirName: '.astro',
  initGit: initGit,
  worktreeStrategy: worktreeStrategy,
}
```

Then creates the project via store with the source info from detection:

```typescript
const project = {
  name: generateProjectName(description),
  description,
  source: {
    localPath: directory,
    isGit: detection?.isGit ?? initGit,
    remoteUrl: detection?.remoteUrl,
    remoteType: detection?.remoteType ?? 'none',
    baseBranch: detection?.baseBranch ?? 'main',
  },
  deliveryMode: deriveDeliveryMode(source, worktreeStrategy),
  agentDir: '.astro',
  worktreeStrategy,
}
```

### 1.5 Removed UI elements

- Repo URL input field
- Reference repos input (multi-URL)
- Environment selector dropdown
- Source type radio buttons
- All repo-cloning progress indicators

These move to a project settings page (post-creation), if needed at all.

---

## 2. Directory Detection Hook (`src/hooks/use-directory-detection.ts`)

### 2.1 Simplify response handling

**Current:** Returns complex state including repo URL validation, reference URL management.

**Change:** Strip to essentials — debounced call to `GET /api/repo/detect`, returns detection state.

```typescript
interface DetectionResult {
  exists: boolean
  isGit: boolean
  remoteUrl?: string
  remoteType: RemoteType
  baseBranch?: string
  suggestedDeliveryMode: DeliveryMode
  dirSizeMB?: number    // only for non-git
}

function useDirectoryDetection(path: string) {
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!path || path === defaultPath) {
      setDetection(null)
      return
    }
    // Debounced fetch to /api/repo/detect?path=...
    const timer = setTimeout(async () => {
      setLoading(true)
      const result = await fetchDetection(path)
      setDetection(result)
      setLoading(false)
    }, 500)
    return () => clearTimeout(timer)
  }, [path])

  return { detection, loading }
}
```

### 2.2 Removed functionality

- `validateGitUrl()` calls (no URL input)
- Reference URL validation
- Repo clone progress tracking

---

## 3. Store Changes

### 3.1 `project-store.ts` — update project creation

**Add:** `agentDir`, `worktreeStrategy`, `deliveryMode` fields to `addProject()`.

**Remove:** `references` handling in project creation and update.

```typescript
// In addProject():
const project: Project = {
  ...input,
  source: input.source,
  deliveryMode: input.deliveryMode,
  agentDir: input.agentDir ?? '.astro',
  worktreeStrategy: input.worktreeStrategy ?? 'direct',
}
```

### 3.2 `execution-store.ts` — update dispatch call

**Current:** Passes `deliveryMode`, `remoteType`, `references` to `POST /api/dispatch/task`.

**Change:**
- Remove `references` from dispatch payload
- Add `agentDir`, `worktreeStrategy`, `subdirectory` to dispatch payload
- Add `'copy'` to `deliveryMode` handling

```typescript
// In dispatchTask():
const payload = {
  // ... existing fields ...
  deliveryMode: project.deliveryMode,
  remoteType: project.source?.remoteType,
  agentDir: project.agentDir ?? '.astro',
  worktreeStrategy: project.worktreeStrategy,
  subdirectory: project.source?.subdirectory,
  // REMOVED: references
}
```

**Serial constraint:** The existing check for `deliveryMode === 'direct'` already works correctly. The store should also check locally before sending the request:

```typescript
if (project.deliveryMode === 'direct') {
  const activeForProject = Object.values(get().executions)
    .filter(e => e.projectId === projectId && e.status === 'running')
  if (activeForProject.length > 0) {
    throw new Error('Serial execution: only one task at a time in direct mode')
  }
}
```

### 3.3 `execution-store.ts` — copy mode result handling

For `copy` delivery mode, the execution result contains a diff. The store needs to:

1. Store the diff for display in the task detail view
2. Surface an "Apply changes" action to the user

```typescript
// On execution complete with deliveryMode='copy':
if (execution.deliveryMode === 'copy' && result.status === 'completed') {
  // Store diff for review
  execution.copyDiff = result.output
  execution.copyApplied = false
  // The task detail view shows "Review & Apply Changes" button
}
```

### 3.4 Other stores — no changes

- `plan-store.ts` — no changes (nodes/edges unchanged)
- `session-store.ts` — no changes
- `settings-store.ts` — no changes
- `usage-store.ts` — no changes

---

## 4. Component Changes

### 4.1 Task detail view — add diff review for copy mode

When a task completes with `deliveryMode='copy'`, show:

1. Diff viewer (unified diff of worktree vs. original)
2. File change list
3. "Apply Changes" button → calls backend to apply worktree changes back
4. "Discard" button → cleans up worktree without applying

This can use the existing `file-changes-view.tsx` component pattern.

### 4.2 Execution panel — update for new delivery modes

The execution panel (`src/components/execution/execution-panel.tsx`) shows delivery mode status. Add handling for `'copy'` mode:

- During execution: "Running on copy of /path/to/project"
- On completion: "Changes ready for review" (instead of "PR created")

### 4.3 Project settings — new page section

After creation, workspace settings are editable in a project settings section:

- Agent directory name (text input, default `.astro`)
- Worktree strategy (radio: direct / copy / reference) — only shown for non-git projects
- Delivery mode (derived, shown as read-only badge)
- Base branch (text input, for git projects)
- Branch prefix (text input, default `astro/`)

This is a future enhancement. Initial implementation uses creation-time settings only.

---

## 5. Type Updates (`src/types/index.ts`)

See [workspace-v2-data-model.md](../backend/workspace-v2-data-model.md) §1 for complete type changes. Summary:

- Delete `SourceType`, `ProjectReference`
- Simplify `ProjectSource` (remove `type`, `gitRoot`)
- Add `'copy'` to `DeliveryMode`
- Add `WorktreeStrategy` type
- Add `agentDir`, `worktreeStrategy` to `Project`
- Remove `references` from `Project`

---

## 6. `src/lib/project-source.ts` — update

### 6.1 `deriveDeliveryMode()` — add worktree strategy awareness

```typescript
export function deriveDeliveryMode(
  source: ProjectSource,
  worktreeStrategy?: WorktreeStrategy
): DeliveryMode {
  if (!source.isGit) {
    return (worktreeStrategy === 'copy' || worktreeStrategy === 'reference')
      ? 'copy' : 'direct'
  }
  switch (source.remoteType) {
    case 'github':
    case 'gitlab':
    case 'bitbucket': return 'pr'
    case 'generic': return 'push'
    case 'none':
    default: return 'branch'
  }
}
```

### 6.2 `deliveryModeLabel()` — add copy

```typescript
export function deliveryModeLabel(mode: DeliveryMode): string {
  switch (mode) {
    case 'pr': return 'Pull Request'
    case 'push': return 'Push to Remote'
    case 'branch': return 'Local Branch'
    case 'copy': return 'Copy & Apply'
    case 'direct': return 'Direct (in-place)'
  }
}
```

### 6.3 Delete `SourceType`-related logic

Remove any references to `source.type` field or `SourceType` type.
