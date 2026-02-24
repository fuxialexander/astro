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
  type TaskSessionInitMessage,
  type HeartbeatPongMessage,
  type TaskDispatch,
  type TaskSteerMessage,
  type HeartbeatPingMessage,
  type MachineRegisterAckMessage,
  type ErrorMessage,
  type MachineInfo,
  type ProviderType,
  // Session attachment types (MCP bridge)
  type SessionAttachMessage,
  type SessionAttachAckMessage,
  type SessionDetachMessage,
  type SessionEventMessage,
  type SessionEvent,
} from '../types/relay.js';
import { machineRegistry } from './machine-registry.js';

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

/** Agent runner's structured tool use message format */
interface AgentRunnerTaskToolUseMessage {
  type: 'task_tool_use';
  timestamp: string;
  payload: {
    taskId: string;
    toolName: string;
    toolInput: unknown;
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
  'task:stdout': (output: TaskStdoutMessage) => void;
  'task:text': (msg: TaskTextMessage) => void;
  'task:progress': (progress: TaskProgressMessage) => void;
  'task:steer_ack': (ack: TaskSteerAckMessage) => void;
  'task:tool_trace': (trace: TaskToolTraceMessage) => void;
  'task:file_change': (change: TaskFileChangeMessage) => void;
  'task:session_init': (msg: TaskSessionInitMessage) => void;
  'task:approval_request': (msg: { taskId: string; requestId: string; question: string; options: string[] }) => void;
  'task:safety_prompt': (msg: { taskId: string; safetyTier: string; warning?: string; options: Array<{ id: string; label: string; description?: string }> }) => void;
  'machine:connected': (machineId: string) => void;
  'machine:disconnected': (machineId: string, reason?: string) => void;
  // Session attachment events (MCP bridge)
  'session:attached': (sessionId: string, taskId: string, machineId: string) => void;
  'session:detached': (sessionId: string, taskId: string, reason?: string) => void;
  'session:event': (sessionId: string, taskId: string, event: SessionEvent) => void;
  'file_list:response': (data: { correlationId: string; files: string[] }) => void;
  'repo_setup:response': (data: { correlationId: string; result: RepoSetupRelayResult }) => void;
  'slash_commands:response': (data: { correlationId: string; commands: Array<{ name: string; description: string }> }) => void;
  'repo_detect:response': (data: { correlationId: string; result: RepoDetectRelayResult }) => void;
  'git_init:response': (data: { correlationId: string; result: GitInitRelayResult }) => void;
  'branch_list:response': (data: { correlationId: string; result: BranchListRelayResult }) => void;
  'error': (error: Error) => void;
}

export class RelayServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private config: RelayServerConfig;
  private rateLimitState: Map<string, RateLimitState> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // Session registry: sessionId -> AttachedSession
  private attachedSessions: Map<string, AttachedSession> = new Map();

  constructor(config: Partial<RelayServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_RELAY_CONFIG, ...config };
    // Support multiple concurrent SSE connections (default 10 is too low)
    // Each SSE client registers ~14 event listeners, so allow 50 concurrent connections
    this.setMaxListeners(700);
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

        // Listen for registry events
        machineRegistry.on('machine:heartbeat-timeout', (machineId: string) => {
          console.log(`[relay] Machine ${machineId} heartbeat timeout`);
          machineRegistry.disconnect(machineId, 'heartbeat_timeout');
        });

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

      console.log('[relay] Verifying client connection');
      console.log('[relay] Config jwtSecret:', this.config.jwtSecret ? 'SET' : 'NOT SET');
      console.log('[relay] Env RELAY_JWT_SECRET:', process.env.RELAY_JWT_SECRET ? 'SET' : 'NOT SET');
      console.log('[relay] Using secret:', secret ? 'YES' : 'NO');

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
          'Run "npx @astroanywhere/agent setup" to register this machine.'
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

        let userMessage = 'Invalid authentication token. ';
        if (errName === 'TokenExpiredError') {
          userMessage += 'Token has expired. Run "npx @astroanywhere/agent setup" to re-register.';
        } else if (errName === 'JsonWebTokenError' && errMsg.includes('malformed')) {
          userMessage += 'Token is malformed (possible "null" string). Run setup again.';
        } else {
          userMessage += 'Run "npx @astroanywhere/agent setup" to re-register this machine.';
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
        // Only disconnect if this socket is still the active connection for this machine.
        // When a machine re-registers, the old socket is closed but the registry already
        // has the new socket — disconnecting here would kill the new connection.
        const current = machineRegistry.getConnection(currentMachineId);
        if (current && current.socket === socket) {
          console.log(`[relay] Connection closed for machine ${currentMachineId}: ${code} - ${reason.toString()}`);
          machineRegistry.disconnect(currentMachineId, reason.toString() || `close_code_${code}`);
          this.rateLimitState.delete(currentMachineId);
          this.emit('machine:disconnected', currentMachineId, reason.toString());
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
          machineRegistry.disconnect(currentMachineId, 'socket_error');
          this.emit('machine:disconnected', currentMachineId, 'socket_error');
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

      case 'task_approval_request':
        this.handleAgentRunnerTaskApprovalRequest(message as AgentRunnerTaskApprovalRequestMessage);
        break;

      // Safety prompt from agent runner — forward as event for browser to display
      case 'task_safety_prompt': {
        const payload = (message as { payload: { taskId: string; safetyTier: string; warning?: string; options: unknown[] } }).payload;
        if (payload?.taskId) {
          this.emit('task:safety_prompt', payload);
          console.log(`[relay] Safety prompt for task ${payload.taskId} (tier: ${payload.safetyTier})`);
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

      // Session attachment messages (MCP bridge)
      case 'session.attach':
        this.handleSessionAttach(socket, message as SessionAttachMessage);
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
      // Extract userId from JWT payload stored on socket
      const jwtPayload = (socket as unknown as { jwtPayload?: MachineJWTPayload }).jwtPayload;
      const userId = jwtPayload?.userId || LOCAL_USER_ID;

      const entry = machineRegistry.register(machineId, machineInfo, socket, userId);
      setMachineId(machineId);

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
   * Handle task result
   */
  private handleTaskResult(message: TaskResultMessage): void {
    console.log(`[relay] Task result received: ${message.result.taskId} - ${message.result.status}`);
    this.emit('task:result', message);
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
  }

  /**
   * Handle task progress update
   */
  private handleTaskProgress(message: TaskProgressMessage): void {
    this.emit('task:progress', message);
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
  }

  /**
   * Handle task file change
   */
  private handleTaskFileChange(message: TaskFileChangeMessage): void {
    this.emit('task:file_change', message);
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
   */
  dispatchTask(task: TaskDispatch, targetMachineId?: string): boolean {
    let machineId = targetMachineId;

    // Find best machine if not specified
    if (!machineId) {
      let bestMachine = machineRegistry.findBestMachine(
        task.environment,
        task.preferredProvider
      );

      // Fallback: try other environment types if no machine matches the requested one
      if (!bestMachine) {
        for (const fallbackEnv of ['local', 'remote', 'hpc', 'cloud'] as const) {
          if (fallbackEnv === task.environment) continue;
          bestMachine = machineRegistry.findBestMachine(fallbackEnv, task.preferredProvider);
          if (bestMachine) {
            console.log(`[relay] No '${task.environment}' machine available, falling back to '${fallbackEnv}' machine ${bestMachine.machineId}`);
            break;
          }
        }
      }

      if (!bestMachine) {
        console.error(`[relay] No available machine for task ${task.taskId}`);
        return false;
      }
      machineId = bestMachine.machineId;
    }

    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for task ${task.taskId}`);
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
        provider: task.preferredProvider || 'claude-sdk',
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
        // Workspace/delivery fields
        ...(task.deliveryMode && { deliveryMode: task.deliveryMode }),
        ...(task.remoteType && { remoteType: task.remoteType }),
        ...(task.agentDir && { agentDir: task.agentDir }),
        ...(task.worktreeStrategy && { worktreeStrategy: task.worktreeStrategy }),
        ...(task.useWorktree !== undefined && { useWorktree: task.useWorktree }),
      },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error(`[relay] Failed to send dispatch for task ${task.taskId} to machine ${machineId} (socket not open)`);
      return false;
    }
    socket.send(JSON.stringify(agentRunnerMsg));
    console.log(`[relay] Task ${task.taskId} dispatched to machine ${machineId}`);
    return true;
  }

  /**
   * Cancel a task on an agent runner
   */
  cancelTask(taskId: string, machineId: string, reason?: string): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for task cancellation`);
      return false;
    }

    // Send in agent-runner's expected format (type: 'task_cancel')
    const agentRunnerMsg = {
      type: 'task_cancel',
      timestamp: new Date().toISOString(),
      payload: { taskId, reason },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error(`[relay] Failed to send cancel for task ${taskId} to machine ${machineId} (socket not open)`);
      return false;
    }
    socket.send(JSON.stringify(agentRunnerMsg));
    console.log(`[relay] Task ${taskId} cancel request sent to machine ${machineId}`);
    return true;
  }

  /**
   * Steer a running task on an agent runner
   */
  steerTask(taskId: string, machineId: string, message: string, action?: 'guidance' | 'redirect' | 'pause' | 'resume', interrupt?: boolean): boolean {
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
   * Send approval response back to agent runner
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
      return false;
    }
    socket.send(JSON.stringify(responseMsg));
    console.log(`[relay] Approval response sent for task ${taskId} request ${requestId} to machine ${machineId}`);
    return true;
  }

  /**
   * Send safety decision back to agent runner
   */
  sendSafetyDecision(
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
      for (const machine of machines) {
        const connection = machineRegistry.getConnection(machine.machineId);
        if (connection) {
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
        console.log(`[relay] Heartbeat timeout for machine ${machineId}`);
        machineRegistry.disconnect(machineId, 'heartbeat_timeout');
        this.emit('machine:disconnected', machineId, 'heartbeat_timeout');
      }
    );
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
          type: (['claude-code', 'claude-sdk', 'codex', 'aws', 'gcp'].includes(p.type) ? p.type : 'custom') as ProviderType,
          version: p.version || undefined,
          status: p.available ? 'available' : 'unavailable',
          maxConcurrentTasks: p.capabilities.maxConcurrentTasks,
          currentTasks: 0,
          capabilities: ['streaming', 'tools', 'multi-turn'].filter((_, i) =>
            [p.capabilities.streaming, p.capabilities.tools, p.capabilities.multiTurn][i]
          ),
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

      // Extract userId from JWT payload stored on socket
      const jwtPayload = (socket as unknown as { jwtPayload?: MachineJWTPayload }).jwtPayload;
      const userId = jwtPayload?.userId || LOCAL_USER_ID;

      machineRegistry.register(machineId, machineInfo, socket, userId);
      setMachineId(machineId);

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
            maxConcurrentTasks: 4,
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
  }

  /**
   * Handle agent runner's task output message format
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
  }

  /**
   * Handle agent runner's task result message format
   */
  /**
   * Handle agent runner's task tool trace message format
   */
  private handleAgentRunnerTaskToolTrace(message: AgentRunnerTaskToolTraceMessage): void {
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
    this.emit('task:tool_trace', traceMsg);
  }

  /**
   * Handle agent runner's structured text message
   * Emits as task:text (NOT task:stdout to avoid double-counting)
   */
  private handleAgentRunnerTaskText(message: AgentRunnerTaskTextMessage): void {
    const { payload } = message;
    const textMsg: TaskTextMessage = {
      type: 'task.text',
      timestamp: new Date(),
      taskId: payload.taskId,
      text: payload.text,
      sequence: payload.sequence,
    };
    this.emit('task:text', textMsg);
  }

  /**
   * Handle agent runner's structured tool use message
   */
  private handleAgentRunnerTaskToolUse(message: AgentRunnerTaskToolUseMessage): void {
    const { payload } = message;
    const traceMsg: TaskToolTraceMessage = {
      type: 'task.tool_trace',
      timestamp: new Date(),
      taskId: payload.taskId,
      toolName: payload.toolName,
      toolInput: payload.toolInput,
    };
    this.emit('task:tool_trace', traceMsg);
  }

  /**
   * Handle agent runner's structured tool result message
   */
  private handleAgentRunnerTaskToolResult(message: AgentRunnerTaskToolResultMessage): void {
    const { payload } = message;
    const traceMsg: TaskToolTraceMessage = {
      type: 'task.tool_trace',
      timestamp: new Date(),
      taskId: payload.taskId,
      toolName: payload.toolName,
      toolResult: payload.result,
      success: payload.success,
    };
    this.emit('task:tool_trace', traceMsg);
  }

  /**
   * Handle agent runner's structured file change message
   */
  private handleAgentRunnerTaskFileChange(message: AgentRunnerTaskFileChangeMessage): void {
    const { payload } = message;
    const changeMsg: TaskFileChangeMessage = {
      type: 'task.file_change',
      timestamp: new Date(),
      taskId: payload.taskId,
      path: payload.path,
      action: payload.action,
      linesAdded: payload.linesAdded,
      linesRemoved: payload.linesRemoved,
      diff: payload.diff,
    };
    this.emit('task:file_change', changeMsg);
  }

  /**
   * Handle agent runner's session init message
   */
  private handleAgentRunnerTaskSessionInit(message: AgentRunnerTaskSessionInitMessage): void {
    const { payload } = message;
    const initMsg: TaskSessionInitMessage = {
      type: 'task.session_init',
      timestamp: new Date(),
      taskId: payload.taskId,
      sessionId: payload.sessionId,
      model: payload.model,
    };
    this.emit('task:session_init', initMsg);
  }

  /**
   * Handle agent runner's steer ack message
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
  }

  /**
   * Handle agent runner's approval request message
   */
  private handleAgentRunnerTaskApprovalRequest(message: AgentRunnerTaskApprovalRequestMessage): void {
    const { payload } = message;
    console.log(`[relay] Approval request from task ${payload.taskId}: ${payload.question}`);
    this.emit('task:approval_request', {
      taskId: payload.taskId,
      requestId: payload.requestId,
      question: payload.question,
      options: payload.options,
    });
  }

  private handleAgentRunnerTaskResult(message: AgentRunnerTaskResultMessage): void {
    const { payload } = message;
    const { taskId, status, exitCode, output, error, artifacts, metrics, branchName, prUrl, prNumber } = payload;

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
      },
    };
    this.emit('task:result', resultMsg);
  }

  // ============================================================================
  // File List Handlers
  // ============================================================================

  /**
   * Request a file list from a connected machine
   */
  requestFileList(machineId: string, path: string, correlationId: string): boolean {
    const connection = machineRegistry.getConnection(machineId);
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for file list request`);
      return false;
    }

    // Send in agent-runner's expected format
    const msg = {
      type: 'file_list_request',
      timestamp: new Date().toISOString(),
      payload: { path, correlationId },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(msg));
    return true;
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
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for repo setup request`);
      return false;
    }

    const msg = {
      type: 'repo_setup_request',
      timestamp: new Date().toISOString(),
      payload,
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(msg));
    return true;
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
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for slash commands request`);
      return false;
    }

    const msg = {
      type: 'slash_commands_request',
      timestamp: new Date().toISOString(),
      payload: { correlationId, workingDirectory },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(msg));
    return true;
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
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for repo detect request`);
      return false;
    }

    const msg = {
      type: 'repo_detect_request',
      timestamp: new Date().toISOString(),
      payload: { path, correlationId },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(msg));
    return true;
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
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for git init request`);
      return false;
    }

    const msg = {
      type: 'git_init_request',
      timestamp: new Date().toISOString(),
      payload,
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(msg));
    return true;
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
    if (!connection) {
      console.error(`[relay] Machine ${machineId} not found for branch list request`);
      return false;
    }

    const msg = {
      type: 'branch_list_request',
      timestamp: new Date().toISOString(),
      payload: { path, correlationId },
    };

    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(msg));
    return true;
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
  // Session Attachment Handlers (MCP Bridge)
  // ============================================================================

  /**
   * Handle session attach request from MCP bridge
   */
  private handleSessionAttach(socket: WebSocket, message: SessionAttachMessage): void {
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

    // TODO: Validate that the task exists in Astro (would need API call)
    // For now, we accept all attach requests

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
}

// Singleton instance
// Pass JWT secret from environment if available
export const relayServer = new RelayServer({
  jwtSecret: process.env.RELAY_JWT_SECRET,
});
