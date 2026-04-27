import { useEffect } from "react"
import { Navigate, useLocation } from "react-router"
import { useAuthStore } from "@/stores/auth-store"
import { isLocalMode } from "@/lib/app-mode"
import { isDesktop } from "@/lib/desktop-detect"

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

  // Skip auth check if Supabase is not configured or local mode
  if (isLocalMode()) {
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
    // In Electron, /signin is the in-app entry point. /login is the
    // browser-side WebAuthn ceremony, not meant to be loaded inside the
    // desktop window — it would just show "Sign in with browser" again.
    const target = isDesktop() ? "/signin" : "/login"
    return <Navigate to={target} state={{ from: location }} replace />
  }

  return <>{children}</>
}
