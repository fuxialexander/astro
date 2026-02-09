import { create } from "zustand"
import type { Session, User } from "@supabase/supabase-js"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase-client"

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
    // If Supabase is not configured, skip auth (dev mode)
    if (!isSupabaseConfigured()) {
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
      set({ loading: false, initialized: true })
      return
    }

    // Get initial session
    const { data: { session } } = await supabase.auth.getSession()
    set({
      session,
      user: session?.user ?? null,
      loading: false,
      initialized: true,
    })

    // Listen for auth changes
    supabase.auth.onAuthStateChange((_event, session) => {
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
    set({ session: null, user: null })
  },
}))
