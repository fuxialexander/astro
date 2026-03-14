import { pgTable, text, integer, real, uuid, timestamp, boolean, date, jsonb, primaryKey, unique, index, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { GitHubSyncSettings } from '../types.js'

// ── Projects ──────────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  number: integer('number'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  visionDoc: text('vision_doc').notNull().default(''),
  status: text('status').notNull().default('active'), // 'active' | 'archived'
  startDate: date('start_date'),
  targetDate: date('target_date'),
  lead: text('lead'),
  health: text('health'), // 'on_track' | 'at_risk' | 'off_track'
  initiativeId: uuid('initiative_id'),
  teamId: uuid('team_id'),
  progress: integer('progress').default(0),
  labels: jsonb('labels').$type<{ id: string; name: string; color: string }[]>().notNull().default([]),
  color: text('color').default('#3b82f6'),
  icon: text('icon').default('📋'),
  workingDirectory: text('working_directory'),
  /** @deprecated Always equalled workingDirectory. Kept for DB backward compat; will be dropped in a future migration. */
  sourceDirectory: text('source_directory'),
  repository: text('repository'),
  defaultEnvironment: text('default_environment'),
  defaultMachineId: text('default_machine_id'),
  computeBackends: text('compute_backends').array().default([]),
  mergeQueueEnabled: boolean('merge_queue_enabled').default(false),
  mergeQueueMergeMethod: text('merge_queue_merge_method').default('squash'),
  source: jsonb('source'),
  deliveryMode: text('delivery_mode'),
  projectType: text('project_type').default('default'), // 'default' | 'playground' | 'github'
  githubOwner: text('github_owner'),
  githubRepo: text('github_repo'),
  githubRepoId: integer('github_repo_id'),
  references: jsonb('references').default([]),
  githubSyncSettings: jsonb('github_sync_settings').$type<GitHubSyncSettings>(),
  projectBranch: text('project_branch'),
  projectPrUrl: text('project_pr_url'),
  projectPrNumber: integer('project_pr_number'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  teamIdIdx: index('idx_projects_team_id').on(table.teamId),
  ownerIdIdx: index('idx_projects_owner_id').on(table.ownerId),
}))

// ── Initiatives ───────────────────────────────────────────────────────
export const initiatives = pgTable('initiatives', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  goal: text('goal'),
  status: text('status').notNull().default('active'), // 'active' | 'on_hold' | 'completed' | 'cancelled'
  startDate: date('start_date'),
  targetDate: date('target_date'),
  lead: text('lead'),
  color: text('color').default('#3b82f6'),
  icon: text('icon').default('🎯'),
  teamId: uuid('team_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  teamIdIdx: index('idx_initiatives_team_id').on(table.teamId),
  ownerIdIdx: index('idx_initiatives_owner_id').on(table.ownerId),
}))

// ── Teams ─────────────────────────────────────────────────────────────
export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ── Team Members ──────────────────────────────────────────────────────
export const teamMembers = pgTable('team_members', {
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.teamId, table.userId] }),
}))

// ── Invite Tokens ─────────────────────────────────────────────────────
export const inviteTokens = pgTable('invite_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  invitedBy: uuid('invited_by').notNull(),
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ── Plan Nodes ────────────────────────────────────────────────────────
export const planNodes = pgTable('plan_nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(), // Preserve client-generated IDs for compatibility
  number: integer('number'),
  type: text('type').notNull(), // 'milestone' | 'task' | 'branch' | 'decision'
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('planned'),
  parentId: text('parent_id'),
  environment: text('environment'), // legacy, unused
  verification: text('verification').notNull().default('auto'),
  positionX: real('position_x').notNull().default(0),
  positionY: real('position_y').notNull().default(0),
  startDate: date('start_date'),
  endDate: date('end_date'),
  dueDate: date('due_date'),
  priority: text('priority'),
  estimate: text('estimate'),
  milestoneId: text('milestone_id'),
  labelIds: text('label_ids').array(),
  executionId: text('execution_id'),
  executionOutput: text('execution_output'),
  executionError: text('execution_error'),
  executionStartedAt: timestamp('execution_started_at'),
  executionCompletedAt: timestamp('execution_completed_at'),
  actualStartDate: timestamp('actual_start_date'),
  actualEndDate: timestamp('actual_end_date'),
  branchName: text('branch_name'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  mergeQueueStatus: text('merge_queue_status'),
  commitBeforeSha: text('commit_before_sha'),
  commitAfterSha: text('commit_after_sha'),
  autoPr: boolean('auto_pr').default(false),
  content: text('content'), // Rich text content (TipTap HTML)
  attachments: jsonb('attachments').$type<Array<{
    id: string; name: string; url: string; mimeType: string; size: number; uploadedAt: string; thumbnailUrl?: string
  }>>().default([]),
  links: jsonb('links').$type<Array<{
    id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string
  }>>().default([]),
  acceptanceCriteria: jsonb('acceptance_criteria').$type<Array<{
    id: string; description: string; type: string; command?: string; autoVerifiable: boolean
  }>>().default([]),
  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl: text('github_issue_url'),
  githubPrData: jsonb('github_pr_data').$type<{
    title: string
    branch: string
    diffStats: { additions: number; deletions: number; changedFiles: number }
    ciStatus: string
    reviewStatus: string
    reviewers: string[]
    mergedAt: string | null
    closedAt: string | null
  }>(),
  githubComments: jsonb('github_comments').$type<Array<{
    id: number; author: { login: string; avatar: string }; body: string;
    createdAt: string; updatedAt: string;
    type: 'issue_comment' | 'review_comment';
    inReplyTo?: number; path?: string; line?: number;
  }>>().default([]),
  githubSyncedAt: timestamp('github_synced_at', { withTimezone: true }),
  githubSyncVersion: integer('github_sync_version').default(0),
  syncSource: text('sync_source'),  // 'user' | 'github' | 'sync' — prevents infinite sync loops
  deletedAt: timestamp('deleted_at'),
  deletionActionId: text('deletion_action_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index('idx_plan_nodes_project').on(table.projectId),
  clientIdIdx: index('idx_plan_nodes_client_id_standalone').on(table.clientId),
  projectClientIdUniq: uniqueIndex('idx_plan_nodes_project_client').on(table.projectId, table.clientId),
  statusIdx: index('idx_plan_nodes_status').on(table.status),
  deletedAtIdx: index('idx_plan_nodes_deleted_at').on(table.deletedAt),
  branchNameIdx: index('idx_plan_nodes_branch_name').on(table.branchName),
  prNumberIdx: index('idx_plan_nodes_pr_number').on(table.prNumber),
}))

// ── Plan Node Dependencies ────────────────────────────────────────────
export const planNodeDependencies = pgTable('plan_node_dependencies', {
  nodeProjectId: uuid('node_project_id').notNull(),
  nodeClientId: text('node_client_id').notNull(),
  dependsOnClientId: text('depends_on_client_id').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.nodeProjectId, table.nodeClientId, table.dependsOnClientId] }),
}))

// ── Plan Edges ────────────────────────────────────────────────────────
export const planEdges = pgTable('plan_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  sourceClientId: text('source_client_id').notNull(),
  targetClientId: text('target_client_id').notNull(),
  type: text('type').notNull().default('dependency'), // 'dependency' | 'branch'
  deletedAt: timestamp('deleted_at'),
  deletionActionId: text('deletion_action_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  projectClientUnique: uniqueIndex('uq_plan_edges_project_client').on(table.projectId, table.clientId),
  projectIdIdx: index('idx_plan_edges_project').on(table.projectId),
  sourceClientIdIdx: index('idx_plan_edges_source').on(table.sourceClientId),
  targetClientIdIdx: index('idx_plan_edges_target').on(table.targetClientId),
  deletedAtIdx: index('idx_plan_edges_deleted_at').on(table.deletedAt),
}))

// ── User Profiles ─────────────────────────────────────────────────────
export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().default(''),
  avatarUrl: text('avatar_url'),
  bio: text('bio').default(''),
  domains: text('domains').array().notNull().default([]),
  experienceLevel: text('experience_level').notNull().default('intermediate'),
  preferredMachines: text('preferred_machines').array().notNull().default([]),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  emailNotifications: boolean('email_notifications').notNull().default(false),
  defaultMachineId: text('default_machine_id'),
  defaultProvider: text('default_provider'),
  apiKeys: jsonb('api_keys').$type<Array<{ id: string; provider: string; name: string; maskedKey: string }>>().notNull().default([]),
  sidebarConfig: jsonb('sidebar_config').$type<Array<{
    id: string; to: string; icon: string; label: string; visible: boolean; protected: boolean
  }>>(),
  settings: jsonb('settings').$type<Record<string, string>>().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ── Display Settings ──────────────────────────────────────────────────
export const displaySettings = pgTable('display_settings', {
  userId: uuid('user_id').notNull(),
  viewKey: text('view_key').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.viewKey] }),
}))

// ── Usage Metrics ─────────────────────────────────────────────────────
export const usageMetrics = pgTable('usage_metrics', {
  userId: uuid('user_id').notNull(),
  sessionDate: date('session_date').notNull(),
  totalCostUsd: real('total_cost_usd').notNull().default(0),
  totalInputTokens: integer('total_input_tokens').notNull().default(0),
  totalOutputTokens: integer('total_output_tokens').notNull().default(0),
  tasksCompleted: integer('tasks_completed').notNull().default(0),
  tasksFailed: integer('tasks_failed').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.sessionDate] }),
}))

// ── Unified Sessions (new unified session store) ─────────────────────
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull(), // 'project-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation'
  status: text('status').notNull().default('active'), // 'active' | 'streaming' | 'completed' | 'error' | 'cancelled'
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  nodeId: text('node_id'),
  providerSessionId: text('provider_session_id'),
  providerId: text('provider_id'),
  model: text('model'),
  messages: jsonb('messages').$type<Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
    appliedMutations?: unknown
  }>>().notNull().default([]),
  activityEvents: jsonb('activity_events').default([]),
  toolTraces: jsonb('tool_traces').default([]),
  fileChanges: jsonb('file_changes').default([]),
  streamText: text('stream_text').default(''),
  summary: jsonb('summary'),
  metrics: jsonb('metrics'),
  steerMessages: jsonb('steer_messages').default([]),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  userIdIdx: index('idx_sessions_user_id').on(table.userId),
  projectIdIdx: index('idx_sessions_project_id').on(table.projectId),
  nodeIdIdx: index('idx_sessions_node_id').on(table.nodeId),
  typeIdx: index('idx_sessions_type').on(table.type),
}))

// ── Task Chat Sessions (legacy, will be migrated to sessions) ─────────
export const taskChatSessions = pgTable('task_chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: text('node_id').notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  sessionId: text('session_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_task_chat_sessions_user_id').on(table.userId),
  projectIdIdx: index('idx_task_chat_sessions_project_id').on(table.projectId),
  nodeIdIdx: index('idx_task_chat_sessions_node_id').on(table.nodeId),
}))

// ── Task Chat Messages ────────────────────────────────────────────────
export const taskChatMessages = pgTable('task_chat_messages', {
  id: text('id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => taskChatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index('idx_task_chat_messages_session_id').on(table.sessionId),
}))

// ── Push Tokens ──────────────────────────────────────────────────────
// Note: This table may be in a later migration (0003_push_tokens.sql)
export const pushTokens = pgTable('push_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  deviceToken: text('device_token').notNull(),
  platform: text('platform').notNull().default('ios'),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_push_tokens_user_id').on(table.userId),
}))

// ── Machine Instructions ─────────────────────────────────────────────
// Shared pool of markdown instruction documents that tell AI agents how
// to run computation jobs on specific environments (K8s, Slurm, etc.).
// Instructions are not pinned to a single machine — any machine can
// reference any instruction via registeredMachines.defaultInstructionId.
export const machineInstructions = pgTable('machine_instructions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  content: text('content').notNull().default(''),
  tags: text('tags').array().notNull().default([]),
  source: text('source').notNull().default('user'), // 'user' | 'auto' (auto-generated from defaults)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('machine_instructions_owner_id_idx').on(table.ownerId),
  index('machine_instructions_team_id_idx').on(table.teamId),
])

// ── Registered Machines ──────────────────────────────────────────────
export const registeredMachines = pgTable('registered_machines', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  hostname: text('hostname').notNull(),
  platform: text('platform').notNull(),
  environmentType: text('environment_type').notNull().default('local'),
  providers: text('providers').array().notNull().default([]),
  providerConfigs: jsonb('provider_configs').$type<Array<{
    provider: string
    apiKey?: string
    defaultModel?: string
    enabled: boolean
    settings?: Record<string, unknown>
  }>>().default([]),
  workspaceId: text('workspace_id'),
  defaultInstructionId: uuid('default_instruction_id'),
  isConnected: boolean('is_connected').notNull().default(false),
  isRevoked: boolean('is_revoked').notNull().default(false),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  metadata: jsonb('metadata').$type<Record<string, string>>(),
  dispatchPublicKey: jsonb('dispatch_public_key'),
  registeredAt: timestamp('registered_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_registered_machines_user_id').on(table.userId),
  teamIdIdx: index('idx_registered_machines_team_id').on(table.teamId),
}))

// ── Project Members ──────────────────────────────────────────────────
export const projectMembers = pgTable('project_members', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull().default('viewer'), // 'owner' | 'editor' | 'viewer'
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.userId] }),
}))

// ── Task Executions ──────────────────────────────────────────────────
export const taskExecutions = pgTable('task_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionId: text('execution_id').notNull().unique(),
  nodeClientId: text('node_client_id').notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'success' | 'failure' | 'cancelled'
  streamText: text('stream_text').notNull().default(''),
  error: text('error'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  sessionId: text('session_id'),
  machineId: text('machine_id'),
  providerId: text('provider_id'),
  providerName: text('provider_name'),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  tokensUsed: integer('tokens_used'),
  estimatedCostUsd: real('estimated_cost_usd'),
  model: text('model'),
  turnsUsed: integer('turns_used'),
  markdownSummary: text('markdown_summary'),
  summary: jsonb('summary'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idx_executions_project: index('idx_executions_project').on(table.projectId),
  idx_executions_node: index('idx_executions_node').on(table.nodeClientId),
}))

// ── Tool Traces ──────────────────────────────────────────────────────
export const toolTraces = pgTable('tool_traces', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionId: text('execution_id').notNull(),
  toolName: text('tool_name').notNull(),
  toolInput: jsonb('tool_input'),
  toolResult: jsonb('tool_result'),
  success: boolean('success'),
  duration: integer('duration'),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
}, (table) => ({
  idx_tool_traces_execution: index('idx_tool_traces_execution').on(table.executionId),
}))

// ── File Changes ──────────────────────────────────────────────────────
export const fileChanges = pgTable('file_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionId: text('execution_id').notNull(),
  path: text('path').notNull(),
  action: text('action').notNull(), // 'create' | 'modify' | 'delete'
  linesAdded: integer('lines_added'),
  linesRemoved: integer('lines_removed'),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
}, (table) => ({
  idx_file_changes_execution: index('idx_file_changes_execution').on(table.executionId),
}))

// ── Refresh Tokens ────────────────────────────────────────────────────
export const refreshTokens = pgTable('refresh_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  machineId: text('machine_id').notNull().references(() => registeredMachines.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  workspaceId: text('workspace_id'),
  scopes: text('scopes').array().notNull().default([]),
  isRevoked: boolean('is_revoked').notNull().default(false),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  machineIdIdx: index('idx_refresh_tokens_machine_id').on(table.machineId),
  userIdIdx: index('idx_refresh_tokens_user_id').on(table.userId),
}))

// ── Passkey Credentials ──────────────────────────────────────────────
export const passkeyCredentials = pgTable('passkey_credentials', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  publicKey: text('public_key').notNull(), // Changed from bytea to text (base64)
  counter: integer('counter').notNull().default(0),
  transports: text('transports').array(),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
}, (table) => ({
  userIdIdx: index('idx_passkey_credentials_user_id').on(table.userId),
}))

// ── Observation Events ───────────────────────────────────────────────
export const observationEvents = pgTable('observation_events', {
  id: text('id').primaryKey(),
  traceId: text('trace_id').notNull(),
  parentObservationId: text('parent_observation_id'),
  type: text('type').notNull(),
  name: text('name').notNull(),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  input: jsonb('input'),
  output: jsonb('output'),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  estimatedCostUsd: real('estimated_cost_usd'),
  level: text('level').notNull().default('default'),
  metadata: jsonb('metadata'),
  projectId: uuid('project_id'),
  nodeId: text('node_id'),
  statusMessage: text('status_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  traceIdIdx: index('idx_observation_events_trace_id').on(table.traceId),
  projectIdIdx: index('idx_observation_events_project_id').on(table.projectId),
}))

// ── Audit Logs ────────────────────────────────────────────────────────
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  action: text('action').notNull(), // e.g. 'account.create', 'api_key.create', 'machine.register'
  resourceType: text('resource_type').notNull(), // e.g. 'account', 'api_key', 'machine', 'project'
  resourceId: text('resource_id'), // ID of the affected resource
  details: jsonb('details').$type<Record<string, unknown>>().default({}), // Additional context (non-sensitive)
  ipAddress: text('ip_address'), // Source IP address
  userAgent: text('user_agent'), // User agent string
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_audit_logs_user_id').on(table.userId),
  actionIdx: index('idx_audit_logs_action').on(table.action),
  resourceTypeIdx: index('idx_audit_logs_resource_type').on(table.resourceType),
  createdAtIdx: index('idx_audit_logs_created_at').on(table.createdAt),
}))

// ── Activity Events ─────────────────────────────────────────────────
export const activityEvents = pgTable('activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  nodeId: text('node_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index('idx_activity_events_project_id').on(table.projectId),
  userIdIdx: index('idx_activity_events_user_id').on(table.userId),
  typeIdx: index('idx_activity_events_type').on(table.type),
}))

// ── Connected Accounts ──────────────────────────────────────────────
export const connectedAccounts = pgTable('connected_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  channel: text('channel').notNull(),
  label: text('label').notNull().default(''),
  credentials: jsonb('credentials').$type<Record<string, unknown>>().notNull(),
  mappings: jsonb('mappings').$type<Record<string, string>>().notNull().default({}),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  externalId: text('external_id'),
  enabled: boolean('enabled').notNull().default(true),
  connectedAt: timestamp('connected_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_connected_accounts_user_id').on(table.userId),
}))

// ── WebAuthn Challenges ─────────────────────────────────────────
// Stores short-lived WebAuthn challenges for cross-instance verification.
// Fixes production auth bug: challenges created on Machine A are now
// visible to Machine B during verification.
export const webauthnChallenges = pgTable('webauthn_challenges', {
  key: text('key').primaryKey(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ── Device Codes ────────────────────────────────────────────────
// OAuth2 device authorization codes (RFC 8628).
// Previously in-memory — now persistent for multi-instance support.
export const deviceCodes = pgTable('device_codes', {
  userCode: text('user_code').primaryKey(),
  deviceCode: text('device_code').notNull().unique(),
  scopes: text('scopes').array().notNull().default([]),
  machineInfo: jsonb('machine_info'),
  status: text('status').notNull().default('pending'), // 'pending' | 'authorized' | 'denied' | 'expired' | 'used'
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  authorizedBy: text('authorized_by'),
  authorizedAt: timestamp('authorized_at'),
  lastPolledAt: timestamp('last_polled_at'),
  dispatchPublicKey: jsonb('dispatch_public_key'),
})

// ── Chat Sessions ───────────────────────────────────────────────
// Server-side SDK session pool for hybrid resume/fallback.
// Previously in-memory TTL map — now persistent for multi-instance support.
export const chatSessions = pgTable('chat_sessions', {
  key: text('key').primaryKey(),
  sdkSessionId: text('sdk_session_id').notNull(),
  providerId: text('provider_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
})

// ── Shared Bundles ──────────────────────────────────────────────
// Stores shared plan export bundles for the /api/share endpoints.
// Previously in-memory Map — now persistent.
export const sharedBundles = pgTable('shared_bundles', {
  id: uuid('id').primaryKey().defaultRandom(),
  bundle: jsonb('bundle').notNull(),
  downloads: integer('downloads').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ── Dispatch Queue Entries ──────────────────────────────────────
// Persisted dispatch queue for multi-instance consistency.
// Previously a complex multi-Map in-memory structure.
export const dispatchQueueEntries = pgTable('dispatch_queue_entries', {
  id: text('id').primaryKey(),
  nodeId: text('node_id').notNull(),
  projectId: uuid('project_id').notNull(),
  status: text('status').notNull().default('ready'), // DispatchStatus
  priority: text('priority').notNull().default('normal'), // DispatchPriority
  environment: text('environment').notNull().default('local'),
  preferredProvider: text('preferred_provider'),
  targetMachineId: text('target_machine_id'),
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(2),
  executionId: text('execution_id'),
  sessionId: text('session_id'),
  lastDispatchAttempt: timestamp('last_dispatch_attempt'),
  lastError: text('last_error'),
  procedureState: jsonb('procedure_state'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index('idx_dispatch_queue_project_id').on(table.projectId),
  statusIdx: index('idx_dispatch_queue_status').on(table.status),
  nodeIdIdx: index('idx_dispatch_queue_node_id').on(table.nodeId),
}))

// ── Machine Usage Logs ───────────────────────────────────────────
export const machineUsageLogs = pgTable('machine_usage_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: text('machine_id').notNull().references(() => registeredMachines.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  executionId: text('execution_id').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
  status: text('status').notNull(), // 'success' | 'failure' | 'cancelled'
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  machineIdIdx: index('idx_machine_usage_logs_machine_id').on(table.machineId),
  userIdIdx: index('idx_machine_usage_logs_user_id').on(table.userId),
  projectIdIdx: index('idx_machine_usage_logs_project_id').on(table.projectId),
}))

// ── Blobs (image/file storage) ──────────────────────────────────
export const blobs = pgTable('blobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  teamId: uuid('team_id'),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  data: text('data').notNull(), // base64-encoded
  filename: text('filename').notNull(),
  nodeId: text('node_id'),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  ownerIdIdx: index('idx_blobs_owner_id').on(table.ownerId),
  projectIdIdx: index('idx_blobs_project_id').on(table.projectId),
}))

// ── Node Comments ───────────────────────────────────────────────
export const nodeComments = pgTable('node_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: text('node_id').notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull(),
  authorName: text('author_name').notNull(),
  authorType: text('author_type').notNull().default('user'), // 'user' | 'agent'
  content: text('content').notNull(),
  parentCommentId: uuid('parent_comment_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  nodeIdIdx: index('idx_node_comments_node_id').on(table.nodeId),
  projectIdIdx: index('idx_node_comments_project_id').on(table.projectId),
}))

// ── Environment Configs ─────────────────────────────────────────
// Custom context overlays for HPC/SSH/Docker environments.
// Users can provide SSH details, module loads, sbatch templates, etc.
// ── GitHub Connections ──────────────────────────────────────────
// Persisted GitHub OAuth connections and repo selections.
export const githubConnections = pgTable('github_connections', {
  userId: uuid('user_id').primaryKey(),
  accessToken: text('access_token').notNull(),
  scope: text('scope').notNull().default(''),
  connectedAt: timestamp('connected_at').notNull().defaultNow(),
  ghUserId: integer('gh_user_id'),
  ghLogin: text('gh_login'),
  ghName: text('gh_name'),
  ghEmail: text('gh_email'),
  ghAvatarUrl: text('gh_avatar_url'),
  selectedRepoIds: jsonb('selected_repo_ids').$type<number[]>().notNull().default([]),
  repos: jsonb('repos').$type<unknown[]>().notNull().default([]),
  lastSyncedAt: timestamp('last_synced_at'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ── GitHub App Installations ─────────────────────────────────────
// GitHub App installation records, linked to users and optionally teams.
// Supports team-level access grants with per-installation repo selection.
export const githubAppInstallations = pgTable('github_app_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationId: integer('installation_id').notNull().unique(),
  userId: uuid('user_id').notNull(),         // who installed / linked it
  teamId: uuid('team_id'),                   // optional team link
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull().default('Organization'), // 'Organization' | 'User'
  accountAvatarUrl: text('account_avatar_url'),
  appId: integer('app_id'),
  repositorySelection: text('repository_selection').notNull().default('all'), // 'all' | 'selected'
  repos: jsonb('repos').$type<{ id: number; name: string; full_name: string; private: boolean }[]>().notNull().default([]),
  permissions: jsonb('permissions').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_github_app_installations_user_id').on(table.userId),
  teamIdIdx: index('idx_github_app_installations_team_id').on(table.teamId),
}))

// ── Encrypted API Keys ──────────────────────────────────────────
// Client-side encrypted API keys for external services (Web Crypto API).
export const encryptedApiKeys = pgTable('encrypted_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  serviceName: text('service_name').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  iv: text('iv').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_encrypted_api_keys_user_id').on(table.userId),
}))

// ── Environment Configs ─────────────────────────────────────────
// Custom context overlays for HPC/SSH/Docker environments.
// Users can provide SSH details, module loads, sbatch templates, etc.
export const environmentConfigs = pgTable('environment_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  teamId: uuid('team_id'),
  machineId: text('machine_id'),       // null = local server backends
  backendId: text('backend_id').notNull(), // 'slurm', 'docker', 'ssh:alias'
  customContext: text('custom_context').notNull().default(''),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ── Streaming Events ─────────────────────────────────────────────
// Append-only log of streaming events for SSE catch-up on reconnection.
// Structural events (tool_use, tool_result, file_change, etc.) are persisted
// immediately; text is accumulated per-turn and flushed at tool boundaries.
export const streamingEvents = pgTable('streaming_events', {
  seq: integer('seq').primaryKey().generatedAlwaysAsIdentity(),
  executionId: text('execution_id').notNull(),
  eventType: text('event_type').notNull(), // 'text' | 'tool_use' | 'tool_result' | 'file_change' | 'session_init' | 'progress' | 'result'
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idx_streaming_events_exec_seq: index('idx_streaming_events_exec_seq').on(table.executionId, table.seq),
}))

// ── Skills ───────────────────────────────────────────────────────
// Reusable skill definitions that can be assigned to tasks/agents.
// Skills define instructions, tools, and configurations for specific capabilities.
export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  version: text('version').notNull().default('1.0.0'),
  description: text('description').notNull().default(''),
  instructions: text('instructions').notNull().default(''),
  category: text('category'), // e.g. 'coding', 'research', 'analysis'
  tags: text('tags').array().notNull().default([]),
  source: text('source'), // 'builtin' | 'user' | 'marketplace'
  sourceUrl: text('source_url'),
  authorId: uuid('author_id').references(() => userProfiles.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  allowedTools: text('allowed_tools').array().notNull().default([]),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('skills_name_team_id_unique').on(table.name, table.teamId),
  check('skills_source_check', sql`${table.source} IN ('builtin', 'workspace', 'clawhub', 'plugin', 'user', 'catalog')`),
  index('skills_team_id_idx').on(table.teamId),
  index('skills_author_id_idx').on(table.authorId),
  index('skills_category_idx').on(table.category),
  index('skills_enabled_idx').on(table.enabled),
  index('skills_team_enabled_idx').on(table.teamId, table.enabled),
  index('skills_name_source_idx').on(table.name, table.source),
  // Partial unique index — PGlite-compatible (PGlite supports WHERE clauses on unique indexes)
  uniqueIndex('skills_builtin_name_unique').on(table.name).where(sql`${table.source} = 'builtin'`),
  check('skills_builtin_null_ownership', sql`${table.source} != 'builtin' OR (${table.teamId} IS NULL AND ${table.authorId} IS NULL)`),
  // Catalog skills must also have null ownership (global, not team-scoped)
  check('skills_catalog_null_ownership', sql`${table.source} != 'catalog' OR (${table.teamId} IS NULL AND ${table.authorId} IS NULL)`),
  // Partial unique index for catalog skills (unique name per catalog source)
  uniqueIndex('skills_catalog_name_unique').on(table.name).where(sql`${table.source} = 'catalog'`),
])

// ── Community Marketplace: Shared Plans ──────────────────────────
// User-published plans that can be shared, starred, forked, and commented on.
// See docs/planning/08-COMMUNITY-MARKETPLACE.md for full specification.
export const sharedPlans = pgTable('shared_plans', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Identity
  title: text('title').notNull(),
  description: text('description'),
  authorId: uuid('author_id').references(() => userProfiles.id, { onDelete: 'set null' }),
  authorName: text('author_name'),
  isAnonymous: boolean('is_anonymous').notNull().default(false),

  // Content (the actual plan)
  visionDoc: text('vision_doc'),
  planData: jsonb('plan_data').$type<{
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }>().notNull(),
  templateId: text('template_id'),
  templateParameters: jsonb('template_parameters'),

  // Customization guide
  customizationNotes: text('customization_notes'),
  customizableFields: jsonb('customizable_fields').$type<Array<{
    nodeId: string
    field: string
    description: string
  }>>(),

  // Execution evidence
  executionSummary: jsonb('execution_summary').$type<{
    totalTasks?: number
    completed?: number
    failed?: number
    totalCost?: number
    totalTokens?: number
  }>(),
  executionResults: text('execution_results'),

  // Metadata
  category: text('category'),
  tags: text('tags').array().notNull().default([]),
  version: integer('version').notNull().default(1),

  // Community metrics
  starsCount: integer('stars_count').notNull().default(0),
  forksCount: integer('forks_count').notNull().default(0),
  commentsCount: integer('comments_count').notNull().default(0),

  // Visibility & curation
  visibility: text('visibility').notNull().default('public'), // 'public' | 'team' | 'unlisted'
  featured: boolean('featured').notNull().default(false),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),

  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('shared_plans_category_idx').on(table.category),
  index('shared_plans_stars_count_idx').on(table.starsCount.desc()),
  index('shared_plans_created_at_idx').on(table.createdAt.desc()),
  index('shared_plans_author_id_idx').on(table.authorId),
  index('shared_plans_featured_idx').on(table.featured),
])

// ── Shared Plan Stars ─────────────────────────────────────────────
// User stars (upvotes) for shared plans.
export const sharedPlanStars = pgTable('shared_plan_stars', {
  userId: uuid('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => sharedPlans.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.planId] }),
}))

// ── Shared Plan Forks ─────────────────────────────────────────────
// Tracks when users fork (copy) shared plans to their local projects.
export const sharedPlanForks = pgTable('shared_plan_forks', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourcePlanId: uuid('source_plan_id').notNull().references(() => sharedPlans.id, { onDelete: 'cascade' }),
  forkedBy: uuid('forked_by').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ── Project Knowledge ────────────────────────────────────────────
// Key-value knowledge entries extracted during task execution.
// Supports upsert semantics via unique(project_id, key).
export const projectKnowledge = pgTable('project_knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  key: text('key').notNull(), // semantic key like 'db_schema', 'api_endpoints'
  value: text('value').notNull(), // the knowledge content
  sourceNodeId: text('source_node_id'), // which task wrote this
  sourceTaskTitle: text('source_task_title'),
  milestoneId: text('milestone_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('project_knowledge_project_id_key_unique').on(table.projectId, table.key),
  index('project_knowledge_project_id_idx').on(table.projectId),
])

// ── Shared Plan Comments ──────────────────────────────────────────
// Comments and replies on shared plans.
export const sharedPlanComments = pgTable('shared_plan_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => sharedPlans.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => userProfiles.id, { onDelete: 'set null' }),
  authorName: text('author_name').notNull(),
  content: text('content').notNull(),
  parentCommentId: uuid('parent_comment_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('shared_plan_comments_plan_id_idx').on(table.planId),
])

// ── User Achievements ────────────────────────────────────────────
// Tracks earned achievements with timestamps for the gamification system.
export const userAchievements = pgTable('user_achievements', {
  userId: uuid('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').notNull().default({}),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.slug] }),
}))

// ── Schedules ────────────────────────────────────────────────────
// Cron schedule definitions for recurring task/project execution.
// The server polls `next_run_at <= NOW()` every 60s to fire due schedules.
export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),              // 'project' | 'node'
  nodeId: text('node_id'),                     // required when scope='node'
  name: text('name').notNull(),
  cronExpression: text('cron_expression').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  targetMachineId: text('target_machine_id').notNull(),
  nodeFilter: text('node_filter').array(),     // project scope: subset of node IDs
  enabled: boolean('enabled').notNull().default(true),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  activeHoursStart: text('active_hours_start'),
  activeHoursEnd: text('active_hours_end'),
  maxConcurrency: integer('max_concurrency').notNull().default(1),
  missedRunPolicy: text('missed_run_policy').notNull().default('skip'), // 'skip' | 'retry_on_reconnect'
  retryTtlMinutes: integer('retry_ttl_minutes').notNull().default(60),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('schedules_project_id_idx').on(table.projectId),
  index('schedules_next_run_enabled_idx').on(table.nextRunAt).where(sql`enabled = true`),
  check('schedules_scope_check', sql`${table.scope} IN ('project', 'node')`),
  check('schedules_missed_run_policy_check', sql`${table.missedRunPolicy} IN ('skip', 'retry_on_reconnect')`),
])

// ── Schedule Runs ────────────────────────────────────────────────
// Execution history per cron fire.
export const scheduleRuns = pgTable('schedule_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  runNumber: integer('run_number').notNull(),
  status: text('status').notNull().default('pending'), // pending|dispatched|running|success|failure|missed
  branchName: text('branch_name'),
  executionIds: text('execution_ids').array().default([]),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  summary: jsonb('summary'),
  errorMessage: text('error_message'),
  retryUntil: timestamp('retry_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('schedule_runs_schedule_id_idx').on(table.scheduleId),
  unique('schedule_runs_schedule_id_run_number_unique').on(table.scheduleId, table.runNumber),
  check('schedule_runs_status_check', sql`${table.status} IN ('pending', 'dispatched', 'running', 'success', 'failure', 'missed')`),
])

// ── GitHub Sync Log ──────────────────────────────────────────────
// Audit log for all GitHub sync operations (both directions).
// Used by the sync health dashboard for monitoring and retry.
export const githubSyncLog = pgTable('github_sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  nodeId: text('node_id'),                // clientId of the plan node (nullable for project-level ops)
  direction: text('direction').notNull(),  // 'github_to_astro' | 'astro_to_github'
  action: text('action').notNull(),        // 'create' | 'update' | 'close' | 'reopen' | 'comment' | 'label' | 'assign'
  status: text('status').notNull(),        // 'success' | 'error'
  errorMessage: text('error_message'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(), // extra context (issue number, field names, etc.)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('github_sync_log_project_id_idx').on(table.projectId),
  index('github_sync_log_created_at_idx').on(table.createdAt),
])
