import type { webcrypto } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { userProfiles } from './db/schema.js'

type JsonWebKey = webcrypto.JsonWebKey

const DISPATCH_PUBLIC_KEYS_SETTING = 'dispatchPublicKeys'
const LEGACY_DISPATCH_PUBLIC_KEY_SETTING = 'dispatchPublicKey'

function getKeyFingerprint(key: JsonWebKey): string {
  return `${key.kty ?? ''}:${key.crv ?? ''}:${key.x ?? ''}:${key.y ?? ''}`
}

export function dedupeDispatchPublicKeys(keys: JsonWebKey[]): JsonWebKey[] {
  const seen = new Set<string>()
  const deduped: JsonWebKey[] = []

  for (const key of keys) {
    const fingerprint = getKeyFingerprint(key)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    deduped.push(key)
  }

  return deduped
}

function parseJsonWebKey(value: unknown): JsonWebKey | null {
  if (!value || typeof value !== 'object') return null
  return value as JsonWebKey
}

function parseStoredDispatchPublicKeys(
  settings: Record<string, string> | null | undefined,
): JsonWebKey[] {
  const parsed: JsonWebKey[] = []

  const arrayValue = settings?.[DISPATCH_PUBLIC_KEYS_SETTING]
  if (typeof arrayValue === 'string' && arrayValue.trim()) {
    try {
      const value = JSON.parse(arrayValue) as unknown
      if (Array.isArray(value)) {
        for (const item of value) {
          const key = parseJsonWebKey(item)
          if (key) parsed.push(key)
        }
      }
    } catch {
      // Ignore malformed settings and fall back to legacy key if present.
    }
  }

  const legacyValue = settings?.[LEGACY_DISPATCH_PUBLIC_KEY_SETTING]
  if (typeof legacyValue === 'string' && legacyValue.trim()) {
    try {
      const key = parseJsonWebKey(JSON.parse(legacyValue))
      if (key) parsed.push(key)
    } catch {
      // Ignore malformed legacy settings.
    }
  }

  return dedupeDispatchPublicKeys(parsed)
}

export async function getUserDispatchPublicKeys(userId: string): Promise<JsonWebKey[]> {
  const [profile] = await db.select({ settings: userProfiles.settings })
    .from(userProfiles)
    .where(eq(userProfiles.id, userId))
    .limit(1)

  return parseStoredDispatchPublicKeys(profile?.settings as Record<string, string> | null | undefined)
}

export async function storeUserDispatchPublicKey(
  userId: string,
  key: JsonWebKey,
): Promise<void> {
  const [profile] = await db.select({ settings: userProfiles.settings })
    .from(userProfiles)
    .where(eq(userProfiles.id, userId))
    .limit(1)

  if (!profile) {
    console.warn(`[dispatch-keys] User profile not found for ${userId}; skipping public key persistence`)
    return
  }

  const currentSettings = (profile.settings as Record<string, string> | null | undefined) ?? {}
  const mergedKeys = dedupeDispatchPublicKeys([
    ...parseStoredDispatchPublicKeys(currentSettings),
    key,
  ])
  const nextSettings: Record<string, string> = {
    ...currentSettings,
    [DISPATCH_PUBLIC_KEYS_SETTING]: JSON.stringify(mergedKeys),
    [LEGACY_DISPATCH_PUBLIC_KEY_SETTING]: JSON.stringify(key),
  }

  await db.update(userProfiles)
    .set({
      settings: nextSettings,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.id, userId))
}
