/**
 * /signin — Electron-only signin/signup screen.
 *
 * Replaces the static /landing/ marketing page as the unauthenticated
 * entry point inside the desktop app. WebAuthn (TouchID/Windows Hello)
 * needs a real browser context, so the actual passkey ceremony still
 * happens in the system browser — but we collect email + (optional)
 * name in-app and pre-fill them in the browser URL so the user doesn't
 * type twice and doesn't see a separate "Sign in with browser" wall.
 *
 * After the browser completes the ceremony, it sends tokens back via
 * the existing astro://auth/callback deep-link, which the Electron main
 * process forwards to the renderer's auth-store.
 */

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { Loader2, AlertCircle, ExternalLink, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuthStore } from "@/stores/auth-store"
import { isDesktop } from "@/lib/desktop-detect"
import { desktopBridge } from "@/lib/desktop-bridge"
import { getSupabase } from "@/lib/supabase-client"

const WEB_BASE_URL = "https://astroanywhere.com"

type Mode = "signin" | "signup"
type Phase = "idle" | "waiting-for-browser"

export function SignIn() {
  const navigate = useNavigate()
  const session = useAuthStore((s) => s.session)
  const initialized = useAuthStore((s) => s.initialized)

  const [mode, setMode] = useState<Mode>("signin")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState<string | null>(null)

  // If somehow rendered in a real browser, kick the user back to /login —
  // this screen is wired for Electron's deep-link callback, not browser nav.
  useEffect(() => {
    if (!isDesktop()) {
      navigate("/login", { replace: true })
    }
  }, [navigate])

  // Already signed in (e.g. user reopens the app) — go to dashboard.
  useEffect(() => {
    if (initialized && session) {
      navigate("/dashboard", { replace: true })
    }
  }, [initialized, session, navigate])

  // Listen for the auth:callback IPC fired after the system browser
  // redirects back via astro://auth/callback. The login page handler
  // does the same; we duplicate it here so the callback resolves no
  // matter which view is mounted when the deep-link fires.
  useEffect(() => {
    if (!isDesktop()) return
    const unsub = desktopBridge.auth.onCallback(async ({ accessToken, refreshToken }) => {
      const supabase = getSupabase()
      if (!supabase) return
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (error) {
        setError(`Sign-in failed: ${error.message}`)
        setPhase("idle")
        return
      }
      navigate("/dashboard", { replace: true })
    })
    return unsub
  }, [navigate])

  const handleSubmit = useCallback(() => {
    if (!email.trim()) {
      setError("Email is required")
      return
    }
    if (mode === "signup" && !name.trim()) {
      setError("Name is required")
      return
    }
    setError(null)

    const params = new URLSearchParams({
      from: "electron",
      email: email.trim(),
    })
    if (mode === "signup") {
      params.set("register", "1")
      params.set("name", name.trim())
    }

    setPhase("waiting-for-browser")
    void desktopBridge.editor
      .openExternal(`${WEB_BASE_URL}/login?${params.toString()}`)
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't open browser — please try again",
        )
        setPhase("idle")
      })
  }, [email, name, mode])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit()
    },
    [handleSubmit],
  )

  if (phase === "waiting-for-browser") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <div>
            <h2 className="text-base font-medium">Complete sign-in in your browser</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We opened a tab where {mode === "signup" ? "you can finish creating your account" : "you can use Touch ID / Face ID to sign in"}.
              We'll pick it up automatically.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPhase("idle")}
            className="text-muted-foreground"
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back
          </Button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="space-y-6">
        <div className="text-center">
          <img
            src="/icon-192.png"
            alt="Astro"
            className="mx-auto mb-4 h-12 w-12 rounded-xl"
          />
          <h1 className="text-2xl font-semibold tracking-tight">Astro</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoFocus
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          {mode === "signup" && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
          )}

          <Button onClick={handleSubmit} size="lg" className="w-full">
            <ExternalLink className="mr-2 h-4 w-4" />
            {mode === "signin" ? "Continue with Touch ID" : "Create account"}
          </Button>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              No account yet?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup")
                  setError(null)
                }}
                className="font-medium text-foreground underline underline-offset-2 hover:opacity-80"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin")
                  setError(null)
                }}
                className="font-medium text-foreground underline underline-offset-2 hover:opacity-80"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
