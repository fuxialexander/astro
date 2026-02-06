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
} as const;

/** Redis keys for shared state */
const KEYS = {
  MACHINE_REGISTRY: 'relay:machines',
  MACHINE_INSTANCE: 'relay:machine:instance:', // + machineId
  TASK_MACHINE: 'relay:task:machine:', // + taskId
  INSTANCE_ID: 'relay:instance:', // + instanceId
} as const;

/** Message published for task dispatch routing */
interface TaskDispatchEvent {
  instanceId: string;
  task: TaskDispatch;
  targetMachineId?: string;
}

/** Message published for task cancellation */
interface TaskCancelEvent {
  instanceId: string;
  taskId: string;
  machineId: string;
  reason?: string;
}

export interface RedisPubSubEvents {
  'machine:state': (event: MachineStateChangeEvent) => void;
  'task:state': (event: TaskStateChangeEvent) => void;
  'task:dispatch': (event: TaskDispatchEvent) => void;
  'task:cancel': (event: TaskCancelEvent) => void;
  'error': (error: Error) => void;
  'connected': () => void;
  'disconnected': () => void;
}

export class RedisPubSub extends EventEmitter {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private instanceId: string;
  private connected: boolean = false;

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
        CHANNELS.TASK_CANCEL
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
    targetMachineId?: string
  ): Promise<void> {
    const event: TaskDispatchEvent = {
      instanceId: this.instanceId,
      task,
      targetMachineId,
    };
    await this.publish(CHANNELS.TASK_DISPATCH, event);
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

    // Set up instance heartbeat
    setInterval(async () => {
      if (this.publisher) {
        await this.publisher.expire(
          `${KEYS.INSTANCE_ID}${this.instanceId}`,
          60
        );
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
