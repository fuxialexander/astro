import { pgTable, text, integer, real, uuid, timestamp, boolean, date, jsonb, primaryKey } from 'drizzle-orm/pg-core'

// ── Projects ──────────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  visionDoc: text('vision_doc').notNull().default(''),
  status: text('status').notNull().default('active'), // 'active' | 'archived'
  startDate: date('start_date'),
  targetDate: date('target_date'),
  lead: text('lead'),
  health: text('health'), // 'on_track' | 'at_risk' | 'off_track'
  initiativeId: uuid('initiative_id'),
  progress: integer('progress').default(0),
  labels: jsonb('labels').$type<{ id: string; name: string; color: string }[]>().notNull().default([]),
  color: text('color').default('#3b82f6'),
  icon: text('icon').default('📋'),
  workingDirectory: text('working_directory'),
  repository: text('repository'),
  defaultEnvironment: text('default_environment'),
  defaultMachineId: text('default_machine_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ── Plan Nodes ────────────────────────────────────────────────────────
export const planNodes = pgTable('plan_nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(), // Preserve client-generated IDs for compatibility
  type: text('type').notNull(), // 'milestone' | 'task' | 'branch' | 'decision'
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('planned'),
  parentId: text('parent_id'),
  environment: text('environment'), // 'local' | 'hpc' | 'cloud'
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
  branchName: text('branch_name'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  deletedAt: timestamp('deleted_at'),
  deletionActionId: text('deletion_action_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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
})

// ── User Profiles ─────────────────────────────────────────────────────
export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().default(''),
  avatarUrl: text('avatar_url'),
  bio: text('bio').default(''),
  domains: text('domains').array().notNull().default([]),
  experienceLevel: text('experience_level').notNull().default('intermediate'),
  preferredEnvironments: text('preferred_environments').array().notNull().default(['local']),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  emailNotifications: boolean('email_notifications').notNull().default(false),
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
  type: text('type').notNull(), // 'plan-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation'
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
})

// ── Task Chat Sessions (legacy, will be migrated to sessions) ─────────
export const taskChatSessions = pgTable('task_chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: text('node_id').notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  sessionId: text('session_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ── Task Chat Messages ────────────────────────────────────────────────
export const taskChatMessages = pgTable('task_chat_messages', {
  id: text('id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => taskChatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

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
})

// ── Registered Machines ──────────────────────────────────────────────
export const registeredMachines = pgTable('registered_machines', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  hostname: text('hostname').notNull(),
  platform: text('platform').notNull(),
  environmentType: text('environment_type').notNull().default('local'),
  providers: text('providers').array().notNull().default([]),
  workspaceId: text('workspace_id'),
  isConnected: boolean('is_connected').notNull().default(false),
  isRevoked: boolean('is_revoked').notNull().default(false),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  metadata: jsonb('metadata').$type<Record<string, string>>(),
  registeredAt: timestamp('registered_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
})

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
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

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
})

// ── File Changes ──────────────────────────────────────────────────────
export const fileChanges = pgTable('file_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionId: text('execution_id').notNull(),
  path: text('path').notNull(),
  action: text('action').notNull(), // 'create' | 'modify' | 'delete'
  linesAdded: integer('lines_added'),
  linesRemoved: integer('lines_removed'),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
})

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
})

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
})

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
  projectId: uuid('project_id').notNull(),
  nodeId: text('node_id'),
  statusMessage: text('status_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

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
})

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
})

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
})
