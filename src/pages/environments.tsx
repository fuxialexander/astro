import { useEffect, useState } from "react"
import {
  Server,
  Monitor,
  Cpu,
  HardDrive,
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
import { useSlurmStore } from "@/stores/slurm-store"
import { ClusterStatus } from "@/components/slurm/cluster-status"
import { AddEnvironmentDialog } from "@/components/environments/add-environment-dialog"

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

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

function MachineCard({ machine, registeredMachine, onRemove }: { machine: MachineEntry; registeredMachine?: RegisteredMachine; onRemove?: () => void }) {
  const providers = machine.providers.map((p) => p.type)

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Monitor className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">{machine.name || machine.machineId}</p>
            <p className="text-xs text-muted-foreground">{machine.machineId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="gap-1.5 bg-success/10 text-success border-0">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Connected
          </Badge>
          {onRemove && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-4 px-6 pb-4">
        {providers.length > 0 && (
          <div className="flex gap-1.5">
            {providers.map((p) => (
              <Badge key={p} variant="outline" className="text-[11px]">{p}</Badge>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">CPU</span>
            <span className="font-medium">{Math.round(machine.load.cpuPercent)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Mem</span>
            <span className="font-medium">{Math.round(machine.load.memoryPercent)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Tasks</span>
            <span className="font-medium">{machine.load.activeTasks}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
        <span>Registered {registeredMachine ? formatDate(registeredMachine.registeredAt) : "—"}</span>
        <span>Last seen {registeredMachine ? formatTime(registeredMachine.lastSeenAt) : "just now"}</span>
      </div>
    </Card>
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
        <span>Last seen {formatTime(machine.lastSeenAt)}</span>
      </div>
    </Card>
  )
}

export function Environments() {
  const [dialogOpen, setDialogOpen] = useState(false)

  const machines = useRealtimeStore((s) => s.machines)
  const realtimeConnected = useRealtimeStore((s) => s.connected)
  const connectRealtime = useRealtimeStore((s) => s.connect)

  const registeredMachines = useMachinesStore((s) => s.machines)
  const fetchRegistered = useMachinesStore((s) => s.fetchMachines)
  const revokeMachine = useMachinesStore((s) => s.revokeMachine)

  const slurmClusters = useSlurmStore((s) => s.clusters)
  const fetchClusters = useSlurmStore((s) => s.fetchClusters)

  useEffect(() => {
    fetchRegistered("current-user")
    fetchClusters()
  }, [fetchRegistered, fetchClusters])

  const liveMachines = Array.from(machines.values())
  const liveMachineIds = new Set(liveMachines.map((m) => m.machineId))

  // Build a lookup from machine ID → registered machine for footer dates
  const registeredLookup = new Map(registeredMachines.map((m) => [m.id, m]))

  // All registered machines (from device auth) that are currently connected
  const remoteLiveMachines = liveMachines.filter((m) => registeredLookup.has(m.machineId))

  // Registered machines that are not currently connected live
  const offlineMachines = registeredMachines.filter(
    (m) => !m.isRevoked && !m.isConnected && !liveMachineIds.has(m.id)
  )

  // +1 for the local machine (this server)
  const totalMachines = 1 + remoteLiveMachines.length + offlineMachines.length
  const connectedCount = 1 + remoteLiveMachines.length
  const activeTasks = liveMachines.reduce((sum, m) => sum + m.load.activeTasks, 0)
  const hpcClusterCount = slurmClusters.length

  const handleRefresh = () => {
    fetchRegistered("current-user")
    fetchClusters()
    if (!realtimeConnected) connectRealtime()
  }

  const handleMachineAdded = () => {
    fetchRegistered("current-user")
    if (!realtimeConnected) connectRealtime()
  }

  return (
    <div className="flex flex-col gap-6 p-8 px-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-primary text-[28px] font-semibold">Environments</h1>
          <p className="text-sm text-muted-foreground">
            Manage your connected machines and compute resources
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Environment
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
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
          label="HPC Clusters"
          value={hpcClusterCount}
          icon={Server}
          iconBg="bg-purple-500/10"
          iconColor="text-purple-500"
        />
      </div>

      {/* Local */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Laptop className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Local</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <LocalMachineCard />
        </div>
      </div>

      {/* Remote */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Remote</h2>
          {remoteLiveMachines.length > 0 && (
            <Badge variant="success">{remoteLiveMachines.length} connected</Badge>
          )}
        </div>
        {remoteLiveMachines.length > 0 || offlineMachines.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {remoteLiveMachines.map((m) => (
              <MachineCard
                key={m.machineId}
                machine={m}
                registeredMachine={registeredLookup.get(m.machineId)}
                onRemove={() => revokeMachine(m.machineId)}
              />
            ))}
            {offlineMachines.map((m) => (
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

      {/* HPC Clusters */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Server className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">HPC Clusters</h2>
          {slurmClusters.filter((c) => c.connectionStatus === "connected").length > 0 && (
            <Badge variant="warning">
              {slurmClusters.filter((c) => c.connectionStatus === "connected").length} connected
            </Badge>
          )}
        </div>
        <ClusterStatus showPartitions />
      </div>

      {/* Cloud */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Cloud className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Cloud</h2>
        </div>
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
        onMachineAdded={handleMachineAdded}
      />
    </div>
  )
}
