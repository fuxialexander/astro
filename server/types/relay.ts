/**
 * Relay Server WebSocket Protocol Types
 *
 * Defines the message protocol for communication between:
 * - Platform (plan graph, dispatch engine) → Relay Server → Agent Runners
 * - Agent Runners → Relay Server → Platform
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * AI agent types available on a machine.
 *
 * "Provider" is legacy terminology — these represent the AI agents
 * (AI service providers) that can execute tasks. Compute backends
 * (AWS, GCP, Slurm) are separate from AI agents.
 */
export type ProviderType = 'claude-sdk' | 'codex' | 'openclaw' | 'opencode' | 'custom';

/** Status of a machine connection */
export type MachineConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

/** Status of a provider on a machine */
export type ProviderStatus = 'available' | 'busy' | 'unavailable' | 'error';

/** Task execution status */
export type TaskStatus =
  | 'queued'
  | 'dispatched'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

// ============================================================================
// Machine & Resource Types
// ============================================================================

/** Resource information for a machine */
export interface MachineResources {
  cpuCores: number;
  memoryMB: number;
  gpuCount?: number;
  gpuMemoryMB?: number;
  gpuType?: string;       // e.g. "NVIDIA A100", "Apple M4 Pro"
  diskSpaceMB?: number;
}

/** Current load on a machine */
export interface MachineLoad {
  cpuPercent: number;
  memoryPercent: number;
  gpuPercent?: number;
  activeTasks: number;
  queuedTasks: number;
}

/** HPC capability metadata on a provider */
export interface HpcCapability {
  clusterName?: string;
  partitions: string[];
  defaultPartition?: string;
  accounts: string[];
}

/** Provider configuration on a machine */
export interface ProviderInfo {
  type: ProviderType;
  version?: string;
  status: ProviderStatus;
  maxConcurrentTasks: number;
  currentTasks: number;
  capabilities?: string[];
  hpcCapability?: HpcCapability;
}

/** Execution strategy info reported by agent runners */
export interface ExecutionStrategyInfo {
  id: string;
  name: string;
  available: boolean;
  version?: string;
  metadata?: Record<string, unknown>;
}

/** Machine registration information */
export interface MachineInfo {
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

/** Machine entry in the registry */
export interface MachineRegistryEntry extends MachineInfo {
  connectionStatus: MachineConnectionStatus;
  connectedAt: Date;
  lastHeartbeat: Date;
  sessionId: string;
  /** Owner user ID (from JWT at registration time) */
  userId?: string;
  /** Task IDs the agent runner reports as actively running (from heartbeat cross-ref) */
  activeTaskIds?: string[];
}

// ============================================================================
// Image / Multimodal Types
// ============================================================================

/** Base64-encoded image for multimodal dispatch */
export interface ImageAttachment {
  /** Blob ID from the blobs table */
  blobId: string;
  /** MIME type (image/png, image/jpeg, etc.) */
  mimeType: string;
  /** Base64-encoded image data */
  data: string;
  /** Optional filename */
  filename?: string;
}

// ============================================================================
// Task Types
// ============================================================================

/**
 * Dispatch task type — tells the agent runner what kind of work this is.
 *
 * - 'execution': Standard task execution (code changes, tests, etc.). Default.
 * - 'plan': Plan generation — produces structured JSON output (task graph).
 * - 'chat': Conversational exchange — multi-turn chat about a plan or project.
 * - 'summarize': Single-turn summarization of task output.
 */
export type TaskDispatchType = 'execution' | 'plan' | 'chat' | 'summarize';

/**
 * A single message in a conversation history.
 *
 * Used by chat/task-chat endpoints to send multi-turn conversation context
 * through the relay to the agent runner, preserving role structure.
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Payload signed by the user's browser to prove dispatch authenticity */
export interface DispatchSigningPayload {
  /** Schema version */
  v: 1;
  /** Which task (plan node) */
  nodeId: string;
  /** Which project */
  projectId: string;
  /** Target machine (prevents redirection) */
  machineId: string;
  /** ISO 8601 timestamp (prevents replay) */
  timestamp: string;
  /** Random 32-byte hex nonce (prevents replay) */
  nonce: string;
}

/** Task dispatch request */
export interface TaskDispatch {
  taskId: string;
  projectId: string;
  nodeId: string;  // Reference to PlanNode
  /** Short hex ID derived from nodeId (first 6 hex chars of UUID) for branch names and PR titles */
  shortNodeId?: string;
  /** Short hex ID derived from projectId (first 6 hex chars of UUID) for PR titles */
  shortProjectId?: string;
  title: string;
  description: string;
  visionDoc?: string;  // Project vision context
  environment?: string;
  preferredProvider?: ProviderType;
  /** Preferred execution strategy (direct, slurm, docker, k8s-exec) */
  executionStrategy?: string;
  priority?: number;
  timeout?: number;  // Timeout in milliseconds
  workingDirectory?: string;
  dependencies?: string[];  // Other task IDs that must complete first
  metadata?: Record<string, string>;
  /** Pre-built prompt — bypasses automatic prompt construction from title/description */
  prompt?: string;
  /** Override agent runner's default maxTurns (e.g., 10 for plan generation) */
  maxTurns?: number;
  /** Force structured JSON output matching a schema */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };

  // ── New fields (relay protocol extension) ──────────────────────────────

  /**
   * Task type — tells the agent runner what kind of work this is.
   * Defaults to 'execution' if omitted (backward-compatible).
   */
  type?: TaskDispatchType;

  /**
   * System prompt — injected as the system-level instruction for the AI session.
   *
   * For 'plan' tasks: planning instructions + JSON schema constraints.
   * For 'chat' tasks: conversational context instructions.
   * For 'execution' tasks: usually omitted (agent runner uses its defaults).
   * For 'summarize' tasks: summarization instructions.
   *
   * When provided, the agent runner passes this to the Claude SDK's
   * `options.systemPrompt` parameter, keeping it separate from user content.
   */
  systemPrompt?: string;

  /**
   * Conversation history — multi-turn message array for chat tasks.
   *
   * For 'chat' and 'task-chat' endpoints, this carries the full conversation
   * history (user/assistant turns) so the agent runner can resume the
   * conversation with proper role structure.
   *
   * When provided, the agent runner uses this to build the prompt as an
   * AsyncIterable<SDKUserMessage> instead of a flat string, preserving
   * the multi-turn structure that the Claude SDK expects.
   *
   * When omitted, `prompt` is used as a single-turn string (backward-compatible).
   */
  messages?: ConversationMessage[];

  /**
   * Explicit model selection — e.g. 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'.
   *
   * The frontend allows users to select models. This field passes that choice
   * through the relay to the agent runner, which passes it to the SDK's
   * `options.model` parameter.
   *
   * When omitted, the agent runner uses its configured default model.
   */
  model?: string;

  /**
   * How results should be delivered after task completion.
   *
   * - 'pr': Create a pull request (GitHub, GitLab, Bitbucket)
   * - 'push': Push to remote branch
   * - 'branch': Commit to local branch only (no push)
   * - 'direct': Modify files in-place (no git operations)
   *
   * Defaults to 'pr' for backward compatibility.
   */
  deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct';

  /**
   * Remote type of the source repository.
   * Helps the agent runner decide how to create PRs or push.
   */
  remoteType?: 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none';

  /**
   * Agent directory name (default '.astro').
   * Used by the agent runner to find config and create worktrees.
   */
  agentDir?: string;

  /**
   * Target branch for worktree creation and PR base (e.g., 'main', 'develop').
   * Resolved from project.source.baseBranch at dispatch time.
   * When provided, the agent runner uses this instead of auto-detecting from
   * .astro/config.json or git symbolic-ref.
   */
  baseBranch?: string;

  /**
   * Project-level accumulation branch (e.g., 'astro/7b19a9').
   * When set, the agent runner creates the worktree from this branch instead of main,
   * and per-task PRs target this branch for auto-merge.
   */
  projectBranch?: string;

  /**
   * Worktree strategy for non-git or copy-based execution.
   * - 'copy': Copy project files to worktree dir (default for 'copy' deliveryMode)
   * - 'reference': Create empty dir with file map (for large datasets)
   * - 'direct': Work in-place (same as 'direct' deliveryMode)
   */
  worktreeStrategy?: 'copy' | 'reference' | 'direct';

  /**
   * Per-task worktree control. When set to `false`, the agent runner skips
   * worktree creation and runs directly in the working directory.
   * This is an explicit user opt-out, not a silent fallback.
   * Defaults to `true` (use worktree when applicable).
   */
  useWorktree?: boolean;

  /**
   * Skip the agent runner's safety check (non-git working directory prompt).
   *
   * Set to `true` for text-only tasks (refinement, summarization, title generation)
   * that don't touch the filesystem and don't need working directory validation.
   * Older agent runners will ignore this field (backward-compatible).
   */
  skipSafetyCheck?: boolean;

  /**
   * Images embedded in task content, sent as base64 for multimodal prompts.
   * Extracted from blob references in the task's rich text content.
   */
  images?: ImageAttachment[];

  /** Base URL of the Astro server — used for linking back to tasks in PR bodies */
  astroBaseUrl?: string;

  /** GitHub issue URL to reference in the PR body (e.g., "https://github.com/org/repo/issues/42") */
  githubIssueUrl?: string;

  /** GitHub issue number to reference in the PR body (e.g., 42 → "Closes #42") */
  githubIssueNumber?: number;

  /** ECDSA P-256 signature of the dispatch signing payload (base64url-encoded) */
  dispatchSignature?: string;
  /** The signed payload for verification by the agent runner */
  dispatchSigningPayload?: DispatchSigningPayload;

  /**
   * Resume an existing Claude Code session by ID.
   * When set, the agent runner uses `query({ resume: sessionId })` instead of starting fresh.
   */
  resumeSessionId?: string;

  /**
   * Fork the resumed session instead of continuing in-place.
   * When true alongside `resumeSessionId`, the agent runner uses
   * `query({ resume: sessionId, forkSession: true })`.
   */
  forkSession?: boolean;
}

/** Structured execution summary produced by the agent after task completion */
export interface ExecutionSummaryResult {
  status: 'success' | 'partial' | 'failure';
  workCompleted: string;
  /** 1-2 paragraph executive summary: what was done, why, approach taken, and key decisions */
  executiveSummary?: string;
  keyFindings: string[];
  filesChanged: string[];
  followUps: string[];
  /** PR URL if the agent created a pull request during execution */
  prUrl?: string | null;
  /** PR number if the agent created a pull request during execution */
  prNumber?: number | null;
  /** Branch name the agent worked on or created */
  branchName?: string | null;
}

/** Task result from agent runner */
export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  exitCode?: number;
  output?: string;
  error?: string;
  artifacts?: TaskArtifact[];
  duration?: number;  // Execution time in milliseconds
  metadata?: Record<string, string>;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  /** Git SHA of the project branch before this task's merge */
  commitBeforeSha?: string;
  /** Git SHA of the project branch after this task's merge */
  commitAfterSha?: string;
  /** Delivery outcome — separate from execution status */
  deliveryStatus?: 'success' | 'failed' | 'skipped';
  /** Error message when deliveryStatus is 'failed' */
  deliveryError?: string;
  /** Structured execution summary (generated via follow-up structured output turn) */
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

/** Artifact produced by a task */
export interface TaskArtifact {
  name: string;
  type: 'file' | 'log' | 'report' | 'other';
  path?: string;
  url?: string;
  size?: number;
  checksum?: string;
}

/** Task stdout/stderr streaming */
export interface TaskOutput {
  taskId: string;
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
}

/** Structured text output (bypasses stdout throttle) */
export interface TaskTextMessage extends BaseMessage {
  type: 'task.text';
  taskId: string;
  text: string;
  sequence: number;
}

/** Session initialization info */
export interface TaskSessionInitMessage extends BaseMessage {
  type: 'task.session_init';
  taskId: string;
  sessionId: string;
  model?: string;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

/** Base message structure */
export interface BaseMessage {
  type: string;
  timestamp: Date;
  correlationId?: string;  // For request/response matching
}

// --- Messages from Agent Runner to Relay ---

/** Machine registration message */
export interface MachineRegisterMessage extends BaseMessage {
  type: 'machine.register';
  machineId: string;
  machineInfo: Omit<MachineInfo, 'machineId'>;
}

/** Machine unregister message */
export interface MachineUnregisterMessage extends BaseMessage {
  type: 'machine.unregister';
  machineId: string;
  reason?: string;
}

/** Machine status update */
export interface MachineStatusMessage extends BaseMessage {
  type: 'machine.status';
  machineId: string;
  load: MachineLoad;
  providers?: ProviderInfo[];
}

/** Provider status update */
export interface ProviderStatusMessage extends BaseMessage {
  type: 'provider.status';
  machineId: string;
  provider: ProviderInfo;
}

/** Task result message */
export interface TaskResultMessage extends BaseMessage {
  type: 'task.result';
  result: TaskResult;
}

/** Task stdout/stderr message */
export interface TaskStdoutMessage extends BaseMessage {
  type: 'task.stdout';
  output: TaskOutput;
}

/** Task progress update */
export interface TaskProgressMessage extends BaseMessage {
  type: 'task.progress';
  taskId: string;
  progress: number;  // 0-100
  message?: string;
}

/** Task steer acknowledgment (agent runner confirms it received steering) */
export interface TaskSteerAckMessage extends BaseMessage {
  type: 'task.steer.ack';
  taskId: string;
  accepted: boolean;
  message?: string;
  interrupted?: boolean;
}

/** Task tool trace (detailed tool call information from agent) */
export interface TaskToolTraceMessage extends BaseMessage {
  type: 'task.tool_trace';
  taskId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: unknown;
  success?: boolean;
  duration?: number;  // milliseconds
}

/** Task file change (file modification by agent) */
export interface TaskFileChangeMessage extends BaseMessage {
  type: 'task.file_change';
  taskId: string;
  path: string;
  action: 'created' | 'modified' | 'deleted';
  linesAdded?: number;
  linesRemoved?: number;
  diff?: string;
}

/** Task approval request (agent requesting user decision) */
export interface TaskApprovalRequestMessage extends BaseMessage {
  type: 'task.approval_request';
  taskId: string;
  requestId: string;
  question: string;
  options: string[];
}

/** Heartbeat pong response */
export interface HeartbeatPongMessage extends BaseMessage {
  type: 'heartbeat.pong';
  machineId: string;
}

// --- Messages from Relay to Agent Runner ---

/** Task dispatch message */
export interface TaskDispatchMessage extends BaseMessage {
  type: 'task.dispatch';
  task: TaskDispatch;
}

/** Task cancel message */
export interface TaskCancelMessage extends BaseMessage {
  type: 'task.cancel';
  taskId: string;
  reason?: string;
}

/** Heartbeat ping request */
export interface HeartbeatPingMessage extends BaseMessage {
  type: 'heartbeat.ping';
}

/** Registration acknowledgment */
export interface MachineRegisterAckMessage extends BaseMessage {
  type: 'machine.register.ack';
  machineId: string;
  sessionId: string;
  success: boolean;
  error?: string;
}

/** Task steer message (inject guidance into running agent) */
export interface TaskSteerMessage extends BaseMessage {
  type: 'task.steer';
  taskId: string;
  message: string;
  action?: 'guidance' | 'redirect' | 'pause' | 'resume';
  interrupt?: boolean;
}

/** Task approval response (relay → agent with user's decision) */
export interface TaskApprovalResponseMessage extends BaseMessage {
  type: 'task.approval_response';
  taskId: string;
  requestId: string;
  answered: boolean;
  answer?: string;
  message?: string;
}

/** File list request (relay → agent) */
export interface FileListRequestMessage extends BaseMessage {
  type: 'file_list.request';
  path: string;
  correlationId: string;
}

/** File list response (agent → relay) */
export interface FileListResponseMessage extends BaseMessage {
  type: 'file_list.response';
  correlationId: string;
  files: string[];
}

/** Directory list request (relay → agent) - for remote path browsing */
export interface DirectoryListRequestMessage extends BaseMessage {
  type: 'directory_list.request';
  correlationId: string;
  path: string;
}

/** Directory entry info */
export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
}

/** Directory list response (agent → relay) */
export interface DirectoryListResponseMessage extends BaseMessage {
  type: 'directory_list.response';
  correlationId: string;
  path: string;
  entries: DirectoryEntry[];
  error?: string;
  homeDirectory?: string;
}

/** Slash commands request (relay → agent) */
export interface SlashCommandsRequestMessage extends BaseMessage {
  type: 'slash_commands.request';
  correlationId: string;
  workingDirectory?: string;
}

/** Slash commands response (agent → relay) */
export interface SlashCommandsResponseMessage extends BaseMessage {
  type: 'slash_commands.response';
  correlationId: string;
  commands: Array<{ name: string; description: string }>;
}

/** Repo detect request (relay → agent) */
export interface RepoDetectRequestMessage extends BaseMessage {
  type: 'repo_detect.request';
  correlationId: string;
  path: string;
}

/** Repo detect response (agent → relay) */
export interface RepoDetectResponseMessage extends BaseMessage {
  type: 'repo_detect.response';
  correlationId: string;
  exists: boolean;
  isGit: boolean;
  remoteUrl?: string;
  remoteType: 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none';
  baseBranch?: string;
  currentBranch?: string;
  isDirty?: boolean;
  dirtyDetails?: {
    staged: number;
    unstaged: number;
    untracked: number;
  };
  suggestedDeliveryMode: 'pr' | 'push' | 'branch' | 'direct';
  dirSizeMB?: number | null;
  error?: string;
}

/** Branch list request (relay → agent) */
export interface BranchListRequestMessage extends BaseMessage {
  type: 'branch_list.request';
  correlationId: string;
  path: string;
}

/** Branch list response (agent → relay) */
export interface BranchListResponseMessage extends BaseMessage {
  type: 'branch_list.response';
  correlationId: string;
  branches: Array<{
    name: string;
    isRemote: boolean;
    isCurrent: boolean;
    isDefault: boolean;
  }>;
  defaultBranch?: string;
  error?: string;
}

/** Git init request (relay → agent) */
export interface GitInitRequestMessage extends BaseMessage {
  type: 'git_init.request';
  correlationId: string;
  workingDirectory: string;
  projectId: string;
  projectName: string;
  projectDescription?: string;
}

/** Git init response (agent → relay) */
export interface GitInitResponseMessage extends BaseMessage {
  type: 'git_init.response';
  correlationId: string;
  success: boolean;
  workingDirectory?: string;
  fileTree?: string[];
  source?: Record<string, unknown>;
  deliveryMode?: string;
  error?: string;
}

/** Create directory request (relay → agent) */
export interface CreateDirectoryRequestMessage extends BaseMessage {
  type: 'create_directory.request';
  correlationId: string;
  parentPath: string;
  name: string;
}

/** Create directory response (agent → relay) */
export interface CreateDirectoryResponseMessage extends BaseMessage {
  type: 'create_directory.response';
  correlationId: string;
  success: boolean;
  path?: string;
  error?: string;
}

/** Git pull request (relay → agent) - fire-and-forget, no response needed */
export interface GitPullRequestMessage extends BaseMessage {
  type: 'git_pull.request';
  workingDirectory: string;
  correlationId: string;
}

/** File content request (relay → agent) - for reading remote files */
export interface FileContentRequestMessage extends BaseMessage {
  type: 'file_content.request';
  correlationId: string;
  path: string;
}

/** File content response (agent → relay) */
export interface FileContentResponseMessage extends BaseMessage {
  type: 'file_content.response';
  correlationId: string;
  path: string;
  content?: string;
  encoding?: 'utf-8' | 'base64';
  mimeType?: string;
  size?: number;
  /** Chunked transfer fields */
  chunked?: boolean;
  chunkIndex?: number;
  totalChunks?: number;
  error?: string;
}

/** File upload request (relay → agent) - for writing remote files */
export interface FileUploadRequestMessage extends BaseMessage {
  type: 'file_upload.request';
  correlationId: string;
  destinationPath: string;
  fileName: string;
  size: number;
  totalChunks: number;
  overwrite?: boolean;
}

/** File upload chunk (relay → agent) */
export interface FileUploadChunkMessage extends BaseMessage {
  type: 'file_upload.chunk';
  correlationId: string;
  chunkIndex: number;
  encoding: 'utf-8' | 'base64';
  content: string;
}

/** File upload response (agent → relay) */
export interface FileUploadResponseMessage extends BaseMessage {
  type: 'file_upload.response';
  correlationId: string;
  success: boolean;
  path?: string;
  error?: string;
}

/** Sessions list request (relay → agent) - for discovering Claude Code sessions */
export interface SessionsListRequestMessage extends BaseMessage {
  type: 'sessions_list.request';
  correlationId: string;
}

/** Claude Code session info */
export interface ClaudeCodeSessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
}

/** Sessions list response (agent → relay) */
export interface SessionsListResponseMessage extends BaseMessage {
  type: 'sessions_list.response';
  correlationId: string;
  sessions: ClaudeCodeSessionInfo[];
  error?: string;
}

// --- Channel relay messages (server <-> agent runner <-> OpenClaw) ---

/** Send notification through OpenClaw (relay → agent) */
export interface ChannelNotificationMessage extends BaseMessage {
  type: 'channel.notification';
  correlationId: string;
  notification: {
    type: string;
    projectId: string;
    summary: string;
    astroUrl?: string;
    to?: string;
    metadata?: Record<string, unknown>;
  };
}

/** Notification delivery acknowledgment (agent → relay) */
export interface ChannelNotificationAckMessage extends BaseMessage {
  type: 'channel.notification.ack';
  correlationId: string;
  success: boolean;
  error?: string;
}

/** Send chat response through OpenClaw (relay → agent) */
export interface ChannelResponseMessage extends BaseMessage {
  type: 'channel.response';
  correlationId: string;
  response: {
    text: string;
    channelId: string;
    threadId?: string;
    to?: string;
    metadata?: Record<string, unknown>;
  };
}

/** Response delivery acknowledgment (agent → relay) */
export interface ChannelResponseAckMessage extends BaseMessage {
  type: 'channel.response.ack';
  correlationId: string;
  success: boolean;
  error?: string;
}

/** Request user approval through OpenClaw (relay → agent) */
export interface ChannelApprovalRequestMessage extends BaseMessage {
  type: 'channel.approval_request';
  correlationId: string;
  approvalId: string;
  projectId: string;
  taskId: string;
  question: string;
  options?: string[];
}

/** User responded to approval via OpenClaw (agent → relay) */
export interface ChannelApprovalResponseMessage extends BaseMessage {
  type: 'channel.approval_response';
  correlationId: string;
  approvalId: string;
  response: string;
}

/** Unprompted inbound message from user via OpenClaw (agent → relay) */
export interface ChannelInboundMessage extends BaseMessage {
  type: 'channel.inbound';
  sourceMessageId: string;
  text: string;
  senderId: string;
  senderName: string;
  channelId: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

/** Error message */
export interface ErrorMessage extends BaseMessage {
  type: 'error';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// --- Platform-internal messages (for Redis pub/sub) ---

/** Message published when machine state changes */
export interface MachineStateChangeEvent {
  event: 'machine.connected' | 'machine.disconnected' | 'machine.updated';
  machineId: string;
  machineInfo?: MachineRegistryEntry;
  timestamp: Date;
}

/** Message published when task state changes */
export interface TaskStateChangeEvent {
  event: 'task.dispatched' | 'task.started' | 'task.completed' | 'task.failed' | 'task.cancelled';
  taskId: string;
  machineId: string;
  result?: TaskResult;
  timestamp: Date;
}

// ============================================================================
// Session Attachment Types (MCP Bridge)
// ============================================================================

/** Session event types from MCP bridge */
export type SessionEventType =
  | 'tool_call'
  | 'tool_result'
  | 'file_change'
  | 'message'
  | 'error';

/** Base session event */
export interface SessionEvent {
  type: SessionEventType;
  timestamp: Date;
  sessionId: string;
  taskId: string;
  [key: string]: unknown;
}

/** Session attach request from MCP bridge */
export interface SessionAttachMessage extends BaseMessage {
  type: 'session.attach';
  taskId: string;
  sessionId: string;
  machineId: string;
}

/** Session attach acknowledgment from relay */
export interface SessionAttachAckMessage extends BaseMessage {
  type: 'session.attach.ack';
  taskId: string;
  sessionId: string;
  success: boolean;
  error?: string;
}

/** Session detach message */
export interface SessionDetachMessage extends BaseMessage {
  type: 'session.detach';
  sessionId: string;
  reason?: string;
}

/** Session event message (MCP bridge → relay → platform) */
export interface SessionEventMessage extends BaseMessage {
  type: 'session.event';
  sessionId: string;
  taskId: string;
  event: SessionEvent;
}

// ============================================================================
// Union Types for Message Handling
// ============================================================================

/** All messages from agent runner to relay */
export type AgentToRelayMessage =
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
  | FileContentResponseMessage
  | FileUploadResponseMessage
  | SlashCommandsResponseMessage
  | RepoDetectResponseMessage
  | GitInitResponseMessage
  | BranchListResponseMessage
  | CreateDirectoryResponseMessage
  | SessionsListResponseMessage;

/** All session-related messages from MCP bridge to relay */
export type SessionToRelayMessage =
  | SessionAttachMessage
  | SessionDetachMessage
  | SessionEventMessage;

/** All messages from relay to MCP bridge */
export type RelayToSessionMessage =
  | SessionAttachAckMessage
  | ErrorMessage;

/** All messages from relay to agent runner */
export type RelayToAgentMessage =
  | TaskDispatchMessage
  | TaskCancelMessage
  | TaskSteerMessage
  | TaskApprovalResponseMessage
  | HeartbeatPingMessage
  | MachineRegisterAckMessage
  | FileListRequestMessage
  | FileContentRequestMessage
  | FileUploadRequestMessage
  | FileUploadChunkMessage
  | SlashCommandsRequestMessage
  | RepoDetectRequestMessage
  | GitInitRequestMessage
  | BranchListRequestMessage
  | CreateDirectoryRequestMessage
  | GitPullRequestMessage
  | SessionsListRequestMessage
  | ErrorMessage;

/** All relay messages */
export type RelayMessage =
  | AgentToRelayMessage
  | RelayToAgentMessage
  | SessionToRelayMessage
  | RelayToSessionMessage;

// ============================================================================
// Utility Types
// ============================================================================

/** JWT payload for machine authentication */
export interface MachineJWTPayload {
  sub: string;  // Machine ID
  iat: number;
  exp: number;
  scopes: string[];
  machineId: string;
  userId?: string;
  workspaceId?: string;
}

/** Rate limit configuration */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  maxTasksPerMinute: number;
  maxStdoutBytesPerSecond: number;
}

/** Relay server configuration */
export interface RelayServerConfig {
  port: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  disconnectGracePeriodMs: number;
  maxConnectionsPerMachine: number;
  rateLimit: RateLimitConfig;
  redisUrl?: string;
  jwtSecret?: string;
}

/** Default relay server configuration */
export const DEFAULT_RELAY_CONFIG: RelayServerConfig = {
  port: 3002,
  heartbeatIntervalMs: 30000,  // 30 seconds
  // 180s (6 missed heartbeats) tolerance for machine disconnection detection
  // Rationale: With unlimited maxTurns for execution tasks, agents may run for
  // extended periods. Longer heartbeat timeout prevents false disconnections
  // from network hiccups or temporary load, at the cost of slower failure
  // detection when machines genuinely disconnect.
  heartbeatTimeoutMs: 180000,
  disconnectGracePeriodMs: 180000,  // 180 seconds grace period before failing tasks
  maxConnectionsPerMachine: 1,
  rateLimit: {
    windowMs: 60000,  // 1 minute
    maxRequests: 1000,
    maxTasksPerMinute: 100,
    maxStdoutBytesPerSecond: 1024 * 1024,  // 1MB/s
  },
};

// ============================================================================
// Slurm/HPC Extensions
// ============================================================================

/** Slurm cluster information */
export interface SlurmClusterInfo {
  clusterName: string;
  slurmVersion: string;
  defaultPartition?: string;
  partitions: SlurmPartitionInfo[];
  qosLevels: string[];
  accounts: string[];
}

/** Slurm partition information */
export interface SlurmPartitionInfo {
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

/** Slurm-specific provider info extension (for backward compatibility) */
export interface SlurmProviderInfo extends ProviderInfo {
  type: 'claude-sdk';
  /** Cluster information */
  clusterInfo?: SlurmClusterInfo;
  /** User's default account */
  defaultAccount?: string;
  /** Available QOS for the user */
  availableQos?: string[];
}

/** Slurm job state */
export type SlurmJobState =
  | 'PENDING'
  | 'RUNNING'
  | 'SUSPENDED'
  | 'COMPLETING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'PREEMPTED'
  | 'NODE_FAIL'
  | 'OUT_OF_MEMORY'
  | 'UNKNOWN';

/** Slurm job info */
export interface SlurmJobInfo {
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

/** Slurm task dispatch extension */
export interface SlurmTaskDispatch extends TaskDispatch {
  preferredProvider: 'claude-sdk';
  /** Slurm-specific configuration */
  slurmConfig?: {
    partition?: string;
    nodes?: number;
    ntasks?: number;
    cpusPerTask?: number;
    mem?: string;
    time?: string;
    gpu?: {
      type?: string;
      count: number;
    };
    qos?: string;
    account?: string;
    modules?: string[];
    workdir?: string;
  };
}

/** Slurm job status message (agent → relay) */
export interface SlurmJobStatusMessage extends BaseMessage {
  type: 'slurm.job.status';
  taskId: string;
  slurmJobId: string;
  jobInfo: SlurmJobInfo;
}

/** Slurm job output message (agent → relay) */
export interface SlurmJobOutputMessage extends BaseMessage {
  type: 'slurm.job.output';
  taskId: string;
  slurmJobId: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

/** Slurm job submitted message (agent → relay) */
export interface SlurmJobSubmittedMessage extends BaseMessage {
  type: 'slurm.job.submitted';
  taskId: string;
  slurmJobId: string;
  scriptPath: string;
  outputPath: string;
  errorPath: string;
}

/** Extended agent to relay messages including Slurm types */
export type AgentToRelayMessageExtended =
  | AgentToRelayMessage
  | SlurmJobStatusMessage
  | SlurmJobOutputMessage
  | SlurmJobSubmittedMessage;
