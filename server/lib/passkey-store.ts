/**
 * PasskeyStore — mode-aware persistence for WebAuthn credentials.
 *
 * The auth routes used to call Supabase directly to store passkeys and look
 * them up. In HIPAA mode there is no Supabase, so we route through this
 * adapter:
 *
 *   - PGlitePasskeyStore: HIPAA + local. Uses Drizzle against the
 *     passkey_credentials table; the user_id column references user_profiles.
 *   - SupabasePasskeyStore: SaaS prod. Wraps the existing Supabase REST flow
 *     so the auth route can keep its current behavior unchanged.
 *
 * getPasskeyStore() picks the right one based on isHipaaMode() / isLocalMode().
 *
 * NOTE: Public keys are stored as base64 (text), matching the existing column
 * type. Callers pass Buffer.toString('base64') strings; transports are
 * stored as a string array; counter is a numeric / bigint.
 */
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { passkeyCredentials } from './db/schema.js'
import { isHipaaMode, isLocalMode } from './app-mode.js'
import { getServiceClient } from './supabase.js'

export interface PasskeyRow {
  id: string                  // base64url WebAuthn credential id
  userId: string
  publicKey: string           // base64-encoded COSE public key
  counter: number
  transports?: string[] | null
  deviceName?: string | null
  deviceType?: string | null  // 'singleDevice' | 'multiDevice'
  backedUp?: boolean
  name?: string | null
  createdAt?: Date
  updatedAt?: Date
  lastUsedAt?: Date | null
}

export interface InsertPasskeyInput {
  id: string
  userId: string
  publicKey: string
  counter: number
  transports?: string[] | null
  deviceName?: string | null
  deviceType?: string | null
  backedUp?: boolean
  name?: string | null
}

export interface PasskeyStore {
  findByCredentialId(credentialId: string): Promise<PasskeyRow | null>
  listForUser(userId: string): Promise<PasskeyRow[]>
  insert(input: InsertPasskeyInput): Promise<void>
  updateCounter(credentialId: string, counter: number): Promise<void>
  updateLastUsed(credentialId: string, when?: Date): Promise<void>
  delete(credentialId: string): Promise<void>
}

// ── PGlite implementation (HIPAA + local) ────────────────────────────
class PGlitePasskeyStore implements PasskeyStore {
  async findByCredentialId(credentialId: string): Promise<PasskeyRow | null> {
    const rows = await db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.id, credentialId))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return mapDrizzleRow(row)
  }

  async listForUser(userId: string): Promise<PasskeyRow[]> {
    const rows = await db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, userId))
    return rows.map(mapDrizzleRow)
  }

  async insert(input: InsertPasskeyInput): Promise<void> {
    await db.insert(passkeyCredentials).values({
      id: input.id,
      userId: input.userId,
      publicKey: input.publicKey,
      counter: input.counter,
      transports: input.transports ?? null,
      deviceName: input.deviceName ?? null,
      deviceType: input.deviceType ?? null,
      backedUp: input.backedUp ?? false,
      name: input.name ?? null,
    })
  }

  async updateCounter(credentialId: string, counter: number): Promise<void> {
    await db
      .update(passkeyCredentials)
      .set({ counter, updatedAt: new Date(), lastUsedAt: new Date() })
      .where(eq(passkeyCredentials.id, credentialId))
  }

  async updateLastUsed(credentialId: string, when: Date = new Date()): Promise<void> {
    await db
      .update(passkeyCredentials)
      .set({ lastUsedAt: when, updatedAt: new Date() })
      .where(eq(passkeyCredentials.id, credentialId))
  }

  async delete(credentialId: string): Promise<void> {
    await db
      .delete(passkeyCredentials)
      .where(eq(passkeyCredentials.id, credentialId))
  }
}

function mapDrizzleRow(row: typeof passkeyCredentials.$inferSelect): PasskeyRow {
  return {
    id: row.id,
    userId: row.userId,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: row.transports ?? null,
    deviceName: row.deviceName ?? null,
    deviceType: row.deviceType ?? null,
    backedUp: row.backedUp,
    name: row.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt ?? null,
  }
}

// ── Supabase implementation (SaaS) ────────────────────────────────────
// Thin wrapper around the existing supabase.from('passkey_credentials')
// queries. Behavior intentionally mirrors the prior code path so SaaS users
// see no change.
class SupabasePasskeyStore implements PasskeyStore {
  async findByCredentialId(credentialId: string): Promise<PasskeyRow | null> {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('passkey_credentials')
      .select('*')
      .eq('id', credentialId)
      .single()
    if (error) {
      // PGRST116 = not found; bubble other errors
      if ((error as { code?: string }).code === 'PGRST116') return null
      throw error
    }
    if (!data) return null
    return mapSupabaseRow(data)
  }

  async listForUser(userId: string): Promise<PasskeyRow[]> {
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('passkey_credentials')
      .select('*')
      .eq('user_id', userId)
    return (data ?? []).map(mapSupabaseRow)
  }

  async insert(input: InsertPasskeyInput): Promise<void> {
    const supabase = getServiceClient()
    const { error } = await supabase.from('passkey_credentials').insert({
      id: input.id,
      user_id: input.userId,
      public_key: input.publicKey,
      counter: input.counter,
      transports: input.transports ?? null,
      device_name: input.deviceName ?? null,
      device_type: input.deviceType ?? null,
      backed_up: input.backedUp ?? false,
      name: input.name ?? null,
    })
    if (error) throw error
  }

  async updateCounter(credentialId: string, counter: number): Promise<void> {
    const supabase = getServiceClient()
    await supabase
      .from('passkey_credentials')
      .update({ counter, last_used_at: new Date().toISOString() })
      .eq('id', credentialId)
  }

  async updateLastUsed(credentialId: string, when: Date = new Date()): Promise<void> {
    const supabase = getServiceClient()
    await supabase
      .from('passkey_credentials')
      .update({ last_used_at: when.toISOString() })
      .eq('id', credentialId)
  }

  async delete(credentialId: string): Promise<void> {
    const supabase = getServiceClient()
    await supabase.from('passkey_credentials').delete().eq('id', credentialId)
  }
}

function mapSupabaseRow(row: Record<string, unknown>): PasskeyRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    publicKey: row.public_key as string,
    counter: Number(row.counter ?? 0),
    transports: (row.transports as string[] | null) ?? null,
    deviceName: (row.device_name as string | null) ?? null,
    deviceType: (row.device_type as string | null) ?? null,
    backedUp: Boolean(row.backed_up),
    name: (row.name as string | null) ?? null,
    createdAt: row.created_at ? new Date(row.created_at as string) : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at as string) : undefined,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
  }
}

// ── Factory ───────────────────────────────────────────────────────────
let cached: PasskeyStore | null = null

export function getPasskeyStore(): PasskeyStore {
  if (cached) return cached
  // HIPAA + local both use PGlite (no Supabase available).
  if (isHipaaMode() || isLocalMode()) {
    cached = new PGlitePasskeyStore()
  } else {
    cached = new SupabasePasskeyStore()
  }
  return cached
}

/** Test helper — clears the cached singleton so a different mode can be selected. */
export function _resetPasskeyStoreForTests(): void {
  cached = null
}
