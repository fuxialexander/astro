import { useCallback, useEffect, useState } from "react"
import { WifiOff } from "lucide-react"
import { useRealtimeStore } from "@/stores/realtime-store"
import { cn } from "@/lib/utils"

/**
 * Thin banner shown when the SSE connection drops.
 * Only appears after having been connected once (no flash on initial load).
 * Shows "Reconnected" briefly on recovery, then auto-dismisses.
 */
export function SseDisconnectBanner() {
  const connected = useRealtimeStore((s) => s.connected)
  // "waiting" = never connected, "ready" = connected & hidden,
  // "disconnected" = warning shown, "reconnected" = brief success
  const [phase, setPhase] = useState<"waiting" | "ready" | "disconnected" | "reconnected">("waiting")

  const transition = useCallback((currentConnected: boolean, currentPhase: typeof phase) => {
    if (currentConnected) {
      if (currentPhase === "waiting") return "ready"
      if (currentPhase === "disconnected") return "reconnected"
    }
    return null // no immediate transition
  }, [])

  // Handle connection state changes via subscription callback (not in effect body)
  useEffect(() => {
    const next = transition(connected, phase)
    if (next) {
      // Use microtask to avoid synchronous setState in effect
      queueMicrotask(() => setPhase(next))
    }
  }, [connected, phase, transition])

  // Delayed transition: ready/reconnected -> disconnected
  // Use 10s threshold to suppress brief disconnects from multi-instance routing
  useEffect(() => {
    if (!connected && (phase === "ready" || phase === "reconnected")) {
      const t = setTimeout(() => setPhase("disconnected"), 10000)
      return () => clearTimeout(t)
    }
  }, [connected, phase])

  // Auto-dismiss "reconnected" after 2s
  useEffect(() => {
    if (phase === "reconnected") {
      const t = setTimeout(() => setPhase("ready"), 2000)
      return () => clearTimeout(t)
    }
  }, [phase])

  if (phase === "waiting" || phase === "ready") return null

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-medium transition-all duration-500",
        phase === "reconnected"
          ? "bg-success/10 text-success"
          : "bg-warning/10 text-warning"
      )}
    >
      {phase === "reconnected" ? (
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
