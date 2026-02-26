import { useState, useCallback, useEffect } from "react"
import { useNavigate, useLocation, useSearchParams } from "react-router"
import { startRegistration, startAuthentication, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser"
import { apiUrl } from "@/lib/api-url"
import { getSupabase } from "@/lib/supabase-client"
import { isLocalMode } from "@/lib/app-mode"
import { useAuthStore } from "@/stores/auth-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Fingerprint, Loader2, AlertCircle, Code2, ArrowRight, Mail, Github } from "lucide-react"

type AuthStep = "email" | "name" | "authenticating" | "registering" | "magic_link_sent"

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
  // Surface server-side error messages directly (e.g. "Account already exists")
  if (message.includes("already exists") || message.includes("Please log in") || message.includes("Account created")) {
    return message
  }
  // SecurityError often means RP ID mismatch (WebAuthn domain config wrong)
  if (message.includes("SecurityError") || message.includes("relying party")) {
    return "Passkey configuration error. The server's domain settings don't match this site."
  }
  return "Something went wrong. Please try again."
}

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const session = useAuthStore((s) => s.session)

  // Support both ?redirect=/device and location.state.from for redirect
  const redirectParam = searchParams.get('redirect')
  const stateFrom = (location.state as { from?: { pathname: string } })?.from?.pathname
  const from = redirectParam || stateFrom || "/projects/new/plan"

  const devMode = isLocalMode()

  const [step, setStep] = useState<AuthStep>("email")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [isReturningUser, setIsReturningUser] = useState(false)
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

        // Wait for Supabase session to be fully established before navigating.
        // The auth state change listener in auth-store needs to fire so that
        // DataLoader sees session !== null and loads all stores with the token.
        await new Promise<void>((resolve) => {
          const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
              subscription.unsubscribe()
              resolve()
            }
          })
          // Safety timeout in case the event already fired before we subscribed
          setTimeout(() => {
            subscription.unsubscribe()
            resolve()
          }, 2000)
        })
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

      const { exists, hasCredentials, name: existingName } = await checkRes.json()

      if (exists && hasCredentials) {
        // Existing user with passkeys on this domain - proceed with authentication
        setStep("authenticating")
        await authenticateUser()
        // Success - authenticateUser navigates away
      } else if (exists && !hasCredentials && existingName) {
        // Existing user without passkeys (e.g., credentials were reset, or new device).
        // Name is already on file — pre-fill and show confirmation step.
        setName(existingName)
        setIsReturningUser(true)
        setStep("name")
        setLoading(false)
      } else {
        // New user — show name field to create account.
        setIsReturningUser(false)
        setStep("name")
        setLoading(false)
      }
    } catch (err) {
      if (err instanceof Error) {
        // Handle WebAuthn-specific errors
        if (err.name === "AbortError") {
          setError("Authentication cancelled")
          setStep("email")
        } else if (err.name === "NotAllowedError") {
          // Passkey not found or cancelled — offer alternatives (magic link, new passkey)
          setError("Passkey login failed. Try signing in with an email link, or register a new passkey.")
          setStep("email")
        } else {
          setError(getFriendlyErrorMessage(err.message))
          setStep("email")
        }
      } else {
        setStep("email")
      }
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
      // Clear any stale session before registration to prevent identity conflicts
      const supabase = getSupabase()
      if (supabase) {
        await supabase.auth.signOut()
      }

      const optionsRes = await fetch(apiUrl("/api/auth/webauthn/register-options"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      })

      if (!optionsRes.ok) {
        if (optionsRes.status === 503) {
          throw new Error("Authentication service not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.")
        }
        const data = await optionsRes.json().catch(() => ({}))
        throw new Error(data.error || "Failed to get registration options")
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
        const data = await verifyRes.json().catch(() => ({}))
        if (verifyRes.status === 409 && data.existingUser) {
          // Account already exists — switch to login flow
          setError("An account with this email already exists. Signing you in instead...")
          setStep("authenticating")
          try {
            await authenticateUser()
            return
          } catch {
            setError("Account exists but login failed. Try signing in from the email step.")
            setStep("email")
            setLoading(false)
            return
          }
        }
        throw new Error(data.error || "Registration failed")
      }

      const result = await verifyRes.json()

      if (result.session?.properties?.hashed_token) {
        if (supabase) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: result.session.properties.hashed_token,
            type: "magiclink",
          })
          if (error) throw error

          // Wait for Supabase session to be fully established before navigating
          await new Promise<void>((resolve) => {
            const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
              if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                subscription.unsubscribe()
                resolve()
              }
            })
            setTimeout(() => {
              subscription.unsubscribe()
              resolve()
            }, 2000)
          })
        }
      } else {
        // Session generation failed on backend but account was created
        setError("Account created. Please sign in with your passkey or email link.")
        setStep("email")
        setLoading(false)
        return
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
  }, [email, name, from, navigate, authenticateUser])

  // Send magic link email for cross-device login
  const handleMagicLink = useCallback(async () => {
    if (!email) return

    setLoading(true)
    setError("")

    try {
      const supabase = getSupabase()
      if (!supabase) {
        throw new Error("Authentication service not configured")
      }

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}${from}`,
        },
      })

      if (error) throw error

      setStep("magic_link_sent")
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [email, from])

  // Google OAuth login
  const handleGoogleLogin = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    setError("")

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${from}`,
        queryParams: {
          prompt: 'select_account',
        },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success, browser redirects to Google — no need to handle here
  }, [from])

  // GitHub OAuth login
  const handleGitHubLogin = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    setError("")

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}${from}`,
        scopes: 'read:user user:email',
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success, browser redirects to GitHub — no need to handle here
  }, [from])

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

  // If session already exists (e.g. login just completed and component remounted),
  // redirect immediately instead of briefly flashing the login form.
  useEffect(() => {
    if (session && !devMode) {
      navigate(from, { replace: true })
    }
  }, [session, devMode, from, navigate])

  // In dev mode, redirect to app immediately (no auth needed)
  useEffect(() => {
    if (devMode) {
      // Don't auto-redirect — show the dev mode UI so user knows what's happening
    }
  }, [devMode])

  const handleDevModeSkip = useCallback(() => {
    navigate(from, { replace: true })
  }, [from, navigate])

  // Already authenticated — show nothing while the redirect effect fires
  if (session && !devMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" />
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center">
          <img src="/icon-192.png" alt="Astro" className="mx-auto mb-4 h-12 w-12 rounded-xl" />
          <h1 className="text-2xl font-semibold tracking-tight">Astro</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === "email" && "Enter your email to continue"}
            {step === "name" && (isReturningUser ? "Welcome back! Register a new passkey" : "Welcome! Let's create your account")}
            {step === "authenticating" && "Authenticating..."}
            {step === "registering" && "Creating your account..."}
            {step === "magic_link_sent" && "Check your email"}
          </p>
        </div>

        {/* Dev mode banner */}
        {devMode && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 p-3 text-sm text-warning">
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

            {platformAuthAvailable === false && email && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or</span>
                  </div>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  variant="outline"
                  onClick={handleMagicLink}
                  disabled={loading}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Sign in with email link
                </Button>
              </>
            )}

            {platformAuthAvailable !== false && email && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={handleMagicLink}
                disabled={loading}
              >
                <Mail className="mr-2 h-4 w-4" />
                Sign in with email link instead
              </Button>
            )}

            {/* OAuth separator and buttons */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              variant="outline"
              onClick={handleGoogleLogin}
              disabled={loading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </Button>

            <Button
              className="w-full"
              size="lg"
              variant="outline"
              onClick={handleGitHubLogin}
              disabled={loading}
            >
              <Github className="mr-2 h-4 w-4" />
              Continue with GitHub
            </Button>
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
                {isReturningUser ? "Press Enter to register a new passkey" : "Press Enter to create account with passkey"}
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
              {isReturningUser ? "Register Passkey" : "Create Account"}
            </Button>

            {platformAuthAvailable === false && (
              <p className="text-xs text-destructive text-center">
                This device doesn't support passkey creation
              </p>
            )}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setStep("email")
                  setName("")
                }}
                disabled={loading}
              >
                Different email
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={handleMagicLink}
                disabled={loading}
              >
                <Mail className="mr-1.5 h-3.5 w-3.5" />
                Email link instead
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              You'll use Face ID, Touch ID, or Windows Hello
            </p>
          </div>
        )}

        {/* Magic Link Sent */}
        {step === "magic_link_sent" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                We sent a sign-in link to
              </p>
              <p className="text-sm font-medium">{email}</p>
              <p className="text-xs text-muted-foreground">
                Click the link in the email to sign in. You can close this tab.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setStep("email")
                setError("")
              }}
            >
              Use a different email
            </Button>
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
