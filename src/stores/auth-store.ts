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

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: true,
  initialized: false,

  initialize: async () => {
    console.log('[auth-store] Initializing...')
    // If Supabase is not in use (not configured or IndexedDB-only mode), skip auth
    if (!shouldUseSupabase()) {
      console.log('[auth-store] IndexedDB-only mode, generating browser user ID')
      // Track browser-specific user ID for IndexedDB operations
      const browserUserId = await getBrowserUserId()
      setCurrentUser(browserUserId)
      console.log('[auth-store] Using browser user ID:', browserUserId)
      set({
        session: null,
        user: null,
        loading: false,
        initialized: true,
      })
      return
    }

    const supabase = getSupabase()
    if (!supabase) {
      console.log('[auth-store] Supabase client not available')
      set({ loading: false, initialized: true })
      return
    }

    // Get initial session
    const { data: { session } } = await supabase.auth.getSession()
    console.log('[auth-store] Initial session:', session ? `User ${session.user.id}` : 'None')

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
      console.log('[auth-store] Setting up realtime sync for authenticated user')
      setupRealtimeSync()
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('[auth-store] Auth state changed:', event, session ? `User ${session.user.id}` : 'None')

      // Track current user for IndexedDB operations (warns on user switch)
      setCurrentUser(session?.user?.id ?? null)

      set({
        session,
        user: session?.user ?? null,
      })

      // Setup/teardown realtime sync based on auth state
      if (session) {
        console.log('[auth-store] Setting up realtime sync after auth state change')
        setupRealtimeSync()
      } else {
        console.log('[auth-store] Tearing down realtime sync after sign out')
        teardownRealtimeSync()
      }
    })
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
