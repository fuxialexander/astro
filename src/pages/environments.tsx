import { useEffect, useState } from "react"
import {
  Server,
  Monitor,
  Activity,
  Wifi,
  RefreshCw,
  Plus,
  Cloud,
  Laptop,
  Zap,
  Globe,
  CheckCircle2,
  XCircle,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useRealtimeStore, type MachineEntry } from "@/stores/realtime-store"
import { useMachinesStore, type RegisteredMachine } from "@/stores/machines-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useAuthStore } from "@/stores/auth-store"
import { AddEnvironmentDialog } from "@/components/environments/add-environment-dialog"
import { formatDate, formatTimeShort } from "@/lib/date-utils"

function StatCard({ label, value, icon: Icon, iconBg, iconColor }: {
  label: string
  value: number
  icon: typeof Server
  iconBg: string
  iconColor: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="font-primary text-[32px] font-bold">{value}</p>
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`h-6 w-6 ${iconColor}`} />
        </div>
      </CardContent>
    </Card>
  )
}

function MachineCard({ machine, onRemove }: { machine: MachineEntry; registeredMachine?: RegisteredMachine; onRemove?: () => void }) {
  const providers = machine.providers.map((p) => p.type).join(" · ")
  const hpcCapability = machine.providers.find((p) => p.hpcCapability)?.hpcCapability
  const loadPercent = Math.round(machine.load.cpuPercent)
  const loadColor = loadPercent > 75 ? "bg-amber-500 dark:bg-amber-500" : "bg-blue-500 dark:bg-blue-500"

  return (
    <div className="rounded-2xl bg-card dark:bg-card p-4 shadow-[0px_2px_12px_-2px_rgba(0,0,0,0.25)] flex flex-col gap-3.5">
      {/* Top Row: Status + Name + Time */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-2.5 w-2.5 rounded-full bg-green-500 shrink-0" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <p className="font-semibold text-base text-foreground truncate">
              {machine.name || machine.machineId}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {providers}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-green-500">Active now</span>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive md:flex hidden"
              onClick={onRemove}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Bottom Row: Load bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground font-medium">Load</span>
          <span className="text-muted-foreground font-semibold">{loadPercent}%</span>
        </div>
        <div className="h-1 w-full rounded-sm bg-muted overflow-hidden">
          <div
            className={`h-full rounded-sm ${loadColor} transition-all duration-500`}
            style={{ width: `${Math.min(loadPercent, 100)}%` }}
          />
        </div>
      </div>

      {/* HPC Info (Desktop only) */}
      {hpcCapability && (
        <div className="hidden md:flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3 text-xs border-t border-border">
          {hpcCapability.partitions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Partitions:</span>
              <span className="font-medium">{hpcCapability.partitions.join(", ")}</span>
            </div>
          )}
          {hpcCapability.accounts.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Accounts:</span>
              <span className="font-medium">{hpcCapability.accounts.join(", ")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LocalMachineCard() {
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)

  useEffect(() => {
    if (!providersLoaded) loadProviders()
  }, [providersLoaded, loadProviders])

  // Only show providers that are at least installed (skip irrelevant ones like Slurm on a laptop)
  const installedProviders = providers.filter((p) => p.installed)
  const hasAvailable = installedProviders.some((p) => p.available)

  return (
    <Card>
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Laptop className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">This Machine</p>
            <p className="text-xs text-muted-foreground">
              Providers detected from local auth
            </p>
          </div>
        </div>
        <Badge className="gap-1.5 bg-success/10 text-success border-0">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Active
        </Badge>
      </div>

      <div className="flex flex-col gap-3 px-6 pb-6">
        {!providersLoaded ? (
          <p className="text-sm text-muted-foreground">Detecting providers...</p>
        ) : installedProviders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No providers detected</p>
        ) : (
          <div className="flex flex-col gap-2">
            {installedProviders.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-muted p-3">
                <div className="flex items-center gap-2">
                  {p.available ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-warning" />
                  )}
                  <span className="text-sm font-medium">{p.name}</span>
                </div>
                <Badge variant={p.available ? "success" : "warning"}>
                  {p.available ? "Ready" : "Not authenticated"}
                </Badge>
              </div>
            ))}
          </div>
        )}
        {!hasAvailable && providersLoaded && (
          <p className="text-xs text-muted-foreground">
            Run <code className="font-mono bg-muted px-1 rounded text-[11px]">claude login</code> to authenticate.
          </p>
        )}
      </div>
    </Card>
  )
}

function OfflineMachineCard({ machine, onRemove }: { machine: RegisteredMachine; onRemove?: () => void }) {
  return (
    <Card className="opacity-60">
      {/* Header */}
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Monitor className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">{machine.name}</p>
            <p className="text-xs text-muted-foreground">
              {machine.hostname} &middot; {machine.platform}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Offline</Badge>
          {onRemove && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {machine.providers.length > 0 && (
        <div className="flex gap-1.5 px-6 pb-4">
          {machine.providers.map((p) => (
            <Badge key={p} variant="outline" className="text-[11px]">{p}</Badge>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
        <span>Registered {formatDate(machine.registeredAt)}</span>
        <span>Last seen {formatTimeShort(machine.lastSeenAt)}</span>
      </div>
    </Card>
  )
}

export function Environments() {
  const [dialogOpen, setDialogOpen] = useState(false)

  const user = useAuthStore((s) => s.user)
  const machines = useRealtimeStore((s) => s.machines)
  const realtimeConnected = useRealtimeStore((s) => s.connected)
  const connectRealtime = useRealtimeStore((s) => s.connect)

  const registeredMachines = useMachinesStore((s) => s.machines)
  const fetchRegistered = useMachinesStore((s) => s.fetchMachines)
  const revokeMachine = useMachinesStore((s) => s.revokeMachine)

  // Connect to real-time events on mount to receive live machine updates
  useEffect(() => {
    if (!realtimeConnected) {
      connectRealtime()
    }
  }, [realtimeConnected, connectRealtime])

  // Re-fetch registered machines on mount and whenever live machines change.
  // The server auto-registers relay-connected machines in the persistent store
  // via ensureMachineRegistered on machine:connected events. A small delay
  // ensures the server has time to persist before the frontend re-fetches.
  const liveMachineCount = machines.size
  useEffect(() => {
    if (!user) return

    fetchRegistered()
    if (liveMachineCount > 0) {
      const timer = setTimeout(() => fetchRegistered(), 1000)
      return () => clearTimeout(timer)
    }
  }, [fetchRegistered, liveMachineCount, user])

  const liveMachines = Array.from(machines.values())
  const liveMachineIds = new Set(liveMachines.map((m) => m.machineId))

  // Build a lookup from machine ID → registered machine for footer dates
  const registeredLookup = new Map(registeredMachines.map((m) => [m.id, m]))

  // Derive HPC machines from live machines with hpcCapability
  const hpcMachineIds = new Set(
    liveMachines
      .filter((m) => m.providers.some((p) => p.hpcCapability))
      .map((m) => m.machineId)
  )
  const hpcMachines = liveMachines.filter((m) => hpcMachineIds.has(m.machineId))

  // Remote machines: non-HPC, non-local machines
  const remoteLiveMachines = liveMachines.filter(
    (m) => !hpcMachineIds.has(m.machineId) && m.environmentType !== 'local'
  )

  // Registered machines that are not currently connected live, split by HPC vs non-HPC
  const offlineNonHpcMachines = registeredMachines.filter(
    (m) => !m.isRevoked && !m.isConnected && !liveMachineIds.has(m.id) && m.environmentType !== 'hpc'
  )
  const offlineHpcMachines = registeredMachines.filter(
    (m) => !m.isRevoked && !m.isConnected && !liveMachineIds.has(m.id) && m.environmentType === 'hpc'
  )

  // +1 for the local machine (this server)
  const totalMachines = 1 + remoteLiveMachines.length + hpcMachines.length + offlineNonHpcMachines.length + offlineHpcMachines.length
  const connectedCount = 1 + remoteLiveMachines.length + hpcMachines.length
  const activeTasks = liveMachines.reduce((sum, m) => sum + m.load.activeTasks, 0)
  const hpcClusterCount = hpcMachines.length + offlineHpcMachines.length

  const handleRefresh = () => {
    if (user) fetchRegistered()
    if (!realtimeConnected) connectRealtime()
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 md:px-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-primary text-[28px] font-semibold">Environments</h1>
          <p className="text-sm text-muted-foreground hidden md:block">
            Manage your connected machines and compute resources
          </p>
          <p className="text-sm text-muted-foreground md:hidden">
            {connectedCount} machines connected
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleRefresh} className="hidden md:flex">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setDialogOpen(true)} size="icon" className="md:hidden h-11 w-11 rounded-[22px]">
            <Plus className="h-5 w-5" />
          </Button>
          <Button onClick={() => setDialogOpen(true)} className="hidden md:flex">
            <Plus className="h-4 w-4" />
            Add Environment
          </Button>
        </div>
      </div>

      {/* Stats Row - Desktop only */}
      <div className="hidden md:grid grid-cols-4 gap-4">
        <StatCard
          label="Total Machines"
          value={totalMachines}
          icon={Monitor}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-500"
        />
        <StatCard
          label="Connected"
          value={connectedCount}
          icon={Wifi}
          iconBg="bg-green-500/10"
          iconColor="text-green-500"
        />
        <StatCard
          label="Active Tasks"
          value={activeTasks}
          icon={Activity}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-500"
        />
        <StatCard
          label="SLURM Clusters"
          value={hpcClusterCount}
          icon={Server}
          iconBg="bg-purple-500/10"
          iconColor="text-purple-500"
        />
      </div>

      {/* Local */}
      <div className="flex flex-col gap-4">
        <div className="hidden md:flex items-center gap-3">
          <Laptop className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Local</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <LocalMachineCard />
        </div>
      </div>

      {/* Connected */}
      <div className="flex flex-col gap-4">
        <div className="hidden md:flex items-center gap-3">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Connected</h2>
          {remoteLiveMachines.length > 0 && (
            <Badge variant="success">{remoteLiveMachines.length} connected</Badge>
          )}
        </div>
        <p className="md:hidden text-sm font-semibold text-muted-foreground uppercase tracking-wider">Connected</p>
        {remoteLiveMachines.length > 0 || offlineNonHpcMachines.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {remoteLiveMachines.map((m) => (
              <MachineCard
                key={m.machineId}
                machine={m}
                registeredMachine={registeredLookup.get(m.machineId)}
                onRemove={() => revokeMachine(m.machineId)}
              />
            ))}
            {offlineNonHpcMachines.map((m) => (
              <OfflineMachineCard key={m.id} machine={m} onRemove={() => revokeMachine(m.id)} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Zap}
                title="Connect a remote machine"
                description="Run the agent setup command on a remote machine, or use the device code flow to register it with the platform."
                action={{
                  label: "Add Remote Machine",
                  onClick: () => setDialogOpen(true),
                }}
                className="py-8"
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* SLURM Clusters */}
      <div className="flex flex-col gap-4">
        <div className="hidden md:flex items-center gap-3">
          <Server className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">SLURM Clusters</h2>
          {hpcMachines.length > 0 && (
            <Badge variant="success">
              {hpcMachines.length} connected
            </Badge>
          )}
        </div>
        <p className="md:hidden text-sm font-semibold text-muted-foreground uppercase tracking-wider">SLURM Clusters</p>
        {hpcMachines.length > 0 || offlineHpcMachines.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hpcMachines.map((m) => (
              <MachineCard
                key={m.machineId}
                machine={m}
                registeredMachine={registeredLookup.get(m.machineId)}
                onRemove={() => revokeMachine(m.machineId)}
              />
            ))}
            {offlineHpcMachines.map((m) => (
              <OfflineMachineCard key={m.id} machine={m} onRemove={() => revokeMachine(m.id)} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Server}
                title="No SLURM clusters connected"
                description="Connect to an HPC login node with Slurm installed. The agent runner will auto-detect the cluster and inject HPC context into Claude sessions."
                action={{
                  label: "Add SLURM Cluster",
                  onClick: () => setDialogOpen(true),
                }}
                className="py-8"
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Cloud */}
      <div className="flex flex-col gap-4">
        <div className="hidden md:flex items-center gap-3">
          <Cloud className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Cloud</h2>
        </div>
        <p className="md:hidden text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cloud</p>
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Cloud}
              title="Scale with cloud compute"
              description="Connect AWS or GCP to automatically scale compute for demanding tasks. Your agents will dispatch work to cloud instances when local resources are insufficient."
              action={{
                label: "Add Cloud Provider",
                onClick: () => setDialogOpen(true),
              }}
              className="py-8"
            />
          </CardContent>
        </Card>
      </div>

      {/* Add Environment Dialog */}
      <AddEnvironmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
