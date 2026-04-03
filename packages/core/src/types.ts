/**
 * @astro/core — Shared type definitions
 *
 * Pure TypeScript types with no React or DOM dependencies.
 * UI-specific types (CommandItem, etc.) remain in src/types/ui-types.ts.
 */

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type Estimate = 'XS' | 'S' | 'M' | 'L' | 'XL';

// Session types for unified chat/execution system
export type SessionType = 'project-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation' | 'skill-create';
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

/**
 * Context from a previous plan execution used to inform replanning.
 * Contains lessons learned, per-task execution summaries, and the
 * user's description of what changed since the last run.
 */
export interface ReplanContext {
  /** High-level summary of the previous plan and its outcome */
  previousPlanSummary?: string;
  /** Per-task lessons from the prior execution */
  lessons: Array<{
    taskTitle: string;
    taskDescription: string;
    status: 'success' | 'partial' | 'failure' | 'not_executed';
    executionSummary?: string;
    followUps?: string[];
  }>;
  /** User-provided description of what changed or why replanning is needed */
  changeDescription?: string;
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
  // Lightweight fields from list endpoint (avoids loading full JSONB blobs)
  messageCount?: number;
  titlePreview?: string | null;
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
  teamId?: string;
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
  featureFlags: Record<string, boolean>;
  isPersonal?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
  user?: { name: string | null; email: string | null; avatarUrl: string | null };
}

// GitHub sync settings stored per-project
export type GitHubSyncDirection = 'github_to_astro' | 'astro_to_github' | 'bidirectional'

export interface GitHubSyncSettings {
  /** Whether auto-sync is enabled */
  enabled: boolean
  /** Sync direction */
  direction: GitHubSyncDirection
  /** Which fields to sync (title, description, status, priority, assignee, labels, estimate) */
  enabledFields: string[]
  /** Auto-create direction for new issues */
  autoCreateDirection: 'astro_to_github' | 'github_to_astro' | 'bidirectional' | 'none'
  /** Custom priority→label name mapping (overrides defaults) */
  labelMapping: Record<string, string>
  /** Auto-dispatch agents on GitHub events */
  automation?: {
    /** Auto-fix failing CI on PRs */
    fixCi?: boolean
    /** Auto-address review comments on PRs */
    addressReviews?: boolean
  }
}

export const DEFAULT_GITHUB_SYNC_SETTINGS: GitHubSyncSettings = {
  enabled: true,
  direction: 'bidirectional',
  enabledFields: ['title', 'status', 'priority', 'assignee', 'labels', 'estimate'],
  autoCreateDirection: 'github_to_astro',
  labelMapping: {},
}

export type RemoteType = 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none'
export type DeliveryMode = 'pr' | 'push' | 'branch' | 'copy' | 'direct'
export type WorktreeStrategy = 'copy' | 'reference' | 'direct'

export interface ProjectSource {
  localPath: string
  subdirectory?: string
  remoteUrl?: string
  remoteType: RemoteType
  baseBranch?: string
  isGit: boolean
}

/** A bibliographic reference (paper, article, book, etc.) stored per-project. */
export interface Reference {
  id: string
  title: string
  authors: string[]
  year: number
  venue?: string
  doi?: string
  url?: string
  abstract?: string
  entryType?: string
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  tags?: string[]
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
  teamId: string;
  progress?: number;
  labels?: Label[];
  color?: string;
  icon?: string;
  workingDirectory?: string;
  repository?: string;
  resourcePaths?: string[];
  fileTree?: string[];
  fileTreeUpdatedAt?: string;
  fileTreeMachineId?: string;
  defaultMachineId?: string
  computeBackends?: string[]
  mergeQueueEnabled?: boolean
  mergeQueueMergeMethod?: 'merge' | 'squash' | 'rebase'
  source?: ProjectSource
  deliveryMode?: DeliveryMode
  discoveryMode?: boolean
  references?: Reference[]
  agentDir?: string
  useWorktree?: boolean
  worktreeStrategy?: WorktreeStrategy
  projectType?: 'default' | 'playground' | 'github' | 'plan'
  githubOwner?: string
  githubRepo?: string
  githubRepoId?: number
  githubSyncSettings?: GitHubSyncSettings
  projectBranch?: string
  projectPrUrl?: string
  projectPrNumber?: number
  references?: Reference[];
  createdAt: Date;
  updatedAt: Date;
}

// ── References (literature/papers/documents) ─────────────────────────────

/** A literature reference (paper, article, book, etc.) attached to a project. */
export interface Reference {
  id: string;
  /** Paper/article title */
  title: string;
  /** Author list */
  authors?: string[];
  /** Publication year */
  year?: number;
  /** Journal or publication venue */
  journal?: string;
  /** Digital Object Identifier */
  doi?: string;
  /** PubMed ID */
  pmid?: string;
  /** arXiv identifier (e.g., "2301.12345") */
  arxivId?: string;
  /** Direct URL to the paper (landing page) */
  url?: string;
  /** URL to the PDF (may be open-access or Zotero-provided) */
  pdfUrl?: string;
  /** Local filesystem path to downloaded PDF (Tauri desktop only) */
  pdfPath?: string;
  /** Whether the PDF has been downloaded locally */
  pdfDownloaded?: boolean;
  /** Abstract/summary */
  abstract?: string;
  /** User-assigned tags */
  tags?: string[];
  /** User notes on this reference */
  notes?: string;
  /** Source of the reference (manual, doi-lookup, zotero, bibtex) */
  source?: 'manual' | 'doi' | 'zotero' | 'bibtex' | 'crossref';
  /** Zotero item key (if synced from Zotero) */
  zoteroKey?: string;
  /** Whether this is open access */
  isOpenAccess?: boolean;
  /** Open access source (publisher, repository, etc.) */
  oaSource?: string;
  /** When the reference was added */
  addedAt?: string;
}

/** Status of a PDF download operation */
export type PdfDownloadStatus = 'idle' | 'resolving' | 'downloading' | 'complete' | 'error'

/** Result from DOI → PDF resolution */
export interface PdfResolution {
  pdfUrl: string | null;
  isOa: boolean;
  oaSource: string | null;
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

export interface LoopConfig {
  maxIterations: number
  stopCondition?: {
    metric: string
    direction: 'minimize' | 'maximize'
    threshold?: number
    plateauWindow?: number
  }
  taskTemplate: string
  evaluationCommand?: string
  iterationTimeoutMinutes?: number
  autonomousMode: boolean
}

export interface LoopIteration {
  id: string
  nodeId: string
  projectId: string
  iteration: number
  executionId?: string
  metricValue?: number
  metricName?: string
  status: 'keep' | 'discard' | 'crash' | 'running' | 'aborted'
  description?: string
  diff?: string
  createdAt: Date
  completedAt?: Date
}

export interface PlanNode {
  id: string;
  number?: number;
  projectId: string;
  type: 'milestone' | 'task' | 'branch' | 'decision' | 'loop';
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
  commitBeforeSha?: string;
  commitAfterSha?: string;
  autoPr?: boolean;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
  githubSyncedAt?: Date;
  githubSyncVersion?: number;
  syncSource?: 'user' | 'github' | 'sync';
  deletedAt?: Date;
  deletionActionId?: string;
  metadata?: Record<string, unknown>;
  // Rich content fields
  content?: string; // Rich text content (HTML from TipTap)
  attachments?: TaskAttachment[];
  links?: TaskLink[];
  acceptanceCriteria?: AcceptanceCriterion[];
  // Loop node fields
  loopConfig?: LoopConfig;
  loopCurrentIteration?: number;
  loopBestMetricValue?: number;
  loopBestIteration?: number;
  loopStatus?: 'iterating' | 'stopped' | null;
  deliveryBranchId?: string;
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
  seq?: number;
}

// File change for execution detail view
export interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  linesAdded?: number;
  linesRemoved?: number;
  diff?: string;
  timestamp: Date;
  seq?: number;
}

// Unified activity event for sequential timeline rendering
// Each variant includes an optional `seq` (streaming_events DB sequence number)
// used for reliable deduplication when merging hydrated and live events.
export type TaskActivityEvent =
  | { type: 'text'; content: string; timestamp: Date; seq?: number }
  | { type: 'operational'; message: string; source: 'astro' | 'git' | 'delivery'; timestamp: Date; seq?: number }
  | { type: 'tool_use'; id: string; toolName: string; toolInput: unknown; timestamp: Date; seq?: number }
  | { type: 'tool_result'; id: string; toolName: string; toolResult?: unknown; success?: boolean; duration?: number; timestamp: Date; seq?: number }
  | { type: 'steer'; message: string; accepted?: boolean; ackMessage?: string; interrupted?: boolean; timestamp: Date; seq?: number }
  | { type: 'chat_user'; message: string; queued?: boolean; timestamp: Date; seq?: number }
  | { type: 'chat_assistant'; content: string; timestamp: Date; seq?: number }
  | { type: 'file_change'; path: string; action: string; diff?: string; linesAdded?: number; linesRemoved?: number; timestamp: Date; seq?: number }
  | { type: 'error'; error: string; timestamp: Date; seq?: number }
  | { type: 'approval_request'; requestId: string; question: string; options: string[]; timestamp: Date; seq?: number }
  | { type: 'approval_response'; requestId: string; question: string; answer: string; autoApproved?: boolean; timestamp: Date; seq?: number }
  | { type: 'mutation'; nodeUpdates: Array<{ nodeId: string; [key: string]: unknown }>; edgeOps: Array<{ action: string; source: string; target: string; type?: string }>; newNodes: Array<{ title: string; description: string; type?: string; id?: string }>; timestamp: Date; seq?: number }
  | { type: 'pr_status'; prNumber: number; prUrl: string; title?: string; state?: 'open' | 'closed' | 'merged'; branchName?: string; baseBranch?: string; additions?: number; deletions?: number; changedFiles?: number; draft?: boolean; checks?: Array<{ name: string; status: string; conclusion: string | null; startedAt?: string; completedAt?: string; htmlUrl?: string }>; reviews?: Array<{ user: { login: string; avatarUrl?: string }; state: string; submittedAt?: string }>; timestamp: Date; seq?: number }
  | { type: 'github_comment'; commentId: number; author: { login: string; avatar: string }; body: string; commentType: 'issue_comment' | 'review_comment'; path?: string; line?: number; url?: string; timestamp: Date; seq?: number }
  | { type: 'branch_linked'; prNumber: number; prUrl: string; branchName: string; linkSource: 'auto-branch' | 'auto-body-reference' | 'manual'; timestamp: Date; seq?: number }
  | { type: 'system_message'; message: string; timestamp: Date; seq?: number }
  | { type: 'system_prompt'; content: string; pathwayType?: string; timestamp: Date; seq?: number }
  | { type: 'plan_result'; nodes: Array<{ id: string; title: string; type: string; status?: string }>; edges: Array<{ source: string; target: string }>; projectName?: string; projectId?: string; timestamp: Date; seq?: number }
  | { type: 'json_render_spec'; spec: { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> }; timestamp: Date; seq?: number }

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
  userId?: string;
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
  /** SSE connection state for reconnection tracking */
  connectionState?: 'connected' | 'reconnecting' | 'polling';
  /** UUID of user who verified this execution */
  verifiedBy?: string;
  /** Optional note from the verifier */
  verificationNote?: string;
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

export type DeliveryBranchStatus = 'active' | 'pr_created' | 'merged' | 'obsolete';

export interface DeliveryBranch {
  id: string;
  projectId: string;
  branchName: string;
  isSingleton: boolean;
  nodeIds: string[];
  prUrl?: string;
  prNumber?: number;
  status: DeliveryBranchStatus;
  createdAt: Date;
  updatedAt: Date;
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
  pinnedSidebarItems?: Array<{ id: string; type: 'project' | 'session' }>;
  collapsedInitiatives?: string[];
  projectOrder?: string[];
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

export interface KnowledgeEntry {
  id: string;
  projectId: string;
  key: string;
  value: string;
  sourceNodeId?: string;
  sourceTaskTitle?: string;
  milestoneId?: string;
  createdAt: Date;
  updatedAt: Date;
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

export interface MachineInstruction {
  id: string;
  ownerId: string;
  teamId?: string | null;
  name: string;
  content: string;
  tags: string[];
  source: 'user' | 'auto';
  createdAt: Date;
  updatedAt: Date;
}

// Cron schedule for recurring task execution
export interface Schedule {
  id: string;
  projectId: string;
  scope: 'project' | 'node';
  nodeId?: string | null;
  name: string;
  cronExpression: string;
  timezone: string;
  targetMachineId: string;
  nodeFilter?: string[] | null;
  enabled: boolean;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  activeHoursStart?: string | null;
  activeHoursEnd?: string | null;
  maxConcurrency: number;
  missedRunPolicy: 'skip' | 'retry_on_reconnect';
  retryTtlMinutes: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GitHubCachedIssue {
  id: string;
  projectId: string;
  issueNumber: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  url: string;
  authorLogin?: string | null;
  labels: Array<{ name: string; color?: string }>;
  assignees: Array<{ login: string }>;
  commentsCount: number;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  closedAt?: Date | null;
  cachedAt: Date;
}

export interface GitHubCachedPr {
  id: string;
  projectId: string;
  prNumber: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed' | 'merged';
  url: string;
  authorLogin?: string | null;
  headBranch?: string | null;
  baseBranch?: string | null;
  labels: Array<{ name: string; color?: string }>;
  ciStatus?: 'success' | 'failure' | 'pending' | 'none' | null;
  reviewDecision?: 'approved' | 'changes_requested' | 'reviewed' | 'pending' | 'none' | null;
  mergeableState?: 'mergeable' | 'conflicting' | 'unknown' | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commentsCount: number;
  draft: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  mergedAt?: Date | null;
  closedAt?: Date | null;
  cachedAt: Date;
}

export interface GitHubRepoCacheSnapshot {
  projectId: string;
  lastSyncedAt: string | null;
  issues: GitHubCachedIssue[];
  pullRequests: GitHubCachedPr[];
}

export interface GitHubWorkspaceAttentionItem {
  type: 'ci_failing' | 'changes_requested' | 'ready_to_merge' | 'new_issue';
  projectId: string;
  projectName: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  updatedAt?: string | null;
}

export interface GitHubWorkspaceProjectSummary {
  projectId: string;
  projectName: string;
  repo: string;
  openIssues: number;
  openPullRequests: number;
  failingPrs: number;
  changesRequestedPrs: number;
  readyToMergePrs: number;
  lastSyncedAt: string | null;
}

export interface GitHubWorkspaceSummary {
  projects: GitHubWorkspaceProjectSummary[];
  attention: GitHubWorkspaceAttentionItem[];
}

export interface PrChangedFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
}

// Execution history entry for a schedule run
export interface ScheduleRun {
  id: string;
  scheduleId: string;
  runNumber: number;
  status: 'pending' | 'dispatched' | 'running' | 'success' | 'failure' | 'missed';
  branchName?: string | null;
  executionIds?: string[] | null;
  scheduledAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  summary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  retryUntil?: Date | null;
  createdAt: Date;
}
