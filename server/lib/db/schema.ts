import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ── Projects ──────────────────────────────────────────────────────────
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().default('dev-user'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  visionDoc: text('vision_doc').notNull().default(''),
  status: text('status').notNull().default('active'), // 'active' | 'archived'
  startDate: text('start_date'),
  targetDate: text('target_date'),
  lead: text('lead'),
  health: text('health'), // 'on_track' | 'at_risk' | 'off_track'
  initiative: text('initiative'),
  progress: integer('progress').default(0),
  labels: text('labels', { mode: 'json' }).$type<{ id: string; name: string; color: string }[]>().default([]),
  workingDirectory: text('working_directory'),
  repository: text('repository'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Plan Nodes ────────────────────────────────────────────────────────
export const planNodes = sqliteTable('plan_nodes', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'milestone' | 'task' | 'branch' | 'decision'
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('planned'),
  parentId: text('parent_id'),
  dependencies: text('dependencies', { mode: 'json' }).$type<string[]>().default([]),
  environment: text('environment'), // 'local' | 'remote' | 'hpc' | 'cloud'
  verification: text('verification').notNull().default('auto'),
  position: text('position', { mode: 'json' }).$type<{ x: number; y: number }>().notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  priority: text('priority'),
  labelIds: text('label_ids', { mode: 'json' }).$type<string[]>(),
  dueDate: text('due_date'),
  estimate: text('estimate'),
  milestoneId: text('milestone_id'),
  boardOrder: integer('board_order'),
  executionId: text('execution_id'),
  executionOutput: text('execution_output'),
  executionError: text('execution_error'),
  executionStartedAt: integer('execution_started_at', { mode: 'timestamp_ms' }),
  executionCompletedAt: integer('execution_completed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Plan Edges ────────────────────────────────────────────────────────
export const planEdges = sqliteTable('plan_edges', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  target: text('target').notNull(),
  type: text('type').notNull().default('dependency'), // 'dependency' | 'branch'
})

// ── User Profiles ─────────────────────────────────────────────────────
export const userProfiles = sqliteTable('user_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().default(''),
  avatarUrl: text('avatar_url'),
  bio: text('bio').default(''),
  domains: text('domains', { mode: 'json' }).$type<string[]>().default([]),
  experienceLevel: text('experience_level').notNull().default('intermediate'),
  preferredEnvironments: text('preferred_environments', { mode: 'json' }).$type<string[]>().default(['local']),
  notificationsEnabled: integer('notifications_enabled', { mode: 'boolean' }).notNull().default(true),
  emailNotifications: integer('email_notifications', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── API Keys ──────────────────────────────────────────────────────────
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  maskedKey: text('masked_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Display Settings ──────────────────────────────────────────────────
export const displaySettings = sqliteTable('display_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  viewKey: text('view_key').notNull(),
  settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
})

// ── Usage Metrics ─────────────────────────────────────────────────────
export const usageMetrics = sqliteTable('usage_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  sessionDate: text('session_date').notNull(), // YYYY-MM-DD
  totalCostUsd: real('total_cost_usd').notNull().default(0),
  totalInputTokens: integer('total_input_tokens').notNull().default(0),
  totalOutputTokens: integer('total_output_tokens').notNull().default(0),
  tasksCompleted: integer('tasks_completed').notNull().default(0),
  tasksFailed: integer('tasks_failed').notNull().default(0),
})

// ── Task Chat Sessions ────────────────────────────────────────────────
export const taskChatSessions = sqliteTable('task_chat_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nodeId: text('node_id').notNull(),
  userId: text('user_id').notNull(),
  projectId: text('project_id').notNull(),
  sessionId: text('session_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Task Chat Messages ────────────────────────────────────────────────
export const taskChatMessages = sqliteTable('task_chat_messages', {
  id: text('id').primaryKey(),
  sessionNodeId: text('session_node_id').notNull(),
  sessionUserId: text('session_user_id').notNull(),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
})

// ── App Settings ──────────────────────────────────────────────────────
export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
})
