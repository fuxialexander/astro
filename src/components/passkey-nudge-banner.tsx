import { useState, useCallback, useEffect } from "react"
import { useAuthStore } from "@/stores/auth-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { isLocalMode } from "@/lib/app-mode"
import { apiUrl } from "@/lib/api-url"
import { startRegistration, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser"
import { Fingerprint, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * PasskeyNudgeBanner — Non-blocking banner that nudges users without passkeys
 * to add one for faster sign-in. Appears for OAuth and magic-link users.
 *
 * Dismissal is stored in localStorage. The banner does NOT block any features.
 */
export function PasskeyNudgeBanner() {
  const user = useAuthStore((s) => s.user)
  const session = useAuthStore((s) => s.session)
  const profileLoaded = useUserProfileStore((s) => s.loaded)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('passkey-nudge-dismissed') === 'true'
    } catch {
      return false
    }
  })
  const [adding, setAdding] = useState(false)
  const [platformAvailable, setPlatformAvailable] = useState<boolean | null>(null)
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null)

  // Check platform authenticator availability
  useEffect(() => {
    if (isLocalMode() || !user) return

    async function check() {
      if (!browserSupportsWebAuthn()) {
        setPlatformAvailable(false)
        return
      }
      const available = await platformAuthenticatorIsAvailable()
      setPlatformAvailable(available)
    }
    check()
  }, [user])

  // Check if user already has passkeys (via check-user endpoint)
  useEffect(() => {
    if (isLocalMode() || !user?.email || !profileLoaded) return

    async function checkPasskeys() {
      try {
        const res = await fetch(apiUrl('/api/auth/webauthn/check-user'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user!.email }),
        })
        if (res.ok) {
          const data = await res.json()
          setHasPasskey(data.hasCredentials === true)
        }
      } catch {
        // Non-fatal — just don't show banner
        setHasPasskey(null)
      }
    }
    checkPasskeys()
  }, [user, profileLoaded])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    try {
      localStorage.setItem('passkey-nudge-dismissed', 'true')
    } catch { /* ignore */ }
  }, [])

  const handleAddPasskey = useCallback(async () => {
    if (!session?.access_token) return

    setAdding(true)
    try {
      // Step 1: Get registration options
      const optionsRes = await fetch(apiUrl('/api/auth/webauthn/add-passkey'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'options' }),
      })

      if (!optionsRes.ok) throw new Error('Failed to get registration options')

      const { options } = await optionsRes.json()

      // Step 2: WebAuthn ceremony
      const credential = await startRegistration({ optionsJSON: options })

      // Step 3: Verify and store
      const verifyRes = await fetch(apiUrl('/api/auth/webauthn/add-passkey'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'verify', credential }),
      })

      if (!verifyRes.ok) throw new Error('Failed to verify passkey')

      // Success — dismiss banner
      setHasPasskey(true)
      handleDismiss()
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
        // User cancelled — do nothing
      } else {
        console.warn('[passkey-nudge] Failed to add passkey:', err)
      }
    } finally {
      setAdding(false)
    }
  }, [session, handleDismiss])

  // Don't show in local mode, if dismissed, if no user, if profile not loaded,
  // if user already has passkeys, or if platform doesn't support passkeys
  if (
    isLocalMode() ||
    dismissed ||
    !user ||
    !profileLoaded ||
    hasPasskey === true ||
    hasPasskey === null ||
    platformAvailable === false ||
    platformAvailable === null
  ) {
    return null
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-info/20 bg-info/5 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Fingerprint className="h-4 w-4 text-info" />
        <span className="text-muted-foreground">
          Add a passkey for faster sign-in with Face ID or Touch ID.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={handleAddPasskey}
          disabled={adding}
        >
          {adding ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Fingerprint className="mr-1 h-3 w-3" />
          )}
          Add passkey
        </Button>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
