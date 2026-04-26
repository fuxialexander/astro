import { useEffect, useState } from "react"
import { useSearchParams, useNavigate } from "react-router"
import { Monitor, CheckCircle2, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useAuthStore } from "@/stores/auth-store"
import { apiUrl } from "@/lib/api-url"

/**
 * /pair — Browser-side completion of the desktop pair flow.
 *
 * Companion to the new POST /api/device/pair-init + /pair/:token/complete
 * endpoints. Unlike the RFC 8628 device flow at /device, this page is the
 * one place where authorization happens and tokens are minted; the desktop
 * app then receives them directly via an astro://pair/callback?... deep-link.
 * No polling, no slow_down errors, no race between background loops.
 *
 * Flow:
 *   1. Page loads with ?token=<pairToken>
 *   2. If user not signed in → redirect to /login?redirect=/pair?token=...
 *   3. GET /api/device/pair/:token → show machine info ("Authorize this Mac?")
 *   4. User clicks Approve → POST /api/device/pair/:token/complete
 *   5. window.location.href = `astro://pair/callback?access_token=...&...`
 *   6. Show "You can close this tab"
 */

type PairStatus =
  | "loading"
  | "ready"
  | "completing"
  | "success"
  | "error"
  | "expired"
  | "used"
  | "missing-token"

interface PairInfo {
  machineInfo?: {
    hostname?: string
    platform?: string
    providers?: string[]
  }
  status: string
  expiresAt: string
}

interface PairCompleteResponse {
  accessToken: string
  refreshToken: string
  wsToken: string
  machineId: string
  machineName: string
  apiUrl: string
  relayUrl: string
  expiresIn: number
}

function getPlatformLabel(platform?: string) {
  switch (platform) {
    case "darwin":
      return "macOS"
    case "linux":
      return "Linux"
    case "win32":
      return "Windows"
    default:
      return platform || "Unknown"
  }
}

export function Pair() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tokenFromUrl = searchParams.get("token")
  const { user, session, loading: authLoading, initialized } = useAuthStore()

  const [info, setInfo] = useState<PairInfo | null>(null)
  const [status, setStatus] = useState<PairStatus>(
    tokenFromUrl ? "loading" : "missing-token",
  )
  const [error, setError] = useState<string | null>(null)

  const isUnauthenticated = initialized && !authLoading && !user

  // Redirect to login if not signed in, preserving the pair token.
  useEffect(() => {
    if (isUnauthenticated && tokenFromUrl) {
      navigate(
        `/login?redirect=${encodeURIComponent(`/pair?token=${tokenFromUrl}`)}`,
        { replace: true },
      )
    }
  }, [isUnauthenticated, tokenFromUrl, navigate])

  // Fetch pair info on mount.
  useEffect(() => {
    if (!tokenFromUrl) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          apiUrl(`/api/device/pair/${encodeURIComponent(tokenFromUrl)}`),
        )
        if (cancelled) return
        const data = await res.json()
        if (!res.ok) {
          if (data.status === "expired") {
            setStatus("expired")
            setError("This pair token has expired. Reopen the desktop app to try again.")
          } else if (data.status === "used" || data.status === "authorized") {
            setStatus("used")
            setError("This pair token has already been used.")
          } else {
            setStatus("error")
            setError(data.error || "Invalid pair token")
          }
          return
        }
        setInfo(data as PairInfo)
        setStatus("ready")
      } catch (err) {
        if (cancelled) return
        setStatus("error")
        setError(err instanceof Error ? err.message : "Failed to load pair info")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tokenFromUrl])

  async function handleApprove() {
    if (!tokenFromUrl || !session?.access_token) return
    setStatus("completing")
    setError(null)
    try {
      const res = await fetch(
        apiUrl(`/api/device/pair/${encodeURIComponent(tokenFromUrl)}/complete`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        },
      )
      const data = await res.json()
      if (!res.ok) {
        setStatus("error")
        setError(data.error || data.error_description || "Failed to authorize")
        return
      }
      const tokens = data as PairCompleteResponse
      setStatus("success")

      // Hand the tokens to the desktop app via astro:// deep-link. The app's
      // open-url handler at electron/main/index.ts extracts the params,
      // writes ~/.astro/config.json, and starts the local agent. Setting
      // window.location.href is reliable for custom protocols (more so than
      // the iframe trick the old /device page used).
      const params = new URLSearchParams({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        ws_token: tokens.wsToken,
        machine_id: tokens.machineId,
        machine_name: tokens.machineName,
        api_url: tokens.apiUrl,
        relay_url: tokens.relayUrl,
      })
      window.location.href = `astro://pair/callback?${params.toString()}`
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "Failed to authorize")
    }
  }

  if (status === "missing-token") {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="text-destructive" size={20} />
            Missing pair token
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This page was opened without a pair token. Open the desktop app and
            click "Connect this Mac" to start over.
          </p>
        </CardContent>
      </CenteredCard>
    )
  }

  if (status === "loading" || authLoading || !initialized) {
    return (
      <CenteredCard>
        <CardContent className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
          <p className="text-sm text-muted-foreground">Loading pair details…</p>
        </CardContent>
      </CenteredCard>
    )
  }

  if (status === "expired" || status === "used" || status === "error") {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="text-destructive" size={20} />
            {status === "expired"
              ? "Pair token expired"
              : status === "used"
                ? "Pair token already used"
                : "Pair failed"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Return to the desktop app and click "Connect this Mac" again.
          </p>
        </CardContent>
      </CenteredCard>
    )
  }

  if (status === "success") {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="text-emerald-500" size={20} />
            Mac connected
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your Mac is now signed in. You can close this tab and return to the
            desktop app.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            If the desktop app didn't pick this up automatically, make sure it's
            running and click "Connect this Mac" again.
          </p>
        </CardContent>
      </CenteredCard>
    )
  }

  // status === "ready" or "completing"
  const machineInfo = info?.machineInfo
  return (
    <CenteredCard>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor size={20} />
          Authorize this Mac?
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Hostname</span>
            <span className="font-mono">{machineInfo?.hostname || "Unknown"}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Platform</span>
            <span className="font-mono">
              {getPlatformLabel(machineInfo?.platform)}
            </span>
          </div>
          {machineInfo?.providers && machineInfo.providers.length > 0 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Providers</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {machineInfo.providers.map((p) => (
                  <Badge key={p} variant="secondary" className="text-xs">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Approving will register this machine to your account and sign the
          desktop app in. You can revoke access later in Settings → Machines.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={handleApprove}
            disabled={status === "completing"}
            className="flex-1"
          >
            {status === "completing" ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Authorizing…
              </>
            ) : (
              "Approve"
            )}
          </Button>
        </div>
      </CardContent>
    </CenteredCard>
  )
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  )
}
