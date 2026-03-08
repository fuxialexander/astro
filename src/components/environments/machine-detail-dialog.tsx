import {
  Laptop,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  MemoryStick,
  MonitorDot,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { formatRelativeTime } from "@/lib/date-utils"
import { compactGpuName } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import type { RegisteredMachine } from "@/stores/machines-store"
import type { MachineEntry } from "@/stores/realtime-store"

// Re-use the shared AI agent display names
import { PROVIDER_NAMES as providerDisplayName } from "@/components/execution/provider-utils"


const platformLabel: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
}

interface MachineDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  machine: RegisteredMachine | null
  /** Live machine data from the relay (if connected) */
  liveMachine?: MachineEntry
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right">{children}</span>
    </div>
  )
}

export function MachineDetailDialog({ open, onOpenChange, machine, liveMachine }: MachineDetailDialogProps) {
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)
  const setDefaultProvider = useSettingsStore((s) => s.setDefaultProvider)

  if (!machine) return null

  const isOnline = machine.isConnected || !!liveMachine

  // Resources from live relay connection
  const resources = liveMachine?.resources
  const load = liveMachine?.load

  // Provider info: prefer live data (has status), fall back to registered strings
  const liveProviders = liveMachine?.providers
  const registeredProviders = machine.providers

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Laptop className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base truncate">{machine.name}</DialogTitle>
              <p className="text-xs text-muted-foreground truncate">{machine.hostname}</p>
            </div>
            <Badge variant={isOnline ? "success" : "secondary"} className="gap-1.5 shrink-0">
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-teal-500" : "bg-muted-foreground"}`} />
              {isOnline ? "Online" : "Offline"}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-0 divide-y divide-border mt-2">
          {/* Basic Info */}
          <InfoRow label="Platform">{platformLabel[machine.platform] || machine.platform}</InfoRow>
          <InfoRow label="Machine ID">
            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{machine.id.slice(0, 16)}...</code>
          </InfoRow>
          <InfoRow label="Registered">
            {machine.registeredAt ? formatRelativeTime(new Date(machine.registeredAt)) : "—"}
          </InfoRow>
          <InfoRow label="Last Seen">
            {machine.lastSeenAt ? formatRelativeTime(new Date(machine.lastSeenAt)) : "—"}
          </InfoRow>
        </div>

        {/* Resources (only available when online via relay) */}
        {resources && (
          <div className="flex flex-col gap-2 mt-4">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resources</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-muted p-2.5">
                <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{resources.cpuCores} cores</span>
                  {load && <span className="text-[10px] text-muted-foreground">{Math.round(load.cpuPercent)}% used</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-muted p-2.5">
                <MemoryStick className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{Math.round(resources.memoryMB / 1024)} GB</span>
                  {load && <span className="text-[10px] text-muted-foreground">{Math.round(load.memoryPercent)}% used</span>}
                </div>
              </div>
              {resources.gpuCount && resources.gpuCount > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-muted p-2.5 col-span-2">
                  <MonitorDot className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {resources.gpuCount}× {resources.gpuType ? compactGpuName(resources.gpuType) : "GPU"}
                    </span>
                    {resources.gpuMemoryMB && (
                      <span className="text-[10px] text-muted-foreground">{Math.round(resources.gpuMemoryMB / 1024)} GB</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Providers */}
        <div className="flex flex-col gap-2 mt-4">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Agent Providers</h4>
          <p className="text-[11px] text-muted-foreground">Click a provider to set it as the default for task execution.</p>
          {liveProviders && liveProviders.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {liveProviders.map((p) => {
                const isDefault = defaultProvider === p.type
                return (
                  <button
                    key={p.type}
                    type="button"
                    className={`flex items-center justify-between rounded-lg p-2.5 w-full text-left transition-colors ${
                      isDefault
                        ? "bg-primary/15 ring-2 ring-primary/50 dark:bg-primary/20 dark:ring-primary/40"
                        : "bg-muted/50 hover:bg-muted/80"
                    }`}
                    onClick={() => setDefaultProvider(isDefault ? "" : p.type)}
                  >
                    <div className="flex items-center gap-2">
                      {p.status === "available" ? (
                        <CheckCircle2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-warning" />
                      )}
                      <span className="text-sm font-medium">{providerDisplayName[p.type] ?? p.type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.currentTasks > 0 && (
                        <span className="text-xs text-muted-foreground">{p.currentTasks}/{p.maxConcurrentTasks} tasks</span>
                      )}
                      {isDefault ? (
                        <Badge className="text-[10px] bg-primary/25 text-primary font-semibold border-0 dark:bg-primary/30">Default</Badge>
                      ) : (
                        <Badge variant={p.status === "available" ? "success" : "warning"} className="text-[10px]">
                          {p.status === "available" ? "Ready" : "Unavailable"}
                        </Badge>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : registeredProviders.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {registeredProviders.map((p) => {
                const isDefault = defaultProvider === p
                return (
                  <button
                    key={p}
                    type="button"
                    className={`flex items-center justify-between rounded-lg p-2.5 w-full text-left transition-colors ${
                      isDefault
                        ? "bg-primary/15 ring-2 ring-primary/50 dark:bg-primary/20 dark:ring-primary/40"
                        : "bg-muted/50 hover:bg-muted/80"
                    }`}
                    onClick={() => setDefaultProvider(isDefault ? "" : p)}
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{providerDisplayName[p] ?? p}</span>
                    </div>
                    {isDefault ? (
                      <Badge className="text-[10px] bg-primary/25 text-primary font-semibold border-0 dark:bg-primary/30">Default</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        {isOnline ? "Detected" : "Last known"}
                      </Badge>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No providers detected</p>
          )}
        </div>

        {/* Active Tasks (only when online) */}
        {load && load.activeTasks > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-info/10 p-3 mt-2">
            <span className="text-sm font-medium text-info">Active Tasks</span>
            <Badge className="bg-info/20 text-info border-0">{load.activeTasks}</Badge>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
