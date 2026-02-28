/**
 * @astro/core — Shared type definitions
 *
 * Pure TypeScript types with no React or DOM dependencies.
 * UI-specific types (CommandItem, etc.) remain in src/types/ui-types.ts.
 */

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type Estimate = 'XS' | 'S' | 'M' | 'L' | 'XL';

// Session types for unified chat/execution system
export type SessionType = 'plan-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation';
export type SessionStatus = 'active' | 'streaming' | 'completed' | 'error' | 'cancelled';

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  appliedMutations?: {
    nodeUpdates: Array<{ nodeId: string; [key: string]: unknown }>;
    edgeOps: Array<{ action: 'add' | 'remove'; source: string; target: string; type?: string }>;
    newNodes: Array<{ id?: string; title: string; description: string; type?: string; milestoneId?: string; dependencies?: string[]; priority?: string; estimate?: string; verification?: string }>;
  };
}

export interface ExecutionSummary {
  workCompleted: string;
  /** 1-2 paragraph executive summary: what was done, why, approach taken, and key decisions */
  executiveSummary?: string;
  keyFindings: string[];
  filesChanged: string[];
  status: 'success' | 'partial' | 'failure';
  followUps: string[];
}

export interface SteerMessage {
  message: string;
  accepted?: boolean;
  ackMessage?: string;
  interrupted?: boolean;
  timestamp: Date;
}

export interface Session {
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

export interface Label {
  id: string;
  name: string;
  color: string;  // hex color
}

export interface Initiative {
  id: string;
  name: string;
  description: string;
  goal?: string;
  status: 'active' | 'on_hold' | 'completed' | 'cancelled';
  startDate?: string;     // ISO YYYY-MM-DD
  targetDate?: string;    // ISO YYYY-MM-DD
  lead?: string;
  color?: string;         // hex color for visual grouping
  icon?: string;          // emoji icon
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

export type RemoteType = 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none'
export type DeliveryMode = 'pr' | 'push' | 'branch' | 'copy' | 'direct'
export type WorktreeStrategy = 'copy' | 'reference' | 'direct'

export interface ProjectSource {
  localPath: string
  subdirectory?: string
  remoteUrl?: string
  remoteType: RemoteType
  baseBranch: string
  isGit: boolean
}

export interface Project {
  id: string;
  number?: number;
  name: string;
  description: string;
  visionDoc: string;
  status: 'active' | 'archived';
  startDate?: string;
  targetDate?: string;
  lead?: string;
  health?: 'on_track' | 'at_risk' | 'off_track';
  initiativeId?: string;
  teamId?: string;
  progress?: number;
  labels?: Label[];
  color?: string;
  icon?: string;
  workingDirectory?: string;
  sourceDirectory?: string;
  repository?: string;
  resourcePaths?: string[];
  fileTree?: string[];
  fileTreeUpdatedAt?: string;
  fileTreeMachineId?: string;
  defaultMachineId?: string
  mergeQueueEnabled?: boolean
  mergeQueueMergeMethod?: 'merge' | 'squash' | 'rebase'
  source?: ProjectSource
  deliveryMode?: DeliveryMode
  agentDir?: string
  worktreeStrategy?: WorktreeStrategy
  projectType?: 'default' | 'playground' | 'github' | 'plan'
  githubOwner?: string
  githubRepo?: string
  githubRepoId?: number
  createdAt: Date;
  updatedAt: Date;
}

// Attachment for tasks (images, files, etc.)
export interface TaskAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  thumbnailUrl?: string;
}

// Link to external resources (GitHub issues, PRs, etc.)
export interface TaskLink {
  id: string;
  type: 'github_issue' | 'github_pr' | 'linear_issue' | 'task' | 'url';
  url: string;
  title: string;
  state?: 'open' | 'closed' | 'merged';
  number?: number;
  targetId?: string; // For internal task links
}

export interface AcceptanceCriterion {
  id: string
  type: 'test' | 'build' | 'lint' | 'command' | 'manual'
  description: string
  command?: string
  autoVerifiable: boolean
}

export interface PlanNode {
  id: string;
  number?: number;
  projectId: string;
  type: 'milestone' | 'task' | 'branch' | 'decision';
  title: string;
  description: string;
  status: 'planned' | 'dispatched' | 'in_progress' | 'auto_verified' | 'awaiting_judgment' | 'awaiting_approval' | 'completed' | 'pruned';
  parentId: string | null;
  dependencies: string[];
  machineId?: string;
  verification: 'auto' | 'human';
  position: { x: number; y: number };
  startDate?: string;
  endDate?: string;
  priority?: Priority;
  labelIds?: string[];
  dueDate?: string;
  estimate?: Estimate;
  milestoneId?: string;
  boardOrder?: number;
  createdAt: Date;
  updatedAt: Date;
  executionId?: string;
  executionOutput?: string;
  executionError?: string;
  executionStartedAt?: Date;
  executionCompletedAt?: Date;
  actualStartDate?: Date;
  actualEndDate?: Date;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  mergeQueueStatus?: 'queued' | 'testing' | 'merged' | 'failed';
  autoPr?: boolean;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
  deletedAt?: Date;
  deletionActionId?: string;
  metadata?: Record<string, unknown>;
  // Rich content fields
  content?: string; // Rich text content (HTML from TipTap)
  attachments?: TaskAttachment[];
  links?: TaskLink[];
  acceptanceCriteria?: AcceptanceCriterion[];
}

// Comment on a plan node
export interface NodeComment {
  id: string;
  nodeId: string;
  projectId: string;
  authorId: string;
  authorName: string;
  authorType: 'user' | 'agent';
  content: string;
  parentCommentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Tool trace for execution detail view
export interface ToolTrace {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown> | unknown;
  toolResult?: unknown;
  success?: boolean;
  duration?: number;
  timestamp: Date;
}

// File change for execution detail view
export interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  linesAdded?: number;
  linesRemoved?: number;
  diff?: string;
  timestamp: Date;
}

// Unified activity event for sequential timeline rendering
export type TaskActivityEvent =
  | { type: 'text'; content: string; timestamp: Date }
  | { type: 'tool_use'; id: string; toolName: string; toolInput: unknown; timestamp: Date }
  | { type: 'tool_result'; id: string; toolName: string; toolResult?: unknown; success?: boolean; duration?: number; timestamp: Date }
  | { type: 'steer'; message: string; accepted?: boolean; ackMessage?: string; interrupted?: boolean; timestamp: Date }
  | { type: 'chat_user'; message: string; timestamp: Date }
  | { type: 'chat_assistant'; content: string; timestamp: Date }
  | { type: 'file_change'; path: string; action: string; diff?: string; linesAdded?: number; linesRemoved?: number; timestamp: Date }
  | { type: 'error'; error: string; timestamp: Date }
  | { type: 'approval_request'; requestId: string; question: string; options: string[]; timestamp: Date }
  | { type: 'approval_response'; requestId: string; question: string; answer: string; autoApproved?: boolean; timestamp: Date }
  | { type: 'mutation'; nodeUpdates: Array<{ nodeId: string; [key: string]: unknown }>; edgeOps: Array<{ action: string; source: string; target: string; type?: string }>; newNodes: Array<{ title: string; description: string; type?: string; id?: string }>; timestamp: Date }

// Usage metrics from provider execution
export interface UsageMetrics {
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  tokensUsed?: number
  estimatedCostUsd?: number
  model?: string
  turnsUsed?: number
}

// Execution state for tracking active task execution
export interface TaskExecution {
  nodeId: string;
  projectId: string;
  executionId: string;
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  streamText: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  toolTraces: ToolTrace[];
  fileChanges: FileChange[];
  sessionId?: string;
  machineId?: string;
  providerId?: string;
  providerName?: string;
  metrics?: UsageMetrics;
  activityEvents: TaskActivityEvent[];
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  /** Delivery outcome — separate from execution status */
  deliveryStatus?: 'success' | 'failed' | 'skipped';
  /** Error message when deliveryStatus is 'failed' */
  deliveryError?: string;
  computeBackend?: string;
  summary?: ExecutionSummary;
  subroutineProgress?: {
    name: string;
    index: number;
    total: number;
    status: 'running' | 'completed' | 'failed';
  };
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

// Provider status for displaying in UI
export interface ProviderStatus {
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

export type EdgeType = 'dependency' | 'branch';

export interface PlanEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  deletedAt?: Date;
  deletionActionId?: string;
}

// Domain expertise options for planning personalization
export type DomainExpertise =
  | 'computational-biology'
  | 'web-development'
  | 'data-engineering'
  | 'ml-ai'
  | 'devops-infrastructure'
  | 'mobile-development'
  | 'systems-programming'
  | 'scientific-computing'
  | 'security'
  | 'other';

// Experience level for calibrating plan granularity
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

// API key entry for agent providers
export interface ApiKey {
  id: string;
  provider: string;
  name: string;
  maskedKey: string;
  createdAt: Date;
}

// Encrypted API key stored in database
export interface EncryptedApiKey {
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
export interface DecryptedApiKey {
  id: string;
  serviceName: string;
  plainKey: string;
  createdAt: Date;
  updatedAt: Date;
}

// User profile for identity and domain context
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  domains: DomainExpertise[];
  experienceLevel: ExperienceLevel;
  preferredMachines: string[];
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  defaultMachineId?: string;
  apiKeys: ApiKey[];
  sidebarConfig?: Array<{ id: string; to: string; icon: string; label: string; visible: boolean; protected: boolean; autoRevealed?: boolean; userDismissed?: boolean }>;
  createdAt: Date;
  updatedAt: Date;
}

// Command palette types (no React deps)
export type CommandCategory =
  | 'recent'
  | 'navigation'
  | 'actions'
  | 'projects'
  | 'tasks'
  | 'settings'
  | 'search'
  | 'plugins';

export interface CommandHistory {
  commandId: string;
  executedAt: Date;
  frequency: number;
}

export interface EnvironmentConfig {
  id: string;
  userId: string;
  teamId?: string;
  machineId?: string;
  backendId: string;
  customContext: string;
  displayName?: string;
  createdAt: Date;
  updatedAt: Date;
}
