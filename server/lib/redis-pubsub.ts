/**
 * Redis Pub/Sub Adapter
 *
 * Enables horizontal scaling of relay server instances by:
 * - Publishing machine state changes to all instances
 * - Routing task dispatch to the correct instance
 * - Synchronizing machine registry across instances
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';
import type {
  MachineStateChangeEvent,
  TaskStateChangeEvent,
  TaskDispatch,
  MachineRegistryEntry,
} from '../types/relay.js';

/** Redis channels for pub/sub */
const CHANNELS = {
  MACHINE_STATE: 'relay:machine:state',
  TASK_STATE: 'relay:task:state',
  TASK_DISPATCH: 'relay:task:dispatch',
  TASK_CANCEL: 'relay:task:cancel',
  TASK_STREAMING: 'relay:task:streaming',
  APPROVAL_RESPONSE: 'relay:approval:response',
  TASK_STEER: 'relay:task:steer',
  SAFETY_DECISION: 'relay:safety:decision',
  WS_PROXY_REQUEST: 'relay:ws:proxy:request',
  WS_PROXY_RESPONSE: 'relay:ws:proxy:response',
} as const;

/** Redis keys for shared state */
const KEYS = {
  MACHINE_REGISTRY: 'relay:machines',
  MACHINE_INSTANCE: 'relay:machine:instance:', // + machineId
  TASK_MACHINE: 'relay:task:machine:', // + taskId
  INSTANCE_ID: 'relay:instance:', // + instanceId
  EXEC_CONTEXT: 'relay:exec:context:', // + executionId
  EXECUTION_COST: 'relay:exec:cost:', // + executionId → cumulative cost (USD float)
  LEADER: 'relay:leader:', // + operationName → instanceId (leader election)
  TASK_DIR: 'relay:task:dir:', // + taskId → workingDirectory
  SAFETY_DIR: 'relay:safety:dir:', // + workingDirectory → decision
  NOTIFIED_APPROVAL: 'relay:notified:approval:', // + requestId → '1' (dedup)
  PENDING_APPROVAL: 'relay:pending:approval:', // + executionId → '1' (cross-instance watchdog check)
  SESSION_APPROVAL_GRANT: 'relay:session:approval:grant:', // + dispatcherUserId:sessionKey → set<subroutineName>
} as const;

/** Message published for task dispatch routing */
interface TaskDispatchEvent {
  instanceId: string;
  task: TaskDispatch;
  targetMachineId?: string;
  userId?: string;
}

/** Message published for task cancellation */
interface TaskCancelEvent {
  instanceId: string;
  taskId: string;
  machineId: string;
  reason?: string;
}

/** Message published for cross-instance approval response routing */
export interface ApprovalResponseEvent {
  instanceId: string;
  taskId: string;
  machineId: string;
  requestId: string;
  answered: boolean;
  answer?: string;
  message?: string;
}

/** Message published for cross-instance steer routing */
export interface TaskSteerEvent {
  instanceId: string;
  taskId: string;
  machineId: string;
  message: string;
  action?: 'guidance' | 'redirect' | 'pause' | 'resume';
  interrupt?: boolean;
  sessionId?: string;
  branchName?: string;
}

/** Message published for cross-instance safety decision routing */
export interface SafetyDecisionEvent {
  instanceId: string;
  taskId: string;
  machineId: string;
  decision: 'proceed' | 'init-git' | 'sandbox' | 'cancel';
}

/** Message published for cross-instance WebSocket proxy request */
export interface WsProxyRequestEvent {
  instanceId: string;
  machineId: string;
  correlationId: string;
  messageType: string;
  payload: Record<string, unknown>;
}

/** Message published for cross-instance WebSocket proxy response */
export interface WsProxyResponseEvent {
  targetInstanceId: string;
  correlationId: string;
  responseType: string;
  payload: Record<string, unknown>;
}

/** Execution context stored in Redis for cross-instance user isolation */
export interface RedisExecutionContext {
  executionId: string;
  projectId: string;
  nodeId: string;
  userId: string;
  machineId: string;
  createdAt: number;
}

/** Streaming event types bridged via Redis */
export type StreamingEventType =
  | 'activity' | 'text' | 'operational' | 'tool_use' | 'tool_result' | 'file_change'
  | 'session_init' | 'progress' | 'result' | 'error'
  | 'node_status_changed' | 'task_init' | 'task_ready'
  | 'plan_result' | 'approval_request' | 'safety_prompt';

/** Message published for cross-instance streaming event delivery */
export interface StreamingEventMessage {
  instanceId: string;
  eventType: StreamingEventType;
  taskId: string;
  userId?: string;
  data: Record<string, unknown>;
  dbSeq?: number;
}

export interface RedisPubSubEvents {
  'machine:state': (event: MachineStateChangeEvent) => void;
  'task:state': (event: TaskStateChangeEvent) => void;
  'task:dispatch': (event: TaskDispatchEvent) => void;
  'task:cancel': (event: TaskCancelEvent) => void;
  'task:streaming': (event: StreamingEventMessage) => void;
  'approval:response': (event: ApprovalResponseEvent) => void;
  'task:steer': (event: TaskSteerEvent) => void;
  'safety:decision': (event: SafetyDecisionEvent) => void;
  'ws:proxy:request': (event: WsProxyRequestEvent) => void;
  'ws:proxy:response': (event: WsProxyResponseEvent) => void;
  'error': (error: Error) => void;
  'connected': () => void;
  'disconnected': () => void;
}

export class RedisPubSub extends EventEmitter {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private instanceId: string;
  private connected: boolean = false;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.instanceId = `instance-${process.pid}-${Date.now()}`;
  }

  /**
   * Connect to Redis
   */
  async connect(redisUrl?: string): Promise<void> {
    const url = redisUrl || process.env.REDIS_URL;
    if (!url) {
      console.log('[redis] No Redis URL configured, running in single-instance mode');
      return;
    }

    try {
      // Create publisher and subscriber connections
      this.publisher = new Redis(url, {
        retryStrategy: (times) => Math.min(times * 100, 3000),
        maxRetriesPerRequest: 3,
      });

      this.subscriber = new Redis(url, {
        retryStrategy: (times) => Math.min(times * 100, 3000),
        maxRetriesPerRequest: 3,
      });

      // Set up event handlers
      this.publisher.on('connect', () => {
        console.log('[redis] Publisher connected');
      });

      this.publisher.on('error', (err) => {
        console.error('[redis] Publisher error:', err);
        this.emit('error', err);
      });

      this.subscriber.on('connect', () => {
        console.log('[redis] Subscriber connected');
      });

      this.subscriber.on('error', (err) => {
        console.error('[redis] Subscriber error:', err);
        this.emit('error', err);
      });

      // Subscribe to channels
      await this.subscriber.subscribe(
        CHANNELS.MACHINE_STATE,
        CHANNELS.TASK_STATE,
        CHANNELS.TASK_DISPATCH,
        CHANNELS.TASK_CANCEL,
        CHANNELS.TASK_STREAMING,
        CHANNELS.APPROVAL_RESPONSE,
        CHANNELS.TASK_STEER,
        CHANNELS.SAFETY_DECISION,
        CHANNELS.WS_PROXY_REQUEST,
        CHANNELS.WS_PROXY_RESPONSE
      );

      // Handle incoming messages
      this.subscriber.on('message', (channel, message) => {
        this.handleMessage(channel, message);
      });

      // Register this instance
      await this.registerInstance();

      this.connected = true;
      this.emit('connected');
      console.log(`[redis] Connected as instance ${this.instanceId}`);
    } catch (err) {
      console.error('[redis] Connection failed:', err);
      this.emit('error', err as Error);
      throw err;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.publisher) {
      await this.unregisterInstance();
      await this.publisher.quit();
      this.publisher = null;
    }

    if (this.subscriber) {
      await this.subscriber.unsubscribe();
      await this.subscriber.quit();
      this.subscriber = null;
    }

    this.connected = false;
    this.emit('disconnected');
    console.log('[redis] Disconnected');
  }

  /**
   * Check if connected to Redis
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get this instance's ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  // =========================================================================
  // Publishing Methods
  // =========================================================================

  /**
   * Publish machine state change
   */
  async publishMachineState(event: MachineStateChangeEvent): Promise<void> {
    await this.publish(CHANNELS.MACHINE_STATE, event);
  }

  /**
   * Publish task state change
   */
  async publishTaskState(event: TaskStateChangeEvent): Promise<void> {
    await this.publish(CHANNELS.TASK_STATE, event);
  }

  /**
   * Request task dispatch (routed to correct instance)
   */
  async requestTaskDispatch(
    task: TaskDispatch,
    targetMachineId?: string,
    userId?: string
  ): Promise<void> {
    const event: TaskDispatchEvent = {
      instanceId: this.instanceId,
      task,
      targetMachineId,
      userId,
    };
    await this.publish(CHANNELS.TASK_DISPATCH, event);
  }

  /**
   * Publish a streaming event for cross-instance SSE delivery.
   *
   * Unlike `publish()`, this method is a no-op when Redis is disconnected
   * (single-instance mode). Streaming events already reach local SSE clients
   * via the in-process EventEmitter path (relay-server → events.ts handlers),
   * so publishing locally would cause duplicate delivery. The private
   * `publish()` method includes a local fallback because infrastructure events
   * (machine state, task dispatch/cancel) have no other delivery path in
   * single-instance mode.
   */
  async publishStreamingEvent(
    event: Omit<StreamingEventMessage, 'instanceId'>
  ): Promise<void> {
    if (!this.publisher) return;
    const msg: StreamingEventMessage = { ...event, instanceId: this.instanceId };
    await this.publisher.publish(CHANNELS.TASK_STREAMING, JSON.stringify(msg));
  }

  /**
   * Request task cancellation
   */
  async requestTaskCancel(
    taskId: string,
    machineId: string,
    reason?: string
  ): Promise<void> {
    const event: TaskCancelEvent = {
      instanceId: this.instanceId,
      taskId,
      machineId,
      reason,
    };
    await this.publish(CHANNELS.TASK_CANCEL, event);
  }

  /**
   * Route an approval response cross-instance. Published when the approval
   * POST lands on an instance that doesn't have the machine's WebSocket.
   */
  async routeApprovalResponse(event: Omit<ApprovalResponseEvent, 'instanceId'>): Promise<void> {
    await this.publish(CHANNELS.APPROVAL_RESPONSE, {
      ...event,
      instanceId: this.instanceId,
    });
  }

  /**
   * Route a steer message cross-instance. Published when the steer POST
   * lands on an instance that doesn't have the machine's WebSocket.
   */
  async routeTaskSteer(event: Omit<TaskSteerEvent, 'instanceId'>): Promise<void> {
    await this.publish(CHANNELS.TASK_STEER, {
      ...event,
      instanceId: this.instanceId,
    });
  }

  /**
   * Route a safety decision cross-instance. Published when the safety-decision
   * POST lands on an instance that doesn't have the machine's WebSocket.
   */
  async routeSafetyDecision(event: Omit<SafetyDecisionEvent, 'instanceId'>): Promise<void> {
    await this.publish(CHANNELS.SAFETY_DECISION, {
      ...event,
      instanceId: this.instanceId,
    });
  }

  // =========================================================================
  // WebSocket Proxy (cross-instance filesystem / session requests)
  // =========================================================================

  /**
   * Publish a WebSocket proxy request. Used when a filesystem or session
   * request arrives on an instance that doesn't own the machine's WebSocket.
   * The instance that owns the WebSocket picks it up and forwards it.
   */
  async publishWsProxyRequest(event: Omit<WsProxyRequestEvent, 'instanceId'>): Promise<void> {
    if (!this.publisher) return;
    const msg: WsProxyRequestEvent = { ...event, instanceId: this.instanceId };
    await this.publisher.publish(CHANNELS.WS_PROXY_REQUEST, JSON.stringify(msg));
  }

  /**
   * Publish a WebSocket proxy response. Sent by the instance that owns
   * the machine's WebSocket after receiving the agent-runner's response.
   */
  async publishWsProxyResponse(event: WsProxyResponseEvent): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.publish(CHANNELS.WS_PROXY_RESPONSE, JSON.stringify(event));
  }

  // =========================================================================
  // Machine Registry Synchronization
  // =========================================================================

  /**
   * Register a machine in the shared registry
   */
  async registerMachine(
    machineId: string,
    entry: MachineRegistryEntry
  ): Promise<void> {
    if (!this.publisher) return;

    // Store machine info
    await this.publisher.hset(
      KEYS.MACHINE_REGISTRY,
      machineId,
      JSON.stringify(entry)
    );

    // Map machine to this instance
    await this.publisher.set(
      `${KEYS.MACHINE_INSTANCE}${machineId}`,
      this.instanceId,
      'EX',
      300 // 5 minute TTL, refreshed by heartbeat
    );
  }

  /**
   * Unregister a machine from the shared registry
   */
  async unregisterMachine(machineId: string): Promise<void> {
    if (!this.publisher) return;

    await this.publisher.hdel(KEYS.MACHINE_REGISTRY, machineId);
    await this.publisher.del(`${KEYS.MACHINE_INSTANCE}${machineId}`);
  }

  /**
   * Update machine info in the shared registry
   */
  async updateMachine(
    machineId: string,
    entry: MachineRegistryEntry
  ): Promise<void> {
    if (!this.publisher) return;

    await this.publisher.hset(
      KEYS.MACHINE_REGISTRY,
      machineId,
      JSON.stringify(entry)
    );

    // Refresh instance mapping TTL
    await this.publisher.expire(
      `${KEYS.MACHINE_INSTANCE}${machineId}`,
      300
    );
  }

  /**
   * Get the instance hosting a machine
   */
  async getMachineInstance(machineId: string): Promise<string | null> {
    if (!this.publisher) return null;

    return this.publisher.get(`${KEYS.MACHINE_INSTANCE}${machineId}`);
  }

  /**
   * Refresh MACHINE_INSTANCE TTL for locally-connected machines.
   * Must be called periodically (e.g., every 30s from the instance heartbeat)
   * to prevent the 5-minute TTL from expiring on long-running connections.
   */
  async refreshMachineInstanceTTLs(machineIds: string[]): Promise<void> {
    if (!this.publisher || machineIds.length === 0) return;

    const pipeline = this.publisher.pipeline();
    for (const machineId of machineIds) {
      pipeline.expire(`${KEYS.MACHINE_INSTANCE}${machineId}`, 300);
    }
    await pipeline.exec();
  }

  /**
   * Get all machines from the shared registry
   */
  async getAllMachines(): Promise<MachineRegistryEntry[]> {
    if (!this.publisher) return [];

    const data = await this.publisher.hgetall(KEYS.MACHINE_REGISTRY);
    return Object.values(data).map((json) => JSON.parse(json));
  }

  // =========================================================================
  // Task Tracking
  // =========================================================================

  /**
   * Map a task to a machine
   */
  async mapTaskToMachine(taskId: string, machineId: string): Promise<void> {
    if (!this.publisher) return;

    await this.publisher.set(
      `${KEYS.TASK_MACHINE}${taskId}`,
      machineId,
      'EX',
      86400 // 24 hour TTL
    );
  }

  /**
   * Get the machine running a task
   */
  async getTaskMachine(taskId: string): Promise<string | null> {
    if (!this.publisher) return null;

    return this.publisher.get(`${KEYS.TASK_MACHINE}${taskId}`);
  }

  /**
   * Remove task mapping
   */
  async removeTaskMapping(taskId: string): Promise<void> {
    if (!this.publisher) return;

    await this.publisher.del(`${KEYS.TASK_MACHINE}${taskId}`);
  }

  // =========================================================================
  // Execution Context (cross-instance user isolation)
  // =========================================================================

  /**
   * Register execution context in Redis for cross-instance userId lookups.
   * Write-through: callers also maintain the local in-memory store for
   * zero-latency lookups on the originating instance.
   */
  async registerExecutionContext(ctx: RedisExecutionContext): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.set(
      `${KEYS.EXEC_CONTEXT}${ctx.executionId}`,
      JSON.stringify(ctx),
      'EX',
      14400 // 4 hour TTL matching local store
    );
  }

  /**
   * Look up execution context from Redis. Used when the local in-memory
   * store doesn't have the entry (cross-instance scenario).
   */
  async getExecutionContext(executionId: string): Promise<RedisExecutionContext | null> {
    if (!this.publisher) return null;
    const json = await this.publisher.get(`${KEYS.EXEC_CONTEXT}${executionId}`);
    if (!json) return null;
    try {
      return JSON.parse(json) as RedisExecutionContext;
    } catch {
      return null;
    }
  }

  /**
   * Remove execution context from Redis.
   */
  async removeExecutionContext(executionId: string): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.del(`${KEYS.EXEC_CONTEXT}${executionId}`);
  }

  // =========================================================================
  // Execution Cost Tracking (cross-instance atomic accumulation)
  // =========================================================================

  /**
   * Atomically increment execution cost across all instances.
   * Uses INCRBYFLOAT so concurrent increments from different instances
   * never lose updates. Returns the new cumulative cost.
   */
  async incrementExecutionCost(executionId: string, costUsd: number): Promise<number | null> {
    if (!this.publisher) return null;
    const key = `${KEYS.EXECUTION_COST}${executionId}`;
    const result = await this.publisher.incrbyfloat(key, costUsd);
    const numResult = parseFloat(String(result));
    // Always refresh TTL (4h matching execution context). EXPIRE is idempotent
    // and avoids edge cases with floating-point equality detection on first write.
    await this.publisher.expire(key, 14400);
    return numResult;
  }

  /**
   * Get the cross-instance cumulative cost for an execution.
   */
  async getExecutionCost(executionId: string): Promise<number> {
    if (!this.publisher) return 0;
    const val = await this.publisher.get(`${KEYS.EXECUTION_COST}${executionId}`);
    return val ? parseFloat(val) : 0;
  }

  /**
   * Remove execution cost tracking (cleanup on completion).
   */
  async removeExecutionCost(executionId: string): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.del(`${KEYS.EXECUTION_COST}${executionId}`);
  }

  // =========================================================================
  // Leader Election (singleton timer coordination)
  // =========================================================================

  /**
   * Try to acquire leadership for a named operation. Uses Redis SETNX
   * (SET ... NX) so exactly one instance wins. The key auto-expires
   * after `ttlSeconds` — if the leader dies, another instance takes over.
   *
   * Returns true if this instance is now the leader.
   */
  async tryAcquireLeader(operationName: string, ttlSeconds: number): Promise<boolean> {
    if (!this.publisher) return true; // single-instance: always leader
    const key = `${KEYS.LEADER}${operationName}`;
    const result = await this.publisher.set(key, this.instanceId, 'NX', 'EX', ttlSeconds);
    return result === 'OK';
  }

  /**
   * Renew leadership for a named operation. Only succeeds if this
   * instance currently holds the lock (compare-and-refresh).
   *
   * Note: GET + EXPIRE is not atomic — there's a tiny TOCTOU window
   * where the key could expire and be re-acquired between the two calls.
   * Acceptable here because (a) TTLs are generous (2× interval), (b) all
   * guarded operations are idempotent, and (c) worst case is a harmless
   * extra TTL refresh on the new leader's lock.
   *
   * Returns true if leadership was renewed.
   */
  async renewLeadership(operationName: string, ttlSeconds: number): Promise<boolean> {
    if (!this.publisher) return true; // single-instance: always leader
    const key = `${KEYS.LEADER}${operationName}`;
    // Atomic compare-and-refresh via Lua: only extend TTL if this instance still owns the key.
    // GET+EXPIRE as two calls has a TOCTOU window where the key could expire and be re-acquired
    // between the two commands, causing both instances to believe they hold the lock.
    const result = await this.publisher.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end`,
      1, key, this.instanceId, String(ttlSeconds),
    ) as number;
    return result === 1;
  }

  /**
   * Release leadership for a named operation. Only deletes if this
   * instance holds the lock (prevents releasing another instance's lock).
   *
   * Note: GET + DEL is not atomic — in theory another instance could
   * acquire the lock between the two calls. Acceptable because this is
   * only called during graceful shutdown, and the window is microseconds.
   */
  async releaseLeadership(operationName: string): Promise<void> {
    if (!this.publisher) return;
    const key = `${KEYS.LEADER}${operationName}`;
    const current = await this.publisher.get(key);
    if (current === this.instanceId) {
      await this.publisher.del(key);
    }
  }

  // =========================================================================
  // Dispatch State: Safety Decisions & Task Directories (cross-instance)
  // =========================================================================

  /**
   * Store a task's working directory for cross-instance safety decision lookup.
   */
  async setTaskDir(taskId: string, workingDirectory: string): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.set(
      `${KEYS.TASK_DIR}${taskId}`,
      workingDirectory,
      'EX',
      14400 // 4h
    );
  }

  /**
   * Get a task's working directory from Redis.
   */
  async getTaskDir(taskId: string): Promise<string | null> {
    if (!this.publisher) return null;
    return this.publisher.get(`${KEYS.TASK_DIR}${taskId}`);
  }

  /**
   * Remove a task's working directory from Redis.
   */
  async removeTaskDir(taskId: string): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.del(`${KEYS.TASK_DIR}${taskId}`);
  }

  /**
   * Store an approved safety decision for a working directory.
   */
  async setApprovedSafetyDir(workingDirectory: string, decision: string): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.set(
      `${KEYS.SAFETY_DIR}${workingDirectory}`,
      decision,
      'EX',
      86400 // 24h
    );
  }

  /**
   * Check if a working directory has an approved safety decision.
   */
  async getApprovedSafetyDir(workingDirectory: string): Promise<string | null> {
    if (!this.publisher) return null;
    return this.publisher.get(`${KEYS.SAFETY_DIR}${workingDirectory}`);
  }

  /**
   * Track that an approval request notification has been sent (dedup across instances).
   * Returns true if this is the first instance to mark it (= should send notification).
   */
  async markApprovalNotified(requestId: string): Promise<boolean> {
    if (!this.publisher) return true; // single-instance: always first
    const key = `${KEYS.NOTIFIED_APPROVAL}${requestId}`;
    const result = await this.publisher.set(key, '1', 'NX', 'EX', 300); // 5min TTL
    return result === 'OK';
  }

  // =========================================================================
  // Pending Approval Tracking (cross-instance watchdog awareness)
  // =========================================================================

  /**
   * Mark an execution as having a pending approval. Used by the watchdog
   * to avoid resetting tasks that are waiting for user input on another instance.
   */
  async setPendingApproval(executionId: string): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.set(
      `${KEYS.PENDING_APPROVAL}${executionId}`,
      '1',
      'EX',
      14400 // 4h — matches execution context TTL
    );
  }

  /**
   * Check if an execution has a pending approval on any instance.
   * Returns true if a pending approval exists.
   */
  async hasPendingApproval(executionId: string): Promise<boolean> {
    if (!this.publisher) return false; // single-instance: use local check
    const val = await this.publisher.get(`${KEYS.PENDING_APPROVAL}${executionId}`);
    return val !== null;
  }

  /**
   * Remove the pending approval marker for an execution.
   */
  async removePendingApproval(executionId: string): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.del(`${KEYS.PENDING_APPROVAL}${executionId}`);
  }

  // =========================================================================
  // Session Approval Grants (cross-instance)
  // =========================================================================
  //
  // When a user taps "Session" on a Telegram approval, we grant auto-approval
  // for that subroutine for the remainder of the session. Grants are stored
  // as a Redis SET per (dispatcherUserId, sessionKey) with a sliding TTL so
  // any Fly instance handling a subsequent approval sees the same grant.
  //
  // In single-instance dev without Redis, all methods return
  // no-op / false — callers should keep an in-process fallback.

  private sessionGrantKey(dispatcherUserId: string, sessionKey: string): string {
    return `${KEYS.SESSION_APPROVAL_GRANT}${dispatcherUserId}:${sessionKey}`;
  }

  /**
   * Record that `subroutineName` is auto-approved for this dispatcher's
   * current session. Refreshes the TTL on every call so active sessions
   * stay granted as long as they keep using the subroutine.
   */
  async addSessionApprovalGrant(
    dispatcherUserId: string,
    sessionKey: string,
    subroutineName: string,
    ttlSeconds = 14400, // 4h — matches EXEC_CONTEXT TTL
  ): Promise<void> {
    if (!this.publisher) return;
    const key = this.sessionGrantKey(dispatcherUserId, sessionKey);
    const pipeline = this.publisher.pipeline();
    pipeline.sadd(key, subroutineName);
    pipeline.expire(key, ttlSeconds);
    await pipeline.exec();
  }

  /**
   * Check whether a subroutine is auto-approved for this dispatcher's
   * current session. Refreshes the TTL on every hit (sliding window) so
   * active sessions don't expire mid-use.
   */
  async hasSessionApprovalGrant(
    dispatcherUserId: string,
    sessionKey: string,
    subroutineName: string,
    ttlSeconds = 14400,
  ): Promise<boolean> {
    if (!this.publisher) return false;
    const key = this.sessionGrantKey(dispatcherUserId, sessionKey);
    const hit = await this.publisher.sismember(key, subroutineName);
    if (hit === 1) {
      // Sliding TTL: extend on every read so continuously-active sessions
      // keep the grant alive until they go idle for ttlSeconds.
      await this.publisher.expire(key, ttlSeconds);
      return true;
    }
    return false;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Publish a message to a channel
   */
  private async publish(channel: string, data: unknown): Promise<void> {
    if (!this.publisher) {
      // If not connected to Redis, emit locally
      this.handleLocalMessage(channel, data);
      return;
    }

    await this.publisher.publish(channel, JSON.stringify(data));
  }

  /**
   * Handle incoming pub/sub message
   */
  private handleMessage(channel: string, message: string): void {
    try {
      const data = JSON.parse(message);
      this.handleLocalMessage(channel, data);
    } catch (err) {
      console.error('[redis] Error parsing message:', err);
    }
  }

  /**
   * Handle message (both local and from Redis)
   */
  private handleLocalMessage(channel: string, data: unknown): void {
    switch (channel) {
      case CHANNELS.MACHINE_STATE:
        this.emit('machine:state', data as MachineStateChangeEvent);
        break;

      case CHANNELS.TASK_STATE:
        this.emit('task:state', data as TaskStateChangeEvent);
        break;

      case CHANNELS.TASK_DISPATCH:
        this.emit('task:dispatch', data as TaskDispatchEvent);
        break;

      case CHANNELS.TASK_CANCEL:
        this.emit('task:cancel', data as TaskCancelEvent);
        break;

      case CHANNELS.TASK_STREAMING:
        this.emit('task:streaming', data as StreamingEventMessage);
        break;

      case CHANNELS.APPROVAL_RESPONSE:
        this.emit('approval:response', data as ApprovalResponseEvent);
        break;

      case CHANNELS.TASK_STEER:
        this.emit('task:steer', data as TaskSteerEvent);
        break;

      case CHANNELS.SAFETY_DECISION:
        this.emit('safety:decision', data as SafetyDecisionEvent);
        break;

      case CHANNELS.WS_PROXY_REQUEST:
        this.emit('ws:proxy:request', data as WsProxyRequestEvent);
        break;

      case CHANNELS.WS_PROXY_RESPONSE:
        this.emit('ws:proxy:response', data as WsProxyResponseEvent);
        break;
    }
  }

  /**
   * Register this instance
   */
  private async registerInstance(): Promise<void> {
    if (!this.publisher) return;

    await this.publisher.set(
      `${KEYS.INSTANCE_ID}${this.instanceId}`,
      JSON.stringify({
        instanceId: this.instanceId,
        startedAt: new Date().toISOString(),
        pid: process.pid,
        hostname: process.env.HOSTNAME || 'unknown',
      }),
      'EX',
      60 // 1 minute TTL, refreshed by heartbeat
    );

    // Set up instance heartbeat (cleared on disconnect)
    this.heartbeatInterval = setInterval(async () => {
      try {
        if (this.publisher) {
          await this.publisher.expire(
            `${KEYS.INSTANCE_ID}${this.instanceId}`,
            60
          );
        }
      } catch (err) {
        console.error('[redis] Heartbeat refresh failed:', err);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Unregister this instance
   */
  private async unregisterInstance(): Promise<void> {
    if (!this.publisher) return;

    await this.publisher.del(`${KEYS.INSTANCE_ID}${this.instanceId}`);
  }
}

// Singleton instance
export const redisPubSub = new RedisPubSub();
