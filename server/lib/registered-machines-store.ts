/**
 * Registered Machines Store
 *
 * Stores information about machines registered through the device auth flow.
 * Uses Drizzle ORM for all queries — works against both PGlite (local) and Postgres (server).
 */

import type { RegisteredMachine } from '../types/device-auth.js'
import type { ProviderType, EnvironmentType } from '../types/relay.js'
import crypto from 'crypto'
import { db } from './db/index.js'
import { registeredMachines, machineUsageLogs, teamMembers, teams } from './db/schema.js'
import { eq, and, desc, or, sql } from 'drizzle-orm'

/**
 * Generate a unique machine ID
 */
export function generateMachineId(hostname: string): string {
  const uuid = crypto.randomUUID().slice(0, 8)
  const sanitizedHostname = hostname.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 20)
  return `${sanitizedHostname}-${uuid}`
}

// Helper: map a Drizzle row to RegisteredMachine
function mapRowToMachine(row: typeof registeredMachines.$inferSelect): RegisteredMachine {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    platform: row.platform,
    environmentType: row.environmentType as EnvironmentType,
    providers: (row.providers ?? []) as ProviderType[],
    providerConfigs: (row.providerConfigs ?? []) as import('../types/device-auth.js').ProviderConfig[],
    userId: row.userId,
    teamId: row.teamId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    registeredAt: row.registeredAt,
    lastSeenAt: row.lastSeenAt,
    isConnected: row.isConnected,
    refreshTokenHash: row.refreshTokenHash,
    isRevoked: row.isRevoked,
    metadata: (row.metadata ?? undefined) as Record<string, string> | undefined,
  }
}

/**
 * Register a new machine
 *
 * Checks if a machine with the same hostname+platform+user already exists.
 * If it does, updates and returns the existing machine instead of creating a duplicate.
 */
export async function registerMachine(params: {
  id?: string
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
  const now = new Date()

  // Check for existing machine: first by client-provided ID, then by hostname+platform+user
  let existingMachine: RegisteredMachine | undefined
  let ownershipTransfer = false
  if (params.id) {
    existingMachine = (await getMachine(params.id)) ?? undefined
    // If machine exists under a different user, transfer ownership.
    // The hardware-based ID proves physical access to the machine.
    if (existingMachine && existingMachine.userId !== params.userId) {
      console.log(`[machines-store] Transferring machine ${params.id} ownership from ${existingMachine.userId} to ${params.userId}`)
      ownershipTransfer = true
    }
  }
  if (!existingMachine) {
    const existingMachines = await getUserMachines(params.userId)
    existingMachine = existingMachines.find(
      m => m.hostname === params.hostname &&
           m.platform === params.platform &&
           !m.isRevoked
    )
  }

  if (existingMachine) {
    console.log(`[machines-store] Machine already registered: ${existingMachine.id}, updating...${ownershipTransfer ? ' (ownership transfer)' : ''}`)

    // Preserve user-set custom name: if the existing name differs from its
    // hostname (and from the incoming default name), the user renamed it.
    // On ownership transfer, always use the new name.
    const preserveName = !ownershipTransfer
      && existingMachine.name
      && existingMachine.name !== existingMachine.hostname
      && existingMachine.name !== existingMachine.id
      && existingMachine.name !== params.name
    const updated: RegisteredMachine = {
      ...existingMachine,
      userId: ownershipTransfer ? params.userId : existingMachine.userId,
      name: preserveName ? existingMachine.name : params.name,
      environmentType: params.environmentType,
      providers: params.providers,
      lastSeenAt: now,
      refreshTokenHash: params.refreshTokenHash,
      metadata: params.metadata,
      isRevoked: false, // Un-revoke on re-registration
    }

    const updateFields: Partial<typeof registeredMachines.$inferInsert> = {
      name: updated.name,
      environmentType: updated.environmentType,
      providers: updated.providers as string[],
      lastSeenAt: now,
      refreshTokenHash: updated.refreshTokenHash,
      metadata: updated.metadata,
      isRevoked: false,
    }
    if (ownershipTransfer) {
      updateFields.userId = params.userId
    }

    await db.update(registeredMachines)
      .set(updateFields)
      .where(eq(registeredMachines.id, existingMachine.id))

    return updated
  }

  // No existing machine found, create a new one
  // Use client-provided hardware-based ID if available, otherwise generate one
  const id = params.id || generateMachineId(params.hostname)

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

  console.log(`[machines-store] Inserting machine:`)
  console.log(`[machines-store]   - ID: ${machine.id}`)
  console.log(`[machines-store]   - Name: ${machine.name}`)
  console.log(`[machines-store]   - Hostname: ${machine.hostname}`)
  console.log(`[machines-store]   - User ID: ${machine.userId}`)
  console.log(`[machines-store]   - Environment: ${machine.environmentType}`)

  try {
    await db.insert(registeredMachines).values({
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
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Special handling for foreign key violations (user not found)
    if (message.includes('foreign key') || message.includes('23503')) {
      throw new Error(
        `User not found in database (userId: ${machine.userId}). ` +
        `The authentication token may be stale. Please delete your agent config ` +
        `(~/Library/Preferences/astro-agent-nodejs/config.json) and run device authorization again.`
      )
    }

    throw new Error(`Failed to register machine to database: ${message}`)
  }

  console.log(`[machines-store] Registered machine ${machine.id} for user ${machine.userId}`)
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
    const now = new Date()
    await db.update(registeredMachines)
      .set({
        isConnected: true,
        lastSeenAt: now,
        environmentType: params.environmentType,
        providers: params.providers as string[],
      })
      .where(eq(registeredMachines.id, machineId))
    return
  }

  // Machine not found — create a new entry
  const now = new Date()

  try {
    await db.insert(registeredMachines).values({
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
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Special handling for foreign key violations (user not found)
    if (message.includes('foreign key') || message.includes('23503')) {
      throw new Error(
        `User not found in database (userId: ${params.userId}). ` +
        `The authentication token may be stale. Please delete your agent config ` +
        `(~/Library/Preferences/astro-agent-nodejs/config.json) and run device authorization again.`
      )
    }

    throw new Error(`Failed to register machine to database: ${message}`)
  }

  console.log(`[machines-store] Auto-registered machine ${machineId} on reconnect`)
}

/**
 * Get a registered machine by ID
 */
export async function getMachine(machineId: string): Promise<RegisteredMachine | null> {
  const [row] = await db.select().from(registeredMachines)
    .where(eq(registeredMachines.id, machineId))
    .limit(1)

  if (!row) return null
  return mapRowToMachine(row)
}

/**
 * Get all machines for a user
 */
export async function getUserMachines(userId: string): Promise<RegisteredMachine[]> {
  const rows = await db.select().from(registeredMachines)
    .where(and(
      eq(registeredMachines.userId, userId),
      eq(registeredMachines.isRevoked, false),
    ))
    .orderBy(desc(registeredMachines.registeredAt))

  return rows.map(mapRowToMachine)
}

/**
 * Update machine's last seen timestamp
 */
export async function updateMachineLastSeen(machineId: string): Promise<boolean> {
  const result = await db.update(registeredMachines)
    .set({ lastSeenAt: new Date() })
    .where(eq(registeredMachines.id, machineId))
    .returning({ id: registeredMachines.id })
  return result.length > 0
}

/**
 * Reset all machines to disconnected on server startup.
 * Prevents stale `is_connected = true` from a previous server session.
 */
export async function resetAllConnectionStatuses(): Promise<void> {
  await db.update(registeredMachines)
    .set({ isConnected: false })
    .where(eq(registeredMachines.isConnected, true))
}

/**
 * Update machine connection status
 */
export async function updateMachineConnectionStatus(machineId: string, isConnected: boolean): Promise<boolean> {
  const updates: Partial<typeof registeredMachines.$inferInsert> = { isConnected }
  if (isConnected) updates.lastSeenAt = new Date()

  const result = await db.update(registeredMachines)
    .set(updates)
    .where(eq(registeredMachines.id, machineId))
    .returning({ id: registeredMachines.id })
  return result.length > 0
}

/**
 * Update machine providers
 */
export async function updateMachineProviders(machineId: string, providers: ProviderType[]): Promise<boolean> {
  const result = await db.update(registeredMachines)
    .set({ providers: providers as string[] })
    .where(eq(registeredMachines.id, machineId))
    .returning({ id: registeredMachines.id })
  return result.length > 0
}

/**
 * Update machine name
 */
export async function updateMachineName(machineId: string, name: string): Promise<boolean> {
  const result = await db.update(registeredMachines)
    .set({ name })
    .where(eq(registeredMachines.id, machineId))
    .returning({ id: registeredMachines.id })
  return result.length > 0
}

/**
 * Update machine provider configurations
 */
export async function updateMachineProviderConfigs(
  machineId: string,
  providerConfigs: Array<{
    provider: string
    apiKey?: string
    defaultModel?: string
    enabled: boolean
    settings?: Record<string, unknown>
  }>
): Promise<boolean> {
  const result = await db.update(registeredMachines)
    .set({ providerConfigs: providerConfigs as never[] })
    .where(eq(registeredMachines.id, machineId))
    .returning({ id: registeredMachines.id })
  return result.length > 0
}

/**
 * Revoke a machine
 */
export async function revokeMachine(machineId: string): Promise<boolean> {
  const result = await db.update(registeredMachines)
    .set({ isRevoked: true, isConnected: false })
    .where(eq(registeredMachines.id, machineId))
    .returning({ id: registeredMachines.id })
  return result.length > 0
}

/**
 * Delete a machine
 */
export async function deleteMachine(machineId: string): Promise<boolean> {
  const result = await db.delete(registeredMachines)
    .where(eq(registeredMachines.id, machineId))
    .returning({ id: registeredMachines.id })
  return result.length > 0
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
  const rows = await db.select().from(registeredMachines)
    .orderBy(desc(registeredMachines.registeredAt))
  return rows.map(mapRowToMachine)
}

/**
 * Get connected machines count
 */
export async function getConnectedMachinesCount(): Promise<number> {
  const rows = await db.select({ id: registeredMachines.id }).from(registeredMachines)
    .where(and(
      eq(registeredMachines.isConnected, true),
      eq(registeredMachines.isRevoked, false),
    ))
  return rows.length
}

/**
 * Share a machine with a team (owner only)
 */
export async function shareMachineWithTeam(machineId: string, teamId: string | null): Promise<boolean> {
  const result = await db.update(registeredMachines)
    .set({ teamId: teamId ?? undefined })
    .where(eq(registeredMachines.id, machineId))
    .returning({ id: registeredMachines.id })
  return result.length > 0
}

/**
 * Get all machines available to a user (owned + team shared)
 *
 * Returns machines the user owns plus machines shared with any team the user belongs to.
 */
export async function getAvailableMachines(userId: string): Promise<import('../types/device-auth.js').MachineWithTeamInfo[]> {
  // Get user's team IDs
  const memberships = await db.select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
  const teamIds = memberships.map(m => m.teamId)

  // Query: user's own machines OR machines shared with user's teams
  const conditions = [
    and(eq(registeredMachines.userId, userId), eq(registeredMachines.isRevoked, false)),
  ]
  if (teamIds.length > 0) {
    conditions.push(
      and(
        sql`${registeredMachines.teamId} IN (${sql.join(teamIds.map(id => sql`${id}`), sql`, `)})`,
        eq(registeredMachines.isRevoked, false),
      )
    )
  }

  const rows = await db.select().from(registeredMachines)
    .where(or(...conditions))
    .orderBy(desc(registeredMachines.registeredAt))

  // Build a teamId → teamName lookup
  const teamNameMap = new Map<string, string>()
  if (teamIds.length > 0) {
    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams)
      .where(sql`${teams.id} IN (${sql.join(teamIds.map(id => sql`${id}`), sql`, `)})`)
    for (const t of teamRows) {
      teamNameMap.set(t.id, t.name)
    }
  }

  return rows.map(row => {
    const machine = mapRowToMachine(row)
    const isTeamMachine = machine.userId !== userId && !!machine.teamId
    return {
      ...machine,
      isTeamMachine,
      teamName: machine.teamId ? teamNameMap.get(machine.teamId) : undefined,
    }
  })
}

/**
 * Get team machines for a specific team
 */
export async function getTeamMachines(teamId: string): Promise<RegisteredMachine[]> {
  const rows = await db.select().from(registeredMachines)
    .where(and(
      eq(registeredMachines.teamId, teamId),
      eq(registeredMachines.isRevoked, false),
    ))
    .orderBy(desc(registeredMachines.registeredAt))

  return rows.map(mapRowToMachine)
}

// ============================================================================
// Machine Usage Logging
// ============================================================================

/**
 * Log the start of a machine usage
 */
export async function logMachineUsageStart(params: {
  machineId: string
  userId: string
  projectId: string
  nodeId: string
  executionId: string
}): Promise<string | null> {
  const now = new Date()

  try {
    const [result] = await db.insert(machineUsageLogs)
      .values({
        machineId: params.machineId,
        userId: params.userId,
        projectId: params.projectId,
        nodeId: params.nodeId,
        executionId: params.executionId,
        startedAt: now,
        status: 'success',
      })
      .returning({ id: machineUsageLogs.id })

    return result?.id ?? null
  } catch (err) {
    console.error('[machines-store] Failed to log machine usage start:', err)
    return null
  }
}

/**
 * Log the completion of a machine usage
 */
export async function logMachineUsageComplete(params: {
  logId: string
  status: 'success' | 'failure' | 'cancelled'
  durationMs?: number
}): Promise<boolean> {
  const now = new Date()

  try {
    const result = await db.update(machineUsageLogs)
      .set({
        completedAt: now,
        durationMs: params.durationMs,
        status: params.status,
      })
      .where(eq(machineUsageLogs.id, params.logId))
      .returning({ id: machineUsageLogs.id })

    return result.length > 0
  } catch (err) {
    console.error('[machines-store] Failed to log machine usage completion:', err)
    return false
  }
}

/**
 * Get machine usage logs for a machine
 */
export async function getMachineUsageLogs(machineId: string, limit = 50): Promise<import('../types/device-auth.js').MachineUsageLog[]> {
  const rows = await db.select().from(machineUsageLogs)
    .where(eq(machineUsageLogs.machineId, machineId))
    .orderBy(desc(machineUsageLogs.startedAt))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    machineId: row.machineId,
    userId: row.userId,
    projectId: row.projectId,
    nodeId: row.nodeId,
    executionId: row.executionId,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    durationMs: row.durationMs ?? undefined,
    status: row.status as 'success' | 'failure' | 'cancelled',
    createdAt: row.createdAt,
  }))
}
