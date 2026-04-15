import { useState, useEffect, useRef, useCallback } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Send, Check, Loader2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import { cn } from "@/lib/utils"

interface TelegramStatus {
  connected: boolean
  chatId?: string | null
  botConfigured: boolean
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export function TelegramConnectCard() {
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const linkUrlRef = useRef(linkUrl)
  linkUrlRef.current = linkUrl

  const checkStatus = useCallback(async () => {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/telegram/status'), { headers })
      if (res.ok) {
        const data = await res.json() as TelegramStatus
        setStatus(data)
        if (data.connected && linkUrlRef.current) {
          // Connection established — stop polling and clear link
          setLinkUrl(null)
          setLinking(false)
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        }
      }
    } catch {
      // Silently fail — will retry on next poll
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkStatus()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [checkStatus])

  const handleConnect = async () => {
    setLinking(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/telegram/link'), {
        method: 'POST',
        headers,
      })
      if (res.ok) {
        const data = await res.json() as { url: string; token: string }
        setLinkUrl(data.url)
        // Start polling for connection
        pollRef.current = setInterval(checkStatus, 3000)
      }
    } catch {
      setLinking(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      const headers = await getAuthHeaders()
      await fetch(apiUrl('/api/telegram/disconnect'), {
        method: 'DELETE',
        headers,
      })
      setStatus({ connected: false, botConfigured: status?.botConfigured ?? false })
    } finally {
      setDisconnecting(false)
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 px-5 py-4">
          <Send className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <h3 className="text-sm font-medium">Telegram</h3>
            <p className="text-[13px] text-muted-foreground">Loading...</p>
          </div>
        </div>
      </section>
    )
  }

  // Bot not configured on server
  if (status && !status.botConfigured) {
    return (
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 px-5 py-4">
          <Send className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <h3 className="text-sm font-medium">Telegram</h3>
            <p className="text-[13px] text-muted-foreground">
              Telegram notifications are not configured on this server.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-5 py-4">
        <Send className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h3 className="text-sm font-medium">Telegram</h3>
          <p className="text-[13px] text-muted-foreground">
            Chat with Astro, run slash commands, and get notifications — all from Telegram.
          </p>
        </div>
        {status?.connected && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Connected
          </span>
        )}
      </div>

      <div className="border-t border-border px-5 py-4">
        {status?.connected ? (
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">
              Connected. Open Telegram and send /help for commands, or /bind to link a project chat.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unlink className="mr-1.5 h-3.5 w-3.5" />
              )}
              Disconnect
            </Button>
          </div>
        ) : linkUrl ? (
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Scan this QR code with your phone, or click the link below:
            </p>
            <div className="flex items-start gap-4">
              <div className="rounded-lg border border-border bg-white p-2 shrink-0">
                <QRCodeSVG value={linkUrl} size={120} />
              </div>
              <div className="flex flex-col gap-2 min-w-0">
                <a
                  href={linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "block rounded-md border border-border bg-muted/50 px-3 py-2",
                    "text-sm font-mono text-primary hover:bg-muted transition-colors",
                    "truncate"
                  )}
                >
                  {linkUrl}
                </a>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Waiting for you to tap Start in Telegram...
                </div>
              </div>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleConnect}
            disabled={linking}
          >
            {linking ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Connect Telegram
          </Button>
        )}
      </div>
    </section>
  )
}
