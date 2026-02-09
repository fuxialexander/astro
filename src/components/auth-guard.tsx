import { useEffect } from "react"
import { Navigate, useLocation } from "react-router"
import { useAuthStore } from "@/stores/auth-store"
import { isSupabaseConfigured } from "@/lib/supabase-client"

interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * Wraps routes that require authentication.
 * In dev mode (Supabase not configured), passes through.
 * In production, redirects to /login if no session.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { session, loading, initialized, initialize } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (!initialized) {
      initialize()
    }
  }, [initialized, initialize])

  // Skip auth check if Supabase is not configured (dev mode)
  if (!isSupabaseConfigured()) {
    return <>{children}</>
  }

  if (!initialized || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span className="text-sm">Checking authentication...</span>
        </div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
