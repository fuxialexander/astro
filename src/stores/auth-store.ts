import { create } from "zustand"
import type { Session, User } from "@supabase/supabase-js"
import { getSupabase, setCachedSession } from "@/lib/supabase-client"
import { isLocalMode, isHipaaMode } from "@/lib/app-mode"
import { teardownRealtimeSync } from "@/lib/realtime-sync"
import { apiUrl } from "@/lib/api-url"
import {
  subscribeHipaaAuth,
  loadStoredHipaaSession,
  dispatchHipaaSignOut,
  type HipaaSession,
} from "@/lib/hipaa-auth-bus"

/**
 * Build a Supabase-shaped Session from a HIPAA self-signed JWT, so the rest
 * of the app (which expects Session/User from @supabase/supabase-js) keeps
 * working without per-mode branching at every consumer.
 */
function hipaaSessionToSupabaseShape(s: HipaaSession): Session {
  return {
    access_token: s.token,
    refresh_token: '',
    expires_in: Math.max(0, s.expiresAt - Math.floor(Date.now() / 1000)),
    expires_at: s.expiresAt,
    token_type: 'bearer',
    user: {
      id: s.user.id,
      email: s.user.email,
      app_metadata: { provider: 'webauthn-hipaa' },
      user_metadata: { name: s.user.name ?? '' },
      aud: 'authenticated',
      created_at: new Date(0).toISOString(),
    } as unknown as User,
  } as Session
}

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  initialized: boolean

  // Actions
  initialize: () => Promise<void>
  signOut: () => Promise<void>
}

// Track the auth state change subscription so we can clean up on re-initialize
let authSubscription: { unsubscribe: () => void } | null = null
let initializeInProgress = false

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  loading: true,
  initialized: false,

  initialize: async () => {
    // Guard against concurrent/duplicate calls (e.g. StrictMode double-invoke)
    if (initializeInProgress || get().initialized) return
    initializeInProgress = true

    // Clean up any existing listener before registering a new one
    if (authSubscription) {
      authSubscription.unsubscribe()
      authSubscription = null
    }

    // HIPAA mode: hydrate from localStorage and subscribe to the bus.
    if (isHipaaMode()) {
      const stored = loadStoredHipaaSession()
      const session = stored ? hipaaSessionToSupabaseShape(stored) : null
      set({
        session,
        user: session?.user ?? null,
        loading: false,
        initialized: true,
      })
      const unsubscribe = subscribeHipaaAuth((event) => {
        if (event.type === 'SIGNED_IN') {
          const sess = hipaaSessionToSupabaseShape(event.session)
          set({ session: sess, user: sess.user })
        } else {
          set({ session: null, user: null })
          teardownRealtimeSync()
        }
      })
      authSubscription = { unsubscribe }
      initializeInProgress = false
      return
    }

    // If Supabase is not in use (not configured or local mode), skip auth
    if (isLocalMode()) {
      set({
        session: null,
        user: null,
        loading: false,
        initialized: true,
      })
      initializeInProgress = false
      return
    }

    const supabase = getSupabase()
    if (!supabase) {
      set({ loading: false, initialized: true })
      initializeInProgress = false
      return
    }

    // Get initial session and populate the token cache so that
    // subsequent getAccessToken() calls skip the Supabase lock.
    const { data: { session } } = await supabase.auth.getSession()
    setCachedSession(session)

    set({
      session,
      user: session?.user ?? null,
      loading: false,
      initialized: true,
    })

    // Realtime sync is set up by DataLoader (app.tsx) after teams load,
    // so it can pass the active teamId for scoped subscriptions.

    // Listen for auth changes (single listener, cleaned up on re-initialize)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Keep the token cache in sync so getAccessToken() never stales
      setCachedSession(session)

      set({
        session,
        user: session?.user ?? null,
      })

      if (session) {
        // Realtime sync is set up by DataLoader after teams load (with teamId).
        // For OAuth sign-ins, ensure user profile + personal team exist.
        // This is idempotent and safe to call on every sign-in.
        if (event === 'SIGNED_IN' && session.user?.app_metadata?.provider !== 'email') {
          fetch(apiUrl('/api/auth/ensure-profile'), {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
              avatarUrl: session.user.user_metadata?.avatar_url,
            }),
          }).catch((err) => {
            console.warn('[auth] ensure-profile call failed (non-fatal):', err)
          })
        }
      } else {
        teardownRealtimeSync()
      }
    })
    authSubscription = subscription
    initializeInProgress = false
  },

  signOut: async () => {
    if (isHipaaMode()) {
      dispatchHipaaSignOut()
      await teardownRealtimeSync()
      set({ session: null, user: null })
      return
    }
    const supabase = getSupabase()
    if (supabase) {
      await supabase.auth.signOut()
    }

    // Teardown realtime sync
    await teardownRealtimeSync()

    set({ session: null, user: null })
  },
}))
