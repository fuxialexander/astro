import { create } from "zustand"
import type { Session, User } from "@supabase/supabase-js"
import { getSupabase, shouldUseSupabase } from "@/lib/supabase-client"
import { setCurrentUser, getBrowserUserId } from "@/lib/db"
import { setupRealtimeSync, teardownRealtimeSync } from "@/lib/realtime-sync"

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

    // If Supabase is not in use (not configured or IndexedDB-only mode), skip auth
    if (!shouldUseSupabase()) {
      const browserUserId = await getBrowserUserId()
      setCurrentUser(browserUserId)
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

    // Get initial session
    const { data: { session } } = await supabase.auth.getSession()

    // Track current user for IndexedDB operations (warns on user switch)
    setCurrentUser(session?.user?.id ?? null)

    set({
      session,
      user: session?.user ?? null,
      loading: false,
      initialized: true,
    })

    // Setup realtime sync if authenticated
    if (session) {
      setupRealtimeSync()
    }

    // Listen for auth changes (single listener, cleaned up on re-initialize)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Track current user for IndexedDB operations (warns on user switch)
      setCurrentUser(session?.user?.id ?? null)

      set({
        session,
        user: session?.user ?? null,
      })

      // Setup/teardown realtime sync based on auth state
      if (session) {
        setupRealtimeSync()
      } else {
        teardownRealtimeSync()
      }
    })
    authSubscription = subscription
    initializeInProgress = false
  },

  signOut: async () => {
    const supabase = getSupabase()
    if (supabase) {
      await supabase.auth.signOut()
    }

    // Clear user tracking
    setCurrentUser(null)

    // Teardown realtime sync
    await teardownRealtimeSync()

    set({ session: null, user: null })
  },
}))
