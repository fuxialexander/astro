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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useRealtimeStore, type MachineEntry } from "@/stores/realtime-store"
import { useMachinesStore, type RegisteredMachine } from "@/stores/machines-store"
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

function MachineCard({ machine, registeredMachine }: { machine: MachineEntry; registeredMachine?: RegisteredMachine }) {
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
        <Badge className="gap-1.5 bg-success/10 text-success border-0">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Connected
        </Badge>
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

function OfflineMachineCard({ machine }: { machine: RegisteredMachine }) {
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
        <Badge variant="secondary">Offline</Badge>
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

  // Registered machines that are not currently connected live
  const offlineMachines = registeredMachines.filter(
    (m) => !m.isRevoked && !m.isConnected && !liveMachineIds.has(m.id)
  )

  const localLiveMachines = liveMachines.filter((m) => m.environmentType === "local")
  const totalMachines = liveMachines.length + offlineMachines.length
  const connectedCount = liveMachines.length
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

      {/* Local Machines */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Laptop className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Local Machines</h2>
          <Badge variant="success">{connectedCount} connected</Badge>
        </div>
        {localLiveMachines.length > 0 || offlineMachines.filter((m) => m.environmentType === "local").length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {localLiveMachines.map((m) => (
              <MachineCard key={m.machineId} machine={m} registeredMachine={registeredLookup.get(m.machineId)} />
            ))}
            {offlineMachines
              .filter((m) => m.environmentType === "local")
              .map((m) => (
                <OfflineMachineCard key={m.id} machine={m} />
              ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <Monitor className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No local machines</p>
              <p className="text-xs text-muted-foreground">
                Run the Nexus agent runner on your machine to connect it
              </p>
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
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Cloud className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No cloud environments configured</p>
            <p className="text-xs text-muted-foreground">
              Add AWS or GCP credentials to integrate cloud compute
            </p>
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
