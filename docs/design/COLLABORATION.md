# Collaboration & Community — Design Document

## 1. Overview

This document describes Astro's collaboration model: how teams work together on projects, how public/community projects enable open contribution, and how the content model supports rich task documentation and community review.

Astro's collaboration is fundamentally different from tools like Linear or Slack because **agents do the work, humans direct and review**. The collaboration primitives optimize for fast review cycles, decision transparency, and distributed compute contribution — not human task assignment.

### 1.1 Design Principles

1. **One architecture, all tiers.** Local mode, personal cloud, private team, enterprise, and open community all use the same schema, same queries, same frontend. Differences are in auth, limits, and UI — not code paths.

2. **The plan graph is the collaboration surface.** Not channels, not boards. The directed graph of tasks is where teams coordinate. Content, discussion, and review attach to nodes in the graph.

3. **Teams own projects, not users.** A project belongs to a team. A user is a member of a team. In local mode and personal accounts, the "team" is implicit and invisible — a team of one.

4. **Visibility is per-project, not per-team.** A team can have both private and public projects. Public projects enable open contribution without exposing the team's private work.

5. **Pricing is decoupled from architecture.** The schema has no billing fields. Limits are configurable feature flags. The pricing model (per-seat, per-usage, flat-rate) is decided later based on real usage patterns.

---

## 2. Account & Team Model

### 2.1 Account Types

Every user gets a personal workspace on registration. A personal workspace IS a team — a team with one member. This keeps all queries identical: `WHERE team_id = ?` works regardless of team size.

| Account type | What it is | Team visibility | Members |
|---|---|---|---|
| **Local** (open source) | PGlite on user's machine. No account. Implicit team + user auto-created. | N/A | 1 (implicit) |
| **Personal** (cloud) | Auto-created team on registration. Invisible to user. | N/A | 1 |
| **Team** (paid) | Real team. Invite members, manage roles. Shared projects and machines. | Private | N (invite-only) |
| **Enterprise** | Same as Team + SSO/SAML, audit logs, compliance, SLA. | Private | N (SSO-managed) |

Under the hood, all account types use the same `teams` table. A personal account IS a team with one member. Enterprise IS a team with SSO enabled. No code branching.

### 2.2 Team Schema

```sql
-- Teams are organizational units. No billing fields.
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team membership with roles
CREATE TABLE team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  role TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Email-based invitations
CREATE TABLE invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES user_profiles(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

These tables already exist in the codebase (`server/lib/db/schema.ts`). No schema changes needed for the team model itself.

### 2.3 Local Mode Bootstrap

On first startup with PGlite (no `DATABASE_URL`), create one implicit team and user:

```typescript
const LOCAL_TEAM_ID = '00000000-0000-0000-0000-000000000000'
const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001'

// Called on startup, idempotent
await db.insert(teams).values({ id: LOCAL_TEAM_ID, name: 'Local' }).onConflictDoNothing()
await db.insert(userProfiles).values({ id: LOCAL_USER_ID, name: 'Local User', email: 'local@astro.local' }).onConflictDoNothing()
await db.insert(teamMembers).values({ teamId: LOCAL_TEAM_ID, userId: LOCAL_USER_ID, role: 'owner' }).onConflictDoNothing()
```

The auth middleware sets `teamId` to `LOCAL_TEAM_ID` for all requests. Every query uses `WHERE team_id = ?` and gets the local team's data.

### 2.4 Server Mode Registration

When a new user registers in server mode, auto-create their personal team:

```typescript
async function onUserRegistered(userId: string, userName: string) {
  const [team] = await db.insert(teams).values({
    name: `${userName}'s workspace`,
    description: 'Personal workspace',
  }).returning()

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId,
    role: 'owner',
  })
}
```

Every user always has at least one team. Multi-team support (user belongs to multiple teams) uses `X-Team-Id` header to select the active team per request.

### 2.5 Workspace Limits

Instead of baking pricing tiers into the schema, use configurable limits:

```typescript
interface WorkspaceLimits {
  maxPrivateProjects: number     // free: 3, paid: unlimited
  maxTeamMembers: number         // free: 1, paid: configurable
  maxStorageMb: number           // free: 500MB, paid: configurable
  executionHistoryDays: number   // free: 30 days, paid: unlimited
  publicProjectsEnabled: boolean // true for all tiers
  ssoEnabled: boolean            // enterprise only
}
```

These limits can be mapped to any future pricing model. When billing is implemented, add a separate `team_billing` table — don't modify the core `teams` schema.

---

## 3. Project Visibility & Access

### 3.1 Project Visibility

Projects have a visibility setting. A team can have both private and public projects.

```sql
ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
  -- 'private': team members only
  -- 'public':  anyone can view, contributors can participate
```

Examples:

```
Personal workspace (Alice):
├── Private: "My thesis analysis"
└── Public:  "Convert EdgeR to Python"     ← anyone can contribute

Team workspace (Bioinformatics Lab):
├── Private: "Grant R01 pipeline"          ← team only
├── Private: "Patient data analysis"       ← team only
└── Public:  "scRNA-seq toolkit v2"        ← open to community

Enterprise workspace (Biotech Corp):
└── Private: everything                    ← all private, SSO, audit
```

### 3.2 Access Roles

A project has two access groups: team members (from the owning team) and contributors (joined the public project).

```sql
-- Contributors to public projects
CREATE TABLE project_contributors (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  role TEXT NOT NULL DEFAULT 'contributor',  -- contributor | maintainer
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);
```

The existing `project_members` table in the schema can serve this purpose with an added `contributor` role.

### 3.3 Permission Matrix

| Action | Team owner/admin | Team member | Contributor (public) | Anonymous (public) |
|---|---|---|---|---|
| View project & plan graph | Yes | Yes | Yes | Yes (read-only) |
| View execution results | Yes | Yes | Yes | Yes (read-only) |
| Create tasks directly | Yes | Yes | No (propose only) | No |
| Propose tasks | Yes | Yes | Yes | No |
| Approve task proposals | Yes | Yes | No | No |
| Run executions (own machine) | Yes | Yes | Yes | No |
| Run executions (team machines) | Yes | Yes | No | No |
| Vote on results | Yes | Yes | Yes | No |
| Comment on tasks | Yes | Yes | Yes | No |
| Approve/merge results | Yes | Yes (if reviewer) | No | No |
| Manage project settings | Yes | No | No | No |
| Change project visibility | Yes | No | No | No |

### 3.4 Task Proposals (Public Projects)

In private projects, team members create tasks directly — they appear in the plan graph immediately. In public projects, contributors submit **proposals** that require team approval before becoming live tasks.

```sql
ALTER TABLE plan_nodes ADD COLUMN proposed_by UUID REFERENCES user_profiles(id);
ALTER TABLE plan_nodes ADD COLUMN proposal_status TEXT;
  -- NULL:       created directly by team member (no approval needed)
  -- 'proposed': submitted by contributor, awaiting review
  -- 'accepted': approved by team, now a live task
  -- 'rejected': declined by team
```

Proposal flow:

```
Private project:                 Public project:

Team member creates task         Contributor proposes task
     │                                │
     ▼                                ▼
Task is live in graph            Task shown as "proposed" (grayed out)
     │                                │
     ▼                                ▼
Dispatch immediately             Team admin reviews proposal
                                      │
                                 ┌────┴────┐
                                 │         │
                              Accept    Reject (with reason)
                                 │         │
                                 ▼         ▼
                           Task goes    Proposer notified
                           live in
                           graph
```

---

## 4. Content Model

### 4.1 The Three Layers

Astro's task content model has three layers, inspired by Linear's separation of issue metadata from description from attachments, but extended with execution results that Linear doesn't have.

```
Layer 1: PlanNode (lightweight — the graph cell)
  id, title, status, dependencies, type, position
  executionId, machineId, reviewStatus
  → What you see in the graph view. Stays small for fast rendering.

Layer 2: NodeDocument (rich content — the detail page)
  nodeId → PlanNode
  content (markdown)
  → Design rationale, acceptance criteria, experiment setup.
  → One primary document per node, created on demand.
  → Not every node needs a document — simple tasks don't.

Layer 3: NodeAttachments (structured results — evidence)
  nodeId → PlanNode
  type: benchmark | test_result | file | image | execution_output
  title, subtitle, metadata (structured JSON)
  → Benchmark comparisons, test outputs, code diffs.
  → Multiple per node. Auto-populated from execution results.
```

### 4.2 Schema

```sql
-- Rich content for plan nodes (created on demand, not on every node)
CREATE TABLE node_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',  -- markdown
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(node_id, project_id)  -- one document per node
);

-- Structured attachments (test results, benchmarks, files)
CREATE TABLE node_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'file',
    -- execution_output | benchmark | test_result | file | image
  title TEXT NOT NULL,
  subtitle TEXT,
  content_url TEXT,         -- S3/R2 URL for binary files
  content_json JSONB,       -- structured data (benchmark tables, test output)
  metadata JSONB,           -- flexible key-value (runtime, dataset, parameters)
  created_by UUID REFERENCES user_profiles(id),
  execution_id TEXT,        -- auto-linked when created from execution results
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_node_attachments_node ON node_attachments (node_id, project_id);
CREATE INDEX idx_node_attachments_execution ON node_attachments (execution_id);
```

### 4.3 Auto-Populated Attachments from Executions

When an agent completes a task, the system automatically creates attachments from the execution results. This is a key differentiator from Linear — execution evidence is first-class content.

```typescript
async function onExecutionComplete(execution: TaskExecution, node: PlanNode) {
  // Auto-attach: execution summary
  if (execution.summary) {
    await db.insert(nodeAttachments).values({
      nodeId: node.id,
      projectId: node.projectId,
      type: 'execution_output',
      title: `Execution: ${execution.status}`,
      subtitle: execution.summary.workCompleted,
      contentJson: execution.summary,
      executionId: execution.executionId,
    })
  }

  // Auto-attach: file changes as structured diff
  if (execution.fileChanges.length > 0) {
    await db.insert(nodeAttachments).values({
      nodeId: node.id,
      projectId: node.projectId,
      type: 'file',
      title: `${execution.fileChanges.length} files changed`,
      contentJson: execution.fileChanges,
      executionId: execution.executionId,
    })
  }

  // Auto-attach: usage metrics
  if (execution.metrics) {
    await db.insert(nodeAttachments).values({
      nodeId: node.id,
      projectId: node.projectId,
      type: 'benchmark',
      title: 'Execution Metrics',
      metadata: {
        durationMs: execution.metrics.durationMs,
        tokensUsed: execution.metrics.tokensUsed,
        estimatedCostUsd: execution.metrics.estimatedCostUsd,
        model: execution.metrics.model,
      },
      executionId: execution.executionId,
    })
  }
}
```

### 4.4 When to Create Documents

Documents are **on-demand**, not auto-created. Most tasks in a private team don't need rich documentation — a title and description suffice. Documents are created when:

- A user clicks "Add documentation" on a task detail page
- A community contributor writes acceptance criteria for a proposed task
- An agent generates design rationale during planning (structured output → document)
- A reviewer writes a detailed assessment

---

## 5. Discussion & Review

### 5.1 Threaded Comments

Comments attach to plan nodes. They support threading (replies) and resolution (like GitHub PR review comments).

```sql
CREATE TABLE node_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES node_comments(id),  -- threading
  author_id UUID NOT NULL REFERENCES user_profiles(id),
  body TEXT NOT NULL,  -- markdown
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_node_comments_node ON node_comments (node_id, project_id);
CREATE INDEX idx_node_comments_parent ON node_comments (parent_id);
```

Comment threads serve different purposes depending on context:

| Context | Thread purpose | Example |
|---|---|---|
| Task is `planned` | Design discussion | "Should we use NumPy or JAX for this?" |
| Task is `in_progress` | Steering discussion | "The agent is going down the wrong path, steer it to use sparse matrices" |
| Task is `awaiting_judgment` | Review discussion | "The error handling is missing for edge cases" |
| Task is `completed` | Post-mortem | "This approach worked, but we should also handle zero counts" |

### 5.2 Community Voting

For public projects, community members vote on execution results. Votes are per-execution, not per-node — multiple runs can compete, and the community evaluates each independently.

```sql
CREATE TABLE node_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  vote TEXT NOT NULL,  -- up | down
  comment TEXT,        -- optional reason
  execution_id TEXT,   -- vote on a specific execution run (NULL = vote on the node itself)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(node_id, user_id, execution_id)  -- one vote per user per execution
);

CREATE INDEX idx_node_votes_node ON node_votes (node_id, project_id);
```

### 5.3 Review Assignments (Private Teams)

For private teams, tasks can be assigned a reviewer — the person who judges the agent's output. This is different from an "assignee" in Linear (who does the work). In Astro, agents do the work; the reviewer **evaluates** it.

```sql
ALTER TABLE plan_nodes ADD COLUMN reviewer_id UUID REFERENCES user_profiles(id);
ALTER TABLE plan_nodes ADD COLUMN reviewed_at TIMESTAMPTZ;
ALTER TABLE plan_nodes ADD COLUMN review_verdict TEXT;
  -- approved | changes_requested | pruned
```

The reviewer gets notified when the agent completes the task. They can approve (task → `completed`), request changes (task → re-dispatch with feedback), or prune (task → `pruned`, branch killed).

### 5.4 Review Flow Comparison

```
Private team:                    Public project:

Reviewer assigned                Community reviews
     │                                │
     ▼                                ▼
Agent completes task             Agent completes task
     │                                │
     ▼                                ▼
Reviewer sees result             Result visible to all
     │                                │
     ▼                                ▼
Single person decides:           Community votes:
  Approve / Changes / Prune        👍/👎 + comments
     │                                │
     ▼                                ▼
Done                             Team admin makes final call
                                 (informed by vote count)
```

### 5.5 Decision Log

Every strategic decision (approve, reject, prune, steer) is logged. This feeds back into agent context for future tasks and provides an audit trail for the team.

```sql
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id TEXT,          -- NULL for project-level decisions
  actor_id UUID NOT NULL REFERENCES user_profiles(id),
  type TEXT NOT NULL,    -- approve | reject | prune | steer | redirect | proposal_accept | proposal_reject
  rationale TEXT,        -- why this decision was made
  context JSONB,         -- agent output snapshot, options presented, vote counts
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decisions_project ON decisions (project_id);
CREATE INDEX idx_decisions_node ON decisions (node_id);
```

---

## 6. Notifications

### 6.1 Notification Types

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  type TEXT NOT NULL,
    -- review_requested:   a task you should review completed
    -- approval_needed:    agent asked a question via ask_user_question
    -- task_completed:     a task you're watching completed
    -- mention:            someone @-mentioned you in a comment
    -- proposal_submitted: a contributor proposed a task (team admins)
    -- proposal_decided:   your proposal was accepted/rejected
    -- vote_received:      someone voted on your execution result
  project_id TEXT REFERENCES projects(id),
  node_id TEXT,
  execution_id TEXT,
  title TEXT NOT NULL,
  body TEXT,             -- markdown
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, read, created_at DESC);
```

### 6.2 Delivery

Notifications are delivered via:

1. **In-app** (always) — notification bell in sidebar, unread count badge
2. **SSE** (real-time) — pushed via existing `/api/events/stream` endpoint
3. **Push** (optional) — via existing `push_tokens` table for mobile/desktop
4. **Email** (optional, future) — digest or immediate, per user preference

---

## 7. Machine Registration & Compute

### 7.1 Machine = Execution Context, Not Physical Hardware

A `registered_machines` row represents an **agent runner connection** — a user's authenticated connection to a compute resource. It is NOT a representation of a physical machine.

Two users on the same SLURM cluster create two separate registrations because they have different credentials, allocations, and permissions. SLURM handles resource isolation.

```
Physical reality:
  Sherlock HPC cluster (1 cluster, shared by department)
  ├── Alice's registration → her SSH keys, SLURM account, fairshare priority
  ├── Bob's registration   → his SSH keys, SLURM account, fairshare priority
  └── SLURM scheduler → handles resource isolation, no conflicts
```

### 7.2 Machine Sharing

A user can **contribute** their machine to a team by setting `teamId` on the registration. This makes the machine available for team project dispatch.

```sql
-- Already exists in schema
registered_machines.team_id UUID REFERENCES teams(id)

-- Share: user opts in their machine
UPDATE registered_machines SET team_id = $teamId WHERE id = $machineId AND user_id = $userId;

-- Unshare: user removes their machine from team
UPDATE registered_machines SET team_id = NULL WHERE id = $machineId AND user_id = $userId;
```

Machine sharing is **opt-in by the machine owner**, not controlled by team admins. The machine owner knows their compute capabilities; the admin doesn't.

### 7.3 Dispatch Routing for Team Projects

When a team project dispatches a task, the dispatch engine selects a machine:

| Strategy | Description | Best for |
|---|---|---|
| **Creator default** | Task runs on the machine of whoever created the task node. No extra step. | Most cases |
| **Explicit assignment** | Task node has `assignedUserId` — dispatch to one of that user's machines. | SLURM teams where each person has their own allocation |
| **Pool dispatch** | Any team-contributed machine can pick up unassigned tasks. `SELECT ... FOR UPDATE SKIP LOCKED`. | Cloud instances, fungible compute |

```sql
ALTER TABLE plan_nodes ADD COLUMN creator_id UUID REFERENCES user_profiles(id);
ALTER TABLE plan_nodes ADD COLUMN assigned_user_id UUID REFERENCES user_profiles(id);
ALTER TABLE plan_nodes ADD COLUMN assigned_machine_id TEXT REFERENCES registered_machines(id);
```

Dispatch priority: `assigned_machine_id` > `assigned_user_id`'s best machine > `creator_id`'s best machine > any team machine.

### 7.4 Docker for Public Projects

Public projects require Docker execution to sandbox untrusted contributors' compute:

```sql
-- Project-level execution config
ALTER TABLE projects ADD COLUMN execution_config JSONB;
```

```typescript
interface ProjectExecutionConfig {
  requireDocker: boolean        // true for public projects
  dockerImage: string           // e.g., "ghcr.io/astro/biotools:latest"
  dockerfileUrl?: string        // or build from source

  // Resource limits (prevent abuse on public projects)
  maxExecutionTimeSec: number   // e.g., 3600
  maxMemoryMb: number           // e.g., 8192
  maxCpuCores: number           // e.g., 4

  // Automated validation
  benchmarkCommand?: string     // e.g., "pytest tests/benchmarks/"
  benchmarkDataUrl?: string     // reference dataset URL
  acceptanceCriteria?: string[] // human-readable criteria
}
```

When a contributor runs a task on their machine:

1. Agent runner pulls the project's Docker image
2. Executes inside the container (sandboxed — no host filesystem access)
3. Runs benchmark suite automatically (pass/fail gate)
4. Streams results back to the project
5. Community reviews

For private team projects, Docker is optional — the team trusts its own machines.

---

## 8. Contribution Tracking

### 8.1 Contribution Ledger

All contributions to public projects are logged. This is an append-only ledger, not a token/credit system. External systems (academic attribution, reputation scores) can build on this data.

```sql
CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  type TEXT NOT NULL,
    -- task_proposed | task_accepted | execution_run |
    -- review_given | result_approved | comment
  node_id TEXT,
  execution_id TEXT,
  metadata JSONB,  -- compute time donated, tokens used, etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contributions_project ON contributions (project_id);
CREATE INDEX idx_contributions_user ON contributions (user_id);
```

### 8.2 Contributor Stats

```sql
-- Materialized view for project contributor summary
CREATE MATERIALIZED VIEW contributor_stats AS
SELECT
  project_id,
  user_id,
  COUNT(*) FILTER (WHERE type = 'execution_run') AS executions_run,
  COUNT(*) FILTER (WHERE type = 'review_given') AS reviews_given,
  COUNT(*) FILTER (WHERE type = 'task_proposed') AS tasks_proposed,
  COUNT(*) FILTER (WHERE type = 'result_approved') AS results_approved,
  SUM((metadata->>'compute_seconds')::int)
    FILTER (WHERE type = 'execution_run') AS compute_seconds_donated,
  MIN(created_at) AS first_contribution,
  MAX(created_at) AS last_contribution
FROM contributions
GROUP BY project_id, user_id;
```

---

## 9. Collaboration Surfaces

### 9.1 Plan-Level Collaboration (the "whiteboard")

The plan graph is the primary collaboration surface. Multiple team members work on the same graph:

- **Add/remove/rearrange nodes** — team members edit the graph directly. Contributors propose nodes (see section 3.4).
- **Threaded comments on nodes** — design discussions, review feedback (see section 5.1).
- **Review assignments** — each node can have a designated reviewer (see section 5.3).

Concurrent editing uses **optimistic locking** (last-write-wins with conflict notification). Plan edits are infrequent, coarse-grained operations (add node, delete node, change dependency). CRDTs are not needed for v1.

### 9.2 Execution Dashboard (the "war room")

A real-time view of what's happening across the project:

```
┌─────────────────────────────────────────────────────────────┐
│  Project: EdgeR Modernization                                │
│                                                               │
│  Running (3)                                                  │
│  ├── "Implement GLM core" — Carol's machine — 4min elapsed   │
│  ├── "Benchmark suite"    — Bob's Sherlock  — 2min elapsed   │
│  └── "API compat layer"   — Alice's laptop  — 1min elapsed   │
│                                                               │
│  Awaiting Review (1)                                          │
│  └── "Statistical tests" — completed 5min ago                │
│       Reviewer: Alice (unreviewed)  │  👍 3  👎 0              │
│                                                               │
│  Completed Today (7)  │  Failed (1) — retry queued            │
└─────────────────────────────────────────────────────────────┘
```

This is NOT a chat. It's a status board built from the existing SSE event stream (`/api/events/stream`).

### 9.3 Review Queue (the "inbox")

A personal view of tasks that need your attention:

```
┌──────────────────────────────────────────────────────────────┐
│  My Reviews (3)                                               │
│                                                               │
│  1. "Implement GLM core" — EdgeR Project                      │
│     Agent completed 5min ago · 12 files changed               │
│     [View Output]  [View Diff]  [Approve]  [Request Changes]  │
│                                                               │
│  2. "Sparse matrix support" — EdgeR Project                   │
│     Agent asks: "Use scipy.sparse or custom CSR?"             │
│     [scipy.sparse]  [Custom CSR]  [Let me think...]           │
│                                                               │
│  3. "API documentation" — scRNA-seq Project                   │
│     Agent completed 1hr ago · 4 files changed                 │
│     [View Output]  [View Diff]  [Approve]  [Request Changes]  │
└──────────────────────────────────────────────────────────────┘
```

This aggregates: tasks where `reviewer_id = currentUser`, pending `ask_user_question` approvals, and tasks with `awaiting_judgment` status in the user's projects.

### 9.4 Task Detail Page (community view)

For public projects, the task detail page shows execution history with community voting:

```
┌─────────────────────────────────────────────────────────────┐
│ Task: "Convert EdgeR's negative binomial GLM to Python"      │
│ Status: completed  │  👍 12  👎 2  │  3 executions             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ [Document]  [Executions]  [Discussion]  [Attachments]        │
│                                                              │
│ ─── Document ───────────────────────────────────────         │
│ ## Acceptance Criteria                                        │
│ - [ ] Numerical results match R within 1e-6 tolerance        │
│ - [x] Supports sparse matrices (scipy.sparse)                │
│ - [x] Runtime <= 2x R version on TCGA benchmark              │
│                                                              │
│ ## Approach                                                   │
│ Use NumPy vectorized operations for the IRLS loop...         │
│                                                              │
│ ─── Executions ─────────────────────────────────────         │
│ Run #3 by Carol | success | 11.9s | 👍 8 👎 0                 │
│   Files: 4 changed | Tests: 47/47 passed                    │
│                                                              │
│ Run #2 by Bob   | success | 45.2s | 👍 3 👎 2                 │
│   Files: 3 changed | Tests: 45/47 passed                    │
│                                                              │
│ Run #1 by Alice | failure | —     | 👍 1 👎 0                 │
│   Error: Numerical precision issue in GLM fit                │
│                                                              │
│ ─── Discussion ─────────────────────────────────────         │
│ Carol: "Used vectorized ops for IRLS, 3.8x faster"          │
│   └── Bob: "Nice! How does it handle zero counts?"           │
│       └── Carol: "Added pseudocount, see line 42"            │
│ Dave: "Can we also support QLF test? EdgeR has both"         │
│   └── [unresolved]                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Example: Open Bioinformatics Project

This section walks through the full lifecycle of the community bioinformatics use case.

### 10.1 Project Setup

Alice creates a public project in her personal workspace:

```
Project: "Modernize EdgeR — R to High-Performance Python"
Visibility: public
Execution config:
  requireDocker: true
  dockerImage: "ghcr.io/astro-bio/edger-dev:latest"
  benchmarkCommand: "pytest tests/ --benchmark-json=results.json"
  acceptanceCriteria:
    - "Numerical results match R edgeR within 1e-6 relative tolerance"
    - "Runtime <= 2x R version on TCGA BRCA dataset (10K genes x 500 samples)"
    - "Python 3.10+, NumPy/SciPy only (no custom C extensions)"
```

She writes a vision document explaining the goals, constraints, and why this matters.

### 10.2 Community Joins

Bob discovers the project (via link, search, or browse). He clicks "Contribute" and joins as a contributor. He can now:

- View the full plan graph and all execution results
- Propose new tasks
- Run executions on his own machine (in Docker)
- Vote on results and comment on tasks

He cannot: create tasks directly, approve results, or change project settings.

### 10.3 Task Proposal

Bob proposes a task: "Convert EdgeR's `estimateDisp` function to Python". He writes a document with acceptance criteria and links to the relevant R source code.

The proposal appears in the graph as a grayed-out node with a "Proposed" badge. Alice reviews it, accepts it, and it becomes a live task.

### 10.4 Execution

Carol (another contributor) claims the task and runs it on her machine. Her agent runner:

1. Pulls the project's Docker image
2. Clones the project repo inside the container
3. Executes the agent with the task prompt + vision doc + dependency context
4. Runs the benchmark suite automatically
5. Streams results back

The execution results (output, file changes, benchmark data, test results) are auto-attached to the task node as structured attachments.

### 10.5 Community Review

The community sees Carol's execution results:

- **Benchmark attachment**: Python version is 3.8x faster than R on the TCGA dataset
- **Test attachment**: 47/47 tests pass, numerical results within tolerance
- **File changes**: 4 files changed, clean implementation

Community members vote and comment. After 8 upvotes and positive discussion, Alice (project owner) approves the result. The decision is logged.

### 10.6 Credit

Carol's contribution is recorded in the ledger:

```
contributions:
  - type: execution_run, user: Carol, compute_seconds: 120
  - type: result_approved, user: Carol
```

The project page shows a contributor leaderboard. Carol has the most approved executions. Bob proposed the most tasks. Dave provided the most reviews. This data is available via API for external credit systems.

---

## 11. What NOT to Build

| Feature | Why not |
|---|---|
| **Slack-style channels** | Discussion is scoped to nodes, not topics. Channels fragment context. |
| **CRDT real-time co-editing** | Plan edits are infrequent and coarse. Optimistic locking is sufficient for v1. |
| **Kanban board** | The plan graph IS the board. A separate kanban view duplicates the primary surface. |
| **Time tracking** | Agents do the work. Track agent execution time (already done), not human time. |
| **Sprint planning** | Milestones exist in the graph. Sprints add ceremony that AI execution doesn't need. |
| **Per-node permissions** | Team-level + project-level access is sufficient. Per-node ACLs add complexity for minimal value. |
| **Built-in credit/token system** | Provide the contribution ledger data. Let external systems build credit/reputation on top. |
| **In-app chat/messaging** | Comments on nodes cover focused discussion. General chat should use existing tools (Slack, Discord). |

---

## 12. Schema Change Summary

### New Tables

| Table | Purpose | Section |
|---|---|---|
| `node_documents` | Rich markdown content per plan node | 4.2 |
| `node_attachments` | Structured results, files, benchmarks per node | 4.2 |
| `node_comments` | Threaded discussion per node | 5.1 |
| `node_votes` | Community voting on execution results | 5.2 |
| `decisions` | Audit log of approve/reject/prune/steer decisions | 5.5 |
| `notifications` | In-app notification queue | 6.1 |
| `contributions` | Append-only contribution ledger for public projects | 8.1 |
| `project_contributors` | Contributors to public projects (join/leave) | 3.2 |

### Altered Tables

| Table | Change | Section |
|---|---|---|
| `projects` | Add `visibility` (private/public), `execution_config` (JSONB) | 3.1, 7.4 |
| `plan_nodes` | Add `proposed_by`, `proposal_status`, `reviewer_id`, `reviewed_at`, `review_verdict`, `creator_id`, `assigned_user_id`, `assigned_machine_id` | 3.4, 5.3, 7.3 |

### Existing Tables (no changes needed)

| Table | Why no changes |
|---|---|
| `teams`, `team_members`, `invite_tokens` | Already support the team model described |
| `registered_machines` | Already has `team_id` for machine sharing |
| `task_executions` | Already tracks execution results, metrics, machine used |
| `activity_events` | Already provides project-level activity feed |

---

## 13. Implementation Phases

### Phase 1: Private Team Collaboration (near-term)

Enables research labs and small teams to work on shared projects.

1. Auth middleware resolves `teamId` from JWT → `team_members` table
2. All data queries use `WHERE team_id = ?` (see `LOCAL_SERVER_REFACTOR.md`)
3. Local mode bootstrap creates implicit team
4. Server mode auto-creates personal team on registration
5. `reviewer_id` on plan nodes + notification when task completes
6. Review queue page (`/reviews`)

No public projects. No community features. No proposals. Just team-scoped projects with assigned reviewers.

### Phase 2: Rich Task Content (medium-term)

Makes tasks useful as collaboration artifacts, not just labels.

7. `node_documents` table + document editor on task detail page
8. `node_attachments` table + auto-populate from execution results
9. `node_comments` table + threaded comment UI on task detail page
10. `decisions` table + decision logging for approve/reject/prune actions

Benefits both private teams and (later) public projects.

### Phase 3: Public Projects & Community (longer-term)

Enables the open bioinformatics collaboration use case.

11. `projects.visibility` field + project contributor model
12. Task proposal flow (`proposal_status` on plan nodes)
13. Community voting (`node_votes` table)
14. Docker-enforced execution for public projects
15. Contribution tracking ledger
16. Public project discovery page

### Phase 4: Team Execution Dashboard (future)

17. Real-time execution dashboard (team-wide status board)
18. Steer handoff between team members
19. `notifications` table + in-app notification bell
20. Contributor stats materialized view + leaderboard

---

## 14. Relationship to Other Design Documents

| Document | Relationship |
|---|---|
| `SERVER_ARCHITECTURE_V2.md` | This document builds on the team-scoped data model and auth middleware described there. The `WHERE team_id = ?` pattern is foundational to collaboration. |
| `LOCAL_SERVER_REFACTOR.md` | The refactoring plan creates the unified database layer that collaboration depends on. Phase 1 of this document requires the refactoring to be complete. |
| `DATA_MODEL.md` | The new tables described here extend the data model. `node_documents`, `node_attachments`, `node_comments`, and `node_votes` attach to `plan_nodes`. |
| `ARCHITECTURE.md` | The four-component architecture (frontend, backend, relay, agent runner) is unchanged. Collaboration adds content and discussion on top of the existing execution pipeline. |

---

## 15. Open Questions

1. **Concurrent plan editing.** Optimistic locking (last-write-wins) is proposed for v1. If teams frequently edit the graph simultaneously, a more sophisticated approach (operational transforms or conflict resolution UI) may be needed. Monitor usage before investing.

2. **Notification delivery.** In-app + SSE is straightforward. Email digests and push notifications add complexity. Defer email until we see user demand.

3. **Public project moderation.** What happens when a contributor submits spam proposals or abusive comments? Need moderation tools (block user, delete comment, report) before launching public projects.

4. **Docker image management.** Who builds and hosts the Docker images for public projects? The project creator? A CI pipeline? A registry we operate? This needs design before Phase 3.

5. **Cross-project relationships.** The bioinformatics use case involves converting many R packages. Should there be a way to link tasks across projects (e.g., "EdgeR GLM conversion" is related to "DESeq2 GLM conversion")? Linear has `relatedTo` relations. Astro currently only has intra-project edges.

6. **Contributor machine trust.** For public projects, Docker provides sandboxing. But can a malicious contributor report fake benchmark results? The benchmark must run server-side or be cryptographically verified. This is a hard problem — defer until Phase 3 design.
