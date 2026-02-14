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

// ============================================================================
// Agent Runner Message Types (for compatibility with @nexus/agent package)
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
    environmentType?: string;
    providers: AgentRunnerProviderInfo[];
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
  'machine:connected': (machineId: string) => void;
  'machine:disconnected': (machineId: string, reason?: string) => void;
  // Session attachment events (MCP bridge)
  'session:attached': (sessionId: string, taskId: string, machineId: string) => void;
  'session:detached': (sessionId: string, taskId: string, reason?: string) => void;
  'session:event': (sessionId: string, taskId: string, event: SessionEvent) => void;
  'file_list:response': (data: { correlationId: string; files: string[] }) => void;
  'repo_setup:response': (data: { correlationId: string; result: RepoSetupRelayResult }) => void;
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
  }

  /**
   * Start the WebSocket server
   */
  start(port?: number): void {
    const serverPort = port ?? this.config.port;

    this.wss = new WebSocketServer({
      port: serverPort,
      verifyClient: this.verifyClient.bind(this),
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', (error) => {
      console.error('[relay] WebSocket server error:', error);
      this.emit('error', error);
    });

    // Start heartbeat interval
    this.startHeartbeatInterval();

    // Listen for registry events
    machineRegistry.on('machine:heartbeat-timeout', (machineId: string) => {
      console.log(`[relay] Machine ${machineId} heartbeat timeout`);
      machineRegistry.disconnect(machineId, 'heartbeat_timeout');
    });

    console.log(`[relay] WebSocket server listening on port ${serverPort}`);
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

      // In development mode (no secret), allow all connections
      if (!secret) {
        console.warn('[relay] No JWT secret configured, allowing connection (development mode)');
        callback(true);
        return;
      }

      // In production mode, require valid JWT token
      const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        callback(false, 401, 'Missing authentication token');
        return;
      }

      try {
        const payload = jwt.verify(token, secret) as MachineJWTPayload;
        // Store machineId in request for use in handleConnection
        (info.req as unknown as { machineJWT: MachineJWTPayload }).machineJWT = payload;
        callback(true);
      } catch (jwtErr) {
        console.error('[relay] JWT verification failed:', jwtErr);
        callback(false, 401, 'Invalid authentication token');
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
      const entry = machineRegistry.register(machineId, machineInfo, socket);
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

      this.emit('machine:connected', machineId);
      console.log(`[relay] Machine ${machineId} registered successfully`);
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
      const bestMachine = machineRegistry.findBestMachine(
        task.environment,
        task.preferredProvider
      );
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
        createdAt: new Date().toISOString(),
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
    const error: ErrorMessage = {
      type: 'error',
      timestamp: new Date(),
      code,
      message,
    };
    this.sendMessage(socket, error);
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
  // Agent Runner Message Handlers (for compatibility with @nexus/agent package)
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
    const { runnerId, machineId, environmentType, providers, resources, version } = payload;

    try {
      // Convert agent runner format to relay server format
      const validEnvTypes = ['local', 'remote', 'hpc', 'cloud'];
      // Auto-promote to 'hpc' if any provider has hpcCapability
      const hasHpcCapability = providers.some((p) => p.hpcCapability);
      const resolvedEnvType = hasHpcCapability ? 'hpc'
        : (validEnvTypes.includes(environmentType || '') ? environmentType : 'local');
      const machineInfo: Omit<MachineInfo, 'machineId'> = {
        name: resources.hostname || machineId,
        environmentType: resolvedEnvType as EnvironmentType,
        hostname: resources.hostname,
        platform: resources.platform,
        providers: providers.map((p) => ({
          type: (['claude-code', 'claude-sdk', 'aws', 'gcp'].includes(p.type) ? p.type : 'custom') as ProviderType,
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
        tags: [runnerId, version],
        metadata: { runnerId, version },
      };

      machineRegistry.register(machineId, machineInfo, socket);
      setMachineId(machineId);

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

      this.emit('machine:connected', machineId);
      console.log(`[relay] Agent runner ${runnerId} (machine ${machineId}) registered successfully`);
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

  private handleAgentRunnerTaskResult(message: AgentRunnerTaskResultMessage): void {
    const { payload } = message;
    const { taskId, status, exitCode, output, error, artifacts } = payload;

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

    // TODO: Validate that the task exists in Nexus (would need API call)
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
export const relayServer = new RelayServer();
