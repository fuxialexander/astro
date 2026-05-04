/**
 * WebSocket Relay Server
 *
 * Handles WebSocket connections from agent runners, manages the machine
 * registry, routes task dispatch messages, and forwards results back
 * to the platform.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { EventEmitter } from 'events';
import jwt from 'jsonwebtoken';
import { LOCAL_USER_ID } from './db/bootstrap-local.js';
import {
  DEFAULT_RELAY_CONFIG,
  type RelayServerConfig,
  type MachineJWTPayload,
  type AgentToRelayMessage,
  type RelayToAgentMessage,
  type MachineRegisterMessage,
  type MachineUnregisterMessage,
  type MachineStatusMessage,
  type ProviderStatusMessage,
  type TaskResultMessage,
  type TaskStdoutMessage,
  type TaskProgressMessage,
  type TaskSteerAckMessage,
  type TaskToolTraceMessage,
  type TaskFileChangeMessage,
  type TaskTextMessage,
  type TaskOperationalMessage,
  type TaskSessionInitMessage,
  type HeartbeatPongMessage,
  type TaskDispatch,
  type TaskSteerMessage,
  type HeartbeatPingMessage,
  type MachineRegisterAckMessage,
  type ErrorMessage,
  type MachineInfo,
  type ProviderType,
  type ClaudeCodeSessionInfo,
  // File content & upload types
  type FileContentResponseMessage,
  type FileUploadResponseMessage,
  // Session attachment types (MCP bridge)
  type SessionAttachMessage,
  type SessionAttachAckMessage,
  type SessionDetachMessage,
  type SessionEventMessage,
  type SessionEvent,
  type ExecutionSummaryResult,
} from '../types/relay.js';
import { machineRegistry } from './machine-registry.js';
import { streamingEventLog } from './streaming-event-log.js';
import { redisPubSub, type StreamingEventMessage } from './redis-pubsub.js';
import { executionContextStore } from './execution-context-store.js';
import { executionEventBus } from './execution-event-bus.js';
import { notifyWarning } from './monitoring.js';
import { db } from './db/index.js';
import { taskExecutions, planNodes } from './db/schema.js';
import { eq, and, or, isNull } from 'drizzle-orm';

/** Compute line counts from a unified diff string */
function computeLineCounts(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

function parseEnvMs(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(parsed, min) : fallback;
}

/** Key file contents returned from remote repo setup */
export interface RepoKeyFiles {
  claudeMd?: string;
  readmeMd?: string;
  packageInfo?: string;
}

/** Result from remote repo setup relayed from agent runner */
export interface RepoSetupRelayResult {
  success: boolean;
  workingDirectory?: string;
  fileTree?: string[];
  repository?: string;
  needsGitInit?: boolean;
  keyFiles?: RepoKeyFiles;
  source?: { localPath: string; subdirectory?: string; remoteUrl?: string; remoteType: string; baseBranch: string; isGit: boolean };
  deliveryMode?: string;
  agentDir?: string;
  error?: string;
}

/** Result from remote repo detect relayed from agent runner */
export interface RepoDetectRelayResult {
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

/** Result from remote branch list relayed from agent runner */
export interface BranchListRelayResult {
  branches: Array<{
    name: string;
    isRemote: boolean;
    isCurrent: boolean;
    isDefault: boolean;
  }>;
  defaultBranch?: string;
  error?: string;
}

/** Result from remote git checkout relayed from agent runner */
export interface GitCheckoutRelayResult {
  success: boolean;
  branch?: string;
  error?: string;
}

/** Result from remote git create-branch relayed from agent runner */
export interface GitCreateBranchRelayResult {
  success: boolean;
  branch?: string;
  error?: string;
}

/** Result from remote git init relayed from agent runner */
export interface GitInitRelayResult {
  success: boolean;
  workingDirectory?: string;
  fileTree?: string[];
  source?: Record<string, unknown>;
  deliveryMode?: string;
  error?: string;
}

// ============================================================================
// Agent Runner Message Types (for compatibility with @astroanywhere/agent package)
// ============================================================================

/** Agent runner's provider info format */
interface AgentRunnerProviderInfo {
  type: string;
  name: string;
  version: string | null;
  path: string;
  available: boolean;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    multiTurn: boolean;
    maxConcurrentTasks: number;
  };
  hpcCapability?: {
    clusterName?: string;
    partitions: string[];
    defaultPartition?: string;
    accounts: string[];
  };
}

/** Agent runner's resource format */
interface AgentRunnerResources {
  hostname: string;
  platform: string;
  arch: string;
  cpu: {
    model: string;
    cores: number;
    speed: number;
    loadAvg: number[];
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
  gpu: Array<{
    name: string;
    vendor: string;
    memoryTotal: number;
    memoryFree: number;
    utilization: number;
  }>;
}

/** Agent runner's register message format */
interface AgentRunnerRegisterMessage {
  type: 'register';
  timestamp: string;
  payload: {
    runnerId: string;
    machineId: string;
    name?: string; // Optional display name override (e.g., SSH alias like "nebius-2")
    environmentType?: string;
    providers: AgentRunnerProviderInfo[];
    executionStrategies?: Array<{
      id: string;
      name: string;
      available: boolean;
      version?: string;
      metadata?: Record<string, unknown>;
    }>;
    resources: AgentRunnerResources;
    version: string;
  };
}

/** Agent runner's heartbeat message format */
interface AgentRunnerHeartbeatMessage {
  type: 'heartbeat';
  timestamp: string;
  payload: {
    runnerId: string;
    activeTasks: string[];
    resources: AgentRunnerResources;
  };
}

/** Agent runner's task status message format */
interface AgentRunnerTaskStatusMessage {
  type: 'task_status';
  timestamp: string;
  payload: {
    taskId: string;
    status: string;
    progress?: number;
    message?: string;
  };
}

/** Agent runner's task output message format */
interface AgentRunnerTaskOutputMessage {
  type: 'task_output';
  timestamp: string;
  payload: {
    taskId: string;
    stream: 'stdout' | 'stderr';
    data: string;
    sequence: number;
  };
}

/** Agent runner's task tool trace message format */
interface AgentRunnerTaskToolTraceMessage {
  type: 'task_tool_trace';
  timestamp: string;
  payload: {
    taskId: string;
    toolName: string;
    toolInput?: unknown;
    toolResult?: unknown;
    success?: boolean;
  };
}

/** Agent runner's structured text message format */
interface AgentRunnerTaskTextMessage {
  type: 'task_text';
  timestamp: string;
  payload: {
    taskId: string;
    text: string;
    sequence: number;
  };
}

/** Agent runner's structured operational message format */
interface AgentRunnerTaskOperationalMessage {
  type: 'task_operational';
  timestamp: string;
  payload: {
    taskId: string;
    message: string;
    source: 'astro' | 'git' | 'delivery';
  };
}

/** Agent runner's structured tool use message format */
interface AgentRunnerTaskToolUseMessage {
  type: 'task_tool_use';
  timestamp: string;
  payload: {
    taskId: string;
    toolName: string;
    toolInput: unknown;
    toolUseId?: string;
  };
}

/** Agent runner's structured tool result message format */
interface AgentRunnerTaskToolResultMessage {
  type: 'task_tool_result';
  timestamp: string;
  payload: {
    taskId: string;
    toolName: string;
    result: unknown;
    success: boolean;
    toolUseId?: string;
  };
}

/** Agent runner's structured file change message format */
interface AgentRunnerTaskFileChangeMessage {
  type: 'task_file_change';
  timestamp: string;
  payload: {
    taskId: string;
    path: string;
    action: 'created' | 'modified' | 'deleted';
    linesAdded?: number;
    linesRemoved?: number;
    diff?: string;
  };
}

/** Agent runner's session init message format */
interface AgentRunnerTaskSessionInitMessage {
  type: 'task_session_init';
  timestamp: string;
  payload: {
    taskId: string;
    sessionId: string;
    model?: string;
  };
}

/** Agent runner's file list response message format */
interface AgentRunnerFileListResponseMessage {
  type: 'file_list_response';
  timestamp: string;
  payload: {
    correlationId: string;
    files: string[];
  };
}

/** Agent runner's file content response message format */
interface AgentRunnerFileContentResponseMessage {
  type: 'file_content_response';
  timestamp: string;
  payload: {
    correlationId: string;
    path: string;
    content?: string;
    encoding?: 'utf-8' | 'base64';
    mimeType?: string;
    size?: number;
    chunked?: boolean;
    chunkIndex?: number;
    totalChunks?: number;
    error?: string;
  };
}

/** Agent runner's file upload response message format */
interface AgentRunnerFileUploadResponseMessage {
  type: 'file_upload_response';
  timestamp: string;
  payload: {
    correlationId: string;
    success: boolean;
    path?: string;
    error?: string;
  };
}

/** Directory entry info */
interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
}

/** Agent runner's content search response message format */
interface AgentRunnerContentSearchResponseMessage {
  type: 'content_search_response';
  timestamp: string;
  payload: {
    correlationId: string;
    matches: Array<{ path: string; lineNo: number; line: string; matchStart: number; matchEnd: number }>;
    error?: string;
  };
}

/** Agent runner's directory list response message format */
interface AgentRunnerDirectoryListResponseMessage {
  type: 'directory_list_response';
  timestamp: string;
  payload: {
    correlationId: string;
    path: string;
    entries: DirectoryEntry[];
    error?: string;
    homeDirectory?: string;
  };
}

/** Agent runner's create directory response message format */
interface AgentRunnerCreateDirectoryResponseMessage {
  type: 'create_directory_response';
  timestamp: string;
  payload: {
    correlationId: string;
    success: boolean;
    path?: string;
    error?: string;
  };
}

/** Agent runner's repo setup response message format */
interface AgentRunnerRepoSetupResponseMessage {
  type: 'repo_setup_response';
  timestamp: string;
  payload: {
    correlationId: string;
    success: boolean;
    workingDirectory?: string;
    fileTree?: string[];
    repository?: string;
    needsGitInit?: boolean;
    source?: { localPath: string; subdirectory?: string; remoteUrl?: string; remoteType: string; baseBranch: string; isGit: boolean };
    deliveryMode?: string;
    agentDir?: string;
    error?: string;
  };
}

/** Agent runner's slash commands response message format */
interface AgentRunnerSlashCommandsResponseMessage {
  type: 'slash_commands_response';
  timestamp: string;
  payload: {
    correlationId: string;
    commands: Array<{ name: string; description: string }>;
  };
}

/** Agent runner's repo detect response message format */
interface AgentRunnerRepoDetectResponseMessage {
  type: 'repo_detect_response';
  timestamp: string;
  payload: {
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
  };
}

/** Agent runner's branch list response message format */
interface AgentRunnerBranchListResponseMessage {
  type: 'branch_list_response';
  timestamp: string;
  payload: {
    correlationId: string;
    branches: Array<{
      name: string;
      isRemote: boolean;
      isCurrent: boolean;
      isDefault: boolean;
    }>;
    defaultBranch?: string;
    error?: string;
  };
}

/** Agent runner's git checkout response message format */
interface AgentRunnerGitCheckoutResponseMessage {
  type: 'git_checkout_response';
  timestamp: string;
  payload: {
    correlationId: string;
    success: boolean;
    branch?: string;
    error?: string;
  };
}

/** Agent runner's git create-branch response message format */
interface AgentRunnerGitCreateBranchResponseMessage {
  type: 'git_create_branch_response';
  timestamp: string;
  payload: {
    correlationId: string;
    success: boolean;
    branch?: string;
    error?: string;
  };
}

/** Agent runner's sessions list response message format */
interface AgentRunnerSessionsListResponseMessage {
  type: 'sessions_list_response';
  timestamp: string;
  payload: {
    correlationId: string;
    sessions: ClaudeCodeSessionInfo[];
    error?: string;
  };
}

/** Agent runner's import sessions response message format */
interface AgentRunnerImportSessionsResponseMessage {
  type: 'import_sessions_response';
  timestamp: string;
  payload: {
    correlationId: string;
    ok: boolean;
    manifestPath?: string;
    rawCount: number;
    failures: Array<{
      provider: 'claude' | 'codex' | 'pi';
      sessionId: string;
      reason: string;
    }>;
    error?: string;
  };
}

/** Agent runner's git init response message format */
interface AgentRunnerGitInitResponseMessage {
  type: 'git_init_response';
  timestamp: string;
  payload: {
    correlationId: string;
    success: boolean;
    workingDirectory?: string;
    fileTree?: string[];
    source?: Record<string, unknown>;
    deliveryMode?: string;
    error?: string;
  };
}

/** Agent runner's steer ack message format */
interface AgentRunnerTaskSteerAckMessage {
  type: 'task_steer_ack';
  timestamp: string;
  payload: {
    taskId: string;
    accepted: boolean;
    message?: string;
    interrupted?: boolean;
  };
}

/** Agent runner's approval request message format */
interface AgentRunnerTaskApprovalRequestMessage {
  type: 'task_approval_request';
  timestamp: string;
  payload: {
    taskId: string;
    requestId: string;
    question: string;
    options: string[];
  };
}

/** Agent runner's task result message format */
interface AgentRunnerTaskResultMessage {
  type: 'task_result';
  timestamp: string;
  payload: {
    taskId: string;
    status: string;
    exitCode?: number;
    output?: string;
    error?: string;
    startedAt?: string;
    completedAt?: string;
    artifacts?: Array<{
      type: string;
      name: string;
      path?: string;
      content?: string;
      metadata?: Record<string, unknown>;
    }>;
    metrics?: {
      durationMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      totalCost?: number;
      model?: string;
      numTurns?: number;
    };
    branchName?: string;
    prUrl?: string;
    prNumber?: number;
    commitBeforeSha?: string;
    commitAfterSha?: string;
    deliveryStatus?: 'success' | 'failed' | 'skipped';
    deliveryError?: string;
    summary?: ExecutionSummaryResult;
  };
}

/** Rate limit state per machine */
interface RateLimitState {
  requests: number[];
  stdoutBytes: number;
  lastReset: number;
}

/** Attached session info */
interface AttachedSession {
  sessionId: string;
  taskId: string;
  machineId: string;
  socket: WebSocket;
  attachedAt: Date;
  eventCount: number;
}

/** Events emitted by the relay server */
export interface RelayServerEvents {
  'task:result': (result: TaskResultMessage) => void;
  'task:error': (msg: { taskId: string; error: string; recoverable?: boolean; synthetic?: boolean; _dbSeq?: number }) => void;
  'task:stdout': (output: TaskStdoutMessage) => void;
  'task:text': (msg: TaskTextMessage) => void;
  'task:operational': (msg: TaskOperationalMessage) => void;
  'task:progress': (progress: TaskProgressMessage) => void;
  'task:steer_ack': (ack: TaskSteerAckMessage) => void;
  'task:tool_trace': (trace: TaskToolTraceMessage) => void;
  'task:file_change': (change: TaskFileChangeMessage) => void;
  'task:session_init': (msg: TaskSessionInitMessage) => void;
  'task:approval_request': (msg: { taskId: string; requestId: string; question: string; options: string[]; machineId?: string }) => void;
  'task:safety_prompt': (msg: { taskId: string; safetyTier: string; warning?: string; machineId?: string; options: Array<{ id: string; label: string; description?: string }> }) => void;
  'task:dead': (data: { taskId: string; machineId: string; reason: string }) => void;
  'machine:connected': (machineId: string) => void;
  'machine:disconnected': (machineId: string, reason?: string) => void;
  'machine:reconnecting': (machineId: string, reason?: string) => void;
  // Session attachment events (MCP bridge)
  'session:attached': (sessionId: string, taskId: string, machineId: string) => void;
  'session:detached': (sessionId: string, taskId: string, reason?: string) => void;
  'session:event': (sessionId: string, taskId: string, event: SessionEvent) => void;
  'file_list:response': (data: { correlationId: string; files: string[] }) => void;
  'directory_list:response': (data: { correlationId: string; path: string; entries: DirectoryEntry[]; error?: string; homeDirectory?: string }) => void;
  'file_content:response': (data: { correlationId: string; path: string; content?: string; encoding?: string; mimeType?: string; size?: number; chunked?: boolean; chunkIndex?: number; totalChunks?: number; error?: string }) => void;
  'file_upload:response': (data: { correlationId: string; success: boolean; path?: string; error?: string }) => void;
  'create_directory:response': (data: { correlationId: string; success: boolean; path?: string; error?: string }) => void;
  'repo_setup:response': (data: { correlationId: string; result: RepoSetupRelayResult }) => void;
  'slash_commands:response': (data: { correlationId: string; commands: Array<{ name: string; description: string }> }) => void;
  'repo_detect:response': (data: { correlationId: string; result: RepoDetectRelayResult }) => void;
  'git_init:response': (data: { correlationId: string; result: GitInitRelayResult }) => void;
  'branch_list:response': (data: { correlationId: string; result: BranchListRelayResult }) => void;
  'git_checkout:response': (data: { correlationId: string; result: GitCheckoutRelayResult }) => void;
  'git_create_branch:response': (data: { correlationId: string; result: GitCreateBranchRelayResult }) => void;
  'error': (error: Error) => void;
}

export class RelayServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private config: RelayServerConfig;
  private rateLimitState: Map<string, RateLimitState> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // Session registry: sessionId -> AttachedSession
  private attachedSessions: Map<string, AttachedSession> = new Map();
  // Track which machine each task was dispatched to (for cancel without explicit machineId)
  private taskToMachine: Map<string, string> = new Map();
  // Track when each task was dispatched (for dead job grace period)
  private taskDispatchedAt: Map<string, number> = new Map();
  // Grace period timers for machines that disconnected — delays task failure to allow reconnection
  private disconnectGracePeriods: Map<string, ReturnType<typeof setTimeout>> = new Map();
  // Dead job detection: periodic cross-reference of heartbeat task IDs vs server-side tracking
  private deadJobCheckInterval: ReturnType<typeof setInterval> | null = null;
  private consecutiveMisses: Map<string, number> = new Map();
  // Dispatch ACK: timers that fire if the agent runner doesn't acknowledge a dispatch within 30s.
  // Detects lost WS messages much faster than the 5-minute dead job checker.
  private dispatchAckTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  // Periodic flush timer per task. Forces streamingEventLog to write any
  // buffered text to Postgres so the wake-up listener can publish a tiny
  // {taskId, dbSeq} notification over Redis. Without this timer, text-only
  // streams (no structural events) would sit in memory until completion.
  private redisTextFlushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly redisTextFlushIntervalMs = parseEnvMs('REDIS_TEXT_FLUSH_INTERVAL_MS', 1000, 100);
  // Listener handle for streamingEventLog 'text-flushed' events — kept so we can
  // detach on shutdown without affecting other subscribers.
  private textFlushedListener: ((event: { executionId: string; seq: number }) => void) | null = null;
  private lastPublishedMachineHeartbeatState: Map<string, { activeTaskSignature: string; publishedAt: number }> = new Map();
  private readonly redisMachineUpdateIntervalMs = parseEnvMs('REDIS_MACHINE_UPDATE_INTERVAL_MS', 300_000, 60_000);

  constructor(config: Partial<RelayServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_RELAY_CONFIG, ...config };
    // Support multiple concurrent SSE connections (default 10 is too low)
    // Each SSE client registers ~14 event listeners, so allow 50 concurrent connections
    this.setMaxListeners(700);
  }

  /**
   * Attach the singleton text-flushed → Redis wake-up bridge. Safe to call
   * multiple times — guarded so a stop()/start() cycle re-attaches exactly
   * one listener instead of leaking.
   */
  private attachTextFlushedListener(): void {
    if (this.textFlushedListener) return;
    this.textFlushedListener = ({ executionId, seq }) => {
      redisPubSub.publishStreamingEvent({
        eventType: 'text',
        taskId: executionId,
        dbSeq: seq,
        data: {},
      }).catch((err) => {
        console.error(`[relay] Failed to publish text wake-up for ${executionId}:`, err);
      });
    };
    streamingEventLog.on('text-flushed', this.textFlushedListener);
  }

  /**
   * Start the WebSocket server
   */
  async start(port?: number): Promise<void> {
    const serverPort = port ?? this.config.port;

    // Stop existing server if running (handles tsx watch restarts)
    if (this.wss) {
      await this.stop();
    }

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: serverPort,
        verifyClient: this.verifyClient.bind(this),
      });

      this.wss.on('connection', this.handleConnection.bind(this));

      this.wss.on('listening', () => {
        // Start heartbeat interval
        this.startHeartbeatInterval();

        // Start dead job cross-reference checker (P2)
        this.startDeadJobChecker();

        // Cross-instance routing: handle approval/steer/cancel from other instances
        this.registerRedisRouting();

        // Bridge durable text writes to tiny Redis wake-ups.
        this.attachTextFlushedListener();

        console.log(`[relay] WebSocket server listening on port ${serverPort}`);
        resolve();
      });

      this.wss.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.warn(`[relay] Port ${serverPort} in use, retrying in 1s...`);
          this.wss?.close();
          this.wss = null;
          setTimeout(() => {
            this.start(serverPort).then(resolve).catch(reject);
          }, 1000);
        } else {
          console.error('[relay] WebSocket server error:', error);
          this.emit('error', error);
          reject(error);
        }
      });
    });
  }

  /**
   * Stop the WebSocket server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Stop dead job checker
      if (this.deadJobCheckInterval) {
        clearInterval(this.deadJobCheckInterval);
        this.deadJobCheckInterval = null;
        redisPubSub.releaseLeadership('dead-job-checker').catch(() => {});
      }
      this.consecutiveMisses.clear();

      // Clear all pending disconnect grace periods
      for (const timer of this.disconnectGracePeriods.values()) {
        clearTimeout(timer);
      }
      this.disconnectGracePeriods.clear();

      // Clear all pending dispatch ACK timers
      for (const timer of this.dispatchAckTimers.values()) {
        clearTimeout(timer);
      }
      this.dispatchAckTimers.clear();

      for (const timer of this.redisTextFlushTimers.values()) {
        clearTimeout(timer);
      }
      this.redisTextFlushTimers.clear();
      if (this.textFlushedListener) {
        streamingEventLog.off('text-flushed', this.textFlushedListener);
        this.textFlushedListener = null;
      }
      this.lastPublishedMachineHeartbeatState.clear();

      machineRegistry.shutdown();

      if (this.wss) {
        this.wss.close(() => {
          console.log('[relay] WebSocket server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Verify client connection (JWT validation)
   */
  private verifyClient(
    info: { origin: string; req: IncomingMessage; secure: boolean },
    callback: (result: boolean, code?: number, message?: string) => void
  ): void {
    try {
      const secret = this.config.jwtSecret || process.env.RELAY_JWT_SECRET;

      // ONLY accept Authorization header (no query params for security)
      const authHeader = info.req.headers['authorization'];
      let token: string | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }

      // Dev mode bypass: allow unauthenticated connections when not in production
      const isProduction = process.env.NODE_ENV === 'production';

      if (!secret && isProduction) {
        console.error('[relay] ❌ No JWT secret configured in production mode.');
        callback(false, 500,
          'Relay server authentication is not configured. ' +
          'Server administrator must set RELAY_JWT_SECRET environment variable.'
        );
        return;
      }

      if ((!token || token === 'null' || token === 'undefined') && !isProduction) {
        // Dev mode: accept connection without auth, use headers for identity
        const runnerId = info.req.headers['x-runner-id'] as string || 'dev-runner';
        const machineId = info.req.headers['x-machine-id'] as string || 'dev-machine';
        console.warn(`[relay] ⚠ SECURITY: Dev-mode auth bypass — accepting unauthenticated WebSocket connection (runner=${runnerId}, machine=${machineId}). Set RELAY_JWT_SECRET and NODE_ENV=production before deploying.`);
        (info.req as unknown as { machineJWT: MachineJWTPayload }).machineJWT = {
          sub: machineId,
          machineId,
          scopes: ['machine:connect', 'task:execute'],
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 86400 * 365, // 1 year
        };
        callback(true);
        return;
      }

      if (!token || token === 'null' || token === 'undefined') {
        console.error('[relay] Missing authentication token');
        callback(false, 401,
          'Missing authentication token. ' +
          'Run "npx @astroanywhere/agent@latest launch" to register this machine.'
        );
        return;
      }

      try {
        console.log('[relay] Authenticating...');
        const payload = jwt.verify(token, secret) as MachineJWTPayload;
        // Store machineId in request for use in handleConnection
        (info.req as unknown as { machineJWT: MachineJWTPayload }).machineJWT = payload;
        callback(true);
      } catch (jwtErr) {
        const errName = (jwtErr as Error).name;
        const errMsg = (jwtErr as Error).message;

        console.error('[relay] JWT verification failed:', errName, errMsg);

        // Dev mode fallback: if JWT verification fails, allow connection with dev identity
        if (!isProduction) {
          const runnerId = info.req.headers['x-runner-id'] as string || 'dev-runner';
          const machineId = info.req.headers['x-machine-id'] as string || 'dev-machine';
          console.warn(`[relay] ⚠ SECURITY: Dev-mode auth fallback — JWT verification failed but accepting connection in dev mode (runner=${runnerId}, machine=${machineId}).`);
          (info.req as unknown as { machineJWT: MachineJWTPayload }).machineJWT = {
            sub: machineId,
            machineId,
            scopes: ['machine:connect', 'task:execute'],
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400 * 365,
          };
          callback(true);
          return;
        }

        let userMessage = 'Invalid authentication token. ';
        if (errName === 'TokenExpiredError') {
          userMessage += 'Token has expired. Run "npx @astroanywhere/agent@latest launch" to re-register.';
        } else if (errName === 'JsonWebTokenError' && errMsg.includes('malformed')) {
          userMessage += 'Token is malformed (possible "null" string). Run setup again.';
        } else {
          userMessage += 'Run "npx @astroanywhere/agent@latest launch" to re-register this machine.';
        }

        callback(false, 401, userMessage);
      }
    } catch (clientErr) {
      console.error('[relay] Error in verifyClient:', clientErr);
      callback(false, 500, 'Internal server error');
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: WebSocket, req: IncomingMessage): void {
    const jwtPayload = (req as unknown as { machineJWT?: MachineJWTPayload }).machineJWT;
    const machineIdFromJWT = jwtPayload?.machineId;

    console.log(`[relay] New connection from ${req.socket.remoteAddress}${machineIdFromJWT ? ` (machine: ${machineIdFromJWT})` : ''}`);

    // Store JWT payload on socket for later use
    (socket as unknown as { jwtPayload?: MachineJWTPayload }).jwtPayload = jwtPayload;

    // Initialize rate limit state
    let currentMachineId: string | null = null;

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as AgentToRelayMessage;
        this.handleMessage(socket, message, currentMachineId, (id) => {
          currentMachineId = id;
          this.initRateLimitState(id);
        });
      } catch (err) {
        console.error('[relay] Error parsing message:', err);
        this.sendError(socket, 'PARSE_ERROR', 'Invalid JSON message');
      }
    });

    socket.on('close', (code, reason) => {
      if (currentMachineId) {
        // Only act if this socket is still the active connection for this machine.
        // When a machine re-registers, the old socket is closed but the registry already
        // has the new socket — disconnecting here would kill the new connection.
        const current = machineRegistry.getConnection(currentMachineId);
        if (current && current.socket === socket) {
          const reasonStr = reason.toString() || `close_code_${code}`;
          console.log(`[relay] Connection closed for machine ${currentMachineId}: ${code} - ${reasonStr}`);
          // Start grace period instead of immediate disconnect — allows the agent runner
          // to reconnect without failing active tasks
          this.startDisconnectGracePeriod(currentMachineId, reasonStr);
        } else {
          console.log(`[relay] Stale connection closed for machine ${currentMachineId}: ${code} - ${reason.toString()} (ignored, new connection active)`);
        }
      }
    });

    socket.on('error', (err) => {
      console.error(`[relay] Socket error for machine ${currentMachineId}:`, err);
      if (currentMachineId) {
        const current = machineRegistry.getConnection(currentMachineId);
        if (current && current.socket === socket) {
          // Start grace period instead of immediate disconnect
          this.startDisconnectGracePeriod(currentMachineId, 'socket_error');
        }
      }
    });
  }

  /**
   * Handle incoming message from agent runner
   */
  private handleMessage(
    socket: WebSocket,
    message: AgentToRelayMessage,
    machineId: string | null,
    setMachineId: (id: string) => void
  ): void {
    // Rate limit check (except for registration)
    if (machineId && message.type !== 'machine.register') {
      if (!this.checkRateLimit(machineId)) {
        this.sendError(socket, 'RATE_LIMITED', 'Too many requests');
        return;
      }
    }

    // Defense-in-depth: ANY task message from the agent runner implicitly ACKs the dispatch.
    // This ensures the 30s ACK timer is cleared even if the agent-runner version doesn't
    // send explicit task_dispatch_ack (safe for rolling deployments).
    if (typeof message.type === 'string' && message.type.startsWith('task')) {
      const payload = (message as { payload?: { taskId?: string } }).payload;
      const taskId = payload?.taskId;
      if (taskId) {
        const ackTimer = this.dispatchAckTimers.get(taskId);
        if (ackTimer) {
          clearTimeout(ackTimer);
          this.dispatchAckTimers.delete(taskId);
        }
      }
    }

    switch (message.type) {
      case 'machine.register':
        this.handleMachineRegister(socket, message as MachineRegisterMessage, setMachineId);
        break;

      // Support agent-runner's 'register' message format (legacy compatibility)
      case 'register':
        this.handleAgentRunnerRegister(socket, message as AgentRunnerRegisterMessage, setMachineId);
        break;

      case 'machine.unregister':
        this.handleMachineUnregister(message as MachineUnregisterMessage);
        break;

      case 'machine.status':
        this.handleMachineStatus(message as MachineStatusMessage);
        break;

      case 'provider.status':
        this.handleProviderStatus(message as ProviderStatusMessage);
        break;

      case 'task.result':
        this.handleTaskResult(message as TaskResultMessage);
        break;

      // Support agent-runner's 'task_result' message format (legacy compatibility)
      case 'task_result':
        this.handleAgentRunnerTaskResult(message as AgentRunnerTaskResultMessage);
        break;

      case 'task.stdout':
        this.handleTaskStdout(message as TaskStdoutMessage);
        break;

      // Support agent-runner's 'task_output' message format (legacy compatibility)
      case 'task_output':
        this.handleAgentRunnerTaskOutput(message as AgentRunnerTaskOutputMessage);
        break;

      case 'task.progress':
        this.handleTaskProgress(message as TaskProgressMessage);
        break;

      // Support agent-runner's 'task_status' message format (legacy compatibility)
      case 'task_status':
        this.handleAgentRunnerTaskStatus(message as AgentRunnerTaskStatusMessage);
        break;

      // Support agent-runner's 'task_tool_trace' message format
      case 'task_tool_trace':
        this.handleAgentRunnerTaskToolTrace(message as AgentRunnerTaskToolTraceMessage);
        break;

      // Structured message types from agent-runner
      case 'task_text':
        this.handleAgentRunnerTaskText(message as AgentRunnerTaskTextMessage);
        break;

      case 'task_operational':
        this.handleAgentRunnerTaskOperational(message as AgentRunnerTaskOperationalMessage);
        break;

      case 'task_tool_use':
        this.handleAgentRunnerTaskToolUse(message as AgentRunnerTaskToolUseMessage);
        break;

      case 'task_tool_result':
        this.handleAgentRunnerTaskToolResult(message as AgentRunnerTaskToolResultMessage);
        break;

      case 'task_file_change':
        this.handleAgentRunnerTaskFileChange(message as AgentRunnerTaskFileChangeMessage);
        break;

      case 'task_session_init':
        this.handleAgentRunnerTaskSessionInit(message as AgentRunnerTaskSessionInitMessage);
        break;

      case 'task_steer_ack':
        this.handleAgentRunnerTaskSteerAck(message as AgentRunnerTaskSteerAckMessage);
        break;

      case 'task_dispatch_ack':
        this.handleTaskDispatchAck(message as { type: 'task_dispatch_ack'; payload: { taskId: string } });
        break;

      case 'task_approval_request':
        this.handleAgentRunnerTaskApprovalRequest(message as AgentRunnerTaskApprovalRequestMessage);
        break;

      // Safety prompt from agent runner — forward as event for browser to display
      case 'task_safety_prompt': {
        const payload = (message as { payload: { taskId: string; safetyTier: string; warning?: string; options: unknown[] } }).payload;
        if (payload?.taskId) {
          const safetyMachineId = this.taskToMachine.get(payload.taskId);
          streamingEventLog.appendSafetyPromptIfAbsent(payload.taskId, {
            safetyTier: payload.safetyTier,
            warning: payload.warning,
            machineId: safetyMachineId,
            options: payload.options as Array<{ id: string; label: string; description?: string }>,
          }).catch((err) => {
            console.warn(`[relay] Failed to persist safety prompt for ${payload.taskId}:`, err);
          });
          this.emit('task:safety_prompt', { ...payload, machineId: safetyMachineId });
          console.log(`[relay] Safety prompt for task ${payload.taskId} (tier: ${payload.safetyTier})`);
          // Bridge cross-instance so the dispatch instance sets waitingForApproval correctly.
          this.publishToRedis({
            eventType: 'safety_prompt',
            taskId: payload.taskId,
            data: { safetyTier: payload.safetyTier, warning: payload.warning, options: payload.options, machineId: safetyMachineId },
          }).catch(() => {});
        }
        break;
      }

      case 'task.steer.ack':
        this.handleTaskSteerAck(message as TaskSteerAckMessage);
        break;

      case 'task.tool_trace':
        this.handleTaskToolTrace(message as TaskToolTraceMessage);
        break;

      case 'task.file_change':
        this.handleTaskFileChange(message as TaskFileChangeMessage);
        break;

      case 'heartbeat.pong':
        this.handleHeartbeatPong(message as HeartbeatPongMessage);
        break;

      // Support agent-runner's 'heartbeat' message format (legacy compatibility)
      case 'heartbeat':
        this.handleAgentRunnerHeartbeat(socket, message as AgentRunnerHeartbeatMessage);
        break;

      // File list response from agent runner
      case 'file_list.response':
        this.handleFileListResponse(message as unknown as { type: 'file_list.response'; correlationId: string; files: string[] });
        break;

      case 'file_list_response':
        this.handleAgentRunnerFileListResponse(message as unknown as AgentRunnerFileListResponseMessage);
        break;

      // Directory list response from agent runner (for path browsing)
      case 'directory_list.response':
        this.handleDirectoryListResponse(message as unknown as { type: 'directory_list.response'; correlationId: string; path: string; entries: DirectoryEntry[]; error?: string; homeDirectory?: string });
        break;

      case 'directory_list_response':
        this.handleAgentRunnerDirectoryListResponse(message as unknown as AgentRunnerDirectoryListResponseMessage);
        break;

      // File content response from agent runner (for reading remote files)
      case 'file_content.response':
        this.handleFileContentResponse(message as unknown as FileContentResponseMessage);
        break;

      case 'file_content_response':
        this.handleAgentRunnerFileContentResponse(message as unknown as AgentRunnerFileContentResponseMessage);
        break;

      case 'content_search_response':
        this.handleAgentRunnerContentSearchResponse(message as unknown as AgentRunnerContentSearchResponseMessage);
        break;

      // File upload response from agent runner (for writing remote files)
      case 'file_upload.response':
        this.handleFileUploadResponse(message as unknown as FileUploadResponseMessage);
        break;

      case 'file_upload_response':
        this.handleAgentRunnerFileUploadResponse(message as unknown as AgentRunnerFileUploadResponseMessage);
        break;

      // Create directory response from agent runner
      case 'create_directory.response':
        this.handleCreateDirectoryResponse(message as unknown as { type: 'create_directory.response'; correlationId: string; success: boolean; path?: string; error?: string });
        break;

      case 'create_directory_response':
        this.handleAgentRunnerCreateDirectoryResponse(message as unknown as AgentRunnerCreateDirectoryResponseMessage);
        break;

      // Repo setup response from agent runner
      case 'repo_setup.response':
        this.handleRepoSetupResponse(message as unknown as { type: 'repo_setup.response'; correlationId: string; result: RepoSetupRelayResult });
        break;

      case 'repo_setup_response':
        this.handleAgentRunnerRepoSetupResponse(message as unknown as AgentRunnerRepoSetupResponseMessage);
        break;

      // Slash commands response from agent runner
      case 'slash_commands.response':
        this.handleSlashCommandsResponse(message as unknown as { type: 'slash_commands.response'; correlationId: string; commands: Array<{ name: string; description: string }> });
        break;

      case 'slash_commands_response':
        this.handleAgentRunnerSlashCommandsResponse(message as unknown as AgentRunnerSlashCommandsResponseMessage);
        break;

      // Repo detect response from agent runner
      case 'repo_detect.response':
        this.handleRepoDetectResponse(message as unknown as { type: 'repo_detect.response'; correlationId: string; result: RepoDetectRelayResult });
        break;

      case 'repo_detect_response':
        this.handleAgentRunnerRepoDetectResponse(message as unknown as AgentRunnerRepoDetectResponseMessage);
        break;

      // Git init response from agent runner
      case 'git_init.response':
        this.handleGitInitResponse(message as unknown as { type: 'git_init.response'; correlationId: string; result: GitInitRelayResult });
        break;

      case 'git_init_response':
        this.handleAgentRunnerGitInitResponse(message as unknown as AgentRunnerGitInitResponseMessage);
        break;

      // Branch list response from agent runner
      case 'branch_list.response':
        this.handleBranchListResponse(message as unknown as { type: 'branch_list.response'; correlationId: string; result: BranchListRelayResult });
        break;

      case 'branch_list_response':
        this.handleAgentRunnerBranchListResponse(message as unknown as AgentRunnerBranchListResponseMessage);
        break;

      // Git checkout response from agent runner
      case 'git_checkout.response':
        this.handleGitCheckoutResponse(message as unknown as { type: 'git_checkout.response'; correlationId: string; result: GitCheckoutRelayResult });
        break;

      case 'git_checkout_response':
        this.handleAgentRunnerGitCheckoutResponse(message as unknown as AgentRunnerGitCheckoutResponseMessage);
        break;

      // Git create-branch response from agent runner
      case 'git_create_branch.response':
        this.handleGitCreateBranchResponse(message as unknown as { type: 'git_create_branch.response'; correlationId: string; result: GitCreateBranchRelayResult });
        break;

      case 'git_create_branch_response':
        this.handleAgentRunnerGitCreateBranchResponse(message as unknown as AgentRunnerGitCreateBranchResponseMessage);
        break;

      // Sessions list response from agent runner (Claude Code session discovery)
      case 'sessions_list.response':
        this.handleSessionsListResponse(message as unknown as { type: 'sessions_list.response'; correlationId: string; sessions: ClaudeCodeSessionInfo[]; error?: string });
        break;

      case 'sessions_list_response':
        this.handleAgentRunnerSessionsListResponse(message as unknown as AgentRunnerSessionsListResponseMessage);
        break;

      case 'import_sessions_response':
        this.handleAgentRunnerImportSessionsResponse(message as unknown as AgentRunnerImportSessionsResponseMessage);
        break;

      // Defensive: also handle the dot-notation form declared in
      // ImportSessionsResponseMessage. Today the agent-runner sends the
      // underscore form above; the dot form exists so any future
      // intermediary (MCP bridge, synthetic server message) gets routed.
      case 'import_sessions.response':
        this.handleAgentRunnerImportSessionsResponse({
          type: 'import_sessions_response',
          timestamp: (message as { timestamp?: string }).timestamp ?? new Date().toISOString(),
          payload: message as unknown as AgentRunnerImportSessionsResponseMessage['payload'],
        });
        break;

      // Session attachment messages (MCP bridge)
      case 'session.attach':
        this.handleSessionAttach(socket, message as SessionAttachMessage).catch((err) => {
          console.error('[relay] handleSessionAttach error:', err);
        });
        break;

      case 'session.detach':
        this.handleSessionDetach(message as SessionDetachMessage);
        break;

      case 'session.event':
        this.handleSessionEvent(message as SessionEventMessage);
        break;

      // Acknowledgment messages from agent runner — log and discard (no forwarding needed)
      case 'resource_update':
        // Heartbeat already carries load info; resource_update is redundant
        console.log(`[relay] Resource update received (ignored — load info via heartbeat)`);
        break;

      case 'task_approval_response':
        console.log(`[relay] Approval response ack received for task ${(message as { payload?: { taskId?: string } }).payload?.taskId ?? 'unknown'}`);
        break;

      case 'task_safety_response':
        console.log(`[relay] Safety response ack received for task ${(message as { payload?: { taskId?: string } }).payload?.taskId ?? 'unknown'}`);
        break;

      // Channel relay messages (agent runner → relay → channel adapter)
      case 'channel_notification_ack':
      case 'channel.notification.ack':
        this.emit('channel:notification_ack', (message as { payload?: { correlationId?: string; success?: boolean; error?: string } }).payload);
        break;

      case 'channel_response_ack':
      case 'channel.response.ack':
        this.emit('channel:response_ack', (message as { payload?: { correlationId?: string; success?: boolean; error?: string } }).payload);
        break;

      case 'channel_approval_response':
      case 'channel.approval_response':
        this.emit('channel:approval_response', (message as { payload?: { correlationId?: string; approvalId?: string; response?: string } }).payload);
        break;

      case 'channel_inbound':
      case 'channel.inbound':
        this.emit('channel:inbound', (message as { payload?: Record<string, unknown> }).payload);
        break;

      default:
        console.warn(`[relay] Unknown message type: ${(message as { type: string }).type}`);
        this.sendError(socket, 'UNKNOWN_MESSAGE', `Unknown message type: ${(message as { type: string }).type}`);
    }
  }

  /**
   * Handle machine registration
   */
  private handleMachineRegister(
    socket: WebSocket,
    message: MachineRegisterMessage,
    setMachineId: (id: string) => void
  ): void {
    const { machineId, machineInfo } = message;

    try {
      // Cancel any pending disconnect grace period — machine is reconnecting
      this.cancelDisconnectGracePeriod(machineId);

      // Extract userId from JWT payload stored on socket
      const jwtPayload = (socket as unknown as { jwtPayload?: MachineJWTPayload }).jwtPayload;
      const userId = jwtPayload?.userId || LOCAL_USER_ID;

      const entry = machineRegistry.register(machineId, machineInfo, socket, userId);
      setMachineId(machineId);
      this.lastPublishedMachineHeartbeatState.delete(machineId);

      // Set up heartbeat timeout
      this.resetHeartbeatTimer(machineId);

      // Send acknowledgment
      const ack: MachineRegisterAckMessage = {
        type: 'machine.register.ack',
        timestamp: new Date(),
        machineId,
        sessionId: entry.sessionId,
        success: true,
      };
      this.sendMessage(socket, ack);

      this.emit('machine:connected', machineId, userId);
      console.log(`[relay] Machine ${machineId} registered successfully for user ${userId}`);
    } catch (err) {
      console.error(`[relay] Error registering machine ${machineId}:`, err);
      const ack: MachineRegisterAckMessage = {
        type: 'machine.register.ack',
        timestamp: new Date(),
        machineId,
        sessionId: '',
        success: false,
        error: (err as Error).message,
      };
      this.sendMessage(socket, ack);
    }
  }

  /**
   * Handle machine unregistration
   */
  private handleMachineUnregister(message: MachineUnregisterMessage): void {
    const { machineId, reason } = message;
    // Explicit unregister — cancel any grace period and disconnect immediately
    this.cancelDisconnectGracePeriod(machineId);
    this.lastPublishedMachineHeartbeatState.delete(machineId);
    machineRegistry.disconnect(machineId, reason || 'client_unregister');
    this.emit('machine:disconnected', machineId, reason);
  }

  /**
   * Handle machine status update
   */
  private handleMachineStatus(message: MachineStatusMessage): void {
    const { machineId, load, providers } = message;
    machineRegistry.updateLoad(machineId, load);

    if (providers) {
      for (const provider of providers) {
        machineRegistry.updateProvider(machineId, provider);
      }
    }

    this.resetHeartbeatTimer(machineId);
  }

  /**
   * Handle provider status update
   */
  private handleProviderStatus(message: ProviderStatusMessage): void {
    const { machineId, provider } = message;
    machineRegistry.updateProvider(machineId, provider);
  }

  /**
   * Publish a streaming event to Redis with userId for cross-instance user isolation.
   * Looks up the task owner from executionContextStore so receiving instances can
   * filter by user without relying on their own (empty) in-memory store.
   *
   * Uses async getUserIdForTaskWithFallback() which checks the local Map first,
   * then falls back to Redis. This is critical for the cross-instance case where
   * the WebSocket instance (receiving agent events) is NOT the dispatch instance
   * (which registered the execution context). The fallback caches locally, so
   * only the first event per task triggers a Redis lookup.
   */
  private async publishToRedis(event: Omit<StreamingEventMessage, 'instanceId'>): Promise<void> {
    try {
      if (event.eventType === 'text') {
        const text = typeof event.data.text === 'string' ? event.data.text : '';
        if (text.length === 0) {
          // Empty heartbeat: tiny activity ping, no DB row, no payload.
          const userId = await executionContextStore.getUserIdForTaskWithFallback(event.taskId);
          await redisPubSub.publishStreamingEvent({
            eventType: 'activity',
            taskId: event.taskId,
            userId,
            data: { source: 'task_text_heartbeat' },
          });
          return;
        }
        // Text was already buffered into streamingEventLog by handleAgentRunnerTaskText.
        // Schedule a periodic DB flush so the wake-up listener publishes promptly
        // even when the stream contains no structural events. The actual Redis
        // publish happens via the 'text-flushed' subscriber in the constructor.
        this.scheduleTextFlush(event.taskId);
        return;
      }

      // Non-text events: streamingEventLog.append() already auto-flushed pending
      // text and emitted its wake-up before we got here. Do NOT cancel the
      // periodic flush timer — text chunks that arrived during the structural
      // event's await window are still buffered and need the timer to flush
      // them. flushText() is a safe no-op if the buffer is empty.
      const userId = await executionContextStore.getUserIdForTaskWithFallback(event.taskId);
      await redisPubSub.publishStreamingEvent({ ...event, userId });
    } catch (err) {
      console.error(`[relay] Failed to publish ${event.eventType} to Redis:`, err);
    }
  }

  /**
   * Ensure streamingEventLog flushes any buffered text within the configured
   * interval. The wake-up Redis publish is driven by the 'text-flushed' event
   * the log emits after the durable insert completes.
   */
  private scheduleTextFlush(taskId: string): void {
    if (this.redisTextFlushTimers.has(taskId)) return;
    const timer = setTimeout(() => {
      this.redisTextFlushTimers.delete(taskId);
      streamingEventLog.flushText(taskId).catch((err) => {
        console.error(`[relay] flushText(${taskId}) failed:`, err);
      });
    }, this.redisTextFlushIntervalMs);
    this.redisTextFlushTimers.set(taskId, timer);
  }

  private cancelTextFlush(taskId: string): void {
    const timer = this.redisTextFlushTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.redisTextFlushTimers.delete(taskId);
    }
  }

  /**
   * Cross-instance text wake-up handler. Fetches the durable text row from
   * Postgres by (taskId, seq) and emits a local task:text event so existing
   * SSE listeners (events.ts, dispatch.ts, agent.ts, channel-router) deliver
   * it identically to a locally-originated event.
   *
   * Fire-and-forget: we never await this from the Redis subscriber so the
   * dispatch loop isn't gated on a Postgres round-trip.
   */
  private fetchAndEmitText(taskId: string, seq: number): void {
    streamingEventLog.getOne(taskId, seq).then((event) => {
      if (!event || event.eventType !== 'text') return;
      const text = (event.data as { text?: string })?.text ?? '';
      this.emit('task:text', {
        type: 'task.text',
        timestamp: event.createdAt,
        taskId,
        text,
        sequence: 0,
      });
    }).catch((err) => {
      console.error(`[relay] fetchAndEmitText(${taskId}, ${seq}) failed:`, err);
    });
  }

  private async emitSyntheticTaskError(
    taskId: string,
    error: string,
    options?: { recoverable?: boolean; reason?: string },
  ): Promise<number> {
    const data = {
      error,
      synthetic: true,
      recoverable: options?.recoverable ?? false,
      ...(options?.reason ? { reason: options.reason } : {}),
    }
    const seq = await streamingEventLog.appendTerminalIfAbsent(taskId, 'error', data)
    executionEventBus.emit('task:error', { taskId, ...data, seq })
    await this.publishToRedis({
      eventType: 'error',
      taskId,
      data,
      dbSeq: seq,
    })
    return seq
  }

  /**
   * Handle task result
   */
  private async handleTaskResult(message: TaskResultMessage): Promise<void> {
    console.log(`[relay] Task result received: ${message.result.taskId} - ${message.result.status}`);
    this.taskToMachine.delete(message.result.taskId);
    this.taskDispatchedAt.delete(message.result.taskId);
    this.consecutiveMisses.delete(message.result.taskId);
    const ackTimer2 = this.dispatchAckTimers.get(message.result.taskId);
    if (ackTimer2) { clearTimeout(ackTimer2); this.dispatchAckTimers.delete(message.result.taskId); }
    redisPubSub.removeTaskMapping(message.result.taskId).catch(() => {});
    // Snapshot userId BEFORE emit — dispatch.ts's onResult handler synchronously
    // calls executionContextStore.remove(), so getUserIdForTask returns undefined
    // after emit returns. Uses async fallback for cross-instance case where the
    // WebSocket instance is not the dispatch instance.
    let userId: string | undefined;
    try {
      userId = await executionContextStore.getUserIdForTaskWithFallback(message.result.taskId);
    } catch {
      userId = executionContextStore.getUserIdForTask(message.result.taskId);
    }
    const resultData = {
      status: message.result.status,
      output: message.result.output,
      error: message.result.error,
      duration: message.result.duration,
      branchName: message.result.branchName,
      prUrl: message.result.prUrl,
      prNumber: message.result.prNumber,
      deliveryStatus: message.result.deliveryStatus,
      deliveryError: message.result.deliveryError,
      summary: message.result.summary,
      metrics: message.result.metrics,
    }
    // Use appendResultOverridingSyntheticError to recover from disconnect errors.
    // If the agent completed work after a grace period expiry marked the task as failed,
    // the synthetic error is soft-deleted and the real result is persisted.
    const { seq, overrodeSynthetic } = await streamingEventLog.appendResultOverridingSyntheticError(
      message.result.taskId, resultData,
    );

    if (overrodeSynthetic) {
      console.warn(
        `[relay] Late result recovery: task ${message.result.taskId} completed after disconnect. ` +
        `Synthetic error overridden with real result (status: ${message.result.status}).`,
      );
      // The dispatch SSE handler has been cleaned up (onMachineDisconnected called cleanupResult).
      // Recover the DB state directly: update task_executions and plan_nodes.
      await this.recoverLateResult(message.result.taskId, message.result.status, resultData);
    }

    // appendTerminalIfAbsent above already flushed pending text and emitted
    // the text-flushed wake-up. Just cancel any pending periodic flush timer.
    this.cancelTextFlush(message.result.taskId);
    this.emit('task:result', message);
    redisPubSub.publishStreamingEvent({
      eventType: 'result', taskId: message.result.taskId, userId,
      data: resultData,
      dbSeq: seq,
    }).catch((err) => {
      console.error(`[relay] Failed to publish result to Redis:`, err);
    });
  }

  /**
   * Recover DB state when a real task result arrives after a synthetic disconnect error.
   * Updates task_executions and plan_nodes to reflect the actual outcome.
   */
  private async recoverLateResult(
    executionId: string,
    status: string,
    resultData: Record<string, unknown>,
  ): Promise<void> {
    try {
      // Look up the task execution to find nodeClientId and projectId
      const [exec] = await db.select({
        nodeClientId: taskExecutions.nodeClientId,
        projectId: taskExecutions.projectId,
      })
        .from(taskExecutions)
        .where(eq(taskExecutions.executionId, executionId))
        .limit(1)

      if (!exec) {
        console.warn(`[relay] Late result recovery: no task_execution found for ${executionId}`)
        return
      }

      const isSuccess = status === 'completed'

      // Update task_executions
      await db.update(taskExecutions)
        .set({
          status: isSuccess ? 'success' : 'failure',
          error: isSuccess ? null : (resultData.error as string) || null,
          completedAt: new Date(),
        })
        .where(eq(taskExecutions.executionId, executionId))

      // Update plan_nodes — set to awaiting_judgment so the user reviews the late result.
      // Guard: only update if the node's executionId still matches this execution OR is null
      // (watchdog cleared it). If a different executionId is set, a new execution was dispatched
      // and we must not clobber it.
      const nodeStatus = 'awaiting_judgment' as const
      await db.update(planNodes)
        .set({
          status: nodeStatus,
          executionId,  // restore link so frontend can show the execution output
          executionError: isSuccess
            ? null
            : (resultData.error as string) || 'Agent returned non-completed status',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(planNodes.clientId, exec.nodeClientId),
            eq(planNodes.projectId, exec.projectId),
            or(
              eq(planNodes.executionId, executionId),
              isNull(planNodes.executionId),
            ),
          ),
        )

      // Notify frontend of the status change
      executionEventBus.emit('node:status_changed', {
        nodeId: exec.nodeClientId,
        projectId: exec.projectId,
        status: nodeStatus,
        executionId,
      })

      console.log(
        `[relay] Late result recovery complete: execution=${executionId} node=${exec.nodeClientId} ` +
        `status=${isSuccess ? 'success' : 'failure'} → node set to awaiting_judgment`,
      )
    } catch (err) {
      console.error(`[relay] Late result recovery failed for ${executionId}:`, (err as Error).message)
    }
  }

  /**
   * Handle task stdout/stderr
   */
  private handleTaskStdout(message: TaskStdoutMessage): void {
    // Rate limit stdout bytes
    const state = this.rateLimitState.get(message.output.taskId.split('-')[0]);
    if (state) {
      state.stdoutBytes += message.output.data.length;
      const timeSinceReset = Date.now() - state.lastReset;
      const bytesPerSecond = (state.stdoutBytes / timeSinceReset) * 1000;

      if (bytesPerSecond > this.config.rateLimit.maxStdoutBytesPerSecond) {
        console.warn(`[relay] Stdout rate limit exceeded for task ${message.output.taskId}`);
        return; // Drop the message
      }
    }

    this.emit('task:stdout', message);
    this.publishToRedis({
      eventType: 'text', taskId: message.output.taskId,
      data: { text: message.output.data },
    });
  }

  /**
   * Handle task progress update
   */
  private handleTaskProgress(message: TaskProgressMessage): void {
    this.emit('task:progress', message);
    this.publishToRedis({
      eventType: 'progress', taskId: message.taskId,
      data: { progress: message.progress, message: message.message },
    });
  }

  /**
   * Handle task steer acknowledgment
   */
  private handleTaskSteerAck(message: TaskSteerAckMessage): void {
    console.log(`[relay] Steer ack for task ${message.taskId}: accepted=${message.accepted}`);
    this.emit('task:steer_ack', message);
  }

  /**
   * Handle task tool trace
   */
  private handleTaskToolTrace(message: TaskToolTraceMessage): void {
    this.emit('task:tool_trace', message);
    const eventType = message.toolResult !== undefined ? 'tool_result' as const : 'tool_use' as const;
    this.publishToRedis({
      eventType, taskId: message.taskId,
      data: { toolName: message.toolName, toolInput: message.toolInput, toolResult: message.toolResult, success: message.success, duration: message.duration },
    });
  }

  /**
   * Handle task file change
   */
  private handleTaskFileChange(message: TaskFileChangeMessage): void {
    this.emit('task:file_change', message);
    this.publishToRedis({
      eventType: 'file_change', taskId: message.taskId,
      data: { path: message.path, action: message.action, linesAdded: message.linesAdded, linesRemoved: message.linesRemoved, diff: message.diff },
    });
  }

  /**
   * Handle heartbeat pong
   */
  private handleHeartbeatPong(message: HeartbeatPongMessage): void {
    const { machineId } = message;
    machineRegistry.recordHeartbeat(machineId);
    this.resetHeartbeatTimer(machineId);
  }

  /**
   * Dispatch a task to an agent runner
   * @param userId - Authenticated user ID for machine ownership filtering
   */
  dispatchTask(task: TaskDispatch, targetMachineId?: string, userId?: string, teamSharedMachineIds?: Set<string>): boolean {
    let machineId = targetMachineId;

    // Find best machine if not specified
    if (!machineId) {
      let bestMachine = machineRegistry.findBestMachine(
        task.preferredProvider,
        userId,
        teamSharedMachineIds,
      );

      // Fallback: try without provider filter if no machine matches
      if (!bestMachine && task.preferredProvider) {
        bestMachine = machineRegistry.findBestMachine(undefined, userId, teamSharedMachineIds);
        if (bestMachine) {
          console.log(`[relay] No '${task.preferredProvider}' provider available, falling back to machine ${bestMachine.machineId}`);
        }
      }

      if (!bestMachine) {
        console.error(`[relay] No available machine for task ${task.taskId}`);
        return false;
      }
      machineId = bestMachine.machineId;
    }

    let connection = machineRegistry.getConnection(machineId);

    // Fallback: if target machine is not connected, try finding any available machine
    if (!connection && targetMachineId) {
      console.warn(`[relay] Target machine ${machineId} not connected for task ${task.taskId}, falling back to best available`);
      const bestMachine = machineRegistry.findBestMachine(task.preferredProvider, userId, teamSharedMachineIds)
        || (task.preferredProvider ? machineRegistry.findBestMachine(undefined, userId, teamSharedMachineIds) : null);
      if (bestMachine) {
        console.info(`[relay] Fallback selected machine ${bestMachine.machineId} (${bestMachine.name || 'unnamed'}) for task ${task.taskId}`);
        machineId = bestMachine.machineId;
        connection = machineRegistry.getConnection(machineId);
      }
    }

    if (!connection) {
      console.error(`[relay] No available machine for task ${task.taskId}${targetMachineId ? ` (target ${targetMachineId} not connected)` : ''}`);
      return false;
    }

    // Build prompt: use pre-built prompt if provided, otherwise construct from parts
    let finalPrompt: string;
    if (task.prompt) {
      finalPrompt = task.prompt;
    } else {
      const promptParts: string[] = [];
      if (task.visionDoc) {
        promptParts.push(`## Project Vision\n\n${task.visionDoc}`);
      }
      if (task.dependencies && task.dependencies.length > 0) {
        promptParts.push(`## Previous Task Outputs\n\n${task.dependencies.join('\n\n---\n\n')}`);
      }
      promptParts.push(`## Current Task\n\n**${task.title}**\n\n${task.description}`);
      promptParts.push(`## Instructions\n\nExecute the task described above. Focus on completing the task thoroughly and correctly.\n- Use appropriate tools to accomplish the task\n- Report progress and any issues encountered\n- Verify your work when possible\n- Be thorough but efficient`);
      finalPrompt = promptParts.join('\n\n---\n\n');
    }

    // Send in agent-runner's expected format (type: 'task_dispatch', payload: Task)
    // New fields (type, systemPrompt, messages, model) are forwarded when present.
    // Agent runners that don't recognize them will ignore them (backward-compatible).
    const agentRunnerMsg: Record<string, unknown> = {
      type: 'task_dispatch',
      timestamp: new Date().toISOString(),
      payload: {
        id: task.taskId,
        projectId: task.projectId,
        planNodeId: task.nodeId,
        provider: task.preferredProvider || connection.entry.providers.find(p => p.status === 'available')?.type || connection.entry.providers[0]?.type || 'claude-sdk',
        prompt: finalPrompt,
        workingDirectory: task.workingDirectory || '',
        timeout: task.timeout,
        maxTurns: task.maxTurns,
        outputFormat: task.outputFormat,
        executionStrategy: task.executionStrategy || undefined,
        createdAt: new Date().toISOString(),
        // New relay protocol fields
        ...(task.type && { type: task.type }),
        ...(task.systemPrompt && { systemPrompt: task.systemPrompt }),
        ...(task.messages && { messages: task.messages }),
        ...(task.model && { model: task.model }),
        ...(task.effort && { effort: task.effort }),
        // Workspace/delivery fields
        ...(task.deliveryMode && { deliveryMode: task.deliveryMode }),
        ...(task.remoteType && { remoteType: task.remoteType }),
        ...(task.agentDir && { agentDir: task.agentDir }),
        ...(task.baseBranch && { baseBranch: task.baseBranch }),
        ...(task.deliveryBranch && { deliveryBranch: task.deliveryBranch }),
        ...(task.projectBranch && { projectBranch: task.projectBranch }),
        ...(task.deliveryBranchIsSingleton !== undefined && { deliveryBranchIsSingleton: task.deliveryBranchIsSingleton }),
        ...(task.worktreeStrategy && { worktreeStrategy: task.worktreeStrategy }),
        ...(task.useWorktree !== undefined && { useWorktree: task.useWorktree }),
        ...(task.skipSafetyCheck !== undefined && { skipSafetyCheck: task.skipSafetyCheck }),
        // Task metadata for PR titles and branch names
        ...(task.title && { title: task.title }),
        ...(task.description && { description: task.description }),
        // Multimodal image attachments
        ...(task.images && task.images.length > 0 && { images: task.images }),
        // Compact IDs for branch names and PR titles
        ...(task.shortNodeId && { shortNodeId: task.shortNodeId }),
        ...(task.shortProjectId && { shortProjectId: task.shortProjectId }),
        // PR body enrichment fields
        ...(task.astroBaseUrl && { astroBaseUrl: task.astroBaseUrl }),
        ...(task.githubIssueUrl && { githubIssueUrl: task.githubIssueUrl }),
        ...(task.githubIssueNumber !== undefined && { githubIssueNumber: task.githubIssueNumber }),
        ...(task.dispatchSignature && { dispatchSignature: task.dispatchSignature }),
        ...(task.dispatchSigningPayload && { dispatchSigningPayload: task.dispatchSigningPayload }),
        ...(task.dispatchTrustedKeys && task.dispatchTrustedKeys.length > 0 && { dispatchTrustedKeys: task.dispatchTrustedKeys }),
        // Session resumption
        ...(task.resumeSessionId && { resumeSessionId: task.resumeSessionId }),
        // Extra folders mounted alongside the primary workingDirectory (agent-runner v0.6.0+)
        ...(task.additionalFolders && task.additionalFolders.length > 0 && { additionalFolders: task.additionalFolders }),
      },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // Remote machine (connected to another instance) — route via Redis pub/sub
      if (!connection.socket && redisPubSub.isConnected()) {
        console.log(`[relay] Machine ${machineId} is remote — routing task ${task.taskId} via Redis`);
        redisPubSub.requestTaskDispatch(task, machineId, userId).catch((err) => {
          console.error(`[relay] Failed to route dispatch via Redis for task ${task.taskId}:`, err);
        });
        this.taskToMachine.set(task.taskId, machineId);
        this.taskDispatchedAt.set(task.taskId, Date.now());
        redisPubSub.mapTaskToMachine(task.taskId, machineId).catch(() => {});
        return true;
      }
      console.error(`[relay] Failed to send dispatch for task ${task.taskId} to machine ${machineId} (socket not open)`);
      notifyWarning(`WebSocket dispatch send failed for task ${task.taskId} — machine ${machineId} socket not open`);
      return false;
    }
    socket.send(JSON.stringify(agentRunnerMsg));
    this.taskToMachine.set(task.taskId, machineId);
    this.taskDispatchedAt.set(task.taskId, Date.now());
    // Write-through to Redis for cross-instance cancel/steer routing
    redisPubSub.mapTaskToMachine(task.taskId, machineId).catch((err) => {
      console.error(`[relay] Failed to write taskToMachine to Redis:`, err);
    });

    // Start dispatch ACK timer — if the agent runner doesn't acknowledge
    // within 30s, the WS message was likely lost (e.g., during reconnection).
    // This detects lost dispatches in 30s instead of the 5-minute dead job checker.
    const DISPATCH_ACK_TIMEOUT_MS = 30_000;
    const ackTimer = setTimeout(() => {
      this.dispatchAckTimers.delete(task.taskId);
      // Only fire if the task is still tracked (hasn't completed or been cancelled)
      if (this.taskToMachine.has(task.taskId)) {
        console.warn(
          `[relay] Dispatch ACK timeout: task ${task.taskId} not acknowledged by machine ${machineId} ` +
          `within ${DISPATCH_ACK_TIMEOUT_MS / 1000}s — WS message likely lost`
        );
        this.taskToMachine.delete(task.taskId);
        this.taskDispatchedAt.delete(task.taskId);
        this.consecutiveMisses.delete(task.taskId);
        redisPubSub.removeTaskMapping(task.taskId).catch(() => {});
        this.emit('task:dead', {
          taskId: task.taskId,
          machineId,
          reason: `Agent runner did not acknowledge dispatch within ${DISPATCH_ACK_TIMEOUT_MS / 1000}s (message likely lost during WebSocket reconnection)`,
        });
      }
    }, DISPATCH_ACK_TIMEOUT_MS);
    this.dispatchAckTimers.set(task.taskId, ackTimer);

    console.log(`[relay] Task ${task.taskId} dispatched to machine ${machineId}`);
    return true;
  }

  /**
   * Cancel a task on an agent runner.
   * If the machine is connected to this instance, sends directly via WebSocket.
   * Otherwise, routes via Redis pub/sub to the instance that has the connection.
   */
  cancelTask(taskId: string, machineId: string, reason?: string): boolean {
    // Resolve machineId from local dispatch history if not provided
    const resolvedMachineId = machineId || this.taskToMachine.get(taskId);
    if (!resolvedMachineId) {
      // Try async Redis fallback (fire-and-forget with logging)
      this.cancelTaskWithRedisFallback(taskId, reason);
      return false; // Caller sees false; Redis routing may succeed asynchronously
    }

    const connection = machineRegistry.getConnection(resolvedMachineId);
    if (!connection) {
      // Machine not on this instance — route via Redis to the instance that has it
      redisPubSub.requestTaskCancel(taskId, resolvedMachineId, reason).catch((err) => {
        console.error(`[relay] Failed to route cancel via Redis:`, err);
      });
      console.log(`[relay] Task ${taskId} cancel routed via Redis (machine ${resolvedMachineId} not local)`);
      this.taskToMachine.delete(taskId);
      this.taskDispatchedAt.delete(taskId);
      this.consecutiveMisses.delete(taskId);
      const ackT1 = this.dispatchAckTimers.get(taskId);
      if (ackT1) { clearTimeout(ackT1); this.dispatchAckTimers.delete(taskId); }
      redisPubSub.removeTaskMapping(taskId).catch(() => {});
      return true; // Optimistic: assume Redis routing will succeed
    }

    // Send in agent-runner's expected format (type: 'task_cancel')
    const agentRunnerMsg = {
      type: 'task_cancel',
      timestamp: new Date().toISOString(),
      payload: { taskId, reason },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error(`[relay] Failed to send cancel for task ${taskId} to machine ${resolvedMachineId} (socket not open)`);
      notifyWarning(`WebSocket cancel send failed for task ${taskId} — machine ${resolvedMachineId} socket not open`);
      return false;
    }
    socket.send(JSON.stringify(agentRunnerMsg));
    this.taskToMachine.delete(taskId);
    this.taskDispatchedAt.delete(taskId);
    this.consecutiveMisses.delete(taskId);
    const ackT2 = this.dispatchAckTimers.get(taskId);
    if (ackT2) { clearTimeout(ackT2); this.dispatchAckTimers.delete(taskId); }
    redisPubSub.removeTaskMapping(taskId).catch(() => {});
    console.log(`[relay] Task ${taskId} cancel request sent to machine ${resolvedMachineId}`);
    return true;
  }

  /**
   * Async fallback: look up machineId from Redis when local Map doesn't have it.
   */
  private async cancelTaskWithRedisFallback(taskId: string, reason?: string): Promise<void> {
    try {
      const machineId = await redisPubSub.getTaskMachine(taskId);
      if (!machineId) {
        console.error(`[relay] No machine found for task ${taskId} cancellation (not in local Map or Redis)`);
        return;
      }
      // Route via Redis to whichever instance has this machine
      await redisPubSub.requestTaskCancel(taskId, machineId, reason);
      console.log(`[relay] Task ${taskId} cancel routed via Redis fallback (machine ${machineId})`);
    } catch (err) {
      console.error(`[relay] cancelTaskWithRedisFallback failed:`, err);
    }
  }

  /**
   * Register Redis pub/sub listeners for cross-instance command routing.
   * When a cancel/approval/steer command arrives via Redis from another
   * instance, execute it locally if we have the target machine's WebSocket.
   */
  private registerRedisRouting(): void {
    // Cross-instance cancel: another instance requested a cancel for a machine we host
    redisPubSub.on('task:cancel', (event) => {
      if (event.instanceId === redisPubSub.getInstanceId()) return; // skip own
      const connection = machineRegistry.getConnection(event.machineId);
      if (!connection) return; // machine not on this instance either
      console.log(`[relay] Executing cross-instance cancel for task ${event.taskId} on machine ${event.machineId}`);
      const socket = connection.socket;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'task_cancel',
          timestamp: new Date().toISOString(),
          payload: { taskId: event.taskId, reason: event.reason },
        }));
        this.taskToMachine.delete(event.taskId);
        this.taskDispatchedAt.delete(event.taskId);
        this.consecutiveMisses.delete(event.taskId);
        const ackRC = this.dispatchAckTimers.get(event.taskId);
        if (ackRC) { clearTimeout(ackRC); this.dispatchAckTimers.delete(event.taskId); }
      }
    });

    // Cross-instance approval response: route to local machine's WebSocket
    redisPubSub.on('approval:response', (event) => {
      if (event.instanceId === redisPubSub.getInstanceId()) return; // skip own
      const connection = machineRegistry.getConnection(event.machineId);
      if (!connection) return; // machine not on this instance
      console.log(`[relay] Executing cross-instance approval for task ${event.taskId} request ${event.requestId}`);
      this.sendApprovalResponseLocal(event.taskId, event.machineId, event.requestId, event.answered, event.answer, event.message);
    });

    // Cross-instance steer: route to local machine's WebSocket
    redisPubSub.on('task:steer', (event) => {
      if (event.instanceId === redisPubSub.getInstanceId()) return; // skip own
      const connection = machineRegistry.getConnection(event.machineId);
      if (!connection?.socket) return; // machine not on this instance (or remote entry with null socket)
      console.log(`[relay] Executing cross-instance steer for task ${event.taskId}`);
      this.steerTaskLocal(event.taskId, event.machineId, event.message, event.action, event.interrupt, event.sessionId, event.branchName);
    });

    // Cross-instance safety decision: route to local machine's WebSocket
    redisPubSub.on('safety:decision', (event) => {
      if (event.instanceId === redisPubSub.getInstanceId()) return; // skip own
      const connection = machineRegistry.getConnection(event.machineId);
      if (!connection) return; // machine not on this instance
      console.log(`[relay] Executing cross-instance safety decision for task ${event.taskId}: ${event.decision}`);
      this.sendSafetyDecisionLocal(event.taskId, event.machineId, event.decision);
    });

    // ── Cross-instance streaming bridge ──────────────────────────────
    // When a task runs on Instance B but the SSE stream lives on Instance A,
    // Instance A's relayServer.on() listeners never fire (they are local).
    // This bridge re-emits cross-instance streaming events as local relay
    // events so dispatch.ts, agent.ts, and events.ts all receive them
    // without needing their own Redis subscriptions.
    redisPubSub.on('task:streaming', (msg) => {
      if (msg.instanceId === redisPubSub.getInstanceId()) return; // skip own — already emitted locally
      switch (msg.eventType) {
        case 'activity':
          this.emit('task:text', {
            type: 'task.text',
            timestamp: new Date(),
            taskId: msg.taskId,
            text: '',
            sequence: 0,
          });
          break;
        case 'text':
          // Wake-up only — Redis carries {taskId, dbSeq}. Fetch the durable
          // payload from Postgres and emit locally. Falls back to the inline
          // payload if dbSeq is missing (older publishers, or future variants).
          if (typeof msg.dbSeq === 'number') {
            this.fetchAndEmitText(msg.taskId, msg.dbSeq);
          } else if (typeof msg.data.text === 'string') {
            this.emit('task:text', {
              type: 'task.text',
              timestamp: new Date(),
              taskId: msg.taskId,
              text: msg.data.text,
              sequence: 0,
            });
          }
          break;
        case 'operational':
          this.emit('task:operational', {
            type: 'task.operational',
            timestamp: new Date(),
            taskId: msg.taskId,
            message: msg.data.message as string,
            source: msg.data.source as 'astro' | 'git' | 'delivery',
            _dbSeq: msg.dbSeq,
          });
          break;
        case 'tool_use':
        case 'tool_result': {
          const traceMsg: TaskToolTraceMessage = {
            type: 'task.tool_trace',
            taskId: msg.taskId,
            toolName: msg.data.toolName as string,
            toolInput: msg.eventType === 'tool_use' ? msg.data.toolInput : undefined,
            toolResult: msg.eventType === 'tool_result' ? (msg.data.toolResult ?? msg.data.result) : undefined,
            success: msg.data.success as boolean | undefined,
            duration: msg.data.duration as number | undefined,
            toolUseId: msg.data.toolUseId as string | undefined,
            _dbSeq: msg.dbSeq,
          };
          this.emit('task:tool_trace', traceMsg);
          break;
        }
        case 'file_change':
          this.emit('task:file_change', {
            taskId: msg.taskId,
            path: msg.data.path as string,
            action: msg.data.action as string,
            linesAdded: msg.data.linesAdded as number | undefined,
            linesRemoved: msg.data.linesRemoved as number | undefined,
            diff: msg.data.diff as string | undefined,
            _dbSeq: msg.dbSeq,
          });
          break;
        case 'session_init':
          this.emit('task:session_init', {
            taskId: msg.taskId,
            sessionId: msg.data.sessionId as string,
            model: msg.data.model as string | undefined,
            _dbSeq: msg.dbSeq,
          });
          break;
        case 'progress':
          this.emit('task:progress', {
            taskId: msg.taskId,
            progress: msg.data.progress as number | undefined,
            message: msg.data.message as string | undefined,
          });
          break;
        case 'result':
          this.emit('task:result', {
            result: {
              taskId: msg.taskId,
              status: msg.data.status as string,
              output: msg.data.output as string | undefined,
              error: msg.data.error as string | undefined,
              duration: msg.data.duration as number | undefined,
              branchName: msg.data.branchName as string | undefined,
              prUrl: msg.data.prUrl as string | undefined,
              prNumber: msg.data.prNumber as number | undefined,
              deliveryStatus: msg.data.deliveryStatus as string | undefined,
              deliveryError: msg.data.deliveryError as string | undefined,
              summary: msg.data.summary as ExecutionSummaryResult | undefined,
              metrics: msg.data.metrics as import('../types/relay.js').UsageMetrics | undefined,
            },
          });
          break;
        case 'error':
          this.emit('task:error', {
            taskId: msg.taskId,
            error: msg.data.error as string,
            recoverable: msg.data.recoverable as boolean | undefined,
            synthetic: msg.data.synthetic as boolean | undefined,
            _dbSeq: msg.dbSeq,
          });
          break;
        case 'approval_request':
          this.emit('task:approval_request', {
            taskId: msg.taskId,
            requestId: msg.data.requestId as string,
            question: msg.data.question as string,
            options: msg.data.options as string[],
            machineId: msg.data.machineId as string | undefined,
          });
          break;
        case 'safety_prompt':
          this.emit('task:safety_prompt', {
            taskId: msg.taskId,
            safetyTier: msg.data.safetyTier as string,
            warning: msg.data.warning as string | undefined,
            options: msg.data.options as Array<{ id: string; label: string; description?: string }>,
            machineId: msg.data.machineId as string | undefined,
          });
          break;
      }
    });
  }

  /**
   * Get all task IDs the server believes are running on a specific machine.
   * Used by dead job detection to cross-reference against heartbeat data.
   */
  getTasksForMachine(machineId: string): string[] {
    const tasks: string[] = [];
    for (const [taskId, mId] of this.taskToMachine) {
      if (mId === machineId) {
        tasks.push(taskId);
      }
    }
    return tasks;
  }

  /**
   * Start the periodic dead job checker (P2 heartbeat cross-reference).
   * Every 60 seconds, compares server-side task tracking against agent runner
   * heartbeat reports. After 5 consecutive misses (~5 minutes), emits 'task:dead'.
   * Tasks dispatched within the last 3 minutes are given a grace period to allow
   * for worktree creation, git clone, and agent startup.
   *
   * Uses Redis leader election when multiple instances are running — only
   * the instance with the machine connections should run dead job detection.
   * (Each instance only sees its own machines, so leader election prevents
   * redundant checks.)
   */
  private startDeadJobChecker(): void {
    if (this.deadJobCheckInterval) return;

    const DEAD_JOB_CHECK_INTERVAL_MS = 60_000;  // 60 seconds
    const CONSECUTIVE_MISS_THRESHOLD = 5;        // 5 misses = ~5 minutes
    const DISPATCH_GRACE_PERIOD_MS = 3 * 60_000; // 3 minutes grace after dispatch
    const LEADER_NAME = 'dead-job-checker';
    const LEADER_TTL_SECONDS = 90; // 90s TTL, renewed every 60s

    this.deadJobCheckInterval = setInterval(async () => {
      try {
        // Leader election: only one instance runs the dead job checker
        const acquired = await redisPubSub.tryAcquireLeader(LEADER_NAME, LEADER_TTL_SECONDS);
        const renewed = !acquired && await redisPubSub.renewLeadership(LEADER_NAME, LEADER_TTL_SECONDS);
        if (!acquired && !renewed) return; // another instance is the leader

        const allMachines = machineRegistry.getAll();
        const now = Date.now();

        for (const machine of allMachines) {
          if (machine.connectionStatus !== 'connected') continue;

          // Skip machines that haven't sent a heartbeat with task IDs yet
          if (!machine.activeTaskIds) continue;

          const runnerTaskIds = new Set(machine.activeTaskIds);
          const serverTaskIds = this.getTasksForMachine(machine.machineId);

          for (const taskId of serverTaskIds) {
            if (runnerTaskIds.has(taskId)) {
              // Task is alive — reset miss count
              this.consecutiveMisses.delete(taskId);
            } else {
              // Skip tasks still in dispatch grace period (startup: worktree, git clone, etc.)
              const dispatchedAt = this.taskDispatchedAt.get(taskId);
              if (dispatchedAt && (now - dispatchedAt) < DISPATCH_GRACE_PERIOD_MS) {
                continue;
              }

              // Task missing from heartbeat — increment miss count
              const misses = (this.consecutiveMisses.get(taskId) ?? 0) + 1;
              this.consecutiveMisses.set(taskId, misses);

              if (misses >= CONSECUTIVE_MISS_THRESHOLD) {
                console.warn(
                  `[relay] Dead job detected: task ${taskId} missing from machine ${machine.machineId} ` +
                  `heartbeat for ${misses} consecutive checks (~${misses} minutes)`
                );
                this.consecutiveMisses.delete(taskId);
                this.taskToMachine.delete(taskId);
                this.taskDispatchedAt.delete(taskId);
                const ackDJ = this.dispatchAckTimers.get(taskId);
                if (ackDJ) { clearTimeout(ackDJ); this.dispatchAckTimers.delete(taskId); }
                redisPubSub.removeTaskMapping(taskId).catch(() => {});

                // Emit event for dispatch layer to handle DB reset
                this.emit('task:dead', {
                  taskId,
                  machineId: machine.machineId,
                  reason: `Task not reported in agent runner heartbeat for ${misses} consecutive checks`,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error('[relay] Dead job check cycle failed:', (err as Error).message);
      }
    }, DEAD_JOB_CHECK_INTERVAL_MS);

    console.log('[relay] Dead job checker started (60s interval, 5-miss threshold, 3-min grace, leader-elected)');
  }

  /**
   * Send a cleanup command to an agent runner to remove worktree + local branch.
   * Used by the reset function to clean up before re-execution.
   */
  cleanupTask(taskId: string, machineId: string, branchName?: string): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.warn(`[relay] Machine ${machineId} not connected for task cleanup`);
      return false;
    }

    const cleanupMsg = {
      type: 'task_cleanup',
      timestamp: new Date().toISOString(),
      payload: { taskId, branchName },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== 1 /* WebSocket.OPEN */) {
      console.warn(`[relay] Socket not open for task cleanup on machine ${machineId}`);
      return false;
    }
    socket.send(JSON.stringify(cleanupMsg));
    console.log(`[relay] Task ${taskId} cleanup request sent to machine ${machineId}`);
    return true;
  }

  /**
   * Send a project cleanup request to remove auto-provisioned workspace.
   * Called when a project is deleted — the agent removes the workspace directory.
   */
  cleanupProject(projectId: string, machineId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.warn(`[relay] Machine ${machineId} not connected for project cleanup`);
      return false;
    }

    const msg = {
      type: 'project_cleanup',
      timestamp: new Date().toISOString(),
      payload: { projectId },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== 1 /* WebSocket.OPEN */) {
      console.warn(`[relay] Socket not open for project cleanup on machine ${machineId}`);
      return false;
    }
    socket.send(JSON.stringify(msg));
    console.log(`[relay] Project ${projectId} cleanup request sent to machine ${machineId}`);
    return true;
  }

  /**
   * Archive discovery mode directories (move to .archived/).
   * Used when pruning milestones/tasks in discovery mode projects.
   */
  archiveDiscoveryDirs(machineId: string, projectDir: string, dirs: string[]): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.warn(`[relay] Machine ${machineId} not connected for discovery archive`);
      return false;
    }

    const msg = {
      type: 'discovery_archive',
      timestamp: new Date().toISOString(),
      payload: { projectDir, dirs },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== 1 /* WebSocket.OPEN */) {
      console.warn(`[relay] Socket not open for discovery archive on machine ${machineId}`);
      return false;
    }
    socket.send(JSON.stringify(msg));
    console.log(`[relay] Discovery archive request sent to machine ${machineId}: ${dirs.length} dirs`);
    return true;
  }

  /**
   * Broadcast project cleanup to ALL connected machines.
   * Used when a project has no defaultMachineId — any machine may have
   * auto-provisioned a workspace for it.
   */
  cleanupProjectBroadcast(projectId: string): void {
    const machines = machineRegistry.getAll();
    const msg = JSON.stringify({
      type: 'project_cleanup',
      timestamp: new Date().toISOString(),
      payload: { projectId },
    });

    let sent = 0;
    for (const machine of machines) {
      if (machine.connectionStatus !== 'connected') continue;
      const connection = machineRegistry.getConnection(machine.machineId);
      if (!connection?.socket || connection.socket.readyState !== 1) continue;
      connection.socket.send(msg);
      sent++;
    }
    if (sent > 0) {
      console.log(`[relay] Project ${projectId} cleanup broadcast to ${sent} machine(s)`);
    }
  }

  /**
   * Send a git pull request to an agent runner (fire-and-forget).
   * Used by git-pull-hook to pull changes on the remote machine after task completion.
   */
  requestGitPull(machineId: string, workingDirectory: string): boolean {
    const connection = machineRegistry.getConnection(machineId);
    const correlationId = `git-pull-${Date.now()}`;

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === 1 /* WebSocket.OPEN */) {
      const msg = {
        type: 'git_pull.request',
        timestamp: new Date().toISOString(),
        workingDirectory,
        correlationId,
      };
      socket.send(JSON.stringify(msg));
      console.log(`[relay] Git pull request sent to machine ${machineId} for ${workingDirectory}`);
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    // Note: git_pull is fire-and-forget with no response handler in the agent runner
    // or proxyResponseTypes bridge. The proxy wraps payload differently (nested vs flat),
    // but since the agent runner currently has no git_pull.request handler, this is harmless.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'git_pull.request',
        payload: { workingDirectory, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy git_pull.request failed:', err));
      return true;
    }

    console.warn(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for git pull request`);
    return false;
  }

  /**
   * Steer a running task on an agent runner.
   * If the machine is connected to this instance, sends directly via WebSocket.
   * Otherwise, routes via Redis pub/sub to the instance that has the connection.
   */
  steerTask(taskId: string, machineId: string, message: string, action?: 'guidance' | 'redirect' | 'pause' | 'resume', interrupt?: boolean, sessionId?: string, branchName?: string): boolean {
    const connection = machineRegistry.getConnection(machineId);
    // Route via Redis when: (a) machine is completely unknown, or (b) machine is a remote
    // entry (socket: null) registered via registerRemote() — same pattern as dispatchTask.
    // Checking only `!connection` misses case (b): remote entries have socket=null and would
    // fall through to steerTaskLocal which silently no-ops on a null socket.
    if (!connection?.socket) {
      if (redisPubSub.isConnected()) {
        redisPubSub.routeTaskSteer({
          taskId, machineId, message, action, interrupt, sessionId, branchName,
        }).catch((err) => {
          console.error(`[relay] Failed to route steer via Redis:`, err);
        });
        console.log(`[relay] Steer routed via Redis for task ${taskId} (machine ${machineId} not local)`);
        return true; // Optimistic: assume Redis routing will succeed
      }
      console.error(`[relay] Cannot steer task ${taskId}: machine ${machineId} not local and Redis not connected`);
      return false;
    }

    return this.steerTaskLocal(taskId, machineId, message, action, interrupt, sessionId, branchName);
  }

  /**
   * Steer a task via local WebSocket connection. Called both for direct
   * sends and for Redis-routed messages.
   */
  private steerTaskLocal(taskId: string, machineId: string, message: string, action?: 'guidance' | 'redirect' | 'pause' | 'resume', interrupt?: boolean, sessionId?: string, branchName?: string): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for task steering`);
      return false;
    }

    const steerMsg: TaskSteerMessage = {
      type: 'task.steer',
      timestamp: new Date(),
      correlationId: taskId,
      taskId,
      message,
      action: action || 'guidance',
      interrupt,
      sessionId,
      branchName,
    };

    try {
      this.sendMessage(connection.socket, steerMsg);
      console.log(`[relay] Steer message sent for task ${taskId} to machine ${machineId}${interrupt ? ' (interrupt)' : ''}`);
      return true;
    } catch (err) {
      console.error(`[relay] Error steering task ${taskId}:`, err);
      return false;
    }
  }

  /**
   * Send approval response back to agent runner.
   * If the machine is connected to this instance, sends directly via WebSocket.
   * Otherwise, routes via Redis pub/sub to the instance that has the connection.
   */
  sendApprovalResponse(
    taskId: string,
    machineId: string,
    requestId: string,
    answered: boolean,
    answer?: string,
    message?: string
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);
    // Route via Redis when: (a) machine completely unknown, or (b) remote entry (socket: null).
    // Same pattern as steerTask — checking only `!connection` misses machines in the grace period
    // (detached socket, connectionStatus='reconnecting') which would silently lose the approval.
    if (!connection?.socket) {
      if (redisPubSub.isConnected()) {
        redisPubSub.routeApprovalResponse({
          taskId, machineId, requestId, answered, answer, message,
        }).catch((err) => {
          console.error(`[relay] Failed to route approval via Redis:`, err);
        });
        console.log(`[relay] Approval response routed via Redis for task ${taskId} (machine ${machineId} not local)`);
        return true; // Optimistic: assume Redis routing will succeed
      }
      console.error(`[relay] Cannot send approval for task ${taskId}: machine ${machineId} not local and Redis not connected`);
      return false;
    }

    return this.sendApprovalResponseLocal(taskId, machineId, requestId, answered, answer, message);
  }

  /**
   * Send approval response directly via local WebSocket connection.
   * Called both for direct sends and for Redis-routed messages.
   */
  private sendApprovalResponseLocal(
    taskId: string,
    machineId: string,
    requestId: string,
    answered: boolean,
    answer?: string,
    message?: string
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for approval response`);
      return false;
    }

    // Send in agent-runner's expected format (type: 'task_approval_response')
    const responseMsg = {
      type: 'task_approval_response',
      timestamp: new Date().toISOString(),
      payload: { taskId, requestId, answered, answer, message },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error(`[relay] Failed to send approval response for task ${taskId} to machine ${machineId} (socket not open)`);
      notifyWarning(`WebSocket approval response send failed for task ${taskId} — machine ${machineId} socket not open`);
      return false;
    }
    socket.send(JSON.stringify(responseMsg));
    console.log(`[relay] Approval response sent for task ${taskId} request ${requestId} to machine ${machineId}`);
    return true;
  }

  /**
   * Send safety decision back to agent runner.
   * If the machine is connected to this instance, sends directly via WebSocket.
   * Otherwise, routes via Redis pub/sub to the instance that has the connection.
   */
  sendSafetyDecision(
    taskId: string,
    machineId: string,
    decision: 'proceed' | 'init-git' | 'sandbox' | 'cancel'
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      // Machine not on this instance — route via Redis
      redisPubSub.routeSafetyDecision({ taskId, machineId, decision }).catch((err) => {
        console.error(`[relay] Failed to route safety decision via Redis:`, err);
      });
      console.log(`[relay] Safety decision routed via Redis for task ${taskId} (machine ${machineId} not local)`);
      return true; // Optimistic: assume Redis routing will succeed
    }

    return this.sendSafetyDecisionLocal(taskId, machineId, decision);
  }

  /**
   * Send safety decision directly via local WebSocket connection.
   * Called both for direct sends and for Redis-routed messages.
   */
  private sendSafetyDecisionLocal(
    taskId: string,
    machineId: string,
    decision: 'proceed' | 'init-git' | 'sandbox' | 'cancel'
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for safety decision`);
      return false;
    }

    const responseMsg = {
      type: 'task_safety_decision',
      timestamp: new Date().toISOString(),
      payload: { taskId, decision },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error(`[relay] Failed to send safety decision for task ${taskId} to machine ${machineId} (socket not open)`);
      notifyWarning(`WebSocket safety decision send failed for task ${taskId} — machine ${machineId} socket not open`);
      return false;
    }
    socket.send(JSON.stringify(responseMsg));
    console.log(`[relay] Safety decision sent for task ${taskId} to machine ${machineId}: ${decision}`);
    return true;
  }

  /**
   * Start the heartbeat interval
   */
  private startHeartbeatInterval(): void {
    this.heartbeatInterval = setInterval(() => {
      const machines = machineRegistry.getAll();
      const localMachineIds: string[] = [];
      for (const machine of machines) {
        const connection = machineRegistry.getConnection(machine.machineId);
        if (connection?.socket) {
          localMachineIds.push(machine.machineId);
          const ping: HeartbeatPingMessage = {
            type: 'heartbeat.ping',
            timestamp: new Date(),
          };
          try {
            this.sendMessage(connection.socket, ping);
          } catch (err) {
            console.error(`[relay] Error sending ping to ${machine.machineId}:`, err);
          }
        }
      }
      // Refresh MACHINE_INSTANCE TTLs for locally-connected machines so they
      // don't expire (5-min TTL) on long-running connections.
      if (localMachineIds.length > 0 && redisPubSub.isConnected()) {
        redisPubSub.refreshMachineInstanceTTLs(localMachineIds).catch((err) => {
          console.error('[relay] Failed to refresh machine instance TTLs:', err);
        });
      }

      // Prune ghost remote machines: check MACHINE_INSTANCE for hydrated entries
      // that no longer have a live instance owning their WebSocket.
      // This catches machines whose owning instance crashed without publishing
      // a disconnect event (e.g., during rolling deploys).
      if (redisPubSub.isConnected()) {
        const remoteMachineIds = machines
          .filter(m => !machineRegistry.isLocal(m.machineId))
          .map(m => m.machineId);
        for (const rmId of remoteMachineIds) {
          redisPubSub.getMachineInstance(rmId).then(instanceId => {
            if (!instanceId) {
              console.log(`[relay] Pruning ghost remote machine ${rmId} (MACHINE_INSTANCE expired)`);
              machineRegistry.removeRemote(rmId);
              redisPubSub.unregisterMachine(rmId).catch(() => {});
            }
          }).catch(() => {});
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Reset heartbeat timer for a machine
   */
  private resetHeartbeatTimer(machineId: string): void {
    machineRegistry.setHeartbeatTimer(
      machineId,
      this.config.heartbeatTimeoutMs,
      () => {
        console.log(`[relay] Heartbeat timeout for machine ${machineId} — entering disconnect grace period`);
        const connection = machineRegistry.getConnection(machineId);
        const socket = connection?.socket;
        if (socket && socket.readyState === 1) {
          // Close the socket to signal the agent runner to reconnect.
          // The 'close' event handler will call startDisconnectGracePeriod.
          // Code 4003 = heartbeat timeout (agent should reconnect, not exit).
          socket.close(4003, 'heartbeat_timeout');
        } else {
          // Socket already gone — start grace period directly.
          this.startDisconnectGracePeriod(machineId, 'heartbeat_timeout');
        }
      }
    );
  }

  /**
   * Start a disconnect grace period for a machine.
   * Instead of immediately failing tasks, detaches the socket and waits
   * for the agent runner to reconnect. If it doesn't reconnect within
   * the grace period, the machine is fully disconnected and tasks are failed.
   */
  private startDisconnectGracePeriod(machineId: string, reason: string): void {
    // Cancel any existing grace period for this machine
    this.cancelDisconnectGracePeriod(machineId);

    // Detach socket but keep machine in registry (status → 'reconnecting')
    machineRegistry.detachSocket(machineId);

    // Reset miss counts so reconnection starts with a clean slate (prevents false task:dead)
    for (const [taskId, mId] of this.taskToMachine) {
      if (mId === machineId) {
        this.consecutiveMisses.delete(taskId);
      }
    }

    const gracePeriodMs = this.config.disconnectGracePeriodMs;
    console.log(`[relay] Machine ${machineId} entering disconnect grace period (${gracePeriodMs / 1000}s) — reason: ${reason}`);
    // Notify frontend immediately so the UI shows "reconnecting" rather than silently hiding the machine
    this.emit('machine:reconnecting', machineId, reason);

    const timer = setTimeout(() => {
      this.disconnectGracePeriods.delete(machineId);
      console.log(`[relay] Grace period expired for machine ${machineId} — disconnecting`);

      const affectedTaskIds = Array.from(this.taskToMachine.entries())
        .filter(([, mId]) => mId === machineId)
        .map(([taskId]) => taskId);

      for (const taskId of affectedTaskIds) {
        void this.emitSyntheticTaskError(
          taskId,
          'Remote machine disconnected during task execution',
          { reason, recoverable: false },
        ).catch((err) => {
          console.error(`[relay] Failed to persist synthetic disconnect error for ${taskId}:`, err);
        });
      }

      // Clean up task tracking for disconnected machine to prevent memory leak
      for (const [taskId, mId] of this.taskToMachine) {
        if (mId === machineId) {
          this.taskToMachine.delete(taskId);
          this.taskDispatchedAt.delete(taskId);
          this.consecutiveMisses.delete(taskId);
          const ackT = this.dispatchAckTimers.get(taskId);
          if (ackT) { clearTimeout(ackT); this.dispatchAckTimers.delete(taskId); }
          redisPubSub.removeTaskMapping(taskId).catch(() => {});
        }
      }

      machineRegistry.disconnect(machineId, reason);
      this.rateLimitState.delete(machineId);
      this.lastPublishedMachineHeartbeatState.delete(machineId);
      this.emit('machine:disconnected', machineId, reason);
    }, gracePeriodMs);

    this.disconnectGracePeriods.set(machineId, timer);
  }

  /**
   * Cancel a pending disconnect grace period (machine reconnected).
   */
  private cancelDisconnectGracePeriod(machineId: string): boolean {
    const timer = this.disconnectGracePeriods.get(machineId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectGracePeriods.delete(machineId);
      console.log(`[relay] Machine ${machineId} reconnected within grace period — disconnect cancelled`);
      return true;
    }
    return false;
  }

  /**
   * Initialize rate limit state for a machine
   */
  private initRateLimitState(machineId: string): void {
    this.rateLimitState.set(machineId, {
      requests: [],
      stdoutBytes: 0,
      lastReset: Date.now(),
    });
  }

  /**
   * Check rate limit for requests from a machine
   */
  private checkRateLimit(machineId: string): boolean {
    let state = this.rateLimitState.get(machineId);
    if (!state) {
      this.initRateLimitState(machineId);
      state = this.rateLimitState.get(machineId)!;
    }

    const now = Date.now();
    const windowStart = now - this.config.rateLimit.windowMs;

    // Reset if window has passed
    if (state.lastReset < windowStart) {
      state.requests = [];
      state.stdoutBytes = 0;
      state.lastReset = now;
    }

    // Filter out old requests
    state.requests = state.requests.filter(t => t > windowStart);

    // Check limit
    if (state.requests.length >= this.config.rateLimit.maxRequests) {
      return false;
    }

    state.requests.push(now);
    return true;
  }

  /**
   * Send a message to a socket. Returns true if the message was sent.
   */
  private sendMessage(socket: WebSocket | null, message: RelayToAgentMessage): boolean {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Send an error message
   */
  private sendError(socket: WebSocket, code: string, message: string): void {
    // Include payload for agent-runner compatibility (expects {payload: {code, message}})
    const error = {
      type: 'error',
      timestamp: new Date().toISOString(),
      code,
      message,
      payload: { code, message },
    };
    this.sendMessage(socket, error as unknown as ErrorMessage);
  }

  /**
   * Get server status
   */
  getStatus(): {
    running: boolean;
    port: number;
    machines: number;
    config: RelayServerConfig;
  } {
    return {
      running: this.wss !== null,
      port: this.config.port,
      machines: machineRegistry.size,
      config: this.config,
    };
  }

  // ============================================================================
  // Agent Runner Message Handlers (for compatibility with @astroanywhere/agent package)
  // ============================================================================

  /**
   * Handle agent runner's register message format
   * Converts to the standard machine.register format
   */
  private handleAgentRunnerRegister(
    socket: WebSocket,
    message: AgentRunnerRegisterMessage,
    setMachineId: (id: string) => void
  ): void {
    const { payload } = message;
    const { runnerId, machineId, name: displayName, providers, executionStrategies, resources, version } = payload;

    try {
      // Convert agent runner format to relay server format
      const machineInfo: Omit<MachineInfo, 'machineId'> = {
        name: displayName || resources.hostname || machineId,
        hostname: resources.hostname,
        platform: resources.platform,
        providers: providers.map((p) => ({
          type: (['claude-sdk', 'codex', 'openclaw', 'opencode', 'pi'].includes(p.type) ? p.type : 'custom') as ProviderType,
          version: p.version || undefined,
          status: p.available ? 'available' : 'unavailable',
          maxConcurrentTasks: p.capabilities.maxConcurrentTasks,
          currentTasks: 0,
          capabilities: ['streaming', 'tools', 'multi-turn'].filter((_, i) =>
            [p.capabilities.streaming, p.capabilities.tools, p.capabilities.multiTurn][i]
          ),
          defaultModel: p.capabilities.defaultModel || undefined,
          hpcCapability: p.hpcCapability || undefined,
        })),
        resources: {
          cpuCores: resources.cpu.cores,
          memoryMB: Math.round(resources.memory.total / (1024 * 1024)),
          gpuCount: resources.gpu.length,
          gpuMemoryMB: resources.gpu.length > 0
            ? Math.round(resources.gpu.reduce((sum, g) => sum + g.memoryTotal, 0) / (1024 * 1024))
            : undefined,
          gpuType: resources.gpu.length > 0
            ? [...new Set(resources.gpu.map((g: { name: string }) => g.name))].join(', ')
            : undefined,
        },
        load: {
          cpuPercent: resources.cpu.loadAvg[0] ? resources.cpu.loadAvg[0] * 100 / resources.cpu.cores : 0,
          memoryPercent: resources.memory.usedPercent,
          gpuPercent: resources.gpu.length > 0
            ? resources.gpu.reduce((sum, g) => sum + g.utilization, 0) / resources.gpu.length
            : undefined,
          activeTasks: 0,
          queuedTasks: 0,
        },
        executionStrategies: executionStrategies?.map((s: { id: string; name: string; available: boolean; version?: string; metadata?: Record<string, unknown> }) => ({
          id: s.id,
          name: s.name,
          available: s.available,
          version: s.version,
          metadata: s.metadata,
        })),
        tags: [runnerId, version],
        metadata: { runnerId, version },
      };

      // Cancel any pending disconnect grace period — machine is reconnecting
      this.cancelDisconnectGracePeriod(machineId);

      // Extract userId from JWT payload stored on socket
      const jwtPayload = (socket as unknown as { jwtPayload?: MachineJWTPayload }).jwtPayload;
      const userId = jwtPayload?.userId || LOCAL_USER_ID;

      machineRegistry.register(machineId, machineInfo, socket, userId);
      setMachineId(machineId);
      this.lastPublishedMachineHeartbeatState.delete(machineId);

      // Log execution strategies for debugging
      const strategies = machineInfo.executionStrategies;
      if (strategies && strategies.length > 0) {
        console.log(`[relay] Machine ${machineId} reported ${strategies.length} execution strategies: ${strategies.map(s => `${s.id}(${s.available ? 'ok' : 'n/a'})`).join(', ')}`);
      } else {
        console.log(`[relay] Machine ${machineId} reported no execution strategies`);
      }

      // Set up heartbeat timeout
      this.resetHeartbeatTimer(machineId);

      // Send acknowledgment in agent runner's expected format
      const ack = {
        type: 'registered',
        timestamp: new Date().toISOString(),
        payload: {
          runnerId,
          serverTime: new Date().toISOString(),
          config: {
            heartbeatInterval: this.config.heartbeatIntervalMs,
            maxConcurrentTasks: 5,
          },
        },
      };
      socket.send(JSON.stringify(ack));

      this.emit('machine:connected', machineId, userId);
      console.log(`[relay] Agent runner ${runnerId} (machine ${machineId}) registered successfully for user ${userId}`);
    } catch (err) {
      console.error(`[relay] Error registering agent runner ${runnerId}:`, err);
      const errorAck = {
        type: 'error',
        timestamp: new Date().toISOString(),
        payload: {
          code: 'REGISTRATION_FAILED',
          message: (err as Error).message,
        },
      };
      socket.send(JSON.stringify(errorAck));
    }
  }

  /**
   * Handle agent runner's heartbeat message format
   */
  private shouldPublishMachineHeartbeat(machineId: string, activeTasks: string[]): boolean {
    const activeTaskSignature = [...new Set(activeTasks)].sort().join('\0');
    const now = Date.now();
    const previous = this.lastPublishedMachineHeartbeatState.get(machineId);
    if (!previous
      || previous.activeTaskSignature !== activeTaskSignature
      || now - previous.publishedAt >= this.redisMachineUpdateIntervalMs) {
      this.lastPublishedMachineHeartbeatState.set(machineId, {
        activeTaskSignature,
        publishedAt: now,
      });
      return true;
    }
    return false;
  }

  private handleAgentRunnerHeartbeat(
    socket: WebSocket,
    message: AgentRunnerHeartbeatMessage
  ): void {
    const { payload } = message;
    const { runnerId, activeTasks, resources } = payload;

    // Find machine by runner ID (stored in metadata)
    const machines = machineRegistry.getAll();
    const machine = machines.find((m) => m.metadata?.runnerId === runnerId);

    if (machine) {
      // Update load
      machineRegistry.updateLoad(machine.machineId, {
        cpuPercent: resources.cpu.loadAvg[0] ? resources.cpu.loadAvg[0] * 100 / resources.cpu.cores : 0,
        memoryPercent: resources.memory.usedPercent,
        gpuPercent: resources.gpu.length > 0
          ? resources.gpu.reduce((sum, g) => sum + g.utilization, 0) / resources.gpu.length
          : undefined,
        activeTasks: activeTasks.length,
        queuedTasks: 0,
      });

      // Store actual task IDs for dead job cross-reference detection (P2)
      machineRegistry.updateActiveTaskIds(machine.machineId, activeTasks);

      // Propagate activeTaskIds cross-instance when routing-relevant state changes.
      // The relay heartbeat loop refreshes MACHINE_INSTANCE TTLs separately; publishing
      // every agent heartbeat would turn idle machines into a steady Redis bill.
      const updatedEntry = machineRegistry.get(machine.machineId);
      if (updatedEntry && redisPubSub.isConnected()
        && this.shouldPublishMachineHeartbeat(machine.machineId, activeTasks)) {
        redisPubSub.updateMachine(machine.machineId, updatedEntry).catch(() => {});
        redisPubSub.publishMachineState({
          event: 'machine.updated',
          machineId: machine.machineId,
          machineInfo: updatedEntry,
          timestamp: new Date(),
        }).catch(() => {});
      }

      // Reset heartbeat timer
      this.resetHeartbeatTimer(machine.machineId);

      // Send acknowledgment
      const ack = {
        type: 'heartbeat_ack',
        timestamp: new Date().toISOString(),
        payload: {
          serverTime: new Date().toISOString(),
        },
      };
      socket.send(JSON.stringify(ack));
    }
  }

  /**
   * Handle agent runner's task status message format
   */
  private handleAgentRunnerTaskStatus(message: AgentRunnerTaskStatusMessage): void {
    const { payload } = message;
    const { taskId, status, progress, message: statusMessage } = payload;

    // Convert to standard progress message
    const progressMsg: TaskProgressMessage = {
      type: 'task.progress',
      timestamp: new Date(),
      taskId,
      progress: progress ?? (status === 'running' ? 50 : status === 'completed' ? 100 : 0),
      message: statusMessage || status,
    };
    this.emit('task:progress', progressMsg);
    this.publishToRedis({
      eventType: 'progress', taskId,
      data: { progress: progressMsg.progress, message: progressMsg.message },
    });
  }

  /**
   * Handle agent runner's task output message format (legacy)
   */
  private handleAgentRunnerTaskOutput(message: AgentRunnerTaskOutputMessage): void {
    const { payload } = message;
    const { taskId, stream, data } = payload;

    // Convert to standard stdout message
    const stdoutMsg: TaskStdoutMessage = {
      type: 'task.stdout',
      timestamp: new Date(),
      output: {
        taskId,
        stream,
        data,
        timestamp: new Date(),
      },
    };
    this.emit('task:stdout', stdoutMsg);
    this.publishToRedis({
      eventType: 'text', taskId,
      data: { text: data },
    });
  }

  /**
   * Handle agent runner's task tool trace message format (legacy)
   */
  private async handleAgentRunnerTaskToolTrace(message: AgentRunnerTaskToolTraceMessage): Promise<void> {
    const { payload } = message;
    const { taskId, toolName, toolInput, toolResult, success } = payload;

    // Convert to standard tool trace message
    const traceMsg: TaskToolTraceMessage = {
      type: 'task.tool_trace',
      timestamp: new Date(),
      taskId,
      toolName,
      toolInput,
      toolResult,
      success,
    };
    // Persist so route handlers (which no longer write relay-originated events) don't silently
    // drop legacy tool traces. Modern agents send task_tool_use/task_tool_result separately;
    // this path handles older agent runners that send the combined task_tool_trace message.
    const eventType = toolResult !== undefined ? 'tool_result' as const : 'tool_use' as const;
    const data = toolResult !== undefined
      ? { toolName, toolResult, success }
      : { toolName, toolInput };
    let seq: number | undefined;
    try {
      seq = await streamingEventLog.append(taskId, eventType, data);
    } catch (err) {
      console.error(`[relay-server] Failed to persist legacy ${eventType} event for task ${taskId}:`, err);
    }
    this.emit('task:tool_trace', Object.assign(traceMsg, { _dbSeq: seq }));
    this.publishToRedis({
      eventType, taskId,
      data: { toolName, toolInput, toolResult, success, toolUseId: traceMsg.toolUseId },
      dbSeq: seq,
    });
  }

  /**
   * Handle agent runner's structured text message
   * Emits as task:text (NOT task:stdout to avoid double-counting)
   */
  private async handleAgentRunnerTaskText(message: AgentRunnerTaskTextMessage): Promise<void> {
    const { payload } = message;
    const textMsg: TaskTextMessage = {
      type: 'task.text',
      timestamp: new Date(),
      taskId: payload.taskId,
      text: payload.text,
      sequence: payload.sequence,
    };
    // relay-server is the single persistence authority for relay-originated events.
    // Route handlers (dispatch.ts, agent.ts) forward events to the browser SSE but
    // do not write to streaming_events for relay-originated events.
    if (payload.text.length > 0) {
      streamingEventLog.appendText(payload.taskId, payload.text);
    }
    this.emit('task:text', textMsg);
    this.publishToRedis({
      eventType: 'text', taskId: payload.taskId,
      data: { text: payload.text },
    });
  }

  /**
   * Handle agent runner's structured operational message.
   */
  private async handleAgentRunnerTaskOperational(message: AgentRunnerTaskOperationalMessage): Promise<void> {
    const { payload } = message;
    const opMsg: TaskOperationalMessage = {
      type: 'task.operational',
      timestamp: new Date(),
      taskId: payload.taskId,
      message: payload.message,
      source: payload.source,
    };
    let seq: number | undefined;
    try {
      seq = await streamingEventLog.append(payload.taskId, 'operational', {
        message: payload.message,
        source: payload.source,
      });
    } catch (err) {
      console.error(`[relay-server] Failed to persist operational event for task ${payload.taskId}:`, err);
    }
    this.emit('task:operational', Object.assign(opMsg, { _dbSeq: seq }));
    this.publishToRedis({
      eventType: 'operational',
      taskId: payload.taskId,
      data: { message: payload.message, source: payload.source },
      dbSeq: seq,
    });
  }

  /**
   * Handle agent runner's structured tool use message
   */
  private async handleAgentRunnerTaskToolUse(message: AgentRunnerTaskToolUseMessage): Promise<void> {
    const { payload } = message;
    const traceMsg: TaskToolTraceMessage = {
      type: 'task.tool_trace',
      timestamp: new Date(),
      taskId: payload.taskId,
      toolName: payload.toolName,
      toolInput: payload.toolInput,
      toolUseId: payload.toolUseId,
    };
    let seq: number | undefined;
    try {
      seq = await streamingEventLog.append(payload.taskId, 'tool_use', { toolName: payload.toolName, toolInput: payload.toolInput, toolUseId: payload.toolUseId });
    } catch (err) {
      console.error(`[relay-server] Failed to persist tool_use event for task ${payload.taskId}:`, err);
    }
    this.emit('task:tool_trace', Object.assign(traceMsg, { _dbSeq: seq }));
    this.publishToRedis({
      eventType: 'tool_use', taskId: payload.taskId,
      data: { toolName: payload.toolName, toolInput: payload.toolInput, toolUseId: payload.toolUseId },
      dbSeq: seq,
    });
  }

  /**
   * Handle agent runner's structured tool result message
   */
  private async handleAgentRunnerTaskToolResult(message: AgentRunnerTaskToolResultMessage): Promise<void> {
    const { payload } = message;
    const traceMsg: TaskToolTraceMessage = {
      type: 'task.tool_trace',
      timestamp: new Date(),
      taskId: payload.taskId,
      toolName: payload.toolName,
      toolResult: payload.result,
      success: payload.success,
      toolUseId: payload.toolUseId,
    };
    let seq: number | undefined;
    try {
      seq = await streamingEventLog.append(payload.taskId, 'tool_result', { toolName: payload.toolName, result: payload.result, success: payload.success, toolUseId: payload.toolUseId });
    } catch (err) {
      console.error(`[relay-server] Failed to persist tool_result event for task ${payload.taskId}:`, err);
    }
    this.emit('task:tool_trace', Object.assign(traceMsg, { _dbSeq: seq }));
    this.publishToRedis({
      eventType: 'tool_result', taskId: payload.taskId,
      data: { toolName: payload.toolName, toolResult: payload.result, success: payload.success, toolUseId: payload.toolUseId },
      dbSeq: seq,
    });
  }

  /**
   * Handle agent runner's structured file change message
   */
  private async handleAgentRunnerTaskFileChange(message: AgentRunnerTaskFileChangeMessage): Promise<void> {
    const { payload } = message;
    // Compute line counts from diff when not provided by agent runner
    let { linesAdded, linesRemoved } = payload;
    if (linesAdded == null && linesRemoved == null && payload.diff) {
      const counts = computeLineCounts(payload.diff);
      linesAdded = counts.added;
      linesRemoved = counts.removed;
    }
    const changeMsg: TaskFileChangeMessage = {
      type: 'task.file_change',
      timestamp: new Date(),
      taskId: payload.taskId,
      path: payload.path,
      action: payload.action,
      linesAdded,
      linesRemoved,
      diff: payload.diff,
    };
    let seq: number | undefined;
    try {
      seq = await streamingEventLog.append(payload.taskId, 'file_change', { path: payload.path, action: payload.action, linesAdded, linesRemoved });
    } catch (err) {
      console.error(`[relay-server] Failed to persist file_change event for task ${payload.taskId}:`, err);
    }
    this.emit('task:file_change', Object.assign(changeMsg, { _dbSeq: seq }));
    this.publishToRedis({
      eventType: 'file_change', taskId: payload.taskId,
      data: { path: payload.path, action: payload.action, linesAdded, linesRemoved, diff: payload.diff },
      dbSeq: seq,
    });
  }

  /**
   * Handle agent runner's session init message
   */
  private async handleAgentRunnerTaskSessionInit(message: AgentRunnerTaskSessionInitMessage): Promise<void> {
    const { payload } = message;
    const initMsg: TaskSessionInitMessage = {
      type: 'task.session_init',
      timestamp: new Date(),
      taskId: payload.taskId,
      sessionId: payload.sessionId,
      model: payload.model,
    };
    let seq: number | undefined;
    try {
      seq = await streamingEventLog.append(payload.taskId, 'session_init', { sessionId: payload.sessionId, model: payload.model });
    } catch (err) {
      console.error(`[relay-server] Failed to persist session_init event for task ${payload.taskId}:`, err);
    }
    this.emit('task:session_init', Object.assign(initMsg, { _dbSeq: seq }));
    this.publishToRedis({
      eventType: 'session_init', taskId: payload.taskId,
      data: { sessionId: payload.sessionId, model: payload.model },
      dbSeq: seq,
    });
  }

  /**
   * Handle dispatch acknowledgment from agent runner.
   * Clears the ACK timeout timer — the agent runner confirmed it received the task.
   */
  private handleTaskDispatchAck(message: { type: 'task_dispatch_ack'; payload: { taskId: string } }): void {
    const { taskId } = message.payload;
    const timer = this.dispatchAckTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.dispatchAckTimers.delete(taskId);
      console.log(`[relay] Dispatch ACK received for task ${taskId}`);
    }
  }

  /**
   * Handle agent runner's steer ack message.
   * Updates all 'sent' steer_message events to 'acknowledged' or 'timed_out',
   * then drains any new pending steers that arrived while the agent was processing.
   */
  private handleAgentRunnerTaskSteerAck(message: AgentRunnerTaskSteerAckMessage): void {
    const { payload } = message;
    const ackMsg: TaskSteerAckMessage = {
      type: 'task.steer.ack',
      timestamp: new Date(),
      taskId: payload.taskId,
      accepted: payload.accepted,
      message: payload.message,
      interrupted: payload.interrupted,
    };
    this.emit('task:steer_ack', ackMsg);

    // Persist ack status: update all 'sent' steer_messages for this execution
    // to 'acknowledged' (or 'timed_out' if rejected). This ensures page-refresh
    // recovery shows correct delivery indicators.
    const status = payload.accepted ? 'acknowledged' as const : 'timed_out' as const
    streamingEventLog.updateSentSteersStatus(payload.taskId, status).then(() => {
      // After ack is persisted, drain any new pending steers that arrived mid-turn.
      // Only drain if the agent accepted — no point sending more if it rejected.
      if (!payload.accepted) return
      const machineId = this.taskToMachine.get(payload.taskId)
      if (!machineId) return
      this.drainPendingSteers(payload.taskId, machineId)
    }).catch((err) => {
      console.warn('[relay] Failed to update steer status on ack:', err)
    })
  }

  /**
   * Batch-drain pending steer messages from DB and deliver via WebSocket.
   * Called on session_init (via dispatch.ts) and after steer_ack (to deliver
   * messages queued while the agent was processing the previous batch).
   */
  private drainPendingSteers(taskId: string, machineId: string): void {
    const batchId = crypto.randomUUID()
    streamingEventLog.claimPendingSteers(taskId, batchId).then((claimed) => {
      if (claimed.length === 0) return

      const messages = claimed.map((e) => {
        const d = e.data as Record<string, unknown>
        return (d.message as string) || ''
      }).filter(Boolean)

      if (messages.length === 0) return

      const batchedMessage = messages.join('\n\n')
      const sent = this.steerTask(taskId, machineId, batchedMessage)

      if (sent) {
        console.log(`[relay] Drained ${claimed.length} pending steer(s) for ${taskId} after ack (batch ${batchId})`)
      } else {
        // Revert claimed steers back to 'pending' so they can be retried
        const seqs = claimed.map((e) => e.seq)
        streamingEventLog.batchUpdateSteerStatus(seqs, 'pending').catch((err) => {
          notifyWarning(`Failed to revert steer status to pending for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`)
        })
        console.warn(`[relay] Failed to drain pending steers for ${taskId} after ack — reverted to pending`)
      }
    }).catch((err) => {
      console.warn(`[relay] Failed to drain pending steers for ${taskId}:`, err)
    })
  }

  /**
   * Handle agent runner's approval request message
   */
  private handleAgentRunnerTaskApprovalRequest(message: AgentRunnerTaskApprovalRequestMessage): void {
    const { payload } = message;
    const machineId = this.taskToMachine.get(payload.taskId);
    console.log(`[relay] Approval request from task ${payload.taskId}: ${payload.question}`);
    streamingEventLog.appendApprovalRequestIfAbsent(payload.taskId, {
      requestId: payload.requestId,
      question: payload.question,
      options: payload.options,
      machineId,
    }).catch((err) => {
      console.warn(`[relay] Failed to persist approval request for ${payload.taskId}:`, err);
    });
    this.emit('task:approval_request', {
      taskId: payload.taskId,
      requestId: payload.requestId,
      question: payload.question,
      options: payload.options,
      machineId,
    });
    // Bridge cross-instance so the dispatch instance sets waitingForApproval correctly.
    this.publishToRedis({
      eventType: 'approval_request',
      taskId: payload.taskId,
      data: { requestId: payload.requestId, question: payload.question, options: payload.options, machineId },
    }).catch(() => {});
  }

  private async handleAgentRunnerTaskResult(message: AgentRunnerTaskResultMessage): Promise<void> {
    const { payload } = message;
    const { taskId, status, exitCode, output, error, artifacts, metrics, branchName, prUrl, prNumber, commitBeforeSha, commitAfterSha, deliveryStatus, deliveryError, summary } = payload;
    this.taskToMachine.delete(taskId);
    this.taskDispatchedAt.delete(taskId);
    this.consecutiveMisses.delete(taskId);
    // Clear dispatch ACK timer — task completed before or after ACK
    const ackTimer = this.dispatchAckTimers.get(taskId);
    if (ackTimer) { clearTimeout(ackTimer); this.dispatchAckTimers.delete(taskId); }
    redisPubSub.removeTaskMapping(taskId).catch(() => {});

    // Snapshot userId BEFORE emit — dispatch.ts's onResult handler synchronously
    // calls executionContextStore.remove(), so getUserIdForTask returns undefined
    // after emit returns. Uses async fallback for cross-instance case.
    let userId: string | undefined;
    try {
      userId = await executionContextStore.getUserIdForTaskWithFallback(taskId);
    } catch {
      userId = executionContextStore.getUserIdForTask(taskId);
    }

    // Convert to standard result message
    const resultMsg: TaskResultMessage = {
      type: 'task.result',
      timestamp: new Date(),
      result: {
        taskId,
        status: status === 'completed' ? 'completed'
          : status === 'failed' ? 'failed'
          : status === 'cancelled' ? 'cancelled'
          : status === 'timeout' ? 'timeout'
          : 'failed',
        exitCode,
        output,
        error,
        artifacts: artifacts?.map((a) => ({
          name: a.name,
          type: a.type === 'file' ? 'file' : a.type === 'log' ? 'log' : 'other',
          path: a.path,
        })),
        metrics,
        branchName,
        prUrl,
        prNumber,
        commitBeforeSha,
        commitAfterSha,
        deliveryStatus,
        deliveryError,
        summary,
      },
    };
    const resultData = {
      status: resultMsg.result.status,
      output,
      error,
      duration: resultMsg.result.duration,
      branchName,
      prUrl,
      prNumber,
      deliveryStatus,
      deliveryError,
      summary,
    };
    const seq = await streamingEventLog.appendTerminalIfAbsent(taskId, 'result', resultData);
    // appendTerminalIfAbsent above already flushed pending text and emitted
    // the text-flushed wake-up. Just cancel any pending periodic flush timer.
    this.cancelTextFlush(taskId);
    this.emit('task:result', resultMsg);
    redisPubSub.publishStreamingEvent({
      eventType: 'result', taskId, userId,
      data: resultData,
      dbSeq: seq,
    }).catch((err) => {
      console.error(`[relay] Failed to publish result to Redis:`, err);
    });
  }

  // ============================================================================
  // File List Handlers
  // ============================================================================

  /**
   * Request a file list from a connected machine.
   * Routes via Redis if the machine is on another instance.
   */
  requestFileList(machineId: string, path: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'file_list_request',
        timestamp: new Date().toISOString(),
        payload: { path, correlationId },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    // The machine may be on another instance even if not yet synced to this registry.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'file_list_request',
        payload: { path, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy file_list_request failed:', err));
      return true;
    }

    console.debug(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for file list request`);
    return false;
  }

  /**
   * Handle file_list.response (dot notation)
   */
  private handleFileListResponse(message: { correlationId: string; files: string[] }): void {
    this.emit('file_list:response', {
      correlationId: message.correlationId,
      files: message.files,
    });
  }

  /**
   * Handle agent runner's file_list_response format
   */
  private handleAgentRunnerFileListResponse(message: AgentRunnerFileListResponseMessage): void {
    this.emit('file_list:response', {
      correlationId: message.payload.correlationId,
      files: message.payload.files,
    });
  }

  // ============================================================================
  // Directory List Handlers (for remote path browsing)
  // ============================================================================

  /**
   * Request a directory listing from a connected machine.
   * Routes via Redis if the machine is on another instance.
   */
  requestDirectoryList(machineId: string, path: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'directory_list_request',
        timestamp: new Date().toISOString(),
        payload: { path, correlationId },
      };
      socket.send(JSON.stringify(msg));
      console.log(`[relay] directory_list_request sent via LOCAL socket machineId=${machineId} cid=${correlationId}`);
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    // The machine may be on another instance even if not yet synced to this registry.
    if (redisPubSub.isConnected()) {
      console.log(`[relay] directory_list_request routing via REDIS proxy machineId=${machineId} cid=${correlationId} connection=${connection ? 'remote' : 'unknown'}`);
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'directory_list_request',
        payload: { path, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy directory_list_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for directory list request`);
    return false;
  }

  /**
   * Handle directory_list.response (dot notation)
   */
  private handleDirectoryListResponse(message: { correlationId: string; path: string; entries: DirectoryEntry[]; error?: string; homeDirectory?: string }): void {
    console.log(`[relay] directory_list.response (dot) cid=${message.correlationId} entries=${message.entries?.length ?? 0} error=${message.error ?? 'none'}`);
    this.emit('directory_list:response', {
      correlationId: message.correlationId,
      path: message.path,
      entries: message.entries,
      error: message.error,
      homeDirectory: message.homeDirectory,
    });
  }

  /**
   * Handle agent runner's directory_list_response format
   */
  private handleAgentRunnerDirectoryListResponse(message: AgentRunnerDirectoryListResponseMessage): void {
    console.log(`[relay] directory_list_response (underscore) cid=${message.payload.correlationId} entries=${message.payload.entries?.length ?? 0} error=${message.payload.error ?? 'none'}`);
    this.emit('directory_list:response', {
      correlationId: message.payload.correlationId,
      path: message.payload.path,
      entries: message.payload.entries,
      error: message.payload.error,
      homeDirectory: message.payload.homeDirectory,
    });
  }

  // ============================================================================
  // File Content Handlers (for reading remote files)
  // ============================================================================

  /**
   * Request file content from a connected machine.
   * Routes via Redis if the machine is on another instance.
   */
  requestFileContent(machineId: string, path: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'file_content_request',
        timestamp: new Date().toISOString(),
        payload: { path, correlationId },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'file_content_request',
        payload: { path, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy file_content_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for file content request`);
    return false;
  }

  /**
   * Handle file_content.response (dot notation)
   */
  private handleFileContentResponse(message: FileContentResponseMessage): void {
    this.emit('file_content:response', {
      correlationId: message.correlationId!,
      path: message.path,
      content: message.content,
      encoding: message.encoding,
      mimeType: message.mimeType,
      size: message.size,
      chunked: message.chunked,
      chunkIndex: message.chunkIndex,
      totalChunks: message.totalChunks,
      error: message.error,
    });
  }

  /**
   * Handle agent runner's file_content_response format
   */
  private handleAgentRunnerFileContentResponse(message: AgentRunnerFileContentResponseMessage): void {
    this.emit('file_content:response', {
      correlationId: message.payload.correlationId,
      path: message.payload.path,
      content: message.payload.content,
      encoding: message.payload.encoding,
      mimeType: message.payload.mimeType,
      size: message.payload.size,
      chunked: message.payload.chunked,
      chunkIndex: message.payload.chunkIndex,
      totalChunks: message.payload.totalChunks,
      error: message.payload.error,
    });
  }

  // ============================================================================
  // File Upload Handlers (for writing remote files)
  // ============================================================================

  /**
   * Request file upload to a connected machine.
   * Routes via Redis if the machine is on another instance.
   */
  requestFileUpload(
    machineId: string,
    destinationPath: string,
    fileName: string,
    size: number,
    totalChunks: number,
    overwrite: boolean,
    correlationId: string,
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'file_upload_request',
        timestamp: new Date().toISOString(),
        payload: { destinationPath, fileName, size, totalChunks, overwrite, correlationId },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'file_upload_request',
        payload: { destinationPath, fileName, size, totalChunks, overwrite, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy file_upload_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for file upload request`);
    return false;
  }

  /**
   * Send a file upload chunk to a connected machine.
   * Routes via Redis if the machine is on another instance.
   */
  sendFileUploadChunk(
    machineId: string,
    correlationId: string,
    chunkIndex: number,
    encoding: 'utf-8' | 'base64',
    content: string,
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'file_upload_chunk',
        timestamp: new Date().toISOString(),
        payload: { correlationId, chunkIndex, encoding, content },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'file_upload_chunk',
        payload: { correlationId, chunkIndex, encoding, content },
      }).catch((err) => console.error('[relay] Redis proxy file_upload_chunk failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for file upload chunk`);
    return false;
  }

  /**
   * Handle file_upload.response (dot notation)
   */
  private handleFileUploadResponse(message: FileUploadResponseMessage): void {
    this.emit('file_upload:response', {
      correlationId: message.correlationId!,
      success: message.success,
      path: message.path,
      error: message.error,
    });
  }

  /**
   * Handle agent runner's file_upload_response format
   */
  private handleAgentRunnerFileUploadResponse(message: AgentRunnerFileUploadResponseMessage): void {
    this.emit('file_upload:response', {
      correlationId: message.payload.correlationId,
      success: message.payload.success,
      path: message.payload.path,
      error: message.payload.error,
    });
  }

  // ============================================================================
  // Sessions List Handlers (Claude Code session discovery)
  // ============================================================================

  /**
   * Request a sessions list from a connected machine.
   * Routes via Redis if the machine is on another instance.
   */
  requestSessionsList(
    machineId: string,
    correlationId: string,
    opts?: {
      maxAgeMs?: number;
      providers?: Array<'claude' | 'codex' | 'pi'>;
      cwd?: string;
    },
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);
    const payload: Record<string, unknown> = { correlationId };
    if (opts?.maxAgeMs !== undefined) payload.maxAgeMs = opts.maxAgeMs;
    if (opts?.providers?.length) payload.providers = opts.providers;
    if (opts?.cwd) payload.cwd = opts.cwd;

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'sessions_list_request',
        timestamp: new Date().toISOString(),
        payload,
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'sessions_list_request',
        payload,
      }).catch((err) => console.error('[relay] Redis proxy sessions_list_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for sessions list request`);
    return false;
  }

  /**
   * Request that a connected machine copy a set of external-agent transcripts
   * into `<workingDirectory>/.astro/imports/`. The response is delivered via
   * the `import_sessions:response` event with the matching correlationId.
   */
  requestImportSessions(
    machineId: string,
    correlationId: string,
    workingDirectory: string,
    sessions: Array<{
      provider: 'claude' | 'codex' | 'pi';
      sessionId: string;
      title: string;
      cwd?: string;
      gitBranch?: string;
      lastModified?: number;
    }>,
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);
    const payload = { correlationId, workingDirectory, sessions };

    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'import_sessions_request',
        timestamp: new Date().toISOString(),
        payload,
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'import_sessions_request',
        payload,
      }).catch((err) => console.error('[relay] Redis proxy import_sessions_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for import sessions request`);
    return false;
  }

  /**
   * Handle sessions_list.response (dot notation)
   */
  private handleSessionsListResponse(message: { correlationId: string; sessions: ClaudeCodeSessionInfo[]; error?: string }): void {
    this.emit('sessions_list:response', {
      correlationId: message.correlationId,
      sessions: message.sessions,
      error: message.error,
    });
  }

  /**
   * Handle agent runner's sessions_list_response format
   */
  private handleAgentRunnerSessionsListResponse(message: AgentRunnerSessionsListResponseMessage): void {
    this.emit('sessions_list:response', {
      correlationId: message.payload.correlationId,
      sessions: message.payload.sessions,
      error: message.payload.error,
    });
  }

  /**
   * Handle agent runner's import_sessions_response format
   */
  private handleAgentRunnerImportSessionsResponse(
    message: AgentRunnerImportSessionsResponseMessage,
  ): void {
    this.emit('import_sessions:response', {
      correlationId: message.payload.correlationId,
      ok: message.payload.ok,
      manifestPath: message.payload.manifestPath,
      rawCount: message.payload.rawCount,
      failures: message.payload.failures,
      error: message.payload.error,
    });
  }

  // ============================================================================
  // Create Directory Handlers
  // ============================================================================

  /**
   * Request creating a directory on a connected machine.
   * Routes via Redis if the machine is on another instance.
   */
  requestCreateDirectory(machineId: string, parentPath: string, name: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'create_directory_request',
        timestamp: new Date().toISOString(),
        payload: { parentPath, name, correlationId },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'create_directory_request',
        payload: { parentPath, name, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy create_directory_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for create directory request`);
    return false;
  }

  /**
   * Handle create_directory.response (dot notation)
   */
  private handleCreateDirectoryResponse(message: { correlationId: string; success: boolean; path?: string; error?: string }): void {
    this.emit('create_directory:response', {
      correlationId: message.correlationId,
      success: message.success,
      path: message.path,
      error: message.error,
    });
  }

  /**
   * Handle agent runner's create_directory_response format
   */
  private handleAgentRunnerCreateDirectoryResponse(message: AgentRunnerCreateDirectoryResponseMessage): void {
    this.emit('create_directory:response', {
      correlationId: message.payload.correlationId,
      success: message.payload.success,
      path: message.payload.path,
      error: message.payload.error,
    });
  }

  // ============================================================================
  // Repo Setup Handlers
  // ============================================================================

  /**
   * Request repo setup from a connected machine
   */
  requestRepoSetup(
    machineId: string,
    payload: {
      correlationId: string;
      projectId: string;
      projectName: string;
      projectDescription?: string;
      workingDirectory?: string;
      repository?: string;
    },
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'repo_setup_request',
        timestamp: new Date().toISOString(),
        payload,
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId: payload.correlationId,
        messageType: 'repo_setup_request',
        payload: payload as unknown as Record<string, unknown>,
      }).catch((err) => console.error('[relay] Redis proxy repo_setup_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for repo setup request`);
    return false;
  }

  /**
   * Handle repo_setup.response (dot notation)
   */
  private handleRepoSetupResponse(message: { correlationId: string; result: RepoSetupRelayResult }): void {
    this.emit('repo_setup:response', {
      correlationId: message.correlationId,
      result: message.result,
    });
  }

  /**
   * Handle agent runner's repo_setup_response format
   */
  private handleAgentRunnerRepoSetupResponse(message: AgentRunnerRepoSetupResponseMessage): void {
    const { correlationId, ...result } = message.payload;
    this.emit('repo_setup:response', {
      correlationId,
      result,
    });
  }

  // ============================================================================
  // Slash Commands Handlers
  // ============================================================================

  /**
   * Request slash commands from a connected machine
   */
  requestSlashCommands(machineId: string, correlationId: string, workingDirectory?: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'slash_commands_request',
        timestamp: new Date().toISOString(),
        payload: { correlationId, workingDirectory },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'slash_commands_request',
        payload: { correlationId, workingDirectory },
      }).catch((err) => console.error('[relay] Redis proxy slash_commands_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for slash commands request`);
    return false;
  }

  /**
   * Handle slash_commands.response (dot notation)
   */
  private handleSlashCommandsResponse(message: { correlationId: string; commands: Array<{ name: string; description: string }> }): void {
    this.emit('slash_commands:response', {
      correlationId: message.correlationId,
      commands: message.commands,
    });
  }

  /**
   * Handle agent runner's slash_commands_response format
   */
  private handleAgentRunnerSlashCommandsResponse(message: AgentRunnerSlashCommandsResponseMessage): void {
    this.emit('slash_commands:response', {
      correlationId: message.payload.correlationId,
      commands: message.payload.commands,
    });
  }

  // ============================================================================
  // Repo Detect Handlers
  // ============================================================================

  /**
   * Request repo detect from a connected machine
   */
  requestRepoDetect(machineId: string, path: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'repo_detect_request',
        timestamp: new Date().toISOString(),
        payload: { path, correlationId },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'repo_detect_request',
        payload: { path, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy repo_detect_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for repo detect request`);
    return false;
  }

  /**
   * Handle repo_detect.response (dot notation)
   */
  private handleRepoDetectResponse(message: { correlationId: string; result: RepoDetectRelayResult }): void {
    this.emit('repo_detect:response', {
      correlationId: message.correlationId,
      result: message.result,
    });
  }

  /**
   * Handle agent runner's repo_detect_response format
   */
  private handleAgentRunnerRepoDetectResponse(message: AgentRunnerRepoDetectResponseMessage): void {
    const { correlationId, ...result } = message.payload;
    this.emit('repo_detect:response', {
      correlationId,
      result,
    });
  }

  // ============================================================================
  // Git Init Handlers
  // ============================================================================

  /**
   * Request git init from a connected machine
   */
  requestGitInit(
    machineId: string,
    payload: {
      correlationId: string;
      workingDirectory: string;
      projectId: string;
      projectName: string;
      projectDescription?: string;
    },
  ): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'git_init_request',
        timestamp: new Date().toISOString(),
        payload,
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId: payload.correlationId,
        messageType: 'git_init_request',
        payload: payload as unknown as Record<string, unknown>,
      }).catch((err) => console.error('[relay] Redis proxy git_init_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for git init request`);
    return false;
  }

  /**
   * Handle git_init.response (dot notation)
   */
  private handleGitInitResponse(message: { correlationId: string; result: GitInitRelayResult }): void {
    this.emit('git_init:response', {
      correlationId: message.correlationId,
      result: message.result,
    });
  }

  /**
   * Handle agent runner's git_init_response format
   */
  private handleAgentRunnerGitInitResponse(message: AgentRunnerGitInitResponseMessage): void {
    const { correlationId, ...result } = message.payload;
    this.emit('git_init:response', {
      correlationId,
      result,
    });
  }

  // ============================================================================
  // Branch List Handlers
  // ============================================================================

  /**
   * Request branch list from a connected machine
   */
  requestBranchList(machineId: string, path: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    // Local socket — send directly
    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'branch_list_request',
        timestamp: new Date().toISOString(),
        payload: { path, correlationId },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    // Remote or unknown machine — route via Redis proxy.
    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'branch_list_request',
        payload: { path, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy branch_list_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable (no local socket, no Redis) for branch list request`);
    return false;
  }

  /**
   * Handle branch_list.response (dot notation)
   */
  private handleBranchListResponse(message: { correlationId: string; result: BranchListRelayResult }): void {
    this.emit('branch_list:response', {
      correlationId: message.correlationId,
      result: message.result,
    });
  }

  /**
   * Handle agent runner's branch_list_response format
   */
  private handleAgentRunnerBranchListResponse(message: AgentRunnerBranchListResponseMessage): void {
    const { correlationId, ...result } = message.payload;
    this.emit('branch_list:response', {
      correlationId,
      result,
    });
  }

  // ============================================================================
  // Git Checkout / Create-Branch Handlers
  // ============================================================================

  requestGitCheckout(machineId: string, path: string, branch: string, correlationId: string, stash?: boolean): boolean {
    const connection = machineRegistry.getConnection(machineId);

    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'git_checkout_request',
        timestamp: new Date().toISOString(),
        payload: { path, branch, correlationId, ...(stash && { stash }) },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'git_checkout_request',
        payload: { path, branch, correlationId, ...(stash && { stash }) },
      }).catch((err) => console.error('[relay] Redis proxy git_checkout_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable for git checkout request`);
    return false;
  }

  requestGitCreateBranch(machineId: string, path: string, branch: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'git_create_branch_request',
        timestamp: new Date().toISOString(),
        payload: { path, branch, correlationId },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'git_create_branch_request',
        payload: { path, branch, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy git_create_branch_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable for git create-branch request`);
    return false;
  }

  private handleGitCheckoutResponse(message: { correlationId: string; result: GitCheckoutRelayResult }): void {
    this.emit('git_checkout:response', {
      correlationId: message.correlationId,
      result: message.result,
    });
  }

  private handleAgentRunnerGitCheckoutResponse(message: AgentRunnerGitCheckoutResponseMessage): void {
    const { correlationId, ...result } = message.payload;
    this.emit('git_checkout:response', { correlationId, result });
  }

  private handleGitCreateBranchResponse(message: { correlationId: string; result: GitCreateBranchRelayResult }): void {
    this.emit('git_create_branch:response', {
      correlationId: message.correlationId,
      result: message.result,
    });
  }

  private handleAgentRunnerGitCreateBranchResponse(message: AgentRunnerGitCreateBranchResponseMessage): void {
    const { correlationId, ...result } = message.payload;
    this.emit('git_create_branch:response', { correlationId, result });
  }

  // ============================================================================
  // Session Attachment Handlers (MCP Bridge)
  // ============================================================================

  /**
   * Handle session attach request from MCP bridge
   */
  private async handleSessionAttach(socket: WebSocket, message: SessionAttachMessage): Promise<void> {
    const { taskId, sessionId, machineId } = message;

    console.log(`[relay] Session attach request: session=${sessionId}, task=${taskId}, machine=${machineId}`);

    // Check if session is already attached
    if (this.attachedSessions.has(sessionId)) {
      const ack: SessionAttachAckMessage = {
        type: 'session.attach.ack',
        timestamp: new Date(),
        taskId,
        sessionId,
        success: false,
        error: 'Session already attached',
      };
      this.sendSessionMessage(socket, ack);
      return;
    }

    // Validate that the task exists in the database
    try {
      const { db } = await import('./db/index.js');
      const { planNodes } = await import('./db/schema.js');
      const { eq } = await import('drizzle-orm');
      const [node] = await db.select({ id: planNodes.id }).from(planNodes).where(eq(planNodes.id, taskId)).limit(1);
      if (!node) {
        console.warn(`[relay] Session attach rejected: task ${taskId} not found`);
        const ack: SessionAttachAckMessage = {
          type: 'session.attach.ack',
          timestamp: new Date(),
          taskId,
          sessionId,
          success: false,
          error: 'Task not found',
        };
        this.sendSessionMessage(socket, ack);
        return;
      }
    } catch (err) {
      // If DB lookup fails, allow the attach to proceed rather than blocking
      console.warn(`[relay] Could not validate task ${taskId}, allowing attach:`, err);
    }

    // Register the session
    const session: AttachedSession = {
      sessionId,
      taskId,
      machineId,
      socket,
      attachedAt: new Date(),
      eventCount: 0,
    };
    this.attachedSessions.set(sessionId, session);

    // Send acknowledgment
    const ack: SessionAttachAckMessage = {
      type: 'session.attach.ack',
      timestamp: new Date(),
      taskId,
      sessionId,
      success: true,
    };
    this.sendSessionMessage(socket, ack);

    // Emit event for SSE streaming
    this.emit('session:attached', sessionId, taskId, machineId);
    console.log(`[relay] Session ${sessionId} attached to task ${taskId}`);
  }

  /**
   * Handle session detach request from MCP bridge
   */
  private handleSessionDetach(message: SessionDetachMessage): void {
    const { sessionId, reason } = message;

    const session = this.attachedSessions.get(sessionId);
    if (!session) {
      console.warn(`[relay] Session detach for unknown session: ${sessionId}`);
      return;
    }

    // Remove from registry
    this.attachedSessions.delete(sessionId);

    // Emit event for SSE streaming
    this.emit('session:detached', sessionId, session.taskId, reason);
    console.log(`[relay] Session ${sessionId} detached from task ${session.taskId} (${session.eventCount} events sent)`);
  }

  /**
   * Handle session event from MCP bridge
   */
  private handleSessionEvent(message: SessionEventMessage): void {
    const { sessionId, taskId, event } = message;

    const session = this.attachedSessions.get(sessionId);
    if (!session) {
      console.warn(`[relay] Session event for unknown session: ${sessionId}`);
      return;
    }

    // Increment event count
    session.eventCount++;

    // Emit event for SSE streaming
    this.emit('session:event', sessionId, taskId, event);
  }

  /**
   * Send a message to a session socket
   */
  private sendSessionMessage(socket: WebSocket, message: SessionAttachAckMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * Get all attached sessions
   */
  getAttachedSessions(): Array<{
    sessionId: string;
    taskId: string;
    machineId: string;
    attachedAt: Date;
    eventCount: number;
  }> {
    return Array.from(this.attachedSessions.values()).map((s) => ({
      sessionId: s.sessionId,
      taskId: s.taskId,
      machineId: s.machineId,
      attachedAt: s.attachedAt,
      eventCount: s.eventCount,
    }));
  }

  /**
   * Get sessions attached to a specific task
   */
  getSessionsForTask(taskId: string): Array<{
    sessionId: string;
    machineId: string;
    attachedAt: Date;
    eventCount: number;
  }> {
    return Array.from(this.attachedSessions.values())
      .filter((s) => s.taskId === taskId)
      .map((s) => ({
        sessionId: s.sessionId,
        machineId: s.machineId,
        attachedAt: s.attachedAt,
        eventCount: s.eventCount,
      }));
  }

  // ============================================================================
  // Channel Relay (server <-> agent runner <-> OpenClaw gateway)
  // ============================================================================

  /**
   * Send a notification through an agent runner's OpenClaw bridge
   */
  sendChannelNotification(machineId: string, correlationId: string, notification: {
    type: string;
    projectId: string;
    summary: string;
    astroUrl?: string;
    to?: string;
    metadata?: Record<string, unknown>;
  }): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection?.socket || connection.socket.readyState !== WebSocket.OPEN) return false;

    connection.socket.send(JSON.stringify({
      type: 'channel_notification',
      timestamp: new Date().toISOString(),
      payload: { correlationId, notification },
    }));
    return true;
  }

  /**
   * Send a chat response through an agent runner's OpenClaw bridge
   */
  sendChannelResponse(machineId: string, correlationId: string, response: {
    text: string;
    channelId: string;
    threadId?: string;
    to?: string;
    metadata?: Record<string, unknown>;
  }): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection?.socket || connection.socket.readyState !== WebSocket.OPEN) return false;

    connection.socket.send(JSON.stringify({
      type: 'channel_response',
      timestamp: new Date().toISOString(),
      payload: { correlationId, response },
    }));
    return true;
  }

  /**
   * Send an approval request through an agent runner's OpenClaw bridge
   */
  sendChannelApprovalRequest(machineId: string, correlationId: string, opts: {
    approvalId: string;
    projectId: string;
    taskId: string;
    question: string;
    options?: string[];
    to?: string;
  }): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection?.socket || connection.socket.readyState !== WebSocket.OPEN) return false;

    connection.socket.send(JSON.stringify({
      type: 'channel_approval_request',
      timestamp: new Date().toISOString(),
      payload: { correlationId, ...opts },
    }));
    return true;
  }

  /**
   * Find a connected machine with the openclaw provider
   */
  findOpenClawMachine(userId?: string): string | null {
    const machines = machineRegistry.getByProvider('openclaw' as import('../types/relay.js').ProviderType);
    if (machines.length === 0) return null;

    // Prefer user-owned machine if userId provided
    if (userId) {
      const userMachine = machines.find(m => m.userId === userId);
      if (userMachine) return userMachine.machineId;
    }

    return machines[0].machineId;
  }

  // ============================================================================
  // Cross-Instance WebSocket Proxy
  // ============================================================================

  /**
   * Handle a WebSocket proxy request from another instance via Redis.
   * Forwards the message to the locally-connected machine's WebSocket.
   * The response will be emitted normally (via relay events) and the
   * Redis response bridge in server/index.ts publishes it back.
   */
  handleWsProxyRequest(machineId: string, messageType: string, payload: Record<string, unknown>): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection?.socket || connection.socket.readyState !== WebSocket.OPEN) {
      console.warn(`[relay] WS proxy: machine ${machineId} not locally connected for ${messageType}`);
      return false;
    }

    const msg = {
      type: messageType,
      timestamp: new Date().toISOString(),
      payload,
    };

    console.log(`[relay] WS proxy: forwarding ${messageType} to local machine ${machineId} cid=${(payload as { correlationId?: string }).correlationId ?? 'none'}`);
    connection.socket.send(JSON.stringify(msg));
    return true;
  }

  /**
   * Check if a machine is reachable — either locally connected (with an open
   * socket) or owned by a live instance (MACHINE_INSTANCE key in Redis).
   * Returns false for ghost machines whose instance key has expired.
   */
  async isMachineReachable(machineId: string): Promise<boolean> {
    const connection = machineRegistry.getConnection(machineId);
    if (connection?.socket && connection.socket.readyState === WebSocket.OPEN) {
      return true;
    }
    if (redisPubSub.isConnected()) {
      try {
        const instanceId = await redisPubSub.getMachineInstance(machineId);
        return !!instanceId;
      } catch {
        // Redis error — fall through to proxy attempt rather than blocking
        return true;
      }
    }
    return false;
  }

  // ============================================================================
  // Content Search Handlers (ripgrep via agent runner)
  // ============================================================================

  requestContentSearch(machineId: string, root: string, pattern: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);

    const socket = connection?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'content_search_request',
        timestamp: new Date().toISOString(),
        payload: { root, pattern, correlationId },
      };
      socket.send(JSON.stringify(msg));
      return true;
    }

    if (redisPubSub.isConnected()) {
      redisPubSub.publishWsProxyRequest({
        machineId,
        correlationId,
        messageType: 'content_search_request',
        payload: { root, pattern, correlationId },
      }).catch((err) => console.error('[relay] Redis proxy content_search_request failed:', err));
      return true;
    }

    console.error(`[relay] Machine ${machineId} not reachable for content search`);
    return false;
  }

  private handleAgentRunnerContentSearchResponse(message: AgentRunnerContentSearchResponseMessage): void {
    this.emit('content_search:response', {
      correlationId: message.payload.correlationId,
      matches: message.payload.matches,
      error: message.payload.error,
    });
  }
}

// Singleton instance
// Pass JWT secret from environment if available
export const relayServer = new RelayServer({
  jwtSecret: process.env.RELAY_JWT_SECRET,
});
