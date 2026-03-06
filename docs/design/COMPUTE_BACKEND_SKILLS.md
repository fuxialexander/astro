# Compute Backend-Scoped Skill & Context Injection

> Design document for project-level compute backend selection and backend-scoped prompt injection.

> **Status (March 2026):** Implemented in PR #640. Projects store a `computeBackends` array that controls which skills and environment context are injected into agent prompts. Default skills ship for k8s-exec, slurm, and docker. Playground gets per-session backend selection.

## Overview

The compute backend system adds a **filtering layer** between the skill registry and prompt injection. Instead of injecting all enabled skills into every prompt, skills are filtered by the project's selected compute backends using a tag-based mapping. This keeps prompts lean — a project targeting only Kubernetes doesn't get Slurm instructions cluttering the context window.

### Design Goals

1. **Project-level ownership**: `computeBackends` lives on the project, inherited by all tasks — same pattern as AI provider
2. **Lean by default**: Empty/unset `computeBackends` means NO backend-specific skills injected
3. **Tag-based filtering**: Skills declare tags; backends map to tags; the filter computes the union
4. **Environment context aggregation**: Per-backend custom context from Environment settings is sectioned and injected
5. **No task-level selector**: Tasks inherit from project (hidden, like provider). Playground gets per-session selection.

### Relationship to Existing Systems

| System | Role | Interaction |
|--------|------|-------------|
| **Skills** (`SKILLS.md`) | Registry of skill definitions with tags | Backend filter selects which skills reach the prompt |
| **Execution Strategies** (`EXECUTION_STRATEGIES.md`) | HOW commands run on machines | Backend selection is about WHAT instructions to inject, orthogonal to execution strategy |
| **Environment Configs** | Per-backend custom context (Agent Context) | Aggregated and injected into prompts alongside skills |
| **Dispatch** | Routes tasks to machines | Reads project `computeBackends` to scope skill injection at dispatch time |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Project                                   │
│              computeBackends: ["k8s-exec", "slurm"]          │
└──────────┬───────────────────────────────────────────────────┘
           │ inherited by all tasks, read at prompt-build time
           ▼
┌──────────────────────────────────────────────────────────────┐
│              BACKEND_SKILL_TAGS Mapping                        │
│  "k8s-exec" → ["kubernetes", "k8s"]                          │
│  "slurm"    → ["slurm", "hpc"]                               │
│  "docker"   → ["docker", "container"]                        │
│  "direct"   → []                                              │
└──────────┬───────────────────────────────────────────────────┘
           │ filterSkillsByBackends()
           ▼
┌──────────────────┐    ┌──────────────────────────────────────┐
│  SkillManager    │    │       Environment Configs DB          │
│  (in-memory)     │    │  loadEnvironmentContext(userId,       │
│  getEligible()   │    │    backends, machineId)               │
│  → filter by     │    │  → sectioned markdown per backend     │
│    backend tags  │    │                                       │
└────────┬─────────┘    └──────────┬───────────────────────────┘
         │ skills XML               │ environment markdown
         ▼                         ▼
┌──────────────────────────────────────────────────────────────┐
│                  Agent System Prompt                           │
│  <skills>                                                     │
│    <skill name="astro/k8s-default">...</skill>               │
│  </skills>                                                    │
│                                                               │
│  ## Compute Environment Context                               │
│  <user_content>                                               │
│    ### k8s-exec Environment                                   │
│    {user's custom K8s context}                                │
│    ### slurm Environment                                      │
│    {user's custom Slurm context}                              │
│  </user_content>                                              │
└──────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/db/schema.ts` | `computeBackends` column on `projects` table |
| `packages/core/src/types.ts` | `computeBackends` on `Project` interface |
| `packages/core/src/skill-injector.ts` | `BACKEND_SKILL_TAGS`, `filterSkillsByBackends()` |
| `packages/core/src/prompt-templates.ts` | `environmentContext` param on all prompt builders |
| `server/lib/skill-manager.ts` | `getBackendScopedSkillInjection()` method |
| `server/routes/agent.ts` | `loadEnvironmentContext()`, backend resolution in all routes |
| `server/routes/dispatch.ts` | Backend-scoped skills at dispatch time |
| `server/routes/data.ts` | `computeBackends` in PATCH allowlist |
| `skills/compute_backend_default/` | Default skills for k8s-exec, slurm, docker |
| `src/components/execution/backend-multi-select.tsx` | Frontend multi-select component |
| `src/components/execution/backend-constants.ts` | `AVAILABLE_BACKENDS` array |

---

## Data Model

### Project Field

```typescript
// packages/core/src/db/schema.ts
computeBackends: text('compute_backends').array().default([]),
```

```sql
-- supabase/migrations/20260308000000_add_project_compute_backends.sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS compute_backends text[] DEFAULT '{}';
```

The field is a simple `text[]` column on the existing `projects` table. No new RLS policies needed — the `projects` table already has row-level security.

### Skill Tags

Skills declare tags in their SKILL.md frontmatter:

```yaml
tags: [kubernetes, k8s]
```

Tags are stored in the `skills.tags` column (`text[]`) and exposed via `OpenClawSkill.tags` (`string[]`).

### Backend-to-Tag Mapping

```typescript
// packages/core/src/skill-injector.ts
export const BACKEND_SKILL_TAGS: Record<string, string[]> = {
  'k8s-exec': ['kubernetes', 'k8s'],
  'slurm':    ['slurm', 'hpc'],
  'docker':   ['docker', 'container'],
  'direct':   [],  // No backend-specific tags
}
```

---

## Filtering Logic

### `filterSkillsByBackends(skills, selectedBackends)`

The filter operates on the **tags** declared by each skill, not on skill names or categories.

| `selectedBackends` | Behavior |
|--------------------|----------|
| `undefined` or `[]` | Exclude all backend-specific skills (lean default) |
| `["direct"]` | Only skills WITHOUT any backend-specific tags |
| `["k8s-exec"]` | Skills tagged `kubernetes`/`k8s` + all non-backend skills |
| `["k8s-exec", "slurm"]` | Union: `kubernetes`/`k8s` + `slurm`/`hpc` + non-backend skills |

A skill is considered "backend-specific" if it has **any** tag that appears in `ALL_BACKEND_TAGS` (the union of all values in `BACKEND_SKILL_TAGS`). Non-backend skills (those with no backend tags) are always included when at least one backend is selected.

```typescript
// Pseudo-logic
const ALL_BACKEND_TAGS = new Set(['kubernetes', 'k8s', 'slurm', 'hpc', 'docker', 'container'])

function filterSkillsByBackends(skills, selectedBackends) {
  if (!selectedBackends?.length) {
    return skills.filter(s => !s.tags.some(t => ALL_BACKEND_TAGS.has(t)))
  }
  const allowedTags = union(selectedBackends.map(b => BACKEND_SKILL_TAGS[b]))
  return skills.filter(s => {
    if (!s.tags.some(t => ALL_BACKEND_TAGS.has(t))) return true  // non-backend → include
    return s.tags.some(t => allowedTags.has(t))                  // backend → match tags
  })
}
```

### `getBackendScopedSkillInjection(teamId, selectedBackends)`

Server-side method on `SkillManager` that chains:

1. `getEligibleSkills(teamId)` — filters by `enabled && !disableModelInvocation`
2. `filterSkillsByBackends(eligible, selectedBackends)` — tag-based backend filter
3. `buildSkillPromptInjection(filtered)` — XML prompt string

---

## Environment Context

### `loadEnvironmentContext(userId, backends, machineId?)`

Loads custom context from the `environment_configs` table for each selected backend and aggregates into sectioned markdown:

```markdown
### k8s-exec Environment
<user's custom K8s context from Environment settings>

### slurm Environment
<user's custom Slurm context from Environment settings>
```

The entire block is wrapped in `<user_content>` delimiters when injected into prompts (SECURITY: prevents prompt injection from user-provided content).

### Query

```sql
SELECT * FROM environment_configs
WHERE user_id = :userId
  AND backend_id IN (:backends)
  AND (machine_id = :machineId OR machine_id IS NULL)
```

Returns `undefined` if no rows match or all `customContext` fields are empty.

---

## Prompt Injection Points

Backend-scoped skills and environment context are injected in **all four** prompt-building paths:

| Context | Route | Prompt Builder | Skills | Env Context |
|---------|-------|----------------|--------|-------------|
| Plan generation | `POST /generate-plan` | `buildPlanSystemPrompt()` | `skillsSummary` param | `environmentContext` param |
| Plan chat | `POST /project-chat` | `buildChatSystemPrompt()` | `skillsInjection` param | `environmentContext` param |
| Task chat | `POST /task-chat` | `buildTaskChatSystemPrompt()` | `skillsInjection` in context | `environmentContext` in context |
| Task dispatch | `POST /dispatch/task` | Relay system prompt | `skillsInjection` appended | (via execution strategy) |

### Backend Resolution Order

In each route handler, backends are resolved as:

```
body.selectedBackends  →  project.computeBackends  →  undefined (lean default)
```

The request body can override the project setting (used by playground per-session selection). If neither is set, no backend-specific skills are injected.

### Security

All `environmentContext` injections use `<user_content>` XML delimiters, consistent with the existing pattern for vision docs, CLAUDE.md, and README content (SECURITY NOTE MEDIUM-002).

---

## Default Skills

Three succinct default skills ship in `skills/compute_backend_default/`:

| Skill | Directory | Tags | Content |
|-------|-----------|------|---------|
| K8s Essentials | `k8s-exec/SKILL.md` | `[kubernetes, k8s]` | kubectl exec, pod management, file copy, namespace awareness |
| Slurm Essentials | `slurm/SKILL.md` | `[slurm, hpc]` | sbatch, squeue, module loads, job monitoring, GPU allocation |
| Docker Essentials | `docker/SKILL.md` | `[docker, container]` | exec, cp, build, volume mounts, compose |

These are intentionally short (~30-40 lines each) with universally-correct instructions. Users can customize further via:

- **Environment settings** — Add custom Agent Context per backend
- **Settings > Skills** — Toggle, edit, or add detailed workflow skills

The existing `kubernetes-workflow` and `skypilot-workflow` skills remain as optional power-user skills (longer, more opinionated) that users can enable via Settings > Skills.

### Recursive Skill Directory Scanning

`loadBuiltinSkillsFromDisk()` was updated to recursively scan nested directories. When a subdirectory has no `SKILL.md`, it's treated as a group directory and its children are scanned:

```
skills/
├── kubernetes-workflow/SKILL.md       ← loaded directly
├── skypilot-workflow/SKILL.md         ← loaded directly
└── compute_backend_default/           ← group directory (no SKILL.md)
    ├── k8s-exec/SKILL.md             ← loaded via recursion
    ├── slurm/SKILL.md                ← loaded via recursion
    └── docker/SKILL.md               ← loaded via recursion
```

---

## Frontend

### BackendMultiSelect Component

`src/components/execution/backend-multi-select.tsx` — A Popover with checkboxes following shadcn/ui patterns.

**Props:**
```typescript
interface BackendMultiSelectProps {
  selectedBackends: string[]
  onSelectionChange: (backends: string[]) => void
  className?: string
}
```

**Available backends** are defined in `backend-constants.ts`:

| ID | Name | Description |
|----|------|-------------|
| `direct` | Direct | Run on machine directly |
| `k8s-exec` | Kubernetes | kubectl exec into pods |
| `slurm` | Slurm | HPC job scheduler |
| `docker` | Docker | Container execution |

### Placement (3 locations)

| Location | Behavior | Persistence |
|----------|----------|-------------|
| **Plan toolbar** (`plan-view.tsx`) | Reads/writes `project.computeBackends` | Persisted via `updateProject()` |
| **Project overview** (`project-overview.tsx`) | Reads/writes `project.computeBackends` | Persisted via `updateProject()` |
| **Playground landing** (`playground.tsx`) | Per-session `selectedBackends` state | Stored on playground project at session start |

### API Client

`selectedBackends` is passed as an optional parameter to:

- `generatePlan()` — plan generation
- `chatWithAgent()` — plan chat
- `projectChatWithAgent()` — plan chat (alternate path)
- `TaskChatParams` — task chat

### Agent Store Integration

`src/stores/agent-store.ts` reads `project.computeBackends` from the project store and passes it to `generatePlan()` automatically.

---

## Export & Import

`computeBackends` is a field on `Project` and is NOT in `PROJECT_STRIP_KEYS`. This means:

- **Export**: `computeBackends` is included in the exported JSON (preserves compute intent)
- **Import**: Restoring a project restores its backend selection

This is intentional — `computeBackends` represents the project's compute intent (what infrastructure it targets), not machine-specific configuration like `workingDirectory` or `defaultMachineId`.

---

## Data Flow

### Project Backend Selection

```
User selects backends in plan toolbar
  → onSelectionChange(["k8s-exec", "slurm"])
  → updateProject(projectId, { computeBackends: ["k8s-exec", "slurm"] })
  → PATCH /api/data/projects/:id
  → Drizzle UPDATE projects SET compute_backends = '{"k8s-exec","slurm"}'
```

### Plan Generation with Backends

```
Frontend calls generatePlan({ ..., selectedBackends: project.computeBackends })
  → POST /generate-plan { selectedBackends: ["k8s-exec"] }
  → Resolve: body.selectedBackends ?? project.computeBackends ?? undefined
  → skillManager.getBackendScopedSkillInjection(teamId, ["k8s-exec"])
    → getEligibleSkills() → filterSkillsByBackends(skills, ["k8s-exec"])
    → returns only skills tagged "kubernetes" or "k8s" + non-backend skills
  → loadEnvironmentContext(userId, ["k8s-exec"], machineId)
    → queries environment_configs for k8s-exec → sectioned markdown
  → buildPlanSystemPrompt(..., skillsSummary, ..., environmentContext)
  → Claude generates plan with K8s-aware context
```

### Task Dispatch with Backends

```
POST /dispatch/task { projectId, nodeId, ... }
  → db.select().from(projects).where(eq(projects.id, projectId))
  → dispatchBackends = task.computeBackend ? [it] : project.computeBackends
  → skillManager.getBackendScopedSkillInjection(teamId, dispatchBackends)
  → injected into relay system prompt alongside task instructions
```

### Playground Session

```
User selects backends in playground UI → local state
  → handleSubmit() → startPlaygroundSession(description, { selectedBackends })
  → Creates project with computeBackends set
  → POST /dispatch/task → reads project.computeBackends → scoped skills injected
```

---

## Validation

### Zod Schemas

All API routes validate `selectedBackends` via Zod:

```typescript
selectedBackends: z.array(z.string().max(100)).max(20).optional()
```

**Note:** Values are not restricted to known backend IDs. Unknown IDs pass harmlessly through `filterSkillsByBackends` (no matching tags → no backend-specific skills added). This allows future backends to be added without schema changes.

### Database

The `compute_backends` column uses `text[]` — no enum constraint. The column defaults to `'{}'` (empty array).

---

## Testing

No dedicated test file for backend filtering. Coverage via:

- **`tests/skills-crud.test.ts`** (82 tests) — Covers `mapSkillRow` changes (tags field), bootstrap seeding of nested skill directories
- **Manual verification** — See PR #640 test plan

### Recommended Test Scenarios

1. Empty `computeBackends` → no backend-specific skills in prompt
2. `["k8s-exec"]` → only K8s-tagged skills + non-backend skills
3. `["k8s-exec", "slurm"]` → union of both tag sets + non-backend skills
4. `["direct"]` → only non-backend skills (direct has no tags)
5. Unknown backend ID → gracefully ignored, non-backend skills still included
6. Project update persists → page refresh retains selection
7. Playground per-session → different from project setting

---

## Future Considerations

- **Backend ID allowlist**: Add `z.enum()` or `.refine()` validation on `selectedBackends` to catch typos early. Currently unknown IDs degrade gracefully.
- **Auto-detection**: Agent-runner could detect available backends on the machine and suggest defaults.
- **Per-task override**: Currently hidden (inherits from project). Could expose task-level backend selection for heterogeneous projects.
- **Depth limit on skill scanning**: Add max-depth guard to recursive `scanDir` for defense-in-depth.
- **Environment config creation UI**: The `loadEnvironmentContext` function reads from `environment_configs`, but creating these configs requires the Environments page. Consider inline creation from the backend selector.
