/**
 * Machine Registry
 *
 * Maintains a live registry of connected machines, their status,
 * resources, and available providers. Supports horizontal scaling
 * via Redis pub/sub.
 *
 * ## Hybrid Architecture — In-Memory WebSocket Map + DB Persistence
 *
 * The in-memory `machines` Map tracks live WebSocket connections, which
 * are inherently per-process — a WebSocket handle cannot be serialized
 * or shared across server instances. This registry is therefore scoped
 * to the connections owned by the current process and is used exclusively
 * for real-time WebSocket message routing (dispatching tasks, sending
 * heartbeats, streaming events to connected agent runners).
 *
 * The authoritative, durable source of truth for registered machines is
 * the `registered_machines` table in the database. DB operations for
 * machine registration, revocation, and listing are handled by
 * `server/lib/registered-machines-store.ts` (and the corresponding
 * `/api/device/*` route handlers). That store persists machine metadata
 * independently of whether a WebSocket connection is currently active.
 *
 * In a multi-instance deployment, each instance maintains its own
 * in-memory registry of the WebSocket connections it owns. Cross-instance
 * task dispatch is coordinated via Redis pub/sub (`redis-pubsub.ts`),
 * which fans out dispatch requests to the instance that holds the
 * target machine's WebSocket connection.
 */

import type {
  MachineRegistryEntry,
  MachineInfo,
  MachineLoad,
  ProviderInfo,
  ProviderType,
} from '../types/relay.js';
import type { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { LOCAL_USER_ID } from './db/bootstrap-local.js';

/** Connection metadata stored with each machine */
export interface MachineConnection {
  socket: WebSocket | null;
  entry: MachineRegistryEntry;
  heartbeatTimer?: ReturnType<typeof setTimeout>;
  lastPingTime?: number;
}

/** Events emitted by the machine registry */
export interface MachineRegistryEvents {
  'machine:connected': (entry: MachineRegistryEntry) => void;
  'machine:disconnected': (machineId: string, reason?: string) => void;
  'machine:updated': (entry: MachineRegistryEntry) => void;
  'machine:heartbeat-timeout': (machineId: string) => void;
}

/**
 * In-memory machine registry with event emission for state changes.
 * Can be extended with Redis pub/sub for multi-instance synchronization.
 */
export class MachineRegistry extends EventEmitter {
  private machines: Map<string, MachineConnection> = new Map();
  private sessionToMachine: Map<string, string> = new Map();

  constructor() {
    super();
  }

  /**
   * Register a new machine connection
   */
  register(
    machineId: string,
    machineInfo: Omit<MachineInfo, 'machineId'>,
    socket: WebSocket,
    userId?: string
  ): MachineRegistryEntry {
    // Check if machine already exists — close old socket without removing from registry
    // (the new entry will replace it immediately below)
    const existing = this.machines.get(machineId);
    if (existing) {
      if (existing.heartbeatTimer) {
        clearTimeout(existing.heartbeatTimer);
      }
      this.sessionToMachine.delete(existing.entry.sessionId);
      if (existing.socket && existing.socket.readyState === 1) {
        // Custom close code 4001 tells the old client NOT to reconnect
        existing.socket.close(4001, 'replaced by new connection');
      }
      console.log(`[registry] Machine ${machineId} replacing existing connection`);
    }

    const sessionId = this.generateSessionId();
    const now = new Date();

    const entry: MachineRegistryEntry = {
      machineId,
      ...machineInfo,
      connectionStatus: 'connected',
      connectedAt: now,
      lastHeartbeat: now,
      sessionId,
      userId,
    };

    const connection: MachineConnection = {
      socket,
      entry,
    };

    this.machines.set(machineId, connection);
    this.sessionToMachine.set(sessionId, machineId);

    this.emit('machine:connected', entry);
    console.log(`[registry] Machine ${machineId} registered (session: ${sessionId}, user: ${userId || 'none'})`);

    return entry;
  }

  /**
   * Register a simulated machine (no real WebSocket connection).
   * Used for testing/demo purposes.
   */
  registerSimulated(
    machineId: string,
    machineInfo: Omit<MachineInfo, 'machineId'>
  ): MachineRegistryEntry {
    const existing = this.machines.get(machineId);
    if (existing) {
      if (existing.heartbeatTimer) {
        clearTimeout(existing.heartbeatTimer);
      }
      this.sessionToMachine.delete(existing.entry.sessionId);
      if (existing.socket && existing.socket.readyState === 1) {
        // Custom close code 4001 tells the old client NOT to reconnect
        existing.socket.close(4001, 'replaced by new connection');
      }
    }

    const sessionId = this.generateSessionId();
    const now = new Date();

    const entry: MachineRegistryEntry = {
      machineId,
      ...machineInfo,
      connectionStatus: 'connected',
      connectedAt: now,
      lastHeartbeat: now,
      sessionId,
    };

    const connection: MachineConnection = {
      socket: null,
      entry,
    };

    this.machines.set(machineId, connection);
    this.sessionToMachine.set(sessionId, machineId);

    this.emit('machine:connected', entry);
    console.log(`[registry] Simulated machine ${machineId} registered (session: ${sessionId})`);

    return entry;
  }

  /**
   * Register a remote machine (connected to another server instance).
   * No WebSocket — task dispatch is routed via Redis pub/sub.
   * Only adds if the machine isn't already locally connected (local wins).
   */
  registerRemote(machineId: string, entry: MachineRegistryEntry): void {
    const existing = this.machines.get(machineId);
    // Don't overwrite a local WebSocket connection — local instance owns it
    if (existing?.socket) return;

    const connection: MachineConnection = {
      socket: null,
      entry: { ...entry, connectionStatus: 'connected', lastHeartbeat: new Date() },
    };
    this.machines.set(machineId, connection);
    if (entry.sessionId) {
      this.sessionToMachine.set(entry.sessionId, machineId);
    }
    console.log(`[registry] Remote machine ${machineId} (${entry.name}) synced from another instance`);
  }

  /**
   * Remove a remote machine (disconnected on another instance).
   * Only removes if the machine isn't locally connected.
   */
  removeRemote(machineId: string): void {
    const existing = this.machines.get(machineId);
    // Don't remove a locally-owned WebSocket connection
    if (existing?.socket) return;
    if (!existing) return;

    this.sessionToMachine.delete(existing.entry.sessionId);
    this.machines.delete(machineId);
    console.log(`[registry] Remote machine ${machineId} removed (disconnected on another instance)`);
  }

  /**
   * Check if a machine is locally connected (has a WebSocket).
   */
  isLocal(machineId: string): boolean {
    const connection = this.machines.get(machineId);
    return !!connection?.socket;
  }

  /**
   * Detach the socket from a machine without removing it from the registry.
   * Used during the disconnect grace period — the machine entry stays so it
   * can be seamlessly replaced when the agent runner reconnects.
   */
  detachSocket(machineId: string): boolean {
    const connection = this.machines.get(machineId);
    if (!connection) return false;

    // Clear heartbeat timer — no socket to ping
    if (connection.heartbeatTimer) {
      clearTimeout(connection.heartbeatTimer);
      connection.heartbeatTimer = undefined;
    }

    // Null out the socket but keep the registry entry
    connection.socket = null;
    connection.entry.connectionStatus = 'reconnecting';

    return true;
  }

  /**
   * Disconnect a machine
   */
  disconnect(machineId: string, reason?: string): boolean {
    const connection = this.machines.get(machineId);
    if (!connection) {
      return false;
    }

    // Clear heartbeat timer
    if (connection.heartbeatTimer) {
      clearTimeout(connection.heartbeatTimer);
    }

    // Clean up session mapping
    this.sessionToMachine.delete(connection.entry.sessionId);

    // Remove from registry
    this.machines.delete(machineId);

    // Close socket if still open
    if (connection.socket && connection.socket.readyState === 1) { // OPEN
      connection.socket.close(1000, reason);
    }

    this.emit('machine:disconnected', machineId, reason);
    console.log(`[registry] Machine ${machineId} disconnected: ${reason || 'unknown'}`);

    return true;
  }

  /**
   * Update machine load/status
   */
  updateLoad(machineId: string, load: MachineLoad): boolean {
    const connection = this.machines.get(machineId);
    if (!connection) {
      return false;
    }

    connection.entry.load = load;
    connection.entry.lastHeartbeat = new Date();

    this.emit('machine:updated', connection.entry);
    return true;
  }

  /**
   * Update provider status on a machine
   */
  updateProvider(machineId: string, provider: ProviderInfo): boolean {
    const connection = this.machines.get(machineId);
    if (!connection) {
      return false;
    }

    const existingIdx = connection.entry.providers.findIndex(
      p => p.type === provider.type
    );

    if (existingIdx >= 0) {
      connection.entry.providers[existingIdx] = provider;
    } else {
      connection.entry.providers.push(provider);
    }

    connection.entry.lastHeartbeat = new Date();
    this.emit('machine:updated', connection.entry);
    return true;
  }

  /**
   * Update the active task IDs reported by the agent runner via heartbeat.
   * Used by dead job detection to cross-reference against server-side tracking.
   */
  updateActiveTaskIds(machineId: string, taskIds: string[]): boolean {
    const connection = this.machines.get(machineId);
    if (!connection) {
      return false;
    }

    connection.entry.activeTaskIds = taskIds;
    return true;
  }

  /**
   * Record heartbeat from machine
   */
  recordHeartbeat(machineId: string): boolean {
    const connection = this.machines.get(machineId);
    if (!connection) {
      return false;
    }

    connection.entry.lastHeartbeat = new Date();
    return true;
  }

  /**
   * Set heartbeat timer for a machine
   */
  setHeartbeatTimer(
    machineId: string,
    timeoutMs: number,
    onTimeout: () => void
  ): void {
    const connection = this.machines.get(machineId);
    if (!connection) return;

    // Clear existing timer
    if (connection.heartbeatTimer) {
      clearTimeout(connection.heartbeatTimer);
    }

    connection.heartbeatTimer = setTimeout(() => {
      this.emit('machine:heartbeat-timeout', machineId);
      onTimeout();
    }, timeoutMs);
  }

  /**
   * Get a machine by ID
   */
  get(machineId: string): MachineRegistryEntry | undefined {
    return this.machines.get(machineId)?.entry;
  }

  /**
   * Get machine connection (including socket)
   */
  getConnection(machineId: string): MachineConnection | undefined {
    return this.machines.get(machineId);
  }

  /**
   * Get machine by session ID
   */
  getBySession(sessionId: string): MachineRegistryEntry | undefined {
    const machineId = this.sessionToMachine.get(sessionId);
    if (!machineId) return undefined;
    return this.machines.get(machineId)?.entry;
  }

  /**
   * Get all connected machines
   */
  getAll(): MachineRegistryEntry[] {
    return Array.from(this.machines.values()).map(c => c.entry);
  }

  /**
   * Get machines owned by a specific user
   */
  getByUser(userId: string): MachineRegistryEntry[] {
    return this.getAll().filter(m => !m.userId || m.userId === userId || m.userId === LOCAL_USER_ID);
  }

  /**
   * Get machines by provider type
   */
  getByProvider(providerType: ProviderType): MachineRegistryEntry[] {
    return this.getAll().filter(m =>
      m.providers.some(p => p.type === providerType && p.status === 'available')
    );
  }

  /**
   * Find best machine for a task based on provider and load.
   */
  findBestMachine(
    preferredProvider?: ProviderType,
    userId?: string,
    teamSharedMachineIds?: Set<string>,
  ): MachineRegistryEntry | undefined {
    let candidates = this.getAll();

    // Filter by user ownership or team sharing when provided
    if (userId) {
      candidates = candidates.filter(m =>
        !m.userId || m.userId === userId || m.userId === LOCAL_USER_ID
        || teamSharedMachineIds?.has(m.machineId)
      );
    }

    const effectiveProvider = preferredProvider;

    // Filter by provider if specified
    if (effectiveProvider) {
      candidates = candidates.filter(m =>
        m.providers.some(p =>
          p.type === effectiveProvider &&
          p.status === 'available' &&
          p.currentTasks < p.maxConcurrentTasks
        )
      );
    }

    // Filter to only connected machines with available capacity
    candidates = candidates.filter(m =>
      m.connectionStatus === 'connected' &&
      m.providers.some(p => p.status === 'available' && p.currentTasks < p.maxConcurrentTasks)
    );

    if (candidates.length === 0) {
      return undefined;
    }

    // Sort by: user-owned first, then by load (lowest first)
    candidates.sort((a, b) => {
      // Strongly prefer user-owned machines over shared/anonymous ones
      if (userId) {
        const aOwned = a.userId === userId ? 1 : 0;
        const bOwned = b.userId === userId ? 1 : 0;
        if (aOwned !== bOwned) return bOwned - aOwned;
      }
      // Combine CPU and task load for scoring
      const scoreA = a.load.cpuPercent + (a.load.activeTasks * 10);
      const scoreB = b.load.cpuPercent + (b.load.activeTasks * 10);
      return scoreA - scoreB;
    });

    return candidates[0];
  }

  /**
   * Get count of connected machines
   */
  get size(): number {
    return this.machines.size;
  }

  /**
   * Check if a machine is connected
   */
  isConnected(machineId: string): boolean {
    const connection = this.machines.get(machineId);
    return connection?.entry.connectionStatus === 'connected';
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Get registry snapshot for external use (e.g., API responses)
   */
  getSnapshot(): {
    machines: MachineRegistryEntry[];
    summary: {
      total: number;
      byProvider: Record<string, number>;
      totalActiveTasks: number;
    };
  } {
    const machines = this.getAll();
    const byProvider: Record<string, number> = {
      'claude-sdk': 0,
      codex: 0,
      openclaw: 0,
      opencode: 0,
      custom: 0,
    };
    let totalActiveTasks = 0;

    for (const machine of machines) {
      for (const provider of machine.providers) {
        byProvider[provider.type]++;
        totalActiveTasks += provider.currentTasks;
      }
    }

    return {
      machines,
      summary: {
        total: machines.length,
        byProvider,
        totalActiveTasks,
      },
    };
  }

  /**
   * Clean up all connections (for shutdown)
   */
  shutdown(): void {
    console.log(`[registry] Shutting down, disconnecting ${this.machines.size} machines`);
    for (const [machineId] of this.machines) {
      this.disconnect(machineId, 'server_shutdown');
    }
  }
}

// Singleton instance
export const machineRegistry = new MachineRegistry();
