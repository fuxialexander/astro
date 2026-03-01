# Astro Data Model — Design Document

## 1. Overview

This document describes all data types, their relationships, where they are defined, and where they are stored.

**Type locations:**
- **Core types**: `packages/core/src/types.ts` — All shared TypeScript types (no React/DOM dependencies)
- **Core type modules**: `packages/core/src/types/` — Sub-module types (relay, device-auth, github, skill)
- **Database schema**: `packages/core/src/db/schema.ts` — Drizzle ORM table definitions (38 tables)
- **Dispatch types**: `packages/core/src/dispatch/types.ts` — Task execution dispatch framework types
- **Relay types**: `server/types/relay.ts` — Full WebSocket relay protocol types
- **Device auth types**: `server/types/device-auth.ts` — OAuth2 device authorization types
- **Frontend re-exports**: `src/types/index.ts` — Re-exports from `@astro/core/types` plus UI-specific types

---

## 2. Core Entities

### 2.1 Project

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `projects` table via Drizzle ORM (PGlite in local mode, postgres-js in server mode)

```typescript
interface Project {
  id: string;                      // UUID
  number?: number;                 // Auto-incrementing display number (e.g., #3)
  name: string;
  description: string;
  visionDoc: string;               // Persistent vision/context doc injected into all AI sessions
  status: 'active' | 'archived';
  startDate?: string;              // ISO YYYY-MM-DD
  targetDate?: string;
  lead?: string;
  health?: 'on_track' | 'at_risk' | 'off_track';
  initiativeId?: string;           // FK to Initiative
  teamId?: string;                 // Team that owns this project (for team projects)
  progress?: number;               // 0-100
  labels?: Label[];
  color?: string;                  // Hex color for visual grouping
  icon?: string;                   // Emoji icon
  workingDirectory?: string;       // @deprecated Use sourceDirectory instead. Kept for backward compatibility.
  sourceDirectory?: string;        // Resolved absolute path where the project repo lives on disk
  repository?: string;             // Git SSH URL (e.g., git@github.com:user/repo.git)
  resourcePaths?: string[];        // Additional local folders (data, configs, docs) besides workingDirectory
  fileTree?: string[];             // Cached git ls-files output (relative paths)
  fileTreeUpdatedAt?: string;      // ISO timestamp for staleness check
  fileTreeMachineId?: string;      // Which machine the cached fileTree belongs to
  defaultMachineId?: string;       // Default machine for task execution
  mergeQueueEnabled?: boolean;
  mergeQueueMergeMethod?: 'merge' | 'squash' | 'rebase';

  // Workspace V2 fields
  source?: ProjectSource;          // Detected project source metadata (git info, remote type, etc.)
  deliveryMode?: DeliveryMode;     // How completed work is delivered: 'pr' | 'push' | 'branch' | 'copy' | 'direct'
  agentDir?: string;               // Agent directory name (default '.astro'), holds config.json and worktrees
  worktreeStrategy?: WorktreeStrategy;  // 'copy' | 'reference' | 'direct'

  // GitHub integration fields
  projectType?: 'default' | 'playground' | 'github' | 'plan';
  githubOwner?: string;            // GitHub repo owner (e.g., 'fuxialexander')
  githubRepo?: string;             // GitHub repo name (e.g., 'astro')
  githubRepoId?: number;           // GitHub numeric repo ID

  createdAt: Date;
  updatedAt: Date;
}
```

**Relationships**:
- A project has many PlanNodes (via `projectId`)
- A project has many PlanEdges (via `projectId`)
- A project may belong to an Initiative (via `initiativeId`)
- A project may belong to a Team (via `teamId`)
- A project has a visionDoc that is injected into every AI session
- A project may have a `source` (ProjectSource) describing where its code lives
- A project may have an `agentDir` (default `.astro/`) with per-project config and worktrees
- A project may link to a GitHub repository (via `githubOwner`/`githubRepo`/`githubRepoId`)

### 2.2 PlanNode (Task)

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `planNodes` table via Drizzle ORM (PGlite in local mode, postgres-js in server mode)

```typescript
interface PlanNode {
  id: string;                      // UUID
  number?: number;                 // Auto-incrementing display number (e.g., #5)
  projectId: string;               // FK to Project
  type: 'milestone' | 'task' | 'branch' | 'decision';
  title: string;
  description: string;
  status: 'planned' | 'dispatched' | 'in_progress' | 'auto_verified'
        | 'awaiting_judgment' | 'awaiting_approval' | 'completed' | 'pruned';
  parentId: string | null;
  dependencies: string[];          // Array of PlanNode IDs this depends on
  machineId?: string;              // Specific machine to run on
  verification: 'auto' | 'human';
  position: { x: number; y: number };  // Graph layout coordinates
  startDate?: string;              // ISO YYYY-MM-DD (planned start)
  endDate?: string;                // ISO YYYY-MM-DD (planned end)
  priority?: Priority;             // 'urgent' | 'high' | 'medium' | 'low' | 'none'
  labelIds?: string[];
  dueDate?: string;                // ISO YYYY-MM-DD (for list/board views)
  estimate?: Estimate;             // 'XS' | 'S' | 'M' | 'L' | 'XL'
  milestoneId?: string;            // FK to milestone PlanNode
  boardOrder?: number;             // Manual sort order for board view
  createdAt: Date;
  updatedAt: Date;

  // Execution metadata (populated when task runs)
  executionId?: string;
  executionOutput?: string;
  executionError?: string;
  executionStartedAt?: Date;
  executionCompletedAt?: Date;

  // Actual timing (populated from execution)
  actualStartDate?: Date;
  actualEndDate?: Date;

  // Git/PR metadata (populated when PR is created)
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  mergeQueueStatus?: 'queued' | 'testing' | 'merged' | 'failed';
  autoPr?: boolean;                // Automatically create PR on completion

  // GitHub issue linking
  githubIssueNumber?: number;
  githubIssueUrl?: string;

  // Rich content fields
  content?: string;                // Rich text content (HTML from TipTap)
  attachments?: TaskAttachment[];  // Images, files attached to the task
  links?: TaskLink[];              // External resource links (GitHub issues, PRs, etc.)
  acceptanceCriteria?: AcceptanceCriterion[];  // Verifiable completion criteria

  // Soft-delete metadata
  deletedAt?: Date;
  deletionActionId?: string;

  // Plugin-contributed custom fields
  metadata?: Record<string, unknown>;
}
```

**Status lifecycle**:
```
planned -> dispatched -> in_progress -> auto_verified -> completed
                                     -> awaiting_judgment -> completed
                                     -> awaiting_approval -> completed
       -> pruned (branch killed)
```

**Status state machine**:

```
+------------------------------------------------------------------+
|  PLAN NODE STATUS LIFECYCLE                                       |
|                                                                   |
|                    +---------+                                    |
|                    | planned | (initial state)                    |
|                    +----+----+                                    |
|                         | dispatch                               |
|                         v                                        |
|                   +-----------+                                   |
|                   |dispatched |                                   |
|                   +-----+-----+                                   |
|                         | execution starts                       |
|                         v                                        |
|                  +------------+                                   |
|                  |in_progress |                                   |
|                  +--+----+---+                                    |
|                     |    |                                        |
|          success +  |    |  success +                             |
|          auto verify|    |  human verify                          |
|                     v    v                                        |
|  +---------------+  +------------------+                          |
|  | auto_verified |  |awaiting_judgment | <-- also on failure      |
|  +-------+-------+  +--------+---------+                          |
|          |                   | human approves                     |
|          |                   v                                    |
|          |          +------------------+                           |
|          |          |awaiting_approval | (optional)                |
|          |          +--------+---------+                           |
|          |                   |                                    |
|          +-------+-----------+                                    |
|                  v                                                |
|            +-----------+                                          |
|            | completed | (terminal)                               |
|            +-----------+                                          |
|                                                                   |
|  Any state ---- branch killed ----> +--------+                    |
|                                      | pruned | (terminal)        |
|                                      +--------+                   |
+-------------------------------------------------------------------+
```

**Relationships**:
- Belongs to a Project (via `projectId`)
- May reference a milestone PlanNode (via `milestoneId`)
- Connected to other PlanNodes via PlanEdges (dependency/branch)
- Has zero or one TaskExecution (via `executionId`)
- Has many NodeComments (via `nodeId`)

### 2.3 PlanEdge

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `planEdges` table via Drizzle ORM (PGlite in local mode, postgres-js in server mode)

```typescript
type EdgeType = 'dependency' | 'branch';

interface PlanEdge {
  id: string;
  source: string;                  // PlanNode ID
  target: string;                  // PlanNode ID
  type: EdgeType;
  deletedAt?: Date;
  deletionActionId?: string;
}
```

- `dependency`: target depends on source (source must complete before target can start)
- `branch`: target is an alternative exploration path from source

### 2.4 TaskExecution

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `taskExecutions` table via Drizzle ORM (PGlite in local mode, postgres-js in server mode)

```typescript
interface TaskExecution {
  nodeId: string;                  // FK to PlanNode
  projectId: string;               // FK to Project
  executionId: string;             // Unique execution ID
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  streamText: string;              // Accumulated stdout/text output
  error?: string;
  startedAt: Date;
  completedAt?: Date;

  // Rich execution data
  toolTraces: ToolTrace[];         // Tool call history
  fileChanges: FileChange[];       // File modifications
  activityEvents: TaskActivityEvent[];  // Unified timeline
  sessionId?: string;              // Provider session ID
  machineId?: string;              // Which machine ran this
  providerId?: string;             // Which provider was used
  providerName?: string;
  metrics?: UsageMetrics;

  // Git/PR metadata
  branchName?: string;
  prUrl?: string;
  prNumber?: number;

  // Delivery outcome
  deliveryStatus?: 'success' | 'failed' | 'skipped';
  deliveryError?: string;          // Error message when deliveryStatus is 'failed'

  // Compute backend
  computeBackend?: string;         // 'direct' | 'slurm' | 'docker' | 'k8s-exec'

  // Post-completion
  summary?: ExecutionSummary;

  // Subroutine pipeline progress (from procedure system)
  subroutineProgress?: {
    name: string;
    index: number;
    total: number;
    status: 'running' | 'completed' | 'failed';
  };

  // Plan mode data (from Claude Code plan mode)
  planTodos?: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
  planQuestions?: Array<{
    question: string;
    options: string[];
    answer?: string;
  }>;
}
```

### 2.5 Initiative

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `initiatives` table via Drizzle ORM (PGlite in local mode, postgres-js in server mode)

```typescript
interface Initiative {
  id: string;
  name: string;
  description: string;
  goal?: string;
  status: 'active' | 'on_hold' | 'completed' | 'cancelled';
  startDate?: string;
  targetDate?: string;
  lead?: string;
  color?: string;
  icon?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

An initiative groups related projects.

### 2.6 NodeComment

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `nodeComments` table via Drizzle ORM

```typescript
interface NodeComment {
  id: string;
  nodeId: string;
  projectId: string;
  authorId: string;
  authorName: string;
  authorType: 'user' | 'agent';
  content: string;
  parentCommentId?: string;        // For threaded replies
  createdAt: Date;
  updatedAt: Date;
}
```

### 2.7 Label

**Definition**: `packages/core/src/types.ts`

```typescript
interface Label {
  id: string;
  name: string;
  color: string;                   // Hex color
}
```

Labels are stored as JSONB arrays within the `projects` table, not as a separate table.

---

## 3. Rich Content Types

### 3.1 TaskAttachment

```typescript
interface TaskAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  thumbnailUrl?: string;
}
```

Stored as JSONB within the `planNodes` table `attachments` column.

### 3.2 TaskLink

```typescript
interface TaskLink {
  id: string;
  type: 'github_issue' | 'github_pr' | 'linear_issue' | 'task' | 'url';
  url: string;
  title: string;
  state?: 'open' | 'closed' | 'merged';
  number?: number;
  targetId?: string;               // For internal task links
}
```

Stored as JSONB within the `planNodes` table `links` column.

### 3.3 AcceptanceCriterion

```typescript
interface AcceptanceCriterion {
  id: string;
  type: 'test' | 'build' | 'lint' | 'command' | 'manual';
  description: string;
  command?: string;                // Shell command for auto-verification
  autoVerifiable: boolean;
}
```

Stored as JSONB within the `planNodes` table `acceptance_criteria` column.

---

## 4. Execution Detail Types

### 4.1 ToolTrace

```typescript
interface ToolTrace {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown> | unknown;
  toolResult?: unknown;
  success?: boolean;
  duration?: number;               // ms
  timestamp: Date;
}
```

### 4.2 FileChange

```typescript
interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  linesAdded?: number;
  linesRemoved?: number;
  diff?: string;
  timestamp: Date;
}
```

### 4.3 TaskActivityEvent (Unified Timeline)

A discriminated union for rendering a sequential timeline of all events:

```typescript
type TaskActivityEvent =
  | { type: 'text'; content: string; timestamp: Date }
  | { type: 'tool_use'; id: string; toolName: string; toolInput: unknown; timestamp: Date }
  | { type: 'tool_result'; id: string; toolName: string; toolResult?: unknown;
      success?: boolean; duration?: number; timestamp: Date }
  | { type: 'steer'; message: string; accepted?: boolean; ackMessage?: string;
      interrupted?: boolean; timestamp: Date }
  | { type: 'chat_user'; message: string; timestamp: Date }
  | { type: 'chat_assistant'; content: string; timestamp: Date }
  | { type: 'file_change'; path: string; action: string; diff?: string;
      linesAdded?: number; linesRemoved?: number; timestamp: Date }
  | { type: 'error'; error: string; timestamp: Date }
  | { type: 'approval_request'; requestId: string; question: string;
      options: string[]; timestamp: Date }
  | { type: 'approval_response'; requestId: string; question: string;
      answer: string; autoApproved?: boolean; timestamp: Date }
```

### 4.4 ExecutionSummary

Generated post-completion by the `/api/agent/summarize` endpoint:

```typescript
interface ExecutionSummary {
  workCompleted: string;
  executiveSummary?: string;       // 1-2 paragraph executive summary
  keyFindings: string[];
  filesChanged: string[];
  status: 'success' | 'partial' | 'failure';
  followUps: string[];
}
```

### 4.5 UsageMetrics

```typescript
interface UsageMetrics {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokensUsed?: number;
  estimatedCostUsd?: number;
  model?: string;
  turnsUsed?: number;
}
```

### 4.6 SteerMessage

```typescript
interface SteerMessage {
  message: string;
  accepted?: boolean;
  ackMessage?: string;
  interrupted?: boolean;
  timestamp: Date;
}
```

---

## 5. Session Types

### 5.1 Session

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `sessions` table via Drizzle ORM

```typescript
type SessionType = 'plan-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation';
type SessionStatus = 'active' | 'streaming' | 'completed' | 'error' | 'cancelled';

interface Session {
  id: string;
  type: SessionType;
  status: SessionStatus;
  projectId: string;
  nodeId?: string;
  title?: string;
  providerSessionId?: string;
  providerId?: string;
  model?: string;
  messages: SessionMessage[];
  activityEvents?: TaskActivityEvent[];
  toolTraces?: ToolTrace[];
  fileChanges?: FileChange[];
  streamText?: string;
  summary?: ExecutionSummary;
  metrics?: UsageMetrics;
  steerMessages?: SteerMessage[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
```

### 5.2 SessionMessage

```typescript
interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  appliedMutations?: {             // Plan modifications from chat
    nodeUpdates: Array<{ nodeId: string; [key: string]: unknown }>;
    edgeOps: Array<{ action: 'add' | 'remove'; source: string; target: string; type?: string }>;
    newNodes: Array<{ id?: string; title: string; description: string; type?: string;
      milestoneId?: string; dependencies?: string[]; priority?: string;
      estimate?: string; verification?: string }>;
  };
}
```

---

## 6. User and Profile Types

### 6.1 UserProfile

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `userProfiles` table via Drizzle ORM (PGlite in local mode, postgres-js in server mode)

```typescript
interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  domains: DomainExpertise[];
  experienceLevel: ExperienceLevel;
  preferredMachines: string[];     // Machine IDs for task dispatch
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  defaultMachineId?: string;
  apiKeys: ApiKey[];
  sidebarConfig?: Array<{
    id: string; to: string; icon: string; label: string;
    visible: boolean; protected: boolean;
    autoRevealed?: boolean; userDismissed?: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.2 ApiKey Types

```typescript
// API key entry visible to the frontend
interface ApiKey {
  id: string;
  provider: string;
  name: string;
  maskedKey: string;
  createdAt: Date;
}

// Encrypted API key stored in database
interface EncryptedApiKey {
  id: string;
  userId: string;
  serviceName: string;
  encryptedKey: string;
  iv: string;
  salt?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Decrypted API key (in-memory only, never persisted)
interface DecryptedApiKey {
  id: string;
  serviceName: string;
  plainKey: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.3 Enum Types

```typescript
type DomainExpertise =
  'computational-biology' | 'web-development' | 'data-engineering' | 'ml-ai' |
  'devops-infrastructure' | 'mobile-development' | 'systems-programming' |
  'scientific-computing' | 'security' | 'other';

type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
type Estimate = 'XS' | 'S' | 'M' | 'L' | 'XL';
```

### 6.4 Workspace & Source Types

These types support Workspace V2: project source detection, delivery modes, and workspace isolation.

```typescript
/** Type of git remote hosting service */
type RemoteType = 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none';

/** How completed work is delivered after task execution */
type DeliveryMode = 'pr' | 'push' | 'branch' | 'copy' | 'direct';

/** Workspace isolation strategy */
type WorktreeStrategy = 'copy' | 'reference' | 'direct';
```

- `RemoteType`: Identifies the git hosting provider for PR creation and push operations.
- `DeliveryMode`: Controls post-execution delivery. `pr` creates a pull request; `push` pushes to the remote branch; `branch` commits to a local branch only; `copy` copies files to an isolated worktree directory; `direct` modifies files in-place without git operations (serial execution enforced).
- `WorktreeStrategy`: `copy` copies project files to a worktree directory; `reference` creates an empty directory with a file map (for large datasets); `direct` works in-place.

### 6.5 ProjectSource

Detected metadata about where a project's code lives. Populated by the directory-detection endpoint (`POST /api/repo/detect`).

```typescript
interface ProjectSource {
  localPath: string;               // Absolute path on disk
  isGit: boolean;                  // Whether the directory is a git repository
  remoteUrl?: string;              // Git remote URL (if any)
  remoteType: RemoteType;          // Hosting provider type
  baseBranch: string;              // Default branch name (e.g., 'main', 'master')
  subdirectory?: string;           // Subdirectory within gitRoot (monorepo support)
}
```

### 6.6 EnvironmentConfig

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `environmentConfigs` table via Drizzle ORM

```typescript
interface EnvironmentConfig {
  id: string;
  userId: string;
  teamId?: string;
  machineId?: string;              // null = local server backends
  backendId: string;               // 'slurm', 'docker', 'ssh:alias'
  customContext: string;            // SSH details, module loads, sbatch templates, etc.
  displayName?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 7. Team & Collaboration Types

### 7.1 Team

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `teams` table via Drizzle ORM

```typescript
interface Team {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 7.2 TeamMember

**Definition**: `packages/core/src/types.ts`
**Storage**: Postgres `teamMembers` table via Drizzle ORM

```typescript
interface TeamMember {
  teamId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}
```

---

## 8. Provider and Machine Types

### 8.1 ProviderStatus (Frontend)

**Definition**: `packages/core/src/types.ts`

```typescript
interface ProviderStatus {
  id: string;
  name: string;
  installed: boolean;
  authStatus: 'authenticated' | 'unauthenticated' | 'expired' | 'unknown';
  available: boolean;
  capabilities?: {
    availableModels: string[];
    defaultModel: string;
  };
}
```

### 8.2 RegisteredMachine

**Definition**: `packages/core/src/types/device-auth.ts`
**Storage**: Postgres `registeredMachines` table via Drizzle ORM

```typescript
interface RegisteredMachine {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  environmentType?: string;
  providers: ProviderType[];
  providerConfigs?: ProviderConfig[];
  userId: string;
  teamId?: string;
  workspaceId?: string;
  registeredAt: Date;
  lastSeenAt: Date;
  isConnected: boolean;
  refreshTokenHash: string;
  isRevoked: boolean;
  metadata?: Record<string, string>;
}

interface ProviderConfig {
  provider: string;
  apiKey?: string;
  defaultModel?: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
}
```

### 8.3 MachineResources (Relay)

**Definition**: `server/types/relay.ts`

```typescript
interface MachineResources {
  cpuCores: number;
  memoryMB: number;
  gpuCount?: number;
  gpuMemoryMB?: number;
  gpuType?: string;                // e.g. "NVIDIA A100", "Apple M4 Pro"
  diskSpaceMB?: number;
}
```

### 8.4 MachineInfo (Relay)

**Definition**: `server/types/relay.ts`

```typescript
interface MachineInfo {
  machineId: string;
  name: string;
  environmentType?: string;
  hostname?: string;
  platform?: string;
  providers: ProviderInfo[];
  executionStrategies?: ExecutionStrategyInfo[];
  resources: MachineResources;
  load: MachineLoad;
  tags?: string[];
  metadata?: Record<string, string>;
}

interface MachineLoad {
  cpuPercent: number;
  memoryPercent: number;
  gpuPercent?: number;
  activeTasks: number;
  queuedTasks: number;
}

interface ProviderInfo {
  type: ProviderType;
  version?: string;
  status: 'available' | 'busy' | 'unavailable' | 'error';
  maxConcurrentTasks: number;
  currentTasks: number;
  capabilities?: string[];
  hpcCapability?: HpcCapability;
}

interface ExecutionStrategyInfo {
  id: string;
  name: string;
  available: boolean;
  version?: string;
  metadata?: Record<string, unknown>;
}
```

---

## 9. Dispatch Engine Types

**Definition**: `packages/core/src/dispatch/types.ts`

The dispatch engine bridges the plan graph and agent execution, managing task lifecycle from dependency resolution through execution to result routing.

### 9.1 DispatchStatus

```typescript
type DispatchStatus =
  | 'pending'       // Waiting for dependencies
  | 'ready'         // Dependencies met, awaiting dispatch
  | 'queued'        // In dispatch queue
  | 'dispatched'    // Sent to provider/machine
  | 'in_progress'   // Executing
  | 'completed'     // Successfully finished
  | 'failed'        // Execution failed
  | 'cancelled'     // Cancelled by user or branch prune
```

### 9.2 DispatchQueueEntry

```typescript
interface DispatchQueueEntry {
  id: string;
  nodeId: string;
  projectId: string;
  status: DispatchStatus;
  priority: DispatchPriority;      // 'critical' | 'high' | 'normal' | 'low'
  environment?: string;
  preferredProvider?: ProviderType;
  targetMachineId?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  lastDispatchAttempt?: Date;
  lastError?: string;
  executionId?: string;
  sessionId?: string;
}
```

### 9.3 AssembledContext

Context assembled for task execution, combining plan node data with project context:

```typescript
interface AssembledContext {
  node: PlanNode;
  projectId: string;
  visionDoc?: string;
  dependencyOutputs: DependencyOutput[];
  graphPosition: GraphPosition;
  workingDirectory?: string;
  originalProjectDirectory?: string;
  resourcePaths?: string[];
  environmentVariables?: Record<string, string>;
}

interface DependencyOutput {
  nodeId: string;
  title: string;
  output: string;
  truncated: boolean;
  status: PlanNode['status'];
}

interface GraphPosition {
  depth: number;
  upstreamCount: number;
  downstreamCount: number;
  isOnBranch: boolean;
  branchId?: string;
  parallelSiblings: number;
}
```

### 9.4 TaskResult (Dispatch)

Result returned from task execution, distinct from the relay `TaskResult`:

```typescript
interface TaskResult {
  taskId: string;
  status: 'success' | 'failure' | 'cancelled';
  stdout?: string;
  stderr?: string;
  errorMessage?: string;
  sessionId?: string;
  metrics?: {
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalCost?: number;
    estimatedCostUsd?: number;
    tokensUsed?: number;
    turnsUsed?: number;
    model?: string;
    numTurns?: number;
  };
  verification?: Record<string, unknown>;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  deliveryStatus?: 'success' | 'failed' | 'skipped';
  deliveryError?: string;
  filesChanged?: Array<{ path: string; diff?: string }>;
  summary?: {
    status: 'success' | 'partial' | 'failure';
    workCompleted: string;
    keyFindings: string[];
    filesChanged: string[];
    followUps: string[];
    prUrl?: string | null;
    prNumber?: number | null;
    branchName?: string | null;
  };
}
```

### 9.5 RoutingDecision

Routing decision for completed tasks (auto-close vs. judgment queue):

```typescript
interface RoutingDecision {
  autoClose: boolean;
  targetStatus: PlanNode['status'];
  reason: string;
  surfaceToJudgment: boolean;
  judgmentContext?: JudgmentContext;
  triggerDownstream: boolean;
  downstreamNodes?: string[];
}

interface JudgmentContext {
  summary: string;
  keyPoints: string[];
  suggestedAction: 'approve' | 'retry' | 'reject' | 'modify';
  confidence: number;
  artifacts?: TaskArtifact[];
}
```

### 9.6 Dispatch Engine Configuration

```typescript
interface DispatchEngineConfig {
  autoDispatch: boolean;
  maxConcurrentPerProject: number;
  maxConcurrentTotal: number;
  defaultPriority: DispatchPriority;
  defaultMaxRetries: number;
  retryDelayBase: number;          // ms
  retryDelayMax: number;           // ms
  dryRunMode: boolean;
  maxDependencyOutputSize: number; // chars
  pollIntervalMs: number;
  machineSelectionPolicy: 'round-robin' | 'priority' | 'least-loaded' | 'manual';
}
```

---

## 10. Relay Protocol Types

**Definition**: `server/types/relay.ts`

### 10.1 Core Relay Types

```typescript
type ProviderType = 'claude-code' | 'claude-sdk' | 'codex' | 'aws' | 'gcp' | 'custom';
type MachineConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
type TaskStatus = 'queued' | 'dispatched' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'timeout';
type TaskDispatchType = 'execution' | 'plan' | 'chat' | 'summarize';
```

### 10.2 TaskDispatch (Relay)

The full relay task dispatch payload, sent from server to agent runner:

```typescript
interface TaskDispatch {
  taskId: string;
  projectId: string;
  nodeId: string;
  shortNodeId?: string;            // First 6 hex chars of UUID for branch names
  shortProjectId?: string;         // First 6 hex chars of UUID for PR titles
  title: string;
  description: string;
  visionDoc?: string;
  environment?: string;
  preferredProvider?: ProviderType;
  executionStrategy?: string;
  priority?: number;
  timeout?: number;
  workingDirectory?: string;
  sourceDirectory?: string;        // Original project directory (for data access from worktrees)
  dependencies?: string[];
  metadata?: Record<string, string>;
  prompt?: string;                 // Pre-built prompt (bypasses automatic construction)
  maxTurns?: number;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };

  // Task type and conversation
  type?: TaskDispatchType;         // Default: 'execution'
  systemPrompt?: string;
  messages?: ConversationMessage[];
  model?: string;

  // Workspace V2 fields
  deliveryMode?: DeliveryMode;
  remoteType?: RemoteType;
  agentDir?: string;
  baseBranch?: string;
  worktreeStrategy?: WorktreeStrategy;
  useWorktree?: boolean;
  skipSafetyCheck?: boolean;

  // Multimodal
  images?: ImageAttachment[];

  // Linking
  astroBaseUrl?: string;
  githubIssueUrl?: string;
  githubIssueNumber?: number;

  // Dispatch signing (ECDSA P-256)
  dispatchSignature?: string;
  dispatchSigningPayload?: DispatchSigningPayload;

  // Session resume
  resumeSessionId?: string;
  forkSession?: boolean;
}
```

### 10.3 TaskResult (Relay)

```typescript
interface TaskResult {
  taskId: string;
  status: TaskStatus;
  exitCode?: number;
  output?: string;
  error?: string;
  artifacts?: TaskArtifact[];
  duration?: number;
  metadata?: Record<string, string>;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  deliveryStatus?: 'success' | 'failed' | 'skipped';
  deliveryError?: string;
  summary?: ExecutionSummaryResult;
  metrics?: {
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalCost?: number;
    model?: string;
    numTurns?: number;
  };
}
```

### 10.4 Message Unions

```typescript
// Server -> Agent Runner
type RelayToAgentMessage =
  | TaskDispatchMessage
  | TaskCancelMessage
  | TaskSteerMessage
  | TaskApprovalResponseMessage
  | HeartbeatPingMessage
  | MachineRegisterAckMessage
  | FileListRequestMessage
  | SlashCommandsRequestMessage
  | RepoDetectRequestMessage
  | GitInitRequestMessage
  | BranchListRequestMessage
  | CreateDirectoryRequestMessage
  | SessionsListRequestMessage
  | ErrorMessage

// Agent Runner -> Server
type AgentToRelayMessage =
  | MachineRegisterMessage
  | MachineUnregisterMessage
  | MachineStatusMessage
  | ProviderStatusMessage
  | TaskResultMessage
  | TaskStdoutMessage
  | TaskProgressMessage
  | TaskSteerAckMessage
  | TaskToolTraceMessage
  | TaskFileChangeMessage
  | TaskApprovalRequestMessage
  | HeartbeatPongMessage
  | FileListResponseMessage
  | SlashCommandsResponseMessage
  | RepoDetectResponseMessage
  | GitInitResponseMessage
  | BranchListResponseMessage
  | CreateDirectoryResponseMessage
  | SessionsListResponseMessage

// MCP Bridge -> Relay
type SessionToRelayMessage =
  | SessionAttachMessage
  | SessionDetachMessage
  | SessionEventMessage

// Relay -> MCP Bridge
type RelayToSessionMessage =
  | SessionAttachAckMessage
  | ErrorMessage
```

### 10.5 Slurm/HPC Extensions

```typescript
interface SlurmClusterInfo {
  clusterName: string;
  slurmVersion: string;
  defaultPartition?: string;
  partitions: SlurmPartitionInfo[];
  qosLevels: string[];
  accounts: string[];
}

interface SlurmPartitionInfo {
  name: string;
  isDefault: boolean;
  totalNodes: number;
  availableNodes: number;
  maxTime?: string;
  defaultTime?: string;
  maxMemPerNode?: string;
  features: string[];
  gpuInfo?: {
    totalGpus: number;
    availableGpus: number;
    gpuTypes: string[];
  };
}

type SlurmJobState =
  | 'PENDING' | 'RUNNING' | 'SUSPENDED' | 'COMPLETING'
  | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT'
  | 'PREEMPTED' | 'NODE_FAIL' | 'OUT_OF_MEMORY' | 'UNKNOWN';

interface SlurmJobInfo {
  jobId: string;
  arrayTaskId?: string;
  name: string;
  state: SlurmJobState;
  stateReason?: string;
  user: string;
  partition: string;
  nodes: number;
  cpus: number;
  timeLimit?: string;
  timeUsed?: string;
  submitTime?: Date;
  startTime?: Date;
  endTime?: Date;
  exitCode?: number;
  nodeList?: string;
  priority?: number;
  queuePosition?: number;
  startTimeEstimate?: Date;
}
```

---

## 11. Observation Types

**Definition**: `src/types/observations.ts`

Types for the Trace Viewer, modeling execution observation trees:

```typescript
interface RawObservation {
  id: string;
  traceId: string;
  parentObservationId: string | null;
  type: 'span' | 'generation' | 'tool' | 'event';
  name: string;
  startTime: string;
  endTime: string | null;
  input: unknown;
  output: unknown;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  level: 'debug' | 'default' | 'warning' | 'error';
  metadata: Record<string, unknown> | null;
  projectId: string;
  nodeId: string | null;
  statusMessage: string | null;
}

interface TraceTree {
  traceId: string;
  contextSpan: RawObservation | null;
  turns: GenerationTurn[];
  events: RawObservation[];
  stats: {
    totalTurns: number;
    totalToolCalls: number;
    totalTokens: number;
    totalCost: number;
    model: string | null;
    durationMs: number | null;
  };
}
```

---

## 12. Plugin & Skill Types

### 12.1 Plugin

**Definition**: `src/types/plugin.ts`

```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  capabilities: PluginCapability[];
  configSchema?: Record<string, unknown>;
}

type PluginCapability =
  | 'routes' | 'sidebar' | 'commands' | 'theme' | 'signals'
  | 'connectors' | 'providers' | 'hooks' | 'node-metadata' | 'store' | 'skills';

interface AstroPlugin {
  manifest: PluginManifest;
  activate: (context: PluginContext) => Promise<PluginContributions>;
  deactivate: () => Promise<void>;
}
```

### 12.2 OpenClaw Skill

**Definition**: `packages/core/src/types/skill.ts`

```typescript
interface OpenClawSkill {
  name: string;
  description: string;
  instructions: string;            // Markdown body (injected into agent prompt)
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  commandDispatch?: 'tool';
  commandTool?: string;
  homepage?: string;
  metadata?: OpenClawSkillMetadata;

  // Astro-specific extensions
  source: 'builtin' | 'workspace' | 'clawhub' | 'plugin';
  pluginId?: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}
```

---

## 13. GitHub Integration Types

**Definition**: `packages/core/src/types/github.ts`

```typescript
interface GitHubRepo {
  id: number;
  nodeId: string;
  name: string;
  fullName: string;
  owner: { login: string; avatarUrl: string };
  private: boolean;
  htmlUrl: string;
  sshUrl: string;
  description: string | null;
  fork: boolean;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
  pushedAt: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string;
}

interface GitHubConnection {
  userId: string;
  accessToken: string;
  scope: string;
  connectedAt: string;
  user: GitHubUser;
}

interface GitHubRepoSelection {
  userId: string;
  selectedRepoIds: number[];
  repos: GitHubRepo[];
  lastSyncedAt: string;
}
```

---

## 14. Device Authentication Types

**Definition**: `server/types/device-auth.ts`

OAuth2 Device Authorization Grant (RFC 8628) for machine registration:

```typescript
type DeviceAuthStatus = 'pending' | 'authorized' | 'denied' | 'expired' | 'used';

interface DeviceAuthResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface DeviceTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  scopes: string[];
  dispatchPublicKey?: JsonWebKey;
}

interface MachineUsageLog {
  id: string;
  machineId: string;
  userId: string;
  projectId: string;
  nodeId: string;
  executionId: string;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  status: 'success' | 'failure' | 'cancelled';
  createdAt: Date;
}
```

---

## 15. Database Schema (Postgres)

Defined in `packages/core/src/db/schema.ts` (38 tables). Re-exported from `server/lib/db/schema.ts` for backward compatibility.

### 15.1 Core Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `projects` | `id` (UUID) | `owner_id` -> auth.users | Project metadata, workspace config |
| `planNodes` | `id` (UUID) | `projectId` -> projects | Plan graph nodes (tasks, milestones, branches, decisions) |
| `planEdges` | `id` (UUID) | `projectId` -> projects | Plan graph edges (dependency, branch) |
| `planNodeDependencies` | composite | `nodeProjectId`, `nodeClientId` | Dependency tracking (denormalized) |
| `initiatives` | `id` (UUID) | `owner_id` -> auth.users | Initiative grouping |
| `nodeComments` | `id` (UUID) | `projectId` -> projects | Comments on plan nodes |

### 15.2 Execution Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `sessions` | `id` (text) | `userId`, `projectId` -> projects | Unified chat/execution sessions |
| `taskExecutions` | `id` (UUID) | `projectId` -> projects | Execution records with metrics |
| `taskChatSessions` | `id` (UUID) | `userId`, `projectId` -> projects | Legacy chat session metadata |
| `taskChatMessages` | `id` (text) | `sessionId` -> taskChatSessions | Legacy chat messages |
| `toolTraces` | `id` (UUID) | `executionId` | Tool call records |
| `fileChanges` | `id` (UUID) | `executionId` | File modification records |
| `dispatchQueueEntries` | `id` (text) | `projectId` | Persisted dispatch queue |

### 15.3 User Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `userProfiles` | `id` (UUID) | -> auth.users | User metadata, preferences, sidebar config |
| `displaySettings` | composite (userId, viewKey) | -- | Per-view display config |
| `usageMetrics` | composite (userId, sessionDate) | -- | Daily usage aggregation |
| `projectMembers` | composite (projectId, userId) | `projectId` -> projects | Project access control |
| `encryptedApiKeys` | `id` (UUID) | `userId` | Client-side encrypted API keys |

### 15.4 Team & Collaboration Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `teams` | `id` (UUID) | -- | Team grouping entity |
| `teamMembers` | composite (teamId, userId) | `teamId` -> teams | Team membership with roles (owner/admin/member) |
| `inviteTokens` | `id` (UUID) | `teamId` -> teams | Email-based team invitation tokens |

### 15.5 Infrastructure Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `registeredMachines` | `id` (text) | `userId`, `teamId` -> teams | Machine registration (team-aware) |
| `refreshTokens` | `tokenHash` (text) | `machineId` -> registeredMachines | Device auth refresh tokens |
| `pushTokens` | `id` (UUID) | `userId` | Push notification tokens |
| `machineUsageLogs` | `id` (UUID) | `machineId` -> registeredMachines, `projectId` -> projects | Machine usage tracking |
| `environmentConfigs` | `id` (UUID) | `userId` | Custom environment context overlays (HPC, SSH, Docker) |

### 15.6 Auth & Integration Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `passkeyCredentials` | `id` (text) | `userId` | WebAuthn/passkey credentials |
| `connectedAccounts` | `id` (UUID) | `userId` | External OAuth integrations (GitHub, Linear) |
| `webauthnChallenges` | `key` (text) | -- | Short-lived WebAuthn challenges (cross-instance) |
| `deviceCodes` | `userCode` (text) | -- | OAuth2 device authorization codes (RFC 8628) |
| `githubConnections` | `userId` (UUID) | -- | Persisted GitHub OAuth connections and repo selections |
| `chatSessions` | `key` (text) | -- | Server-side SDK session pool for hybrid resume/fallback |

### 15.7 Activity & Audit Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `auditLogs` | `id` (UUID) | `userId` | Audit trail of user actions |
| `activityEvents` | `id` (UUID) | `userId`, `projectId` -> projects | Activity feed events |
| `observationEvents` | `id` (text) | `projectId` | Observability trace events (Langfuse-compatible) |
| `streamingEvents` | `seq` (int, auto-increment) | -- | Append-only log of SSE events for page-refresh catch-up and reconnect recovery. See `REFRESH_ROBUSTNESS.md`. |

### 15.8 Storage Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `blobs` | `id` (UUID) | `ownerId`, `projectId` -> projects | Image/file storage (base64-encoded) |
| `sharedBundles` | `id` (UUID) | -- | Shared plan export bundles |

---

## 16. Data Persistence

All data is stored in Postgres via Drizzle ORM. The same schema and queries work in both modes:

| Mode | Driver | Storage Location |
|------|--------|-----------------|
| **Local mode** | PGlite (Postgres in WASM) | `~/.astro/pglite/` on disk |
| **Server mode** | postgres-js | External Postgres (Supabase, Fly.io, etc.) |

Frontend stores fetch data via `fetch('/api/...')` in both modes. There is no browser-side database (IndexedDB was removed in the PGlite refactor).

**Serialization**: Dates stored as ISO strings. Maps serialized as Records. Reconstructed on load.

---

## 17. Entity Relationships

```
+-------------------------------------------------------------------+
|  ENTITY RELATIONSHIPS                                              |
|                                                                    |
|  Team                                                              |
|  |-- has many TeamMembers (owner, admin, member)                   |
|  |-- has many Projects (via teamId)                                |
|  |-- has many RegisteredMachines (shared machines)                 |
|  +-- has many InviteTokens (pending invitations)                   |
|                                                                    |
|  Initiative                                                        |
|  +-- has many Projects                                             |
|                                                                    |
|  Project                                                           |
|  |-- has many PlanNodes (tasks, milestones, branches, decisions)   |
|  |-- has many PlanEdges (dependency and branch connections)         |
|  |-- has many ProjectMembers (access control)                      |
|  |-- has many Sessions (plan-chat, execution, etc.)                |
|  |-- has many DispatchQueueEntries (pending tasks)                 |
|  |-- may belong to a Team (via teamId)                             |
|  |-- may belong to an Initiative (via initiativeId)                |
|  |-- may link to GitHub (via githubOwner/githubRepo)               |
|  +-- has a visionDoc (injected into every AI session)              |
|                                                                    |
|  PlanNode                                                          |
|  |-- belongs to a Project                                          |
|  |-- may belong to a milestone PlanNode                            |
|  |-- connected to other PlanNodes via PlanEdges                    |
|  |-- has at most one active TaskExecution                          |
|  |-- has many NodeComments                                         |
|  +-- has TaskAttachments, TaskLinks, AcceptanceCriteria (JSONB)    |
|                                                                    |
|  PlanEdge                                                          |
|  |-- connects two PlanNodes (source -> target)                     |
|  +-- type: dependency (must complete before) or branch (explore)   |
|                                                                    |
|  TaskExecution                                                     |
|  |-- belongs to a PlanNode                                         |
|  |-- has many ToolTraces (tool call history)                       |
|  |-- has many FileChanges (file modifications)                     |
|  |-- has many TaskActivityEvents (unified timeline)                |
|  +-- has optional ExecutionSummary (post-completion)               |
|                                                                    |
|  Session                                                           |
|  |-- belongs to a Project                                          |
|  |-- may belong to a PlanNode                                      |
|  +-- has many SessionMessages                                      |
|                                                                    |
|  DispatchQueueEntry                                                |
|  |-- belongs to a Project                                          |
|  |-- references a PlanNode                                         |
|  +-- may reference a TaskExecution (once dispatched)               |
+-------------------------------------------------------------------+
```

```
Initiative (1) -------- (*) Project
                              |
                   (1)--------+---------(*)
                   |                     |
              PlanNode (*)         PlanEdge (*)
                   |             (source -> target)
                   |
         TaskExecution (0..1)      NodeComment (*)
              |
    +---------+---------+
    |         |         |
ToolTrace  FileChange  TaskActivityEvent
   (*)       (*)          (*)
```

- A Project has many PlanNodes and PlanEdges
- PlanEdges connect PlanNodes (source -> target, dependency or branch)
- A PlanNode has at most one active TaskExecution
- A TaskExecution has many ToolTraces, FileChanges, and TaskActivityEvents
- An Initiative groups many Projects
- A Team owns many Projects and RegisteredMachines
- Sessions track all chat and execution conversations per project/node
- DispatchQueueEntries track the lifecycle of task dispatch
