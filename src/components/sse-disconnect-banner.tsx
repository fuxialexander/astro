import { useEffect, useRef, useState } from "react"
import { WifiOff } from "lucide-react"
import { useRealtimeStore } from "@/stores/realtime-store"
import { cn } from "@/lib/utils"

/**
 * Thin banner shown when the SSE connection drops.
 * Only appears after having been connected (avoids flash on initial load).
 * Fades out automatically 2s after reconnection.
 */
export function SseDisconnectBanner() {
  const connected = useRealtimeStore((s) => s.connected)
  const wasConnected = useRef(false)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (connected) {
      wasConnected.current = true
      // Fade out after reconnect
      if (show) {
        const t = setTimeout(() => setShow(false), 2000)
        return () => clearTimeout(t)
      }
    } else if (wasConnected.current) {
      // Only show after having been connected once (skip initial load)
      setShow(true)
    }
  }, [connected, show])

  if (!show) return null

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-medium transition-all duration-500",
        connected
          ? "bg-success/10 text-success"
          : "bg-warning/10 text-warning"
      )}
    >
      {connected ? (
        "Reconnected"
      ) : (
        <>
          <WifiOff className="h-3 w-3" />
          Live updates paused — reconnecting...
        </>
      )}
    </div>
  )
}
