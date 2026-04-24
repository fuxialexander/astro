/**
 * HIPAA Auth Event Bus
 *
 * Replaces Supabase's `onAuthStateChange` for HIPAA deployments. Login and
 * logout call dispatch* functions; the auth store subscribes to the bus and
 * updates its Zustand state in response.
 *
 * The JWT lives in localStorage (key: HIPAA_TOKEN_STORAGE_KEY) — HIPAA
 * deployments enforce HTTPS via the ALB so the persistence is safe.
 *
 * No realtime cross-device sync is part of HIPAA Phase 2 — see Phase 6
 * realtime-sync notes for context.
 */
import { isHipaaMode } from './app-mode'

export const HIPAA_TOKEN_STORAGE_KEY = 'astro.hipaa.jwt'
export const HIPAA_USER_STORAGE_KEY = 'astro.hipaa.user'

export interface HipaaUser {
  id: string
  email: string
  name?: string
}

export interface HipaaSession {
  token: string
  expiresAt: number      // epoch seconds
  user: HipaaUser
}

export type HipaaAuthEvent =
  | { type: 'SIGNED_IN'; session: HipaaSession }
  | { type: 'SIGNED_OUT' }

type Listener = (event: HipaaAuthEvent) => void

const listeners = new Set<Listener>()

// ── Persistence ───────────────────────────────────────────────────────
export function loadStoredHipaaSession(): HipaaSession | null {
  if (typeof window === 'undefined') return null
  try {
    const token = window.localStorage.getItem(HIPAA_TOKEN_STORAGE_KEY)
    const userJson = window.localStorage.getItem(HIPAA_USER_STORAGE_KEY)
    if (!token || !userJson) return null
    const user = JSON.parse(userJson) as HipaaUser & { expiresAt?: number }
    const expiresAt = user.expiresAt ?? 0
    // Drop expired tokens — Phase 2 has no refresh.
    if (expiresAt && expiresAt * 1000 < Date.now()) {
      clearStoredHipaaSession()
      return null
    }
    return { token, expiresAt, user: { id: user.id, email: user.email, name: user.name } }
  } catch {
    return null
  }
}

export function persistHipaaSession(session: HipaaSession): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(HIPAA_TOKEN_STORAGE_KEY, session.token)
  window.localStorage.setItem(
    HIPAA_USER_STORAGE_KEY,
    JSON.stringify({ ...session.user, expiresAt: session.expiresAt }),
  )
}

export function clearStoredHipaaSession(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(HIPAA_TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(HIPAA_USER_STORAGE_KEY)
}

// ── Bus ────────────────────────────────────────────────────────────────
export function subscribeHipaaAuth(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: HipaaAuthEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      console.error('[hipaa-auth-bus] listener error:', err)
    }
  }
}

export function dispatchHipaaSignIn(session: HipaaSession): void {
  if (!isHipaaMode()) {
    console.warn('[hipaa-auth-bus] dispatchHipaaSignIn called outside HIPAA mode — ignored')
    return
  }
  persistHipaaSession(session)
  emit({ type: 'SIGNED_IN', session })
}

export function dispatchHipaaSignOut(): void {
  clearStoredHipaaSession()
  emit({ type: 'SIGNED_OUT' })
}

// ── Token getter ──────────────────────────────────────────────────────
/** Synchronous read — auth-headers wrappers can call this without awaiting. */
export function getHipaaAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(HIPAA_TOKEN_STORAGE_KEY)
}
