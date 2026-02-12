/**
 * Registered Machines Store
 *
 * Stores information about machines registered through the device auth flow.
 * Uses Supabase as primary storage when configured, falls back to local SQLite.
 */

import type { RegisteredMachine } from '../types/device-auth.js'
import type { ProviderType, EnvironmentType } from '../types/relay.js'
import crypto from 'crypto'
import { isSupabaseConfigured, getServiceClient } from './supabase.js'
import { db } from './db/index.js'
import { registeredMachines } from './db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

/**
 * Generate a unique machine ID
 */
export function generateMachineId(hostname: string): string {
  const uuid = crypto.randomUUID().slice(0, 8)
  const sanitizedHostname = hostname.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 20)
  return `${sanitizedHostname}-${uuid}`
}

// Helper: map a SQLite row to RegisteredMachine
function mapRowToMachine(row: typeof registeredMachines.$inferSelect): RegisteredMachine {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    platform: row.platform,
    environmentType: row.environmentType as EnvironmentType,
    providers: (row.providers ?? []) as ProviderType[],
    userId: row.userId,
    workspaceId: row.workspaceId ?? undefined,
    registeredAt: row.registeredAt,
    lastSeenAt: row.lastSeenAt,
    isConnected: row.isConnected,
    refreshTokenHash: row.refreshTokenHash,
    isRevoked: row.isRevoked,
    metadata: (row.metadata ?? undefined) as Record<string, string> | undefined,
  }
}

// Helper: map a Supabase row to RegisteredMachine
function mapSupabaseToMachine(row: Record<string, unknown>): RegisteredMachine {
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
    db.insert(registeredMachines).values({
      id: machine.id,
      userId: machine.userId,
      name: machine.name,
      hostname: machine.hostname,
      platform: machine.platform,
      environmentType: machine.environmentType,
      providers: machine.providers as string[],
      workspaceId: machine.workspaceId,
      refreshTokenHash: machine.refreshTokenHash,
      metadata: machine.metadata,
      isConnected: false,
      isRevoked: false,
      registeredAt: now,
      lastSeenAt: now,
    }).run()
  }

  return machine
}

/**
 * Ensure a machine exists in the persistent store.
 * If found, marks it connected and updates lastSeenAt.
 * If not found, creates a new entry with the given machineId.
 */
export async function ensureMachineRegistered(machineId: string, params: {
  name: string
  hostname: string
  platform: string
  environmentType: EnvironmentType
  providers: ProviderType[]
  userId: string
}): Promise<void> {
  const existing = await getMachine(machineId)

  if (existing) {
    // Machine exists — update connection status + environmentType/providers
    if (isSupabaseConfigured()) {
      const supabase = getServiceClient()
      await supabase
        .from('registered_machines')
        .update({
          is_connected: true,
          last_seen_at: new Date().toISOString(),
          environment_type: params.environmentType,
          providers: params.providers,
        })
        .eq('id', machineId)
    } else {
      const now = new Date()
      db.update(registeredMachines)
        .set({
          isConnected: true,
          lastSeenAt: now,
          environmentType: params.environmentType,
          providers: params.providers as string[],
        })
        .where(eq(registeredMachines.id, machineId))
        .run()
    }
    return
  }

  // Machine not found — create a new entry
  const now = new Date()
  const machine: RegisteredMachine = {
    id: machineId,
    name: params.name,
    hostname: params.hostname,
    platform: params.platform,
    environmentType: params.environmentType,
    providers: params.providers,
    userId: params.userId,
    registeredAt: now,
    lastSeenAt: now,
    isConnected: true,
    refreshTokenHash: '',
    isRevoked: false,
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
      is_connected: true,
      refresh_token_hash: '',
    })
  } else {
    db.insert(registeredMachines).values({
      id: machineId,
      userId: params.userId,
      name: params.name,
      hostname: params.hostname,
      platform: params.platform,
      environmentType: params.environmentType,
      providers: params.providers as string[],
      refreshTokenHash: '',
      isConnected: true,
      isRevoked: false,
      registeredAt: now,
      lastSeenAt: now,
    }).run()
  }

  console.log(`[machines-store] Auto-registered machine ${machineId} on reconnect`)
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
    return mapSupabaseToMachine(data)
  }

  const row = db.select().from(registeredMachines)
    .where(eq(registeredMachines.id, machineId))
    .get()

  if (!row) return null
  return mapRowToMachine(row)
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

    return (data || []).map(mapSupabaseToMachine)
  }

  const rows = db.select().from(registeredMachines)
    .where(and(
      eq(registeredMachines.userId, userId),
      eq(registeredMachines.isRevoked, false),
    ))
    .orderBy(desc(registeredMachines.registeredAt))
    .all()

  return rows.map(mapRowToMachine)
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

  const result = db.update(registeredMachines)
    .set({ lastSeenAt: new Date() })
    .where(eq(registeredMachines.id, machineId))
    .run()
  return result.changes > 0
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

  const updates: Partial<typeof registeredMachines.$inferInsert> = { isConnected }
  if (isConnected) updates.lastSeenAt = new Date()

  const result = db.update(registeredMachines)
    .set(updates)
    .where(eq(registeredMachines.id, machineId))
    .run()
  return result.changes > 0
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

  const result = db.update(registeredMachines)
    .set({ providers: providers as string[] })
    .where(eq(registeredMachines.id, machineId))
    .run()
  return result.changes > 0
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

  const result = db.update(registeredMachines)
    .set({ name })
    .where(eq(registeredMachines.id, machineId))
    .run()
  return result.changes > 0
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

  const result = db.update(registeredMachines)
    .set({ isRevoked: true, isConnected: false })
    .where(eq(registeredMachines.id, machineId))
    .run()
  return result.changes > 0
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

  const result = db.delete(registeredMachines)
    .where(eq(registeredMachines.id, machineId))
    .run()
  return result.changes > 0
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
    return (data || []).map(mapSupabaseToMachine)
  }

  const rows = db.select().from(registeredMachines)
    .orderBy(desc(registeredMachines.registeredAt))
    .all()
  return rows.map(mapRowToMachine)
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

  const rows = db.select().from(registeredMachines)
    .where(and(
      eq(registeredMachines.isConnected, true),
      eq(registeredMachines.isRevoked, false),
    ))
    .all()
  return rows.length
}
