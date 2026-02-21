# Astro Data Model — Design Document

## 1. Overview

This document describes all data types, their relationships, where they are defined, and where they are stored.

---

## 2. Core Entities

### 2.1 Project

**Definition**: `src/types/index.ts` (lines 80-104)
**Storage**: IndexedDB `"astro-projects"` (local mode), Postgres `projects` table (server mode)

```typescript
interface Project {
  id: string;                      // UUID
  name: string;
  description: string;
  visionDoc: string;               // Persistent vision/context doc injected into all AI sessions
  status: 'active' | 'archived';
  startDate?: string;              // ISO YYYY-MM-DD
  targetDate?: string;
  lead?: string;
  health?: 'on_track' | 'at_risk' | 'off_track';
  initiativeId?: string;           // FK to Initiative
  progress?: number;               // 0-100
  labels?: Label[];
  color?: string;                  // Hex color for visual grouping
  icon?: string;                   // Emoji icon
  workingDirectory?: string;       // Absolute path for task execution (cwd for agents)
  repository?: string;             // Git clone URL
  fileTree?: string[];             // Cached git ls-files output (relative paths)
  fileTreeUpdatedAt?: string;      // ISO timestamp for staleness check
  fileTreeMachineId?: string;      // Which machine the cached fileTree belongs to
  defaultEnvironment?: 'local' | 'remote' | 'hpc' | 'cloud';
  defaultMachineId?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Relationships**:
- A project has many PlanNodes (via `projectId`)
- A project has many PlanEdges (via `projectId`)
- A project may belong to an Initiative (via `initiativeId`)
- A project has a visionDoc that is injected into every AI session

### 2.2 PlanNode (Task)

**Definition**: `src/types/index.ts` (lines 106-144)
**Storage**: IndexedDB `"astro-plan-nodes"` (local mode), Postgres `planNodes` table (server mode)

```typescript
interface PlanNode {
  id: string;                      // UUID
  projectId: string;               // FK to Project
  type: 'milestone' | 'task' | 'branch' | 'decision';
  title: string;
  description: string;
  status: 'planned' | 'dispatched' | 'in_progress' | 'auto_verified'
        | 'awaiting_judgment' | 'awaiting_approval' | 'completed' | 'pruned';
  parentId: string | null;
  dependencies: string[];          // Array of PlanNode IDs this depends on
  environment?: 'local' | 'remote' | 'hpc' | 'cloud';
  machineId?: string;              // Specific machine to run on
  verification: 'auto' | 'human';
  position: { x: number; y: number };  // Graph layout coordinates
  startDate?: string;              // ISO YYYY-MM-DD (milestones only)
  endDate?: string;                // ISO YYYY-MM-DD (milestones only)
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

  // Git/PR metadata (populated when PR is created)
  branchName?: string;
  prUrl?: string;
  prNumber?: number;

  // Soft-delete metadata
  deletedAt?: Date;
  deletionActionId?: string;

  // Plugin-contributed custom fields
  metadata?: Record<string, unknown>;
}
```

**Status lifecycle**:
```
planned → dispatched → in_progress → auto_verified → completed
                                   → awaiting_judgment → completed
                                   → awaiting_approval → completed
       → pruned (branch killed)
```

**Status state machine**:

```
┌──────────────────────────────────────────────────────────────────┐
│  PLAN NODE STATUS LIFECYCLE                                      │
│                                                                  │
│                    ┌─────────┐                                   │
│                    │ planned │ (initial state)                    │
│                    └────┬────┘                                   │
│                         │ dispatch                                │
│                         ▼                                        │
│                   ┌───────────┐                                  │
│                   │dispatched │                                  │
│                   └─────┬─────┘                                  │
│                         │ execution starts                       │
│                         ▼                                        │
│                  ┌────────────┐                                  │
│                  │in_progress │                                  │
│                  └──┬────┬───┘                                   │
│                     │    │                                       │
│          success +  │    │  success +                            │
│          auto verify│    │  human verify                         │
│                     ▼    ▼                                       │
│  ┌───────────────┐  ┌──────────────────┐                        │
│  │ auto_verified │  │awaiting_judgment │ ◄── also on failure     │
│  └───────┬───────┘  └────────┬─────────┘                        │
│          │                   │ human approves                    │
│          │                   ▼                                   │
│          │          ┌──────────────────┐                         │
│          │          │awaiting_approval │ (optional)               │
│          │          └────────┬─────────┘                         │
│          │                   │                                   │
│          └───────┬───────────┘                                   │
│                  ▼                                               │
│            ┌───────────┐                                        │
│            │ completed │ (terminal)                               │
│            └───────────┘                                        │
│                                                                  │
│  Any state ──── branch killed ────► ┌────────┐                  │
│                                      │ pruned │ (terminal)       │
│                                      └────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

**Relationships**:
- Belongs to a Project (via `projectId`)
- May reference a milestone PlanNode (via `milestoneId`)
- Connected to other PlanNodes via PlanEdges (dependency/branch)
- Has zero or one TaskExecution (via `executionId`)

### 2.3 PlanEdge

**Definition**: `src/types/index.ts` (lines 250-260)
**Storage**: IndexedDB `"astro-plan-edges"` (local mode), Postgres `planEdges` table (server mode)

```typescript
interface PlanEdge {
  id: string;
  source: string;                  // PlanNode ID
  target: string;                  // PlanNode ID
  type: 'dependency' | 'branch';
  deletedAt?: Date;
  deletionActionId?: string;
}
```

- `dependency`: target depends on source (source must complete before target can start)
- `branch`: target is an alternative exploration path from source

### 2.4 TaskExecution

**Definition**: `src/types/index.ts` (lines 190-235)
**Storage**: IndexedDB `"astro-executions"` (local mode, max 100), Postgres `taskExecutions` table (server mode)

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

**Definition**: `src/types/index.ts` (lines 65-78)
**Storage**: IndexedDB (local mode), Postgres `initiatives` table (server mode)

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

---

## 3. Execution Detail Types

### 3.1 ToolTrace

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

### 3.2 FileChange

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

### 3.3 TaskActivityEvent (Unified Timeline)

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
```

### 3.4 ExecutionSummary

Generated post-completion by the `/api/agent/summarize` endpoint:

```typescript
interface ExecutionSummary {
  workCompleted: string;
  filesChanged: string[];
  status: 'success' | 'partial' | 'failure';
  followUps: string[];
}
```

### 3.5 UsageMetrics

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

---

## 4. User and Profile Types

### 4.1 UserProfile

**Definition**: `src/types/index.ts` (lines 291-310)
**Storage**: IndexedDB `"astro-user-profile"`, Postgres `userProfiles` table

```typescript
interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  domains: DomainExpertise[];
  experienceLevel: ExperienceLevel;
  preferredEnvironments: PreferredEnvironment[];
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  apiKeys: ApiKey[];
  sidebarConfig?: Array<{ id, to, icon, label, visible, protected }>;
  createdAt: Date;
  updatedAt: Date;
}
```

### 4.2 Enum Types

```typescript
type DomainExpertise =
  'computational-biology' | 'web-development' | 'data-engineering' | 'ml-ai' |
  'devops-infrastructure' | 'mobile-development' | 'systems-programming' |
  'scientific-computing' | 'security' | 'other';

type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
type PreferredEnvironment = 'local' | 'remote' | 'hpc' | 'cloud';
type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
type Estimate = 'XS' | 'S' | 'M' | 'L' | 'XL';
```

---

## 5. Session Types

### 5.1 Session

**Definition**: `src/types/index.ts` (lines 35-57)

```typescript
interface Session {
  id: string;
  type: SessionType;               // 'plan-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation'
  status: SessionStatus;           // 'active' | 'streaming' | 'completed' | 'error' | 'cancelled'
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
    newNodes: Array<{ id?; title; description; type?; milestoneId?; dependencies?; priority?; estimate?; environment?; verification? }>;
  };
}
```

---

## 6. Provider and Machine Types

### 6.1 ProviderStatus (Frontend)

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

### 6.2 Agent Runner Types

**Task** (agent runner internal, `packages/agent-runner/src/types.ts`):
```typescript
interface Task {
  id: string;
  projectId: string;
  planNodeId: string;
  provider: 'claude-code' | 'claude-sdk' | 'codex' | 'slurm';
  prompt: string;
  workingDirectory: string;
  environment?: Record<string, string>;
  timeout?: number;
  maxTurns?: number;
  outputFormat?: { type: 'json_schema'; schema: Record };
  executionStrategy?: 'direct' | 'slurm' | 'docker' | 'k8s-exec' | 'skypilot';
  createdAt: string;
}
```

**TaskResult** (agent runner → server):
```typescript
interface TaskResult {
  taskId: string;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  exitCode?: number;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  artifacts?: TaskArtifact[];
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
}
```

### 6.3 MachineResources

```typescript
interface MachineResources {
  hostname: string;
  platform: NodeJS.Platform;
  arch: string;
  cpu: { model: string; cores: number; speed: number; loadAvg: number[] };
  memory: { total: number; free: number; used: number; usedPercent: number };
  gpu: Array<{ model: string; memoryTotal: number; memoryUsed: number; utilization: number }>;
}
```

---

## 7. Relay Protocol Types

**Definition**: `server/types/relay.ts` (671 lines)

### 7.1 TaskDispatch

```typescript
interface TaskDispatch {
  taskId: string;
  projectId: string;
  nodeId: string;
  title: string;
  description: string;
  prompt: string;
  visionDoc?: string;
  environment?: string;
  preferredProvider?: string;
  executionStrategy?: string;
  priority?: string;
  timeout?: number;
  workingDirectory?: string;
  dependencies?: DependencyContext[];
  maxTurns?: number;
  outputFormat?: { type: string; schema: Record };
}
```

### 7.2 DependencyContext

```typescript
interface DependencyContext {
  nodeId: string;
  title: string;
  output?: string;
}
```

### 7.3 Message Unions

```typescript
// Server → Agent Runner
type RelayToAgentMessage =
  | TaskDispatchMessage
  | TaskCancelMessage
  | TaskSteerMessage
  | TaskApprovalResponseMessage
  | TaskSafetyDecisionMessage
  | FileListRequestMessage
  | RepoSetupRequestMessage
  | ConfigUpdateMessage

// Agent Runner → Server
type AgentToRelayMessage =
  | MachineRegisterMessage
  | HeartbeatMessage
  | TaskResultMessage
  | TaskStatusMessage
  | TaskOutputMessage
  | TaskTextMessage
  | TaskToolUseMessage
  | TaskToolResultMessage
  | TaskToolTraceMessage
  | TaskFileChangeMessage
  | TaskSessionInitMessage
  | TaskSteerAckMessage
  | TaskApprovalRequestMessage
  | ResourceUpdateMessage
  | FileListResponseMessage
  | RepoSetupResponseMessage
```

---

## 8. Database Schema (Postgres)

Defined in `server/lib/db/schema.ts` (~300 lines, 27+ tables):

### 8.1 Core Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `projects` | `id` (UUID) | `owner_id` → auth.users | Project metadata |
| `planNodes` | `id` (UUID) | `projectId` → projects | Plan graph nodes |
| `planEdges` | `id` (UUID) | `projectId` → projects | Plan graph edges |
| `planNodeDependencies` | composite | `nodeProjectId`, `nodeClientId` | Dependency tracking |
| `initiatives` | `id` (UUID) | `owner_id` → auth.users | Initiative grouping |

### 8.2 Execution Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `sessions` | `id` (text) | `userId` | Chat/execution sessions |
| `taskExecutions` | `id` (UUID) | `projectId` | Execution records |
| `taskChatSessions` | `id` | `userId` | Chat session metadata |
| `taskChatMessages` | `id` | `sessionId` | Chat messages |
| `toolTraces` | `id` | — | Tool call records |
| `fileChanges` | `id` | — | File modification records |

### 8.3 User Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `userProfiles` | `id` (UUID) | → auth.users | User metadata |
| `displaySettings` | composite (userId, viewKey) | — | Per-view display config |
| `usageMetrics` | composite (userId, sessionDate) | — | Daily usage aggregation |
| `projectMembers` | composite (projectId, userId) | — | Project access control |

### 8.4 Team & Collaboration Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `teams` | `id` (UUID) | — | Team grouping entity |
| `teamMembers` | composite (teamId, userId) | `teamId` → teams | Team membership with roles (owner/admin/member) |
| `inviteTokens` | `id` (UUID) | `teamId` → teams | Email-based team invitation tokens |

### 8.5 Infrastructure Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `registeredMachines` | `id` (text) | `userId`, `teamId` → teams | Machine registration (now team-aware) |
| `refreshTokens` | `tokenHash` | `machineId` | Device auth tokens |
| `pushTokens` | — | — | Push notification tokens |
| `machineUsageLogs` | `id` (UUID) | `machineId`, `userId` | Machine usage tracking |

### 8.6 Auth & Integration Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `passkeyCredentials` | `credentialId` (text) | `userId` | WebAuthn/passkey credentials |
| `connectedAccounts` | `id` (UUID) | `userId` | External OAuth integrations (GitHub, Linear) |

### 8.7 Activity & Audit Tables

| Table | Primary Key | Foreign Keys | Purpose |
|-------|------------|-------------|---------|
| `auditLogs` | `id` (UUID) | `userId` | Audit trail of user actions |
| `activityEvents` | `id` (UUID) | `userId`, `projectId` | Activity feed events |
| `observationEvents` | `id` | `executionId` | Observability trace events |

---

## 9. IndexedDB Keys

| Key | Store | Format |
|-----|-------|--------|
| `astro-projects` | project-store | `Project[]` |
| `astro-plan-nodes` | plan-store | `PlanNode[]` |
| `astro-plan-edges` | plan-store | `PlanEdge[]` |
| `astro-executions` | execution-store | `Record<string, TaskExecution>` (max 100) |
| `astro-agent-sessions` | agent-store | `Record<string, GenerationSession>` |
| `astro-settings` | settings-store | `{ model, defaultProvider }` |
| `astro-user-profile` | user-profile-store | `UserProfile` |
| `astro-task-chats` | task-chat-store | `Record<string, TaskChatSession>` |
| `astro-usage-metrics` | usage-store | `SessionMetrics` |
| `astro:activities` | activity-store | `Activity[]` (max 1000) |
| `astro-display-settings` | display-settings-store | `Record<string, DisplaySettings>` |
| `astro-sessions` | session-store | `Record<string, Session>` |
| `astro-active-sessions` | session-store | Active session ID tracking |
| `astro-initiatives` | initiative-store | `Initiative[]` |
| `astro-teams` | team-store | `Team[]` |
| `astro-team-members` | team-store | `Record<string, TeamMember[]>` |
| `astro-machines` | machines-store | `RegisteredMachine[]` |
| `astro-slurm-clusters` | slurm-store | `SlurmCluster[]` |
| `astro-slurm-jobs` | slurm-store | `SlurmJob[]` |
| `astro-plugins` | plugin-store | Plugin data |
| `astro-skills` | skill-store | Skill data |
| `astro-connected-accounts` | connected-accounts-store | Connected account data |
| `astro:command-history` | command-palette | Command history |

**Serialization**: Dates stored as ISO strings. Maps serialized as Records. Reconstructed on load.

---

## 10. Entity Relationships

```
┌──────────────────────────────────────────────────────────────────┐
│  ENTITY RELATIONSHIPS                                            │
│                                                                  │
│  Team                                                            │
│  ├── has many TeamMembers (owner, admin, member)                 │
│  ├── has many Projects (via teamId)                              │
│  ├── has many RegisteredMachines (shared machines)               │
│  └── has many InviteTokens (pending invitations)                 │
│                                                                  │
│  Initiative                                                      │
│  └── has many Projects                                           │
│                                                                  │
│  Project                                                         │
│  ├── has many PlanNodes (tasks, milestones, branches, decisions) │
│  ├── has many PlanEdges (dependency and branch connections)       │
│  ├── has many ProjectMembers (access control)                    │
│  ├── may belong to a Team (via teamId)                           │
│  └── has a visionDoc (injected into every AI session)            │
│                                                                  │
│  PlanNode                                                        │
│  ├── belongs to a Project                                        │
│  ├── may belong to a milestone PlanNode                          │
│  ├── connected to other PlanNodes via PlanEdges                  │
│  └── has at most one active TaskExecution                        │
│                                                                  │
│  PlanEdge                                                        │
│  ├── connects two PlanNodes (source → target)                    │
│  └── type: dependency (must complete before) or branch (explore) │
│                                                                  │
│  TaskExecution                                                   │
│  ├── belongs to a PlanNode                                       │
│  ├── has many ToolTraces (tool call history)                     │
│  ├── has many FileChanges (file modifications)                   │
│  ├── has many TaskActivityEvents (unified timeline)              │
│  └── has optional ExecutionSummary (post-completion)             │
│                                                                  │
│  Session                                                         │
│  ├── belongs to a Project                                        │
│  ├── may belong to a PlanNode                                    │
│  └── has many SessionMessages                                    │
└──────────────────────────────────────────────────────────────────┘
```

```
Initiative (1) ──────── (*) Project
                              |
                   (1)────────+────────(*)
                   |                    |
              PlanNode (*)        PlanEdge (*)
                   |             (source → target)
                   |
         TaskExecution (0..1)
              |
    +---------+---------+
    |         |         |
ToolTrace  FileChange  TaskActivityEvent
   (*)       (*)          (*)
```

- A Project has many PlanNodes and PlanEdges
- PlanEdges connect PlanNodes (source → target, dependency or branch)
- A PlanNode has at most one active TaskExecution
- A TaskExecution has many ToolTraces, FileChanges, and TaskActivityEvents
- An Initiative groups many Projects
