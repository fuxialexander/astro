/**
 * Machine Registry
 *
 * Maintains a live registry of connected machines, their status,
 * resources, and available providers. Supports horizontal scaling
 * via Redis pub/sub.
 */

import type {
  MachineRegistryEntry,
  MachineInfo,
  MachineLoad,
  ProviderInfo,
  EnvironmentType,
  ProviderType,
} from '../types/relay.js';
import type { WebSocket } from 'ws';
import { EventEmitter } from 'events';

/** Connection metadata stored with each machine */
export interface MachineConnection {
  socket: WebSocket;
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
    socket: WebSocket
  ): MachineRegistryEntry {
    // Check if machine already exists
    const existing = this.machines.get(machineId);
    if (existing) {
      // Close old connection and update with new one
      this.disconnect(machineId, 'reconnected');
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
      socket,
      entry,
    };

    this.machines.set(machineId, connection);
    this.sessionToMachine.set(sessionId, machineId);

    this.emit('machine:connected', entry);
    console.log(`[registry] Machine ${machineId} registered (session: ${sessionId})`);

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
      this.disconnect(machineId, 'reconnected');
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
      socket: null as unknown as WebSocket,
      entry,
    };

    this.machines.set(machineId, connection);
    this.sessionToMachine.set(sessionId, machineId);

    this.emit('machine:connected', entry);
    console.log(`[registry] Simulated machine ${machineId} registered (session: ${sessionId})`);

    return entry;
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
   * Get machines by environment type
   */
  getByEnvironment(environment: EnvironmentType): MachineRegistryEntry[] {
    return this.getAll().filter(m => m.environmentType === environment);
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
   * Find best machine for a task based on environment, provider, and load
   */
  findBestMachine(
    environment: EnvironmentType,
    preferredProvider?: ProviderType
  ): MachineRegistryEntry | undefined {
    let candidates = this.getByEnvironment(environment);

    // Filter by provider if specified
    if (preferredProvider) {
      candidates = candidates.filter(m =>
        m.providers.some(p =>
          p.type === preferredProvider &&
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

    // Sort by load (lowest first) and pick the best
    candidates.sort((a, b) => {
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
      byEnvironment: Record<EnvironmentType, number>;
      byProvider: Record<ProviderType, number>;
      totalActiveTasks: number;
    };
  } {
    const machines = this.getAll();
    const byEnvironment: Record<EnvironmentType, number> = {
      local: 0,
      hpc: 0,
      cloud: 0,
    };
    const byProvider: Record<ProviderType, number> = {
      'claude-code': 0,
      slurm: 0,
      aws: 0,
      gcp: 0,
      custom: 0,
    };
    let totalActiveTasks = 0;

    for (const machine of machines) {
      byEnvironment[machine.environmentType]++;
      for (const provider of machine.providers) {
        byProvider[provider.type]++;
        totalActiveTasks += provider.currentTasks;
      }
    }

    return {
      machines,
      summary: {
        total: machines.length,
        byEnvironment,
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
