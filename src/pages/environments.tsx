import { useEffect, useState } from "react"
import {
  Server,
  Monitor,
  Activity,
  Wifi,
  RefreshCw,
  Plus,
  Laptop,
  Globe,
  CheckCircle2,
  XCircle,
  Trash2,
  Boxes,
  Container,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useRealtimeStore, type MachineEntry } from "@/stores/realtime-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useExecutionStore, type ComputeBackendInfo } from "@/stores/execution-store"
import { AddEnvironmentDialog } from "@/components/environments/add-environment-dialog"
import { BackendDetailDialog } from "@/components/environments/backend-detail-dialog"
import { shouldUseSupabase } from "@/lib/supabase-client"

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

const backendStyleMap: Record<string, { color: string; bg: string }> = {
  direct: { color: "text-gray-600 dark:text-gray-400", bg: "bg-gray-100 dark:bg-gray-800" },
  slurm: { color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-100 dark:bg-purple-900/30" },
  docker: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30" },
  "k8s-exec": { color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-100 dark:bg-sky-900/30" },
  skypilot: { color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-100 dark:bg-orange-900/30" },
  ssh: { color: "text-green-600 dark:text-green-400", bg: "bg-green-100 dark:bg-green-900/30" },
}

function getBackendStyle(id: string) {
  if (id.startsWith('ssh:')) return backendStyleMap.ssh!
  return backendStyleMap[id] ?? backendStyleMap.direct!
}

const providerDisplayName: Record<string, string> = {
  "claude-sdk": "Claude Agent SDK",
  "claude-code": "Claude Code",
  "codex": "Codex",
}

function formatResourceSummary(resources?: MachineEntry["resources"]): string | null {
  if (!resources) return null
  const parts: string[] = []
  parts.push(`${resources.cpuCores} CPUs`)
  const memGb = Math.round(resources.memoryMB / 1024)
  parts.push(`${memGb}GB RAM`)
  if (resources.gpuCount && resources.gpuCount > 0) {
    const gpuMemGb = resources.gpuMemoryMB ? Math.round(resources.gpuMemoryMB / 1024) : null
    parts.push(`${resources.gpuCount} GPU${resources.gpuCount > 1 ? "s" : ""}${gpuMemGb ? ` (${gpuMemGb}GB)` : ""}`)
  }
  return parts.join(" · ")
}

function ConnectedMachinesCard({ machines, onRemove, onBackendClick }: {
  machines: MachineEntry[]
  onRemove?: (machineId: string) => void
  onBackendClick?: (backend: ComputeBackendInfo) => void
}) {
  return (
    <Card>
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
            <Globe className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <p className="font-medium">Connected</p>
            <p className="text-xs text-muted-foreground">
              {machines.length} machine{machines.length !== 1 ? "s" : ""} via agent runner relay
            </p>
          </div>
        </div>
        <Badge className="gap-1.5 bg-success/10 text-success border-0">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {machines.length} active
        </Badge>
      </div>
      <div className="flex flex-col gap-2 px-6 pb-6">
        {machines.map((machine) => {
          const strategies = machine.executionStrategies?.filter((s) => s.available) ?? []
          const loadPercent = Math.round(machine.load.cpuPercent)
          const loadColor = loadPercent > 75 ? "bg-amber-500" : "bg-blue-500"
          const resourceSummary = formatResourceSummary(machine.resources)

          return (
            <div
              key={machine.machineId}
              className="flex flex-col gap-2.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors p-3"
            >
              {/* Name + status row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                  <div className="flex flex-col gap-0 min-w-0">
                    <span className="text-sm font-medium truncate">{machine.name || machine.machineId}</span>
                    {resourceSummary && (
                      <span className="text-[11px] text-muted-foreground truncate">{resourceSummary}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] text-muted-foreground">{loadPercent}%</span>
                  <div className="h-1 w-16 rounded-sm bg-background overflow-hidden">
                    <div
                      className={`h-full rounded-sm ${loadColor} transition-all duration-500`}
                      style={{ width: `${Math.min(loadPercent, 100)}%` }}
                    />
                  </div>
                  {onRemove && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive hidden md:flex"
                      onClick={() => onRemove(machine.machineId)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              {/* Badges: providers + backends */}
              <div className="flex flex-wrap gap-1">
                {machine.providers.map((p) => (
                  <span
                    key={p.type}
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                      p.status === "available"
                        ? "text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30"
                        : "text-muted-foreground bg-background"
                    }`}
                  >
                    {providerDisplayName[p.type] ?? p.type}
                  </span>
                ))}
                {strategies.filter((s) => s.id !== 'direct').map((s) => {
                  const style = getBackendStyle(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${style.color} ${style.bg}`}
                      onClick={() => onBackendClick?.(s)}
                    >
                      {s.name}
                      {s.version && <span className="opacity-60">v{s.version}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
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

function backendSubtitle(b: ComputeBackendInfo): string | null {
  const meta = b.metadata ?? {}

  // Individual SSH host
  if (b.id.startsWith('ssh:')) {
    const user = meta.user as string | undefined
    const hostname = meta.hostname as string | undefined
    const proxyJump = meta.proxyJump as string | undefined
    const parts: string[] = []
    if (user && hostname) parts.push(`${user}@${hostname}`)
    else if (hostname && hostname !== b.name) parts.push(hostname)
    if (proxyJump) parts.push(`via ${proxyJump}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  switch (b.id) {
    case 'k8s-exec': {
      const namespaces = meta.namespaces as string[] | undefined
      const ctx = meta.context as string | undefined
      const parts: string[] = []
      if (ctx) parts.push(ctx)
      if (namespaces?.length) parts.push(`${namespaces.length} namespaces`)
      return parts.length > 0 ? parts.join(' · ') : null
    }
    case 'docker': {
      const cpus = meta.cpus as number | undefined
      const memGb = meta.memoryGb as number | undefined
      const parts: string[] = []
      if (cpus) parts.push(`${cpus} CPUs`)
      if (memGb) parts.push(`${memGb}GB RAM`)
      return parts.length > 0 ? parts.join(' · ') : null
    }
    case 'slurm': {
      const clusterName = meta.clusterName as string | undefined
      const partitions = meta.partitions as unknown[] | undefined
      const parts: string[] = []
      if (clusterName) parts.push(clusterName)
      if (partitions?.length) parts.push(`${partitions.length} partitions`)
      return parts.length > 0 ? parts.join(' · ') : null
    }
    default:
      return null
  }
}

function LocalBackendsCard({ backends, onBackendClick }: { backends: ComputeBackendInfo[]; onBackendClick?: (backend: ComputeBackendInfo) => void }) {
  return (
    <Card>
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
            <Boxes className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <p className="font-medium">This Machine</p>
            <p className="text-xs text-muted-foreground">
              Backends detected on the server
            </p>
          </div>
        </div>
        <Badge className="gap-1.5 bg-success/10 text-success border-0">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Detected
        </Badge>
      </div>
      <div className="flex flex-col gap-2 px-6 pb-6">
        {backends.map((b) => {
          const style = getBackendStyle(b.id)
          const subtitle = backendSubtitle(b)
          const isSSH = b.id.startsWith('ssh:')
          const reachable = isSSH ? (b.metadata?.reachable as boolean | null) : null
          const isUnreachable = isSSH && reachable === false

          return (
            <button
              key={b.id}
              type="button"
              className={`flex items-center justify-between rounded-lg p-3 w-full text-left cursor-pointer transition-colors ${
                isUnreachable ? "bg-muted/50 opacity-60 hover:opacity-80" : "bg-muted hover:bg-muted/80"
              }`}
              onClick={() => onBackendClick?.(b)}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isUnreachable ? (
                  <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                )}
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{b.name}</span>
                    {b.version && (
                      <span className={`text-xs ${style.color}`}>v{b.version}</span>
                    )}
                  </div>
                  {subtitle && (
                    <span className="text-[11px] text-muted-foreground truncate">{subtitle}</span>
                  )}
                </div>
              </div>
              {isUnreachable ? (
                <Badge variant="secondary" className="shrink-0 ml-2">Unreachable</Badge>
              ) : isSSH ? (
                <Badge variant="warning" className="shrink-0 ml-2">SSH Only</Badge>
              ) : (
                <Badge variant="success" className="shrink-0 ml-2">Available</Badge>
              )}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

export function Environments() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedBackend, setSelectedBackend] = useState<ComputeBackendInfo | null>(null)
  const [backendContextString, setBackendContextString] = useState("")
  const [backendDialogOpen, setBackendDialogOpen] = useState(false)
  const [backendDetailLoading, setBackendDetailLoading] = useState(false)
  const fetchBackendDetail = useExecutionStore((s) => s.fetchBackendDetail)

  const handleBackendClick = (backend: ComputeBackendInfo) => {
    setSelectedBackend(backend)
    setBackendContextString("")
    setBackendDialogOpen(true)
    setBackendDetailLoading(true)
    fetchBackendDetail(backend.id).then((result) => {
      if (result) {
        setSelectedBackend(result.backend)
        setBackendContextString(result.contextString)
      }
      setBackendDetailLoading(false)
    })
  }

  const machines = useRealtimeStore((s) => s.machines)
  const realtimeConnected = useRealtimeStore((s) => s.connected)
  const connectRealtime = useRealtimeStore((s) => s.connect)

  // Check if we're in multi-tenant mode (hide "Local" in production)
  const isMultiTenant = shouldUseSupabase()

  const revokeMachine = useMachinesStore((s) => s.revokeMachine)

  // Local backends detected on server
  const localBackends = useExecutionStore((s) => s.localBackends)
  const localBackendsLoaded = useExecutionStore((s) => s.localBackendsLoaded)
  const loadLocalBackends = useExecutionStore((s) => s.loadLocalBackends)

  // Connect to real-time events on mount to receive live machine updates
  useEffect(() => {
    if (!realtimeConnected) {
      connectRealtime()
    }
  }, [realtimeConnected, connectRealtime])

  // Load local backends on mount
  useEffect(() => {
    if (!localBackendsLoaded) {
      loadLocalBackends()
    }
  }, [localBackendsLoaded, loadLocalBackends])

  const liveMachines = Array.from(machines.values())

  // Connected: machines with a live relay WebSocket connection
  const connectedLiveMachines = liveMachines.filter((m) => m.environmentType !== 'local')

  // In single-user mode, +1 for the local machine (this server)
  const localMachineCount = isMultiTenant ? 0 : 1
  const totalMachines = localMachineCount + connectedLiveMachines.length
  const connectedCount = localMachineCount + connectedLiveMachines.length
  const activeTasks = liveMachines.reduce((sum, m) => sum + m.load.activeTasks, 0)

  // Compute Backends: locally-detected execution environments only
  const availableLocalBackends = localBackends.filter((b) => b.available)
  const computeBackendCount = availableLocalBackends.length

  const handleRefresh = () => {
    loadLocalBackends()
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
          label="Compute Backends"
          value={computeBackendCount}
          icon={Boxes}
          iconBg="bg-purple-500/10"
          iconColor="text-purple-500"
        />
      </div>

      {/* Local - only show in single-user mode */}
      {!isMultiTenant && (
        <div className="flex flex-col gap-4">
          <div className="hidden md:flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Laptop className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Local</h2>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              AI providers authenticated on this machine. Agents use these credentials to run tasks locally.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LocalMachineCard />
          </div>
        </div>
      )}

      {/* Connected — only show when there are live relay machines */}
      {connectedLiveMachines.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="hidden md:flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Connected</h2>
              <Badge variant="success">{connectedLiveMachines.length} active</Badge>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              Remote machines running the agent runner with an active relay connection. Tasks can be dispatched to these machines directly.
            </p>
          </div>
          <p className="md:hidden text-sm font-semibold text-muted-foreground uppercase tracking-wider">Connected</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConnectedMachinesCard
              machines={connectedLiveMachines}
              onRemove={(id) => revokeMachine(id)}
              onBackendClick={handleBackendClick}
            />
          </div>
        </div>
      )}

      {/* Compute Backends */}
      <div className="flex flex-col gap-4">
        <div className="hidden md:flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Boxes className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Compute Backends</h2>
            {availableLocalBackends.length > 0 && (
              <Badge variant="outline">
                {availableLocalBackends.length} detected
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground ml-8">
            Execution environments detected on this server — Docker, Kubernetes, SLURM clusters, and SSH-reachable hosts. Click any backend to see details and the AI context that gets injected into agent sessions.
          </p>
        </div>
        <p className="md:hidden text-sm font-semibold text-muted-foreground uppercase tracking-wider">Compute Backends</p>
        {availableLocalBackends.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LocalBackendsCard backends={availableLocalBackends} onBackendClick={handleBackendClick} />
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Container}
                title="No compute backends detected"
                description="Connect a machine with SLURM, Docker, Kubernetes, or SkyPilot. The agent runner auto-detects available backends and injects environment context into Claude sessions."
                action={{
                  label: "Add Environment",
                  onClick: () => setDialogOpen(true),
                }}
                className="py-8"
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Environment Dialog */}
      <AddEnvironmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      {/* Backend Detail Dialog */}
      <BackendDetailDialog
        open={backendDialogOpen}
        onOpenChange={setBackendDialogOpen}
        backend={selectedBackend}
        contextString={backendContextString}
        loading={backendDetailLoading}
      />
    </div>
  )
}
