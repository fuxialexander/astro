# Cross-Project References & Overleaf Integration

> **Status: PROPOSED** — Not yet implemented (~5%)
>
> This is a design proposal document. The features described here are not yet implemented in the codebase.
>
> **Depends on:** DATA_MODEL.md, BACKEND.md, AGENT_RUNNER.md

---

## What Is This?

Think of a scientist who has just finished months of experiments — cell clustering,
differential expression, pathway analyses — all tracked as completed tasks across
several Astro projects. Now they want to write a paper. Today they would open
Overleaf, copy results from various places, paste them into LaTeX, and manually
keep everything in sync as experiments evolve.

This design introduces two capabilities:

1. **Cross-project references** — a lightweight linking system that lets a task in
   one project point at tasks in other projects and pull their outputs into context.
   Think of it as a citation: "this writing task cites the results of that experiment."

2. **Overleaf integration** — a Git-based sync path that lets Astro agents write
   LaTeX directly into an Overleaf project, so the user can review and edit in
   Overleaf's rich editor while Astro handles the heavy lifting.

Together they enable a workflow where a user says "write a paper about X using
results from projects Y and Z" and the system handles context assembly, LaTeX
generation, and upload — without the user needing to write code or copy-paste.

---

## Vocabulary

| Term | Meaning |
|------|---------|
| **Reference** | A soft link from a task in one project to a task in another project. Does not affect execution ordering — it is metadata, not a dependency. |
| **Backlink** | The reverse view of a reference: "which tasks cite me?" Computed, not stored. |
| **Reference output** | The `executionOutput` of a referenced task, fetched at execution time and injected into the agent's prompt. |
| **Vision doc** | A persistent document on each project that describes intent (product vision or research question). Already injected into every agent session. |
| **Overleaf Git Bridge** | Overleaf's official feature that exposes each project as a Git remote. Requires a premium plan. Auth via Personal Access Token. |
| **Connected account** | An external service credential stored in Astro (e.g., Slack bot token, GitHub OAuth). Encrypted at rest, masked on the client. |

---

## 1. Cross-Project References

### 1.1 Why Soft Links, Not Hard Dependencies?

Astro's existing dependency model (`PlanNode.dependencies`, `PlanEdge`) governs
execution order within a single project. A task with unmet dependencies cannot
run. Cross-project references serve a different purpose: they provide *context*,
not *sequencing*.

A paper-writing task does not block on an experiment completing — the experiment
is already done. The reference says "when you run, go read the output of that
task over there." If the referenced task hasn't run yet or failed, the writing
task still executes; it just gets less context.

This distinction keeps the single-project DAG clean and avoids the complexity of
cross-project scheduling, cycle detection across project boundaries, and
distributed cancellation.

### 1.2 Data Model

Add a `references` field to `PlanNode`:

```typescript
// src/types/index.ts — addition to PlanNode

interface TaskReference {
  projectId: string        // Target project
  nodeId: string           // Target task
  label?: string           // Human-readable ("experiment results", "Figure 3 data")
  addedBy: 'user' | 'ai'  // Who created the reference
  addedAt: string          // ISO timestamp
}

interface PlanNode {
  // ... existing fields ...
  references?: TaskReference[]
}
```

**Design decisions:**

- **`label` is optional but encouraged.** The AI should generate labels during
  plan creation ("DE gene list from cluster analysis"). Users can edit them.
- **`addedBy` tracks provenance.** Users may want to distinguish AI-suggested
  references from ones they explicitly added.
- **No `type` enum.** We considered `type: 'cites' | 'extends' | 'supersedes'`
  but this adds complexity without clear utility. A free-text label is more
  flexible and less likely to confuse non-technical users.
- **References are stored on the source node**, not as separate entities. This
  matches the existing pattern where `dependencies` is an array on `PlanNode`.

### 1.3 Backlink Index

Backlinks ("which tasks reference me?") are computed client-side from the
reference arrays, not stored separately. The plan store builds a reverse index:

```typescript
// src/stores/plan-store.ts — new computed state

interface BacklinkEntry {
  sourceProjectId: string
  sourceNodeId: string
  sourceNodeTitle: string
  sourceProjectName: string
  label?: string
}

// Computed: projectId+nodeId → BacklinkEntry[]
getBacklinksForNode(projectId: string, nodeId: string): BacklinkEntry[]
```

This requires loading plan data for all projects that might reference the current
one. In practice the set is small (a user has tens of projects, not thousands),
so eager loading is acceptable. If scale becomes an issue, a server-side backlink
table can be added later.

### 1.4 Context Injection

Extend `server/lib/dispatch/context-assembler.ts`:

```
EXISTING FLOW:
  vision doc → dependency outputs → agent skills → prompt

NEW FLOW:
  vision doc → dependency outputs → reference outputs → agent skills → prompt
```

A new function `gatherReferenceOutputs()` resolves references at dispatch time:

```typescript
// server/lib/dispatch/context-assembler.ts — new function

interface ReferenceOutput {
  projectId: string
  projectName: string
  nodeId: string
  nodeTitle: string
  label?: string
  output: string           // Truncated executionOutput
  status: PlanNode['status']
}

async function gatherReferenceOutputs(
  references: TaskReference[],
  maxPerReference: number = 5000,
  maxTotal: number = 20000
): Promise<ReferenceOutput[]>
```

The outputs are injected into the prompt as a dedicated section:

```
<referenced_outputs>
## From project "scRNA-seq Analysis" — task "Run cell clustering" (label: experiment results)
Status: completed

[truncated output from that task's execution...]

## From project "Pathway Analysis" — task "KEGG enrichment" (label: pathway data)
Status: completed

[truncated output...]
</referenced_outputs>
```

**Truncation strategy:**

- Each reference output is capped at `maxPerReference` (default 5,000 chars)
- Total reference context is capped at `maxTotal` (default 20,000 chars)
- If total exceeds cap, references are truncated in reverse order (last added
  first), since earlier references are typically more important
- If a referenced task has no output (not yet run, failed, pruned), include
  only its title, description, and status — the agent can note the gap

### 1.5 CLI Command

Add a `task link` subcommand to `packages/cli/src/commands/task.ts` so agents
can create cross-project references via the same astro-cli surface they use
for every other mutation:

```bash
astro-cli task link \
  --source-node-id <nodeId> \
  --target-project-id <projectId> \
  --target-node-id <nodeId> \
  --label "clustering results" \
  --json
```

Agents discover what to link with existing commands (`project list`,
`plan tree`), then call `task link` programmatically. This is useful during
plan generation: the AI can search for relevant completed tasks across
projects and auto-link them without needing a second mutation channel.

### 1.6 UI

**Node detail panel — References section:**

```
┌─────────────────────────────────────────────┐
│ References                            [+ Add]│
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ 📎 experiment results                │    │
│  │ scRNA-seq Analysis → Run clustering  │    │
│  │ Status: completed          [✕ Remove]│    │
│  └──────────────────────────────────────┘    │
│  ┌──────────────────────────────────────┐    │
│  │ 📎 pathway data                      │    │
│  │ Pathway Analysis → KEGG enrichment   │    │
│  │ Status: completed          [✕ Remove]│    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

- Clicking a reference navigates to the target task (`/project/:id/task/:nodeId`)
- **[+ Add]** opens a picker: select project → select task → optional label
- References with `addedBy: 'ai'` show a subtle indicator

**Target task — Backlinks section:**

```
┌─────────────────────────────────────────────┐
│ Referenced by                                │
│                                              │
│  Paper Draft → "Write Results section"       │
│    as "experiment results"                   │
└─────────────────────────────────────────────┘
```

This is read-only. Clicking navigates to the referencing task.

### 1.7 Plan Generation Integration

When generating a plan for a project whose vision doc mentions other projects or
experiments, the AI should automatically suggest references. This is handled in
`server/lib/prompt-templates.ts` by extending the plan generation system prompt:

```
When generating tasks, look for opportunities to create cross-project references.
If the user's description mentions prior experiments, analyses, or data from
other projects, use the link_task tool to connect relevant tasks.

Available projects and their completed tasks:
<available_projects>
[injected list of user's projects with completed task summaries]
</available_projects>
```

The list of available projects is assembled at plan generation time. Only
projects owned by the same user are included. Only completed tasks with
non-empty outputs are listed (no point referencing tasks that haven't run).

---

## 2. Overleaf Integration

### 2.1 Integration Strategy

Overleaf exposes two programmatic paths:

| Path | Auth | Capabilities | Reliability |
|------|------|-------------|-------------|
| **Git Bridge** | Personal Access Token | Full read/write to project files via `git clone/push/pull` | High — official, documented |
| **`/docs` endpoint** | Browser session (no token) | Create new project from `.tex` or `.zip` (one-way, no update) | High — official, create-only |

We use **Git Bridge** as the primary integration. It supports bidirectional sync,
uses standard Git tooling, and authenticates with a token the user generates in
Overleaf's account settings. The `/docs` endpoint is useful only for initial
project creation and does not require implementation in Astro (users can use it
directly from Overleaf).

**Requirements:**

- Overleaf premium plan (Git Bridge is a paid feature on Overleaf Cloud)
- Personal Access Token (created in Overleaf → Account Settings → Git Integration)
- The token expires after 1 year; max 10 per account

### 2.2 Connected Account

Add `'overleaf'` to the `ChannelType` union and define its credential shape:

```typescript
// src/types/index.ts

export type ChannelType = 'slack' | 'telegram' | 'github_webhook' | 'linear' | 'overleaf'
```

```typescript
// server/routes/connected-accounts.ts — add to REQUIRED_FIELDS

const REQUIRED_FIELDS: Record<ChannelType, string[]> = {
  // ... existing ...
  overleaf: ['gitToken'],
}
```

**Stored credentials:**

```json
{
  "channel": "overleaf",
  "label": "My Paper Project",
  "credentials": {
    "gitToken": "olp_xxxxxxxxxxxxxxxxxxxx"
  },
  "settings": {
    "gitUrl": "https://git.overleaf.com/66abc123def456",
    "projectName": "Tumor Microenvironment Paper",
    "autoSync": false,
    "defaultBranch": "master"
  },
  "externalId": "66abc123def456"
}
```

**Connection test** (`POST /api/connected-accounts/:id/test`):

```typescript
// In connected-accounts route, add overleaf test handler

case 'overleaf': {
  const { gitToken } = credentials
  const { gitUrl } = settings
  // git ls-remote with token auth validates both token and project access
  const result = await exec(
    `git ls-remote ${gitUrl.replace('https://', `https://git:${gitToken}@`)}`,
    { timeout: 10000 }
  )
  return { success: true, message: 'Connected to Overleaf project' }
}
```

### 2.3 Workspace Setup

When a task in a paper project is dispatched to an agent, the working directory
setup includes cloning the Overleaf project:

```
DISPATCH FLOW (paper project with Overleaf connected):

1. Resolve working directory (existing pattern in dispatch-engine.ts)
2. If project has Overleaf connected account:
   a. git clone <overleaf-git-url> into working directory
      (or git pull if already cloned)
   b. Set git remote credentials via credential helper
3. Assemble context (vision doc + dependencies + references)
4. Dispatch to agent provider
```

The Overleaf repo becomes the working directory. The agent writes `.tex` files,
and pushes are handled either:

- **Automatically** at task completion (if `autoSync: true`)
- **Via astro-cli** (agent calls `astro-cli overleaf sync`)
- **Manually** by the user from the UI

### 2.4 CLI Commands

Two new subcommands for agents, added to `packages/cli/src/commands/overleaf.ts`:

```bash
# Push local changes to the connected Overleaf project. Commits all modified
# .tex, .bib, and image files, then pushes. Call after writing LaTeX files.
astro-cli overleaf sync \
  --commit-message "<message>" \
  [--file <path>]... \
  --json

# Pull latest changes from Overleaf. Use before writing to avoid conflicts
# with edits made in Overleaf's editor.
astro-cli overleaf pull --json
```

**Implementation in the backend:**

```typescript
// server/lib/dispatch/overleaf-sync.ts

async function syncToOverleaf(
  workingDir: string,
  credentials: { gitToken: string; gitUrl: string },
  commitMessage: string,
  files?: string[]
): Promise<{ pushed: boolean; filesChanged: string[] }> {
  // 1. Configure credential helper (ephemeral, no disk storage)
  // 2. git add (specified files or all tracked + new .tex/.bib/.png/.pdf)
  // 3. git commit -m <message>
  // 4. git pull --rebase (handle conflicts)
  // 5. git push
  // 6. Return list of changed files
}
```

**Credential safety:**

- The Git token is never passed to the agent directly
- The backend injects it via a Git credential helper at dispatch time
- The agent only sees the MCP tool interface, not the underlying auth
- Tokens are fetched from the encrypted connected accounts store

### 2.5 Conflict Handling

Overleaf edits and Astro agent edits can conflict. The strategy:

```
CONFLICT RESOLUTION:

1. Agent calls overleaf_pull before starting work
2. Agent writes LaTeX files
3. Agent calls overleaf_sync
4. If push fails (remote has new changes):
   a. Pull with rebase
   b. If merge conflict:
      - Save conflict markers in files
      - Report to user via ask_user_question:
        "Overleaf has conflicting changes in section.tex.
         Should I keep my version, keep the Overleaf version,
         or show you both?"
   c. If clean merge: push automatically
```

In practice, conflicts are rare because:

- The user is typically not editing Overleaf *while* an agent is writing
- LaTeX sections map to separate files, reducing overlap
- The agent pulls before each writing session

### 2.6 UI

**Settings → Connected Accounts:**

```
┌─────────────────────────────────────────────────────────┐
│ Connected Accounts                                       │
│                                                          │
│  Slack          My Workspace             ● Connected     │
│  GitHub         fuxialexander            ● Connected     │
│  Overleaf       TME Paper Project        ● Connected     │
│                                          [+ Add Account] │
└─────────────────────────────────────────────────────────┘
```

**Add Overleaf dialog:**

```
┌─────────────────────────────────────────────────────────┐
│ Connect Overleaf Project                          [✕]    │
│                                                          │
│  To connect, you need:                                   │
│  1. An Overleaf premium account                          │
│  2. A Personal Access Token (create one in               │
│     Overleaf → Account Settings → Git Integration)       │
│  3. Your project's Git URL (found in the project's       │
│     menu → Git Integration)                              │
│                                                          │
│  Label                                                   │
│  ┌──────────────────────────────────────────────────┐    │
│  │ My Paper                                         │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  Git URL                                                 │
│  ┌──────────────────────────────────────────────────┐    │
│  │ https://git.overleaf.com/66abc123def456          │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  Personal Access Token                                   │
│  ┌──────────────────────────────────────────────────┐    │
│  │ ●●●●●●●●●●●●●●●●●●●●                            │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│                      [Test Connection]  [Connect]         │
└─────────────────────────────────────────────────────────┘
```

**Project plan view — Overleaf badge:**

When a project has a connected Overleaf account, show a small badge/indicator in
the plan view header, with a "Sync to Overleaf" button that triggers a manual
push for the entire project's LaTeX output.

---

## 3. End-to-End Workflow

Here is the complete flow for a scientist writing a paper from experiment results:

```
USER ACTIONS                          SYSTEM ACTIONS
─────────────                         ──────────────

1. Create project
   "Write paper on TME using          AI generates plan:
    results from scRNA-seq             - "Write Abstract"
    and pathway projects"              - "Write Introduction"
                                       - "Write Methods"
                                       - "Write Results — Clustering"
                                       - "Write Results — Pathways"
                                       - "Generate Figure 1"
                                       - "Generate Figure 2"
                                       - "Write Discussion"
                                       - "Compile and Upload"

                                       AI auto-discovers completed tasks
                                       in referenced projects and creates
                                       references:
                                       - "Results — Clustering" → links to
                                         scRNA-seq / "Run cell clustering"
                                       - "Results — Pathways" → links to
                                         Pathway / "KEGG enrichment"

2. Review plan
   Add/remove references
   Adjust task descriptions
   Connect Overleaf account           Validates token + Git URL

3. Approve plan
                                       Dispatch begins:

                                       For "Write Introduction":
                                       - Clone Overleaf repo
                                       - Pull latest
                                       - Inject vision doc + references
                                       - Agent writes introduction.tex
                                       - Agent calls overleaf_sync

                                       For "Write Results — Clustering":
                                       - Pull latest from Overleaf
                                       - Resolve references → fetch
                                         clustering task output (5K chars)
                                       - Agent writes results_clustering.tex
                                         using actual experiment outputs
                                       - Agent calls overleaf_sync

4. Review in Overleaf
   Make edits directly in
   Overleaf's editor

5. Continue with next tasks
                                       Agent calls overleaf_pull
                                       (picks up user's edits)
                                       Writes next section...

6. Final review
   Edit in Overleaf
   Submit to journal
```

---

## 4. Implementation Phases

### Phase 1: Cross-Project References (Foundation)

**Scope:** `references` field, UI, context injection
**Files to modify:**

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `TaskReference` interface, `references` field to `PlanNode` |
| `src/stores/plan-store.ts` | Add `getBacklinksForNode()`, handle references in CRUD |
| `server/lib/dispatch/context-assembler.ts` | Add `gatherReferenceOutputs()`, inject into prompt |
| `packages/cli/src/commands/task.ts` | Add `astro-cli task link` subcommand |
| `src/components/plan-graph/task-node.tsx` | Show reference indicator on nodes |
| New: `src/components/task-detail/references-section.tsx` | References list + add picker |

**No database migration needed** — references are stored in the plan node's JSON
(already a JSONB column in server mode, or in IndexedDB objects in local mode).

### Phase 2: Reference-Aware Plan Generation

**Scope:** AI auto-suggests references during plan creation
**Files to modify:**

| File | Change |
|------|--------|
| `server/lib/prompt-templates.ts` | Extend plan generation prompt with available projects/tasks |
| `server/routes/agent.ts` | Fetch user's completed tasks for prompt context |

### Phase 3: Overleaf Connected Account

**Scope:** Add Overleaf as a channel type, connection UI, test endpoint
**Files to modify:**

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `'overleaf'` to `ChannelType` |
| `server/routes/connected-accounts.ts` | Add `overleaf` to `REQUIRED_FIELDS`, add test handler |
| `src/stores/connected-accounts-store.ts` | No change (generic) |
| `supabase/migrations/` | No change (generic `connected_accounts` table handles it) |

### Phase 4: Overleaf Sync Engine

**Scope:** Git clone/pull/push, CLI commands, workspace integration
**Files to create/modify:**

| File | Change |
|------|--------|
| New: `server/lib/overleaf/sync.ts` | Git operations (clone, pull, push, conflict detection) |
| New: `server/lib/overleaf/credential-helper.ts` | Ephemeral Git credential injection |
| New: `packages/cli/src/commands/overleaf.ts` | Add `astro-cli overleaf sync` and `overleaf pull` subcommands |
| `server/lib/dispatch/dispatch-engine.ts` | Clone/pull Overleaf repo during workspace setup |

### Phase 5: Polish

**Scope:** Auto-sync toggle, sync status indicators, conflict resolution UI
**Files to create/modify:**

| File | Change |
|------|--------|
| New: `src/components/overleaf/sync-status.tsx` | Sync state indicator in plan view |
| `src/components/task-detail/task-output-view.tsx` | Show Overleaf sync events in output |

---

## 5. Security Considerations

### Credential Isolation

- Overleaf tokens are **never exposed to agents**. The backend handles all Git
  operations. The agent calls `astro-cli overleaf sync`, which hits an
  authenticated backend endpoint; the backend fetches the token from encrypted
  storage and injects it via a temporary Git credential helper.
- Tokens are encrypted at rest using Web Crypto API (AES-GCM), matching the
  existing `api-keys-store` pattern.
- In local mode, tokens are stored in IndexedDB (single-user, no encryption
  needed since the browser protects its storage).

### Cross-Project Access

- References can only target projects owned by the same user (enforced by
  RLS in server mode, trivially true in local mode).
- `gatherReferenceOutputs()` fetches from the database with the user's auth
  context, so RLS policies prevent accessing other users' data.
- The `link_task` MCP tool operates within the user's scope (the agent
  session inherits the user's identity).

### Git Operations

- `git clone` / `git push` run in the dispatch engine's sandbox (the task's
  working directory).
- The credential helper writes to a temp file deleted after the operation.
- `git push --force` is never used; conflicts are surfaced to the user.

---

## 6. Limitations & Known Gaps

1. **Overleaf premium required.** Git Bridge is a paid feature on Overleaf Cloud.
   Self-hosted Overleaf Server Pro 4.0+ also supports it. There is no free-tier
   programmatic access path. We should document this clearly in the UI.

2. **No real-time sync.** Sync is triggered by agent actions or manual button
   press. Overleaf does not support webhooks or push notifications for document
   changes. Polling is possible but adds complexity.

3. **10 token limit.** Overleaf limits Personal Access Tokens to 10 per account.
   If a user connects 10+ projects, they'll need to reuse tokens across projects
   (which is fine — one token works for all projects).

4. **Binary files.** Git Bridge handles images and PDFs, but large files may be
   slow. For figure-heavy papers, consider generating figures as separate files
   and referencing them rather than embedding.

5. **Backlink computation at scale.** The current design computes backlinks
   client-side by scanning all projects. This is O(projects * nodes) which is
   fine for typical usage (tens of projects, hundreds of nodes) but would need
   a server-side index for very large workspaces.

6. **No Overleaf project creation from Astro.** The `/docs` endpoint requires a
   browser session and cannot be called from the backend. Users must create the
   Overleaf project manually, then connect it in Astro. This is acceptable for
   v1 since project creation is a one-time action.

7. **SSH keys not supported.** Overleaf Cloud does not support SSH key auth for
   Git. We use HTTPS + token only.

---

## 7. Alternatives Considered

### Full cross-project dependency graph

We could extend `PlanEdge` to support cross-project edges, making references
into real dependencies that block execution. This was rejected because:

- It requires cross-project cycle detection (complex)
- It couples project lifecycles (cancelling one project affects another)
- It doesn't match the use case: paper tasks read from completed experiments,
  they don't wait for them

### Overleaf unofficial APIs (pyoverleaf, overleaf-sync)

Several community tools use session cookie scraping to access Overleaf's internal
APIs. This was rejected because:

- Fragile — breaks on any Overleaf frontend update
- Security risk — requires storing full session cookies
- No official support or stability guarantees

### GitHub as intermediary

Use Overleaf's GitHub Sync feature: Astro pushes to GitHub, user manually syncs
GitHub → Overleaf from the Overleaf UI. This was rejected because:

- Adds an extra manual step (user must click "Pull from GitHub" in Overleaf)
- Requires both GitHub and Overleaf integrations configured
- The Git Bridge is more direct and equally reliable

### Embedding a LaTeX editor in Astro

Build a LaTeX preview/editor directly in Astro's UI. This was rejected because:

- Massive implementation effort for a mature problem (Overleaf already solves)
- Users have existing Overleaf projects and collaborators
- Compilation infrastructure (TeX Live) is non-trivial to host
- Better to integrate with the tool users already use

---

## 8. Open Questions

1. **Should references be project-level or task-level?** The current design is
   task-level (a reference points at a specific task). An alternative is
   project-level references ("this project references that project"), with the
   context assembler automatically finding relevant completed tasks. Task-level
   is more precise but requires more user/AI effort to set up.

2. **Reference output freshness.** If a referenced task is re-run after the
   reference was created, should the writing task see the new output? The current
   design always fetches the latest output, which seems correct but could
   surprise users if old results change.

3. **Multi-Overleaf-project support.** Should one Astro project be able to sync
   to multiple Overleaf projects (e.g., paper + supplementary materials)? The
   current design assumes 1:1 but the connected accounts model can store
   multiple Overleaf accounts per user.

4. **Template support.** Should Astro provide LaTeX templates (e.g., journal-
   specific styles) as part of the paper project creation flow? This is useful
   but orthogonal to the core integration.
