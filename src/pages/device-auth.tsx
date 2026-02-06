import { useEffect, useState } from "react"
import { useSearchParams } from "react-router"
import { Monitor, CheckCircle2, XCircle, Loader2, AlertCircle, Laptop, Server, Cloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

type AuthStatus = "loading" | "pending" | "success" | "error" | "denied" | "expired"

interface DeviceCodeInfo {
  deviceCode: string
  machineInfo?: {
    hostname?: string
    platform?: string
    environmentType?: string
  }
  scopes: string[]
  expiresAt: string
}

// Mock user ID - in a real app this would come from auth session
const MOCK_USER_ID = "user-1"

function getEnvironmentIcon(type?: string) {
  switch (type) {
    case "local":
      return <Laptop className="h-5 w-5" />
    case "hpc":
      return <Server className="h-5 w-5" />
    case "cloud":
      return <Cloud className="h-5 w-5" />
    default:
      return <Monitor className="h-5 w-5" />
  }
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

export function DeviceAuth() {
  const [searchParams] = useSearchParams()
  const codeFromUrl = searchParams.get("code")

  const [code, setCode] = useState(codeFromUrl || "")
  const [status, setStatus] = useState<AuthStatus>(codeFromUrl ? "loading" : "pending")
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch device code info when code is provided
  useEffect(() => {
    if (!codeFromUrl) return

    let cancelled = false

    const doFetch = async () => {
      setStatus("loading")
      setError(null)

      try {
        const response = await fetch(`/api/device/code/${encodeURIComponent(codeFromUrl)}`)
        if (cancelled) return

        const data = await response.json()

        if (!response.ok) {
          if (data.status === "expired") {
            setStatus("expired")
            setError("This device code has expired. Please request a new code.")
          } else {
            setStatus("error")
            setError(data.error || "Invalid device code")
          }
          return
        }

        setDeviceInfo(data)
        setStatus("pending")
      } catch {
        if (!cancelled) {
          setStatus("error")
          setError("Failed to verify device code. Please try again.")
        }
      }
    }

    doFetch()

    return () => {
      cancelled = true
    }
  }, [codeFromUrl])

  async function handleAuthorize() {
    if (!deviceInfo) return

    setStatus("loading")
    setError(null)

    try {
      const response = await fetch(`/api/device/code/${deviceInfo.deviceCode}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: MOCK_USER_ID }),
      })

      const data = await response.json()

      if (!response.ok) {
        setStatus("error")
        setError(data.error || "Failed to authorize device")
        return
      }

      setStatus("success")
    } catch {
      setStatus("error")
      setError("Failed to authorize device. Please try again.")
    }
  }

  async function handleDeny() {
    if (!deviceInfo) return

    setStatus("loading")

    try {
      await fetch(`/api/device/code/${deviceInfo.deviceCode}/deny`, {
        method: "POST",
      })
      setStatus("denied")
    } catch {
      setStatus("error")
      setError("Failed to deny authorization. Please try again.")
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    const deviceCode = code.trim().toUpperCase()
    if (!deviceCode) return

    setStatus("loading")
    setError(null)

    try {
      const response = await fetch(`/api/device/code/${encodeURIComponent(deviceCode)}`)
      const data = await response.json()

      if (!response.ok) {
        if (data.status === "expired") {
          setStatus("expired")
          setError("This device code has expired. Please request a new code.")
        } else {
          setStatus("error")
          setError(data.error || "Invalid device code")
        }
        return
      }

      setDeviceInfo(data)
      setStatus("pending")
    } catch {
      setStatus("error")
      setError("Failed to verify device code. Please try again.")
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Nexus</h1>
          <p className="text-sm text-muted-foreground">Device Authentication</p>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle>
              {status === "success" && "Device Authorized"}
              {status === "denied" && "Authorization Denied"}
              {status === "expired" && "Code Expired"}
              {status === "error" && "Error"}
              {(status === "pending" || status === "loading") && !deviceInfo && "Enter Device Code"}
              {(status === "pending" || status === "loading") && deviceInfo && "Authorize Device"}
            </CardTitle>
          </CardHeader>

          <CardContent>
            {/* Success State */}
            {status === "success" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                  <CheckCircle2 className="h-8 w-8 text-success" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  The device has been authorized successfully. You can close this page
                  and return to your terminal.
                </p>
              </div>
            )}

            {/* Denied State */}
            {status === "denied" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <XCircle className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Authorization was denied. The device will not be registered.
                </p>
              </div>
            )}

            {/* Expired State */}
            {status === "expired" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
                  <AlertCircle className="h-8 w-8 text-warning" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  This device code has expired. Please run the setup command again
                  to get a new code.
                </p>
              </div>
            )}

            {/* Error State */}
            {status === "error" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
                <p className="text-center text-sm text-destructive">{error}</p>
                <Button variant="outline" onClick={() => setStatus("pending")}>
                  Try Again
                </Button>
              </div>
            )}

            {/* Manual Code Entry */}
            {(status === "pending" || status === "loading") && !deviceInfo && (
              <form onSubmit={handleManualSubmit} className="flex flex-col gap-4">
                <p className="text-center text-sm text-muted-foreground">
                  Enter the code shown in your terminal to authorize the device.
                </p>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  className="text-center text-lg font-mono tracking-widest"
                  maxLength={9}
                  autoFocus
                />
                <Button type="submit" disabled={status === "loading" || code.length < 9}>
                  {status === "loading" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
              </form>
            )}

            {/* Authorize Confirmation */}
            {(status === "pending" || status === "loading") && deviceInfo && (
              <div className="flex flex-col gap-6">
                <p className="text-center text-sm text-muted-foreground">
                  A device is requesting access to your Nexus workspace.
                </p>

                {/* Device Info */}
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background">
                      {getEnvironmentIcon(deviceInfo.machineInfo?.environmentType)}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {deviceInfo.machineInfo?.hostname || "Unknown Device"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {getPlatformLabel(deviceInfo.machineInfo?.platform)}
                        {deviceInfo.machineInfo?.environmentType && (
                          <> · {deviceInfo.machineInfo.environmentType}</>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {deviceInfo.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="text-xs">
                        {scope.replace("machine:", "")}
                      </Badge>
                    ))}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Code: <code className="font-mono">{deviceInfo.deviceCode}</code>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleDeny}
                    disabled={status === "loading"}
                  >
                    Deny
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleAuthorize}
                    disabled={status === "loading"}
                  >
                    {status === "loading" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Authorizing...
                      </>
                    ) : (
                      "Authorize"
                    )}
                  </Button>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                  Only authorize devices you trust. This will allow the device to
                  execute tasks in your workspace.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Having trouble? Run <code className="rounded bg-muted px-1 py-0.5">npx @nexus/agent setup</code> to
          start the device authentication process.
        </p>
      </div>
    </div>
  )
}
