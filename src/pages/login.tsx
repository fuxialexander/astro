import { useState, useCallback, useEffect } from "react"
import { useNavigate, useLocation, useSearchParams } from "react-router"
import { startRegistration, startAuthentication, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser"
import { apiUrl } from "@/lib/api-url"
import { getSupabase } from "@/lib/supabase-client"
import { isLocalMode } from "@/lib/app-mode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Fingerprint, Loader2, AlertCircle, Code2, ArrowRight } from "lucide-react"

type AuthStep = "email" | "name" | "authenticating" | "registering"

// Map technical errors to user-friendly messages
function getFriendlyErrorMessage(message: string): string {
  if (message.includes("Failed to get login options") || message.includes("Failed to check user") || message.includes("Failed to get registration options")) {
    return "Connection error. Please check your internet and try again."
  }
  if (message.includes("Authentication failed") || message.includes("Verification failed") || message.includes("Registration failed")) {
    return "Authentication failed. Please try again."
  }
  if (message.includes("platform") || message.includes("authenticator")) {
    return "This device doesn't support passkeys. Please use a device with Face ID, Touch ID, or Windows Hello."
  }
  if (message.includes("Authentication service not configured")) {
    return message // Keep specific config errors
  }
  return "Something went wrong. Please try again."
}

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // Support both ?redirect=/device and location.state.from for redirect
  const redirectParam = searchParams.get('redirect')
  const stateFrom = (location.state as { from?: { pathname: string } })?.from?.pathname
  const from = redirectParam || stateFrom || "/"

  const devMode = isLocalMode()

  const [step, setStep] = useState<AuthStep>("email")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState<boolean | null>(null)

  // Authenticate existing user (called from handleEmailSubmit)
  // NOTE: Does NOT manage loading state - caller manages it
  const authenticateUser = useCallback(async () => {
    const optionsRes = await fetch(apiUrl("/api/auth/webauthn/login-options"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })

    if (!optionsRes.ok) {
      throw new Error("Failed to get login options")
    }

    const { options, challengeKey } = await optionsRes.json()

    const credential = await startAuthentication({
      optionsJSON: options,
      useBrowserAutofill: false, // Disable autofill which might show QR codes
    })

    const verifyRes = await fetch(apiUrl("/api/auth/webauthn/login-verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential, challengeKey }),
    })

    if (!verifyRes.ok) {
      throw new Error("Authentication failed")
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
  }, [email, from, navigate])

  // Check if user exists and proceed with appropriate flow
  const handleEmailSubmit = useCallback(async () => {
    if (!email) return

    setLoading(true)
    setError("")

    try {
      // Check if user exists
      const checkRes = await fetch(apiUrl("/api/auth/webauthn/check-user"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      if (!checkRes.ok) {
        throw new Error("Failed to check user")
      }

      const { exists } = await checkRes.json()

      if (exists) {
        // Existing user - proceed with authentication
        setStep("authenticating")
        await authenticateUser()
        // Success - authenticateUser navigates away
      } else {
        // New user - show name field
        setStep("name")
        setLoading(false)
      }
    } catch (err) {
      if (err instanceof Error) {
        // Handle WebAuthn-specific errors
        if (err.name === "AbortError") {
          setError("Authentication cancelled")
        } else if (err.name === "NotAllowedError") {
          setError("Face ID/Touch ID was cancelled or not recognized. Please try again.")
        } else {
          setError(getFriendlyErrorMessage(err.message))
        }
      }
      setStep("email")
      setLoading(false)
    }
  }, [email, authenticateUser])

  // Register new user
  const handleRegister = useCallback(async () => {
    if (!name) {
      setError("Name is required")
      return
    }

    setLoading(true)
    setError("")
    setStep("registering")

    try {
      const optionsRes = await fetch(apiUrl("/api/auth/webauthn/register-options"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      })

      if (!optionsRes.ok) {
        if (optionsRes.status === 503) {
          throw new Error("Authentication service not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.")
        }
        throw new Error("Failed to get registration options")
      }

      const { options } = await optionsRes.json()

      const credential = await startRegistration({
        optionsJSON: options,
        useAutoRegister: false, // Disable auto-register which might trigger QR codes
      })

      const verifyRes = await fetch(apiUrl("/api/auth/webauthn/register-verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, credential }),
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
    } catch (err) {
      if (err instanceof Error) {
        // Handle WebAuthn-specific errors
        if (err.name === "AbortError") {
          setError("Registration cancelled")
        } else if (err.name === "NotAllowedError") {
          setError("Face ID/Touch ID was cancelled or not recognized. Please try again.")
        } else {
          setError(getFriendlyErrorMessage(err.message))
        }
      }
      setStep("name")
      setLoading(false)
    }
  }, [email, name, from, navigate])

  // Handle Enter key on email field
  const handleEmailKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleEmailSubmit()
    }
  }, [handleEmailSubmit])

  // Handle Enter key on name field
  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRegister()
    }
  }, [handleRegister])

  // Check if platform authenticator is available (Face ID/Touch ID/Windows Hello)
  useEffect(() => {
    if (isLocalMode()) return

    async function checkPlatformAuth() {
      if (!browserSupportsWebAuthn()) {
        setPlatformAuthAvailable(false)
        setError("Your browser doesn't support passkeys. Please use a modern browser like Chrome, Safari, or Edge.")
        return
      }

      const available = await platformAuthenticatorIsAvailable()
      setPlatformAuthAvailable(available)

      if (!available) {
        setError("No Face ID, Touch ID, or Windows Hello detected on this device. Please use a device with biometric authentication.")
      }
    }

    checkPlatformAuth()
  }, [])

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
          <h1 className="text-2xl font-semibold tracking-tight">Astro</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === "email" && "Enter your email to continue"}
            {step === "name" && "Welcome! Let's create your account"}
            {step === "authenticating" && "Authenticating..."}
            {step === "registering" && "Creating your account..."}
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

        {/* Email Step */}
        {step === "email" && (
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleEmailKeyDown}
                disabled={loading}
                autoComplete="email webauthn"
                autoFocus
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Press Enter to continue
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleEmailSubmit}
              disabled={loading || !email || platformAuthAvailable === false}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Continue
            </Button>

            {platformAuthAvailable === false && (
              <p className="text-xs text-muted-foreground text-center">
                Passkey authentication requires Face ID, Touch ID, or Windows Hello
              </p>
            )}
          </div>
        )}

        {/* Name Step (for new users) */}
        {step === "name" && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-3 text-sm">
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{email}</p>
            </div>

            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                type="text"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleNameKeyDown}
                disabled={loading}
                required
                autoComplete="name"
                autoFocus
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Press Enter to create account with passkey
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleRegister}
              disabled={loading || !name || platformAuthAvailable === false}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="mr-2 h-4 w-4" />
              )}
              Create Account
            </Button>

            {platformAuthAvailable === false && (
              <p className="text-xs text-destructive text-center">
                This device doesn't support passkey creation
              </p>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setStep("email")
                setName("")
              }}
              disabled={loading}
            >
              Use a different email
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              You'll use Face ID, Touch ID, or Windows Hello
            </p>
          </div>
        )}

        {/* Authenticating/Registering State */}
        {(step === "authenticating" || step === "registering") && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Fingerprint className="h-8 w-8 text-primary animate-pulse" />
            </div>
            <p className="text-sm text-muted-foreground">
              {step === "authenticating"
                ? "Follow the prompt on your device to sign in"
                : "Follow the prompt on your device to create your account"}
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
