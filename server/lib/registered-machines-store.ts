/**
 * Registered Machines Store
 *
 * Stores information about machines registered through the device auth flow.
 * This is separate from the machine registry which tracks live connections.
 */

import type { RegisteredMachine } from '../types/device-auth';
import type { ProviderType, EnvironmentType } from '../types/relay';
import crypto from 'crypto';

// In-memory store for registered machines
// In production, this should be backed by a database
const registeredMachinesStore = new Map<string, RegisteredMachine>();

// Index: userId -> machineIds for quick lookup
const userMachinesIndex = new Map<string, Set<string>>();

/**
 * Generate a unique machine ID
 */
export function generateMachineId(hostname: string): string {
  const uuid = crypto.randomUUID().slice(0, 8);
  // Sanitize hostname for use in ID
  const sanitizedHostname = hostname.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 20);
  return `${sanitizedHostname}-${uuid}`;
}

/**
 * Register a new machine
 */
export function registerMachine(params: {
  name: string;
  hostname: string;
  platform: string;
  environmentType: EnvironmentType;
  providers: ProviderType[];
  userId: string;
  workspaceId?: string;
  refreshTokenHash: string;
  metadata?: Record<string, string>;
}): RegisteredMachine {
  const id = generateMachineId(params.hostname);
  const now = new Date();

  const machine: RegisteredMachine = {
    id,
    name: params.name,
    hostname: params.hostname,
    platform: params.platform,
    environmentType: params.environmentType,
    providers: params.providers,
    userId: params.userId,
    workspaceId: params.workspaceId,
    registeredAt: now,
    lastSeenAt: now,
    isConnected: false,
    refreshTokenHash: params.refreshTokenHash,
    isRevoked: false,
    metadata: params.metadata,
  };

  registeredMachinesStore.set(id, machine);

  // Update user index
  let userMachines = userMachinesIndex.get(params.userId);
  if (!userMachines) {
    userMachines = new Set();
    userMachinesIndex.set(params.userId, userMachines);
  }
  userMachines.add(id);

  return machine;
}

/**
 * Get a registered machine by ID
 */
export function getMachine(machineId: string): RegisteredMachine | null {
  return registeredMachinesStore.get(machineId) || null;
}

/**
 * Get all machines for a user
 */
export function getUserMachines(userId: string): RegisteredMachine[] {
  const machineIds = userMachinesIndex.get(userId);
  if (!machineIds) {
    return [];
  }

  const machines: RegisteredMachine[] = [];
  for (const id of machineIds) {
    const machine = registeredMachinesStore.get(id);
    if (machine && !machine.isRevoked) {
      machines.push(machine);
    }
  }

  return machines;
}

/**
 * Update machine's last seen timestamp
 */
export function updateMachineLastSeen(machineId: string): boolean {
  const machine = registeredMachinesStore.get(machineId);
  if (!machine) {
    return false;
  }

  machine.lastSeenAt = new Date();
  return true;
}

/**
 * Update machine connection status
 */
export function updateMachineConnectionStatus(machineId: string, isConnected: boolean): boolean {
  const machine = registeredMachinesStore.get(machineId);
  if (!machine) {
    return false;
  }

  machine.isConnected = isConnected;
  if (isConnected) {
    machine.lastSeenAt = new Date();
  }
  return true;
}

/**
 * Update machine providers
 */
export function updateMachineProviders(machineId: string, providers: ProviderType[]): boolean {
  const machine = registeredMachinesStore.get(machineId);
  if (!machine) {
    return false;
  }

  machine.providers = providers;
  return true;
}

/**
 * Update machine name
 */
export function updateMachineName(machineId: string, name: string): boolean {
  const machine = registeredMachinesStore.get(machineId);
  if (!machine) {
    return false;
  }

  machine.name = name;
  return true;
}

/**
 * Revoke a machine (invalidates its tokens)
 */
export function revokeMachine(machineId: string): boolean {
  const machine = registeredMachinesStore.get(machineId);
  if (!machine) {
    return false;
  }

  machine.isRevoked = true;
  machine.isConnected = false;
  return true;
}

/**
 * Delete a machine completely
 */
export function deleteMachine(machineId: string): boolean {
  const machine = registeredMachinesStore.get(machineId);
  if (!machine) {
    return false;
  }

  // Remove from user index
  const userMachines = userMachinesIndex.get(machine.userId);
  if (userMachines) {
    userMachines.delete(machineId);
    if (userMachines.size === 0) {
      userMachinesIndex.delete(machine.userId);
    }
  }

  // Remove from store
  registeredMachinesStore.delete(machineId);
  return true;
}

/**
 * Check if a machine is valid (not revoked)
 */
export function isMachineValid(machineId: string): boolean {
  const machine = registeredMachinesStore.get(machineId);
  return machine !== null && machine !== undefined && !machine.isRevoked;
}

/**
 * Get all registered machines (for admin)
 */
export function getAllMachines(): RegisteredMachine[] {
  return Array.from(registeredMachinesStore.values());
}

/**
 * Get connected machines count
 */
export function getConnectedMachinesCount(): number {
  let count = 0;
  for (const machine of registeredMachinesStore.values()) {
    if (machine.isConnected && !machine.isRevoked) {
      count++;
    }
  }
  return count;
}

/**
 * Get statistics about registered machines
 */
export function getMachineStats(): {
  total: number;
  connected: number;
  revoked: number;
  byEnvironment: Record<EnvironmentType, number>;
  byProvider: Record<ProviderType, number>;
} {
  const stats = {
    total: 0,
    connected: 0,
    revoked: 0,
    byEnvironment: {} as Record<EnvironmentType, number>,
    byProvider: {} as Record<ProviderType, number>,
  };

  for (const machine of registeredMachinesStore.values()) {
    stats.total++;

    if (machine.isRevoked) {
      stats.revoked++;
    } else if (machine.isConnected) {
      stats.connected++;
    }

    // Count by environment
    stats.byEnvironment[machine.environmentType] =
      (stats.byEnvironment[machine.environmentType] || 0) + 1;

    // Count by provider
    for (const provider of machine.providers) {
      stats.byProvider[provider] = (stats.byProvider[provider] || 0) + 1;
    }
  }

  return stats;
}

// Export for testing
export const __testing = {
  registeredMachinesStore,
  userMachinesIndex,
};
