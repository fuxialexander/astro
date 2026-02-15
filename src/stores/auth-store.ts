import { create } from "zustand"
import type { Session, User } from "@supabase/supabase-js"
import { getSupabase, shouldUseSupabase } from "@/lib/supabase-client"
import { setCurrentUser } from "@/lib/db"

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
      console.log('[auth-store] IndexedDB-only mode, using dev mode')
      // Track dev user for IndexedDB operations
      setCurrentUser('dev')
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

    // Listen for auth changes
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('[auth-store] Auth state changed:', event, session ? `User ${session.user.id}` : 'None')

      // Track current user for IndexedDB operations (warns on user switch)
      setCurrentUser(session?.user?.id ?? null)

      set({
        session,
        user: session?.user ?? null,
      })
    })
  },

  signOut: async () => {
    const supabase = getSupabase()
    if (supabase) {
      await supabase.auth.signOut()
    }

    // Clear user tracking
    setCurrentUser(null)

    set({ session: null, user: null })
  },
}))
