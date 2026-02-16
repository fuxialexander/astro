import { useState, useCallback, useEffect } from "react"
import { useNavigate, useLocation, useSearchParams } from "react-router"
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import { getSupabase, shouldUseSupabase } from "@/lib/supabase-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { KeyRound, Fingerprint, ArrowRight, Loader2, AlertCircle, Code2 } from "lucide-react"

type Mode = "auto" | "signin" | "signup"

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // Support both ?redirect=/device and location.state.from for redirect
  const redirectParam = searchParams.get('redirect')
  const stateFrom = (location.state as { from?: { pathname: string } })?.from?.pathname
  const from = redirectParam || stateFrom || "/"

  const devMode = !shouldUseSupabase()

  const [mode, setMode] = useState<Mode>("auto")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Unified passkey handler: try auth first, fall back to registration
  const handlePasskey = useCallback(async () => {
    if (mode === "signup" && !email) {
      setError("Email is required for signup")
      return
    }

    setLoading(true)
    setError("")

    try {
      // Try authentication first (works for both auto and signin modes)
      if (mode !== "signup") {
        try {
          // Note: Providing email helps browser prioritize local Touch ID/Face ID over QR codes
          const optionsRes = await fetch("/api/auth/webauthn/login-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email || undefined }),
          })

          if (optionsRes.ok) {
            const { options, challengeKey } = await optionsRes.json()
            const credential = await startAuthentication({ optionsJSON: options })

            const verifyRes = await fetch("/api/auth/webauthn/login-verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential, challengeKey }),
            })

            if (verifyRes.ok) {
              const result = await verifyRes.json()

              if (result.session?.properties?.hashed_token) {
                const supabase = getSupabase()
                if (supabase) {
                  const { error } = await supabase.auth.verifyOtp({
                    token_hash: result.session.properties.hashed_token,
                    type: "magiclink",
                  })
                  if (error) throw error
                  await new Promise(resolve => setTimeout(resolve, 100))
                }
              }

              navigate(from, { replace: true })
              return // Success!
            }
          }

          // If we're in explicit signin mode and it failed, show error
          if (mode === "signin") {
            throw new Error("No passkey found. Please sign up first.")
          }
        } catch (err) {
          // If auto mode and auth failed, try registration
          if (mode === "auto") {
            if (!email) {
              setError("Email is required to create an account")
              setMode("signup")
              setLoading(false)
              return
            }
            // Fall through to registration below
          } else {
            throw err
          }
        }
      }

      // Registration flow
      if (mode === "auto" || mode === "signup") {
        if (!email) {
          setError("Email is required")
          setLoading(false)
          return
        }

        // Use first part of email as fallback name (e.g., "john.doe@example.com" → "john.doe")
        const displayName = name || email.split('@')[0]

        const optionsRes = await fetch("/api/auth/webauthn/register-options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name: displayName }),
        })

        if (!optionsRes.ok) {
          if (optionsRes.status === 503) {
            throw new Error("Authentication service not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.")
          }
          throw new Error("Failed to get registration options")
        }

        const { options } = await optionsRes.json()
        const credential = await startRegistration({ optionsJSON: options })

        const verifyRes = await fetch("/api/auth/webauthn/register-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name: displayName, credential }),
        })

        if (!verifyRes.ok) {
          const data = await verifyRes.json()
          throw new Error(data.error || "Registration failed")
        }

        const result = await verifyRes.json()

        if (result.session?.properties?.hashed_token) {
          const supabase = getSupabase()
          if (supabase) {
            const { error } = await supabase.auth.verifyOtp({
              token_hash: result.session.properties.hashed_token,
              type: "magiclink",
            })
            if (error) throw error
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }

        navigate(from, { replace: true })
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [email, name, mode, from, navigate])

  // In dev mode, redirect to app immediately (no auth needed)
  useEffect(() => {
    if (devMode) {
      // Don't auto-redirect — show the dev mode UI so user knows what's happening
    }
  }, [devMode])

  const handleDevModeSkip = useCallback(() => {
    navigate(from, { replace: true })
  }, [from, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <span className="text-xl font-bold text-primary-foreground">N</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Nexus</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "auto" ? "Sign in or create an account" : mode === "signin" ? "Sign in to your account" : "Create your account"}
          </p>
        </div>

        {/* Dev mode banner */}
        {devMode && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
              <Code2 className="h-4 w-4 shrink-0" />
              <span>Development mode — Supabase not configured</span>
            </div>
            <Button
              className="w-full"
              size="lg"
              variant="outline"
              onClick={handleDevModeSkip}
            >
              <Code2 className="mr-2 h-4 w-4" />
              Continue without auth (dev mode)
            </Button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or configure Supabase</span>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
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
                disabled={loading}
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder={mode === "auto" ? "Required first time, optional after" : mode === "signin" ? "Optional for passkey sign-in" : "you@example.com"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            {mode === "auto" && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Required for first-time setup, then optional for sign-in with existing passkey
              </p>
            )}
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={handlePasskey}
            disabled={loading || (mode === "signup" && !email)}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : mode === "signup" ? (
              <KeyRound className="mr-2 h-4 w-4" />
            ) : (
              <Fingerprint className="mr-2 h-4 w-4" />
            )}
            {mode === "signup" ? "Create Passkey" : "Continue with Passkey"}
          </Button>
        </div>

        {/* Toggle mode */}
        {mode !== "auto" && (
          <div className="text-center text-sm text-muted-foreground">
            {mode === "signin" ? (
              <>
                Don't have a passkey?{" "}
                <button
                  className="font-medium text-primary hover:underline"
                  onClick={() => {
                    setMode("signup")
                    setError("")
                  }}
                >
                  Sign up <ArrowRight className="inline h-3 w-3" />
                </button>
              </>
            ) : (
              <>
                Already have a passkey?{" "}
                <button
                  className="font-medium text-primary hover:underline"
                  onClick={() => {
                    setMode("signin")
                    setError("")
                  }}
                >
                  Sign in <ArrowRight className="inline h-3 w-3" />
                </button>
              </>
            )}
          </div>
        )}
        {mode === "auto" && (
          <div className="text-center text-sm text-muted-foreground">
            Having trouble?{" "}
            <button
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setMode("signup")
                setError("")
              }}
            >
              Create a new passkey <ArrowRight className="inline h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
