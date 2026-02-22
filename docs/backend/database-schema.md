# Database Schema

Complete reference for Astro's Drizzle/PostgreSQL schema. All tables are defined in `server/lib/db/schema.ts`.

## Core Data Model

### Projects

Primary organizational unit for work. Contains plan graph, vision document, and settings.

```typescript
projects {
  id: uuid (PK)
  ownerId: uuid (FK → auth.users)
  name: text
  description: text
  visionDoc: text                    // Markdown document injected into all agent sessions
  status: text                       // 'active' | 'archived'
  startDate: date
  targetDate: date
  lead: text
  health: text                       // 'on_track' | 'at_risk' | 'off_track'
  initiativeId: uuid (FK → initiatives)
  progress: integer                  // 0-100 percentage
  labels: jsonb[]                    // Project-level labels
  color: text                        // Hex color for UI
  icon: text                         // Emoji icon
  workingDirectory: text             // Local repo path
  repository: text                   // Git repository URL
  defaultEnvironment: text           // 'local' | 'hpc' | 'cloud'
  defaultMachineId: text             // Default execution machine
  mergeQueueEnabled: boolean
  mergeQueueMergeMethod: text        // 'merge' | 'squash' | 'rebase'
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Relationships:**
- One-to-many with `planNodes` (cascade delete)
- One-to-many with `planEdges` (cascade delete)
- One-to-many with `sessions` (cascade delete)
- One-to-many with `taskExecutions` (cascade delete)
- Belongs to one `initiative` (optional)

### Initiatives

High-level groupings of related projects (e.g., "Q1 Product Launch", "Research Phase 2").

```typescript
initiatives {
  id: uuid (PK)
  ownerId: uuid (FK → auth.users)
  name: text
  description: text
  goal: text                         // High-level objective
  status: text                       // 'active' | 'on_hold' | 'completed' | 'cancelled'
  startDate: date
  targetDate: date
  lead: text
  color: text
  icon: text
  createdAt: timestamp
  updatedAt: timestamp
}
```

## Plan Graph

The plan graph is a directed acyclic graph (DAG) of tasks, milestones, and dependencies.

### Plan Nodes

Vertices in the plan graph. Each node represents a unit of work (task), decision point, or milestone.

```typescript
planNodes {
  id: uuid (PK)
  projectId: uuid (FK → projects, cascade)
  clientId: text                     // Client-generated ID for compatibility
  type: text                         // 'milestone' | 'task' | 'branch' | 'decision'
  title: text
  description: text
  status: text                       // See status values below
  parentId: text                     // Client ID of parent node
  environment: text                  // 'local' | 'hpc' | 'cloud'
  verification: text                 // 'auto' | 'manual'
  positionX: real                    // React Flow canvas position
  positionY: real
  startDate: date                    // AI-generated or user-set
  endDate: date                      // AI-generated or user-set
  dueDate: date                      // User deadline
  priority: text                     // 'urgent' | 'high' | 'normal' | 'low'
  estimate: text                     // 'xs' | 's' | 'm' | 'l' | 'xl'
  milestoneId: text                  // Associated milestone ID
  labelIds: text[]                   // Label IDs
  executionId: text                  // Current execution ID
  executionOutput: text              // Latest execution output
  executionError: text               // Latest execution error
  executionStartedAt: timestamp
  executionCompletedAt: timestamp
  branchName: text                   // Git branch name
  prUrl: text                        // GitHub PR URL
  prNumber: integer                  // GitHub PR number
  mergeQueueStatus: text             // 'pending' | 'queued' | 'in_progress' | 'merged' | 'failed'
  autoPr: boolean                    // Auto-create PR on completion
  deletedAt: timestamp               // Soft delete timestamp
  deletionActionId: text             // Activity event ID for deletion
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Status values:**
- `planned` - Not started
- `dispatched` - Sent to agent runner
- `in_progress` - Actively executing
- `auto_verified` - Completed with automatic verification
- `awaiting_approval` - Requires user approval
- `awaiting_judgment` - Requires user decision
- `completed` - Successfully completed
- `pruned` - Cancelled/discarded

**Relationships:**
- Belongs to one `project`
- Has many `planNodeDependencies` (via `clientId`)
- Has many `taskExecutions`

### Plan Node Dependencies

Explicit dependency edges between nodes (many-to-many).

```typescript
planNodeDependencies {
  nodeProjectId: uuid
  nodeClientId: text                 // Node that depends on another
  dependsOnClientId: text            // Node that must complete first
  -- Composite PK: (nodeProjectId, nodeClientId, dependsOnClientId)
}
```

### Plan Edges

Graph edges for React Flow visualization. Duplicates dependency data in a format optimized for the graph library.

```typescript
planEdges {
  id: uuid (PK)
  projectId: uuid (FK → projects, cascade)
  clientId: text                     // Client-generated edge ID
  sourceClientId: text               // Source node client ID
  targetClientId: text               // Target node client ID
  type: text                         // 'dependency' | 'branch'
  deletedAt: timestamp               // Soft delete
  deletionActionId: text
  createdAt: timestamp
}
```

## User Management

### User Profiles

Extended user data beyond Supabase `auth.users`. Auto-created by the `handle_new_user` trigger when a user is inserted into `auth.users`. The trigger uses `ON CONFLICT DO NOTHING` + exception handling to never block auth signup. A `find_auth_user_by_email` RPC function provides efficient email lookup in `auth.users` for self-healing when profiles are missing.

```typescript
userProfiles {
  id: uuid (PK, matches auth.users.id)
  name: text
  email: text
  avatarUrl: text
  bio: text
  domains: text[]                    // Expertise domains
  experienceLevel: text              // 'beginner' | 'intermediate' | 'expert'
  preferredEnvironments: text[]      // ['local', 'hpc', 'cloud']
  notificationsEnabled: boolean
  emailNotifications: boolean
  apiKeys: jsonb[]                   // Encrypted API keys for external services
  sidebarConfig: jsonb[]             // Sidebar navigation customization
  settings: jsonb                    // User preferences
  createdAt: timestamp
  updatedAt: timestamp
}
```

**API Keys structure:**
```typescript
{
  id: string
  provider: string         // 'anthropic' | 'openai' | 'github' | etc.
  name: string
  maskedKey: string        // Last 4 chars only
}
```

**Sidebar Config structure:**
```typescript
{
  id: string
  to: string              // Route path
  icon: string            // Lucide icon name
  label: string
  visible: boolean
  protected: boolean      // Cannot be hidden
}
```

### Project Members

Multi-user project access control.

```typescript
projectMembers {
  projectId: uuid (FK → projects, cascade)
  userId: uuid (FK → auth.users)
  role: text              // 'owner' | 'editor' | 'viewer'
  createdAt: timestamp
  -- Composite PK: (projectId, userId)
}
```

**Permissions:**
- `owner` - Full control, can delete project
- `editor` - Can edit plan, dispatch tasks, manage settings
- `viewer` - Read-only access

### Passkey Credentials

WebAuthn/passkey credentials for authentication.

```typescript
passkeyCredentials {
  id: text (PK)                      // Credential ID from WebAuthn
  userId: uuid (FK → auth.users)
  publicKey: text                    // Base64-encoded public key
  counter: integer                   // Signature counter (prevents replay)
  transports: text[]                 // ['usb', 'nfc', 'ble', 'internal']
  deviceName: text                   // User-friendly device name
  createdAt: timestamp
  lastUsedAt: timestamp
}
```

## Session & Execution Tracking

### Sessions (Unified)

New unified session table consolidating plan chat, task chat, steer chat, and execution tracking.

```typescript
sessions {
  id: text (PK)
  userId: uuid
  type: text                         // 'plan-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation'
  status: text                       // 'active' | 'streaming' | 'completed' | 'error' | 'cancelled'
  projectId: uuid (FK → projects, cascade)
  nodeId: text                       // Plan node client ID (for task/steer)
  providerSessionId: text            // Provider's session ID
  providerId: text                   // 'claude-code' | 'codex' | 'slurm'
  model: text                        // Model identifier
  messages: jsonb[]                  // Chat message history
  activityEvents: jsonb[]            // Activity event timeline
  toolTraces: jsonb[]                // Tool call traces
  fileChanges: jsonb[]               // File modification records
  streamText: text                   // Accumulated output stream
  summary: jsonb                     // Session summary data
  metrics: jsonb                     // Usage metrics
  steerMessages: jsonb[]             // Steering messages (for steer sessions)
  metadata: jsonb                    // Additional context
  createdAt: timestamp
  updatedAt: timestamp
  completedAt: timestamp
}
```

**Messages structure:**
```typescript
{
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string (ISO 8601)
  appliedMutations?: unknown
}
```

### Task Executions

Execution records for tasks dispatched to agent runners.

```typescript
taskExecutions {
  id: uuid (PK)
  executionId: text (unique)         // User-facing execution ID
  nodeClientId: text
  projectId: uuid (FK → projects, cascade)
  status: text                       // 'pending' | 'running' | 'success' | 'failure' | 'cancelled'
  streamText: text                   // Accumulated stdout/stderr
  error: text
  startedAt: timestamp
  completedAt: timestamp
  sessionId: text                    // Provider session ID
  machineId: text                    // Executing machine ID
  providerId: text                   // Provider identifier
  providerName: text                 // Provider display name
  durationMs: integer
  inputTokens: integer
  outputTokens: integer
  tokensUsed: integer
  estimatedCostUsd: real
  model: text                        // Model used
  turnsUsed: integer                 // Agent turns consumed
  markdownSummary: text              // Markdown execution summary
  createdAt: timestamp
}
```

### Tool Traces

Records of tool calls made during task execution (for debugging and replay).

```typescript
toolTraces {
  id: uuid (PK)
  executionId: text                  // FK to taskExecutions.executionId
  toolName: text                     // Tool identifier
  toolInput: jsonb                   // Tool parameters
  toolResult: jsonb                  // Tool output
  success: boolean
  duration: integer                  // Milliseconds
  timestamp: timestamp
}
```

### File Changes

File modifications made during task execution.

```typescript
fileChanges {
  id: uuid (PK)
  executionId: text                  // FK to taskExecutions.executionId
  path: text                         // File path
  action: text                       // 'create' | 'modify' | 'delete'
  linesAdded: integer
  linesRemoved: integer
  timestamp: timestamp
}
```

### Task Chat (Legacy)

Legacy task chat tables, being migrated to unified `sessions` table.

```typescript
taskChatSessions {
  id: uuid (PK)
  nodeId: text
  projectId: uuid (FK → projects, cascade)
  userId: uuid
  sessionId: text
  createdAt: timestamp
  updatedAt: timestamp
}

taskChatMessages {
  id: text (PK)
  sessionId: uuid (FK → taskChatSessions, cascade)
  role: text                         // 'user' | 'assistant'
  content: text
  createdAt: timestamp
}
```

## Machine & Device Management

### Registered Machines

Agent runner machines registered for task execution.

```typescript
registeredMachines {
  id: text (PK)
  userId: uuid
  name: text                         // User-friendly name
  hostname: text                     // Machine hostname
  platform: text                     // 'darwin' | 'linux' | 'win32'
  environmentType: text              // 'local' | 'hpc' | 'cloud'
  providers: text[]                  // ['claude-code', 'slurm', etc.]
  workspaceId: text                  // Git worktree ID
  isConnected: boolean               // Currently connected to relay
  isRevoked: boolean                 // Manually revoked
  refreshTokenHash: text             // Hashed refresh token
  metadata: jsonb                    // Additional machine info
  registeredAt: timestamp
  lastSeenAt: timestamp
}
```

### Refresh Tokens

Long-lived tokens for machine authentication (OAuth2-style).

```typescript
refreshTokens {
  tokenHash: text (PK)               // SHA256 hash of token
  machineId: text (FK → registeredMachines, cascade)
  userId: uuid
  workspaceId: text
  scopes: text[]                     // ['dispatch', 'report', etc.]
  isRevoked: boolean
  expiresAt: timestamp
  createdAt: timestamp
}
```

## Activity & Observability

### Activity Events

User-visible activity timeline (project updates, task completions, approvals).

```typescript
activityEvents {
  id: uuid (PK)
  userId: uuid
  projectId: uuid (FK → projects, cascade)
  type: text                         // Event type identifier
  title: text                        // Human-readable title
  description: text                  // Additional context
  nodeId: text                       // Associated plan node (optional)
  metadata: jsonb                    // Structured event data
  createdAt: timestamp
}
```

**Common event types:**
- `project.created`
- `task.dispatched`
- `task.completed`
- `approval.requested`
- `approval.approved`
- `branch.pruned`

### Observation Events

LangSmith-compatible observability events (traces, spans, generations).

```typescript
observationEvents {
  id: text (PK)
  traceId: text                      // Trace identifier
  parentObservationId: text          // Parent span ID
  type: text                         // 'trace' | 'span' | 'generation' | 'event'
  name: text                         // Observation name
  startTime: timestamp
  endTime: timestamp
  input: jsonb                       // Input data
  output: jsonb                      // Output data
  model: text                        // Model used
  inputTokens: integer
  outputTokens: integer
  estimatedCostUsd: real
  level: text                        // 'default' | 'debug' | 'warning' | 'error'
  metadata: jsonb                    // Additional context
  projectId: uuid                    // Associated project
  nodeId: text                       // Associated node
  statusMessage: text                // Status or error message
  createdAt: timestamp
}
```

### Audit Logs

Security and compliance audit trail.

```typescript
auditLogs {
  id: uuid (PK)
  userId: uuid
  action: text                       // 'account.create', 'api_key.create', 'machine.register', etc.
  resourceType: text                 // 'account' | 'api_key' | 'machine' | 'project'
  resourceId: text                   // ID of affected resource
  details: jsonb                     // Additional context (non-sensitive)
  ipAddress: text                    // Source IP
  userAgent: text                    // User agent string
  createdAt: timestamp
}
```

## User Preferences & Settings

### Display Settings

Per-view display preferences (grouping, sorting, visible columns).

```typescript
displaySettings {
  userId: uuid
  viewKey: text                      // 'my-tasks', 'project-{id}', etc.
  settings: jsonb                    // View-specific settings
  updatedAt: timestamp
  -- Composite PK: (userId, viewKey)
}
```

**Example settings:**
```typescript
{
  groupBy: 'status' | 'priority' | 'milestone' | 'none'
  orderBy: 'status' | 'priority' | 'created' | 'updated'
  properties: ['status', 'priority', 'estimate', 'dueDate', ...]
}
```

### Usage Metrics

Daily usage tracking per user (cost, tokens, task counts).

```typescript
usageMetrics {
  userId: uuid
  sessionDate: date
  totalCostUsd: real
  totalInputTokens: integer
  totalOutputTokens: integer
  tasksCompleted: integer
  tasksFailed: integer
  updatedAt: timestamp
  -- Composite PK: (userId, sessionDate)
}
```

## Encrypted API Keys

### Encrypted API Keys

Client-side encrypted storage of external service credentials (e.g., OpenAI, Anthropic). Keys are encrypted using Web Crypto API before storage.

```typescript
encryptedApiKeys {
  id: uuid (PK)
  userId: uuid (FK → auth.users, cascade)
  serviceName: text                    // e.g., 'openai-whisper', 'anthropic', 'openai'
  encryptedKey: text                   // Base64-encoded encrypted key
  iv: text                             // Base64-encoded initialization vector for AES-GCM
  createdAt: timestamp
  updatedAt: timestamp
  -- Unique constraint: (userId, serviceName)
}
```

## Teams & Collaboration

### Teams

Organizational units for multi-user collaboration. Team members share access to team projects and machines.

```typescript
teams {
  id: uuid (PK)
  name: text
  description: text
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Relationships:**
- One-to-many with `team_members` (cascade delete)
- One-to-many with `invite_tokens` (cascade delete)
- One-to-many with `projects` via `team_id` (set null on delete)

**Trigger:** When a team is created, the creator is automatically added as `owner` via `add_team_creator_as_owner()` trigger.

### Team Members

Junction table linking users to teams with role-based access.

```typescript
teamMembers {
  teamId: uuid (FK → teams, cascade)
  userId: uuid (FK → auth.users, cascade)
  role: team_member_role               // 'owner' | 'admin' | 'member'
  joinedAt: timestamp
  -- Composite PK: (teamId, userId)
}
```

**Permissions:**
- `owner` - Full control, can delete team, manage all members
- `admin` - Can manage members, update team settings, send invites
- `member` - Can access team projects and machines

### Invite Tokens

Email-based team invitation tokens. Supports both new user registration and existing user acceptance flows.

```typescript
inviteTokens {
  id: uuid (PK)
  token: text (unique)                 // Secure random hex token (32 bytes)
  teamId: uuid (FK → teams, cascade)
  email: text                          // Invitee email address
  invitedBy: uuid                      // User ID of inviter
  role: text                           // 'owner' | 'admin' | 'member'
  expiresAt: timestamp                 // 7-day expiration
  usedAt: timestamp                    // Set when invite is accepted
  createdAt: timestamp
}
```

**Cleanup:** The `cleanup_expired_invite_tokens()` function deletes expired, unused tokens and can be called via cron job.

### Machine Usage Logs

Tracks machine usage for capacity planning and billing. Records each task execution on a machine.

```typescript
machineUsageLogs {
  id: uuid (PK)
  machineId: text (FK → registeredMachines, cascade)
  userId: uuid (FK → auth.users, cascade)
  projectId: uuid (FK → projects, cascade)
  nodeId: text                         // Plan node client ID
  executionId: text                    // Execution identifier
  startedAt: timestamp
  completedAt: timestamp
  durationMs: integer
  status: text                         // 'success' | 'failure' | 'cancelled'
  createdAt: timestamp
}
```

## Integrations

### Connected Accounts

External service integrations (GitHub, Slack, Linear, etc.).

```typescript
connectedAccounts {
  id: uuid (PK)
  userId: uuid
  channel: text                      // 'github' | 'slack' | 'linear'
  label: text                        // User-friendly name
  credentials: jsonb                 // Encrypted OAuth tokens
  mappings: jsonb                    // Resource mappings (e.g., repo → project)
  settings: jsonb                    // Integration settings
  externalId: text                   // External account ID
  enabled: boolean
  connectedAt: timestamp
  updatedAt: timestamp
}
```

**Credentials structure (encrypted):**
```typescript
{
  access_token: string
  refresh_token?: string
  expires_at?: number
  scope?: string
}
```

### Push Tokens

iOS/Android push notification tokens.

```typescript
pushTokens {
  id: uuid (PK)
  userId: uuid
  deviceToken: text                  // APNs/FCM token
  platform: text                     // 'ios' | 'android'
  preferences: jsonb                 // Notification preferences
  createdAt: timestamp
  updatedAt: timestamp
}
```

## Indexes

Key indexes for performance (defined in migrations):

```sql
-- Projects
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_projects_initiative ON projects(initiative_id);

-- Plan Nodes
CREATE INDEX idx_plan_nodes_project ON plan_nodes(project_id);
CREATE INDEX idx_plan_nodes_client_id ON plan_nodes(project_id, client_id);
CREATE INDEX idx_plan_nodes_status ON plan_nodes(status);

-- Plan Edges
CREATE INDEX idx_plan_edges_project ON plan_edges(project_id);
CREATE INDEX idx_plan_edges_source ON plan_edges(source_client_id);
CREATE INDEX idx_plan_edges_target ON plan_edges(target_client_id);

-- Task Executions
CREATE INDEX idx_task_executions_project ON task_executions(project_id);
CREATE INDEX idx_task_executions_node ON task_executions(node_client_id);
CREATE INDEX idx_task_executions_status ON task_executions(status);

-- Activity Events
CREATE INDEX idx_activity_events_project ON activity_events(project_id);
CREATE INDEX idx_activity_events_created ON activity_events(created_at DESC);

-- Audit Logs
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- Encrypted API Keys
CREATE INDEX idx_encrypted_api_keys_user_id ON encrypted_api_keys(user_id);

-- Teams
CREATE INDEX idx_teams_name ON teams(name);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_team_members_role ON team_members(team_id, role);
CREATE INDEX idx_projects_team ON projects(team_id);

-- Invite Tokens
CREATE INDEX idx_invite_tokens_token ON invite_tokens(token);
CREATE INDEX idx_invite_tokens_team ON invite_tokens(team_id);
CREATE INDEX idx_invite_tokens_email ON invite_tokens(email);
CREATE INDEX idx_invite_tokens_expires ON invite_tokens(expires_at);

-- Machine Usage Logs
CREATE INDEX idx_machine_usage_logs_machine ON machine_usage_logs(machine_id);
CREATE INDEX idx_machine_usage_logs_user ON machine_usage_logs(user_id);
CREATE INDEX idx_machine_usage_logs_project ON machine_usage_logs(project_id);
CREATE INDEX idx_machine_usage_logs_started_at ON machine_usage_logs(started_at DESC);

-- Registered Machines (team)
CREATE INDEX idx_registered_machines_team ON registered_machines(team_id);
```

## Related Documentation

- [RLS Policies](./rls-policies.md) - Row-level security configuration
- [API Reference](./api-reference.md) - REST API endpoints
- [Data Flows](./data-flows.md) - How data moves through the system
- [Supabase Setup](../setup/supabase-local-dev.md) - Local Supabase development
