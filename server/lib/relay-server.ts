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
  type HeartbeatPongMessage,
  type TaskDispatch,
  type TaskDispatchMessage,
  type TaskCancelMessage,
  type HeartbeatPingMessage,
  type MachineRegisterAckMessage,
  type ErrorMessage,
} from '../types/relay.js';
import { machineRegistry } from './machine-registry.js';

/** Rate limit state per machine */
interface RateLimitState {
  requests: number[];
  stdoutBytes: number;
  lastReset: number;
}

/** Events emitted by the relay server */
export interface RelayServerEvents {
  'task:result': (result: TaskResultMessage) => void;
  'task:stdout': (output: TaskStdoutMessage) => void;
  'task:progress': (progress: TaskProgressMessage) => void;
  'machine:connected': (machineId: string) => void;
  'machine:disconnected': (machineId: string, reason?: string) => void;
  'error': (error: Error) => void;
}

export class RelayServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private config: RelayServerConfig;
  private rateLimitState: Map<string, RateLimitState> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

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
        console.log(`[relay] Connection closed for machine ${currentMachineId}: ${code} - ${reason.toString()}`);
        machineRegistry.disconnect(currentMachineId, reason.toString() || `close_code_${code}`);
        this.rateLimitState.delete(currentMachineId);
        this.emit('machine:disconnected', currentMachineId, reason.toString());
      }
    });

    socket.on('error', (err) => {
      console.error(`[relay] Socket error for machine ${currentMachineId}:`, err);
      if (currentMachineId) {
        machineRegistry.disconnect(currentMachineId, 'socket_error');
        this.emit('machine:disconnected', currentMachineId, 'socket_error');
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

      case 'task.stdout':
        this.handleTaskStdout(message as TaskStdoutMessage);
        break;

      case 'task.progress':
        this.handleTaskProgress(message as TaskProgressMessage);
        break;

      case 'heartbeat.pong':
        this.handleHeartbeatPong(message as HeartbeatPongMessage);
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

    const message: TaskDispatchMessage = {
      type: 'task.dispatch',
      timestamp: new Date(),
      correlationId: task.taskId,
      task,
    };

    try {
      this.sendMessage(connection.socket, message);
      console.log(`[relay] Task ${task.taskId} dispatched to machine ${machineId}`);
      return true;
    } catch (err) {
      console.error(`[relay] Error dispatching task ${task.taskId}:`, err);
      return false;
    }
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

    const message: TaskCancelMessage = {
      type: 'task.cancel',
      timestamp: new Date(),
      correlationId: taskId,
      taskId,
      reason,
    };

    try {
      this.sendMessage(connection.socket, message);
      console.log(`[relay] Task ${taskId} cancel request sent to machine ${machineId}`);
      return true;
    } catch (err) {
      console.error(`[relay] Error cancelling task ${taskId}:`, err);
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
   * Send a message to a socket
   */
  private sendMessage(socket: WebSocket, message: RelayToAgentMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
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
}

// Singleton instance
export const relayServer = new RelayServer();
