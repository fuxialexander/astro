import { useNavigate } from "react-router"
import { Server } from "lucide-react"
import { MachineGauge } from "./machine-gauge"
import { cn } from "@/lib/utils"

interface MachineData {
  machineId: string
  name: string
  cpuPercent: number
  memoryPercent: number
  activeTasks: number
  connected: boolean
}

interface MachineFleetPanelProps {
  machines: MachineData[]
  className?: string
}

export function MachineFleetPanel({ machines, className }: MachineFleetPanelProps) {
  const navigate = useNavigate()

  if (machines.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 py-6", className)}>
        <button
          onClick={() => navigate("/settings")}
          className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border/40 px-6 py-4 hover:border-border/60 hover:bg-muted/20 transition-all cursor-pointer"
        >
          <Server className="h-5 w-5 text-muted-foreground/40" />
          <span className="text-[11px] text-muted-foreground/50">Add machine</span>
        </button>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      {machines.map((m) => (
        <MachineGauge
          key={m.machineId}
          name={m.name}
          cpuPercent={m.cpuPercent}
          memoryPercent={m.memoryPercent}
          activeTasks={m.activeTasks}
          connected={m.connected}
          size={88}
        />
      ))}
    </div>
  )
}
