import { Wifi, WifiOff, DollarSign, AlertCircle } from "lucide-react"
import { MicroSparkline } from "./micro-sparkline"
import { cn } from "@/lib/utils"

interface CommandStripProps {
  approvalCount: number
  hourlyPulse: number[]
  todayCost: number
  connected: boolean
  onApprovalClick: () => void
  className?: string
}

export function CommandStrip({
  approvalCount,
  hourlyPulse,
  todayCost,
  connected,
  onApprovalClick,
  className,
}: CommandStripProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-30 flex items-center gap-4 px-4 py-2.5 rounded-xl",
        "glass-panel glass-shimmer",
        "transition-shadow duration-500 hover:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.12)]",
        className,
      )}
    >
      {/* Approval badge */}
      <button
        onClick={onApprovalClick}
        className={cn(
          "flex items-center gap-2 px-2.5 py-1 rounded-lg transition-all duration-300 cursor-pointer",
          approvalCount > 0
            ? "bg-amber-500/10 hover:bg-amber-500/20 hover:scale-[1.03] text-amber-600 dark:text-amber-400"
            : "text-muted-foreground/50 hover:text-muted-foreground/70",
        )}
      >
        {approvalCount > 0 && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
        )}
        <AlertCircle className="h-3.5 w-3.5" />
        <span className="text-[12px] font-semibold tabular-nums">{approvalCount}</span>
      </button>

      {/* Separator */}
      <div className="h-4 w-px bg-border/20" />

      {/* 24h pulse sparkline */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">24h</span>
        <MicroSparkline
          data={hourlyPulse}
          width={100}
          height={20}
          strokeColor="var(--color-primary, #6b8fa3)"
        />
      </div>

      <div className="flex-1" />

      {/* Today's cost */}
      <div className="flex items-center gap-1 text-[12px] text-muted-foreground/60">
        <DollarSign className="h-3 w-3" />
        <span className="font-medium tabular-nums">{todayCost.toFixed(2)}</span>
      </div>

      {/* Connection status */}
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium transition-colors duration-300",
          connected ? "text-success/70" : "text-muted-foreground/50",
        )}
      >
        {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
        {connected ? "Live" : "Offline"}
      </div>
    </div>
  )
}
