/**
 * Registered Machines Store
 *
 * Stores information about machines registered through the device auth flow.
 * Uses Supabase as primary storage when configured, falls back to in-memory.
 */

import type { RegisteredMachine } from '../types/device-auth.js'
import type { ProviderType, EnvironmentType } from '../types/relay.js'
import crypto from 'crypto'
import { isSupabaseConfigured, getServiceClient } from './supabase.js'

// In-memory fallback store (used when Supabase is not configured)
const memStore = new Map<string, RegisteredMachine>()
const memUserIndex = new Map<string, Set<string>>()

/**
 * Generate a unique machine ID
 */
export function generateMachineId(hostname: string): string {
  const uuid = crypto.randomUUID().slice(0, 8)
  const sanitizedHostname = hostname.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 20)
  return `${sanitizedHostname}-${uuid}`
}

/**
 * Register a new machine
 */
export async function registerMachine(params: {
  name: string
  hostname: string
  platform: string
  environmentType: EnvironmentType
  providers: ProviderType[]
  userId: string
  workspaceId?: string
  refreshTokenHash: string
  metadata?: Record<string, string>
}): Promise<RegisteredMachine> {
  const id = generateMachineId(params.hostname)
  const now = new Date()

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
  }

  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    await supabase.from('registered_machines').insert({
      id: machine.id,
      user_id: machine.userId,
      name: machine.name,
      hostname: machine.hostname,
      platform: machine.platform,
      environment_type: machine.environmentType,
      providers: machine.providers,
      workspace_id: machine.workspaceId,
      refresh_token_hash: machine.refreshTokenHash,
      metadata: machine.metadata,
    })
  } else {
    memStore.set(id, machine)
    let userMachines = memUserIndex.get(params.userId)
    if (!userMachines) {
      userMachines = new Set()
      memUserIndex.set(params.userId, userMachines)
    }
    userMachines.add(id)
  }

  return machine
}

/**
 * Get a registered machine by ID
 */
export async function getMachine(machineId: string): Promise<RegisteredMachine | null> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('registered_machines')
      .select('*')
      .eq('id', machineId)
      .single()

    if (!data) return null
    return mapDbToMachine(data)
  }

  return memStore.get(machineId) || null
}

/**
 * Get all machines for a user
 */
export async function getUserMachines(userId: string): Promise<RegisteredMachine[]> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('registered_machines')
      .select('*')
      .eq('user_id', userId)
      .eq('is_revoked', false)
      .order('registered_at', { ascending: false })

    return (data || []).map(mapDbToMachine)
  }

  const machineIds = memUserIndex.get(userId)
  if (!machineIds) return []

  const machines: RegisteredMachine[] = []
  for (const id of machineIds) {
    const machine = memStore.get(id)
    if (machine && !machine.isRevoked) machines.push(machine)
  }
  return machines
}

/**
 * Update machine's last seen timestamp
 */
export async function updateMachineLastSeen(machineId: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('registered_machines')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', machineId)
    return !error
  }

  const machine = memStore.get(machineId)
  if (!machine) return false
  machine.lastSeenAt = new Date()
  return true
}

/**
 * Update machine connection status
 */
export async function updateMachineConnectionStatus(machineId: string, isConnected: boolean): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const update: Record<string, unknown> = { is_connected: isConnected }
    if (isConnected) update.last_seen_at = new Date().toISOString()

    const { error } = await supabase
      .from('registered_machines')
      .update(update)
      .eq('id', machineId)
    return !error
  }

  const machine = memStore.get(machineId)
  if (!machine) return false
  machine.isConnected = isConnected
  if (isConnected) machine.lastSeenAt = new Date()
  return true
}

/**
 * Update machine providers
 */
export async function updateMachineProviders(machineId: string, providers: ProviderType[]): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('registered_machines')
      .update({ providers })
      .eq('id', machineId)
    return !error
  }

  const machine = memStore.get(machineId)
  if (!machine) return false
  machine.providers = providers
  return true
}

/**
 * Update machine name
 */
export async function updateMachineName(machineId: string, name: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('registered_machines')
      .update({ name })
      .eq('id', machineId)
    return !error
  }

  const machine = memStore.get(machineId)
  if (!machine) return false
  machine.name = name
  return true
}

/**
 * Revoke a machine
 */
export async function revokeMachine(machineId: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('registered_machines')
      .update({ is_revoked: true, is_connected: false })
      .eq('id', machineId)
    return !error
  }

  const machine = memStore.get(machineId)
  if (!machine) return false
  machine.isRevoked = true
  machine.isConnected = false
  return true
}

/**
 * Delete a machine
 */
export async function deleteMachine(machineId: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('registered_machines')
      .delete()
      .eq('id', machineId)
    return !error
  }

  const machine = memStore.get(machineId)
  if (!machine) return false

  const userMachines = memUserIndex.get(machine.userId)
  if (userMachines) {
    userMachines.delete(machineId)
    if (userMachines.size === 0) memUserIndex.delete(machine.userId)
  }
  memStore.delete(machineId)
  return true
}

/**
 * Check if a machine is valid (not revoked)
 */
export async function isMachineValid(machineId: string): Promise<boolean> {
  const machine = await getMachine(machineId)
  return machine !== null && !machine.isRevoked
}

/**
 * Get all registered machines (for admin)
 */
export async function getAllMachines(): Promise<RegisteredMachine[]> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('registered_machines')
      .select('*')
      .order('registered_at', { ascending: false })
    return (data || []).map(mapDbToMachine)
  }

  return Array.from(memStore.values())
}

/**
 * Get connected machines count
 */
export async function getConnectedMachinesCount(): Promise<number> {
  if (isSupabaseConfigured()) {
    const supabase = getServiceClient()
    const { count } = await supabase
      .from('registered_machines')
      .select('*', { count: 'exact', head: true })
      .eq('is_connected', true)
      .eq('is_revoked', false)
    return count || 0
  }

  let count = 0
  for (const machine of memStore.values()) {
    if (machine.isConnected && !machine.isRevoked) count++
  }
  return count
}

// Helper: map Supabase row to RegisteredMachine
function mapDbToMachine(row: Record<string, unknown>): RegisteredMachine {
  return {
    id: row.id as string,
    name: row.name as string,
    hostname: row.hostname as string,
    platform: row.platform as string,
    environmentType: row.environment_type as EnvironmentType,
    providers: row.providers as ProviderType[],
    userId: row.user_id as string,
    workspaceId: row.workspace_id as string | undefined,
    registeredAt: new Date(row.registered_at as string),
    lastSeenAt: new Date(row.last_seen_at as string),
    isConnected: row.is_connected as boolean,
    refreshTokenHash: row.refresh_token_hash as string,
    isRevoked: row.is_revoked as boolean,
    metadata: row.metadata as Record<string, string> | undefined,
  }
}
