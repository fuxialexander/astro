import { useEffect, useRef, useState } from "react"
import {
  Server,
  Monitor,
  Activity,
  Wifi,
  RefreshCw,
  Plus,
  Globe,
  CheckCircle2,
  XCircle,
  Trash2,
  Boxes,
  Container,
  Pencil,
  Check,
  X,
  ScrollText,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useRealtimeStore, type MachineEntry } from "@/stores/realtime-store"
import { useMachinesStore, type RegisteredMachine } from "@/stores/machines-store"
import { useExecutionStore, type ComputeBackendInfo } from "@/stores/execution-store"
import { useMachineInstructionStore } from "@/stores/machine-instruction-store"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { AddEnvironmentDialog } from "@/components/environments/add-environment-dialog"
import { BackendDetailDialog } from "@/components/environments/backend-detail-dialog"
import { MachineDetailDialog } from "@/components/environments/machine-detail-dialog"
import { InstructionPicker } from "@/components/execution/instruction-picker"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { isServerMode } from "@/lib/app-mode"
import { formatRelativeTime } from "@/lib/date-utils"
import { compactGpuName } from "@/lib/utils"
import { useToastStore } from "@/stores/toast-store"
import { PROVIDER_NAMES as providerDisplayName } from "@/components/execution/provider-utils"
import type { MachineInstruction } from "@/types"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"

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
  slurm: { color: "text-primary", bg: "bg-primary/10" },
  docker: { color: "text-info", bg: "bg-info/10" },
  "k8s-exec": { color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-100 dark:bg-sky-900/30" },
  ssh: { color: "text-teal-700 dark:text-teal-400", bg: "bg-teal-50 dark:bg-teal-900/25" },
}

function getBackendStyle(id: string) {
  if (id.startsWith('ssh:')) return backendStyleMap.ssh!
  return backendStyleMap[id] ?? backendStyleMap.direct!
}

function formatResourceSummary(resources?: MachineEntry["resources"]): string | null {
  if (!resources) return null
  const parts: string[] = []
  parts.push(`${resources.cpuCores} CPUs`)
  const memGb = Math.round(resources.memoryMB / 1024)
  parts.push(`${memGb}GB RAM`)
  if (resources.gpuCount && resources.gpuCount > 0) {
    const gpuMemGb = resources.gpuMemoryMB ? Math.round(resources.gpuMemoryMB / 1024) : null
    const gpuLabel = resources.gpuType ? compactGpuName(resources.gpuType) : 'GPU'
    parts.push(`${resources.gpuCount}× ${gpuLabel}${gpuMemGb ? ` (${gpuMemGb}GB)` : ""}`)
  }
  return parts.join(" · ")
}

function InlineMachineName({ machineId, name, fallback }: {
  machineId: string
  name: string
  fallback: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name || fallback)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameMachine = useMachinesStore((s) => s.renameMachine)

  const displayName = name || fallback

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation()
    setValue(displayName)
    setEditing(true)
  }

  const save = async () => {
    const trimmed = value.trim()
    setEditing(false)
    if (trimmed && trimmed !== displayName) {
      await renameMachine(machineId, trimmed)
    }
  }

  const cancel = () => {
    setEditing(false)
    setValue(displayName)
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="text-sm font-medium bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-ring min-w-0 w-full"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save()
          if (e.key === "Escape") cancel()
        }}
        onClick={(e) => e.stopPropagation()}
      />
    )
  }

  return (
    <button
      type="button"
      className="group/name inline-flex items-center gap-1 min-w-0 text-left"
      onClick={startEditing}
    >
      <span className="text-sm font-medium truncate">{displayName}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/name:opacity-100 shrink-0 transition-opacity" />
    </button>
  )
}

function ConnectedMachineCard({ machine, onRemove, onMachineClick, onAssignInstruction }: {
  machine: MachineEntry
  onRemove?: (machineId: string) => void
  onMachineClick?: (machine: MachineEntry) => void
  onAssignInstruction?: (machineId: string, instructionId: string | null) => void
}) {
  const loadPercent = Math.round(machine.load.cpuPercent)
  const loadColor = loadPercent > 75 ? "bg-warning" : "bg-info"
  const resourceSummary = formatResourceSummary(machine.resources)
  const registeredMachine = useMachinesStore((s) => s.machines.find((m) => m.id === machine.machineId))

  return (
    <Card
      className="cursor-pointer hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.1)] transition-shadow duration-200"
      onClick={() => onMachineClick?.(machine)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onMachineClick?.(machine) }}
    >
      <div className="flex flex-col gap-3 p-4">
        {/* Name + status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-2 w-2 rounded-full bg-teal-500 shrink-0" />
            <InlineMachineName machineId={machine.machineId} name={machine.name} fallback={machine.machineId} />
            {onAssignInstruction && (
              <div className="relative shrink-0">
                <InstructionPicker
                  currentInstructionId={registeredMachine?.defaultInstructionId}
                  onSelect={(id) => onAssignInstruction(machine.machineId, id)}
                />
              </div>
            )}
          </div>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive hidden md:flex"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(machine.machineId)
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Resources */}
        {resourceSummary && (
          <span className="text-[11px] text-muted-foreground truncate">{resourceSummary}</span>
        )}

        {/* Load bar */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">{loadPercent}% CPU</span>
          <div className="flex-1 h-1 rounded-sm bg-muted overflow-hidden">
            <div
              className={`h-full rounded-sm ${loadColor} transition-all duration-500`}
              style={{ width: `${Math.min(loadPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Provider badges */}
        <div className="flex flex-wrap gap-1">
          {machine.providers.map((p) => (
            <span
              key={p.type}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                p.status === "available"
                  ? "text-success bg-success/10"
                  : "text-muted-foreground bg-muted/50"
              }`}
            >
              {providerDisplayName[p.type] ?? p.type}
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}

function RegisteredMachinesCard({ machines, liveMachineIds, onRefresh }: {
  machines: RegisteredMachine[]
  liveMachineIds: Set<string>
  onRefresh: () => void
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const revokeMachine = useMachinesStore((s) => s.revokeMachine)

  // Filter to only offline machines (not in the live relay set)
  const offlineMachines = machines.filter((m) => !liveMachineIds.has(m.id) && !m.isRevoked)

  if (offlineMachines.length === 0) return null

  const handleDelete = async (id: string) => {
    const ok = await revokeMachine(id)
    if (ok) {
      setConfirmingId(null)
      onRefresh()
    }
  }

  return (
    <Card className="opacity-70">
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Server className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">Registered</p>
            <p className="text-xs text-muted-foreground">
              {offlineMachines.length} registered machine{offlineMachines.length !== 1 ? "s" : ""} not currently online
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          {offlineMachines.length} offline
        </Badge>
      </div>
      <div className="flex flex-col gap-2 px-6 pb-6">
        <p className="text-xs text-muted-foreground px-1">
          Run <code className="font-mono bg-muted px-1 rounded text-[11px]">astro-agent start</code> on each machine to bring it online.
        </p>
        {offlineMachines.map((machine) => (
          <div
            key={machine.id}
            className="flex items-center justify-between rounded-xl bg-muted/30 p-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
              <div className="flex flex-col gap-0 min-w-0">
                <InlineMachineName machineId={machine.id} name={machine.name} fallback={machine.hostname || machine.id} />
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {machine.hostname && <span className="truncate">{machine.hostname}</span>}
                  {machine.platform && (
                    <>
                      {machine.hostname && <span>·</span>}
                      <span>{machine.platform}</span>
                    </>
                  )}
                  {machine.lastSeenAt && (
                    <>
                      <span>·</span>
                      <span>Last seen {formatRelativeTime(new Date(machine.lastSeenAt))}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="shrink-0 ml-2">
              {confirmingId === machine.id ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-1">Remove?</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(machine.id)}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => setConfirmingId(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmingId(machine.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
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
      const totalGpus = meta.totalGpus as number | undefined
      const gpuNodeCount = meta.gpuNodeCount as number | undefined
      const parts: string[] = []
      if (clusterName) parts.push(clusterName)
      if (partitions?.length) parts.push(`${partitions.length} partitions`)
      if (totalGpus) parts.push(`${totalGpus} GPUs`)
      else if (gpuNodeCount) parts.push(`${gpuNodeCount} GPU nodes`)
      return parts.length > 0 ? parts.join(' · ') : null
    }
    default:
      return null
  }
}

function LocalBackendsCard({ backends, onBackendClick, title, subtitle }: { backends: ComputeBackendInfo[]; onBackendClick?: (backend: ComputeBackendInfo) => void; title?: string; subtitle?: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Boxes className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">{title ?? "This Machine"}</p>
            <p className="text-xs text-muted-foreground">
              {subtitle ?? "Backends detected on the server"}
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
              className={`flex items-center justify-between rounded-xl p-3 w-full text-left cursor-pointer transition-all duration-200 ${
                isUnreachable ? "bg-muted/30 opacity-60 hover:opacity-80" : "bg-muted/50 hover:bg-muted/80"
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
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="warning" className="shrink-0 ml-2">SSH Only</Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Discovery only — not a dispatch target. Install the agent runner on this host to enable task execution.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
  const [selectedMachineId, setSelectedMachineId] = useState<string | undefined>()
  const [selectedMachine, setSelectedMachine] = useState<RegisteredMachine | null>(null)
  const [machineDetailDialogOpen, setMachineDetailDialogOpen] = useState(false)
  const [detailLiveMachine, setDetailLiveMachine] = useState<MachineEntry | undefined>(undefined)
  const [confirmingUnregister, setConfirmingUnregister] = useState<{ machineId: string; name: string } | null>(null)
  const fetchRemoteBackendDetail = useExecutionStore((s) => s.fetchRemoteBackendDetail)
  const addToast = useToastStore((s) => s.add)

  // Fetch backend detail from the relay's machine registry (unified path for all modes)
  const handleRemoteBackendClick = (backend: ComputeBackendInfo, machineId: string) => {
    setSelectedBackend(backend)
    setSelectedMachineId(machineId)
    setBackendContextString("")
    setBackendDialogOpen(true)
    setBackendDetailLoading(true)
    fetchRemoteBackendDetail(machineId, backend.id).then((result) => {
      if (result) {
        setSelectedBackend(result.backend)
        setBackendContextString(result.contextString)
      }
    }).catch((err) => {
      console.error('[environments] Failed to fetch backend detail:', err)
    }).finally(() => {
      setBackendDetailLoading(false)
    })
  }

  const machines = useRealtimeStore((s) => s.machines)
  const realtimeConnected = useRealtimeStore((s) => s.connected)
  const connectRealtime = useRealtimeStore((s) => s.connect)

  // Check if we're in multi-tenant mode
  const isMultiTenant = isServerMode()

  const revokeMachine = useMachinesStore((s) => s.revokeMachine)
  const registeredMachines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)

  // Machine instructions
  const miInstructions = useMachineInstructionStore((s) => s.instructions)
  const miPresets = useMachineInstructionStore((s) => s.presets)
  const miLoaded = useMachineInstructionStore((s) => s.loaded)
  const miLoad = useMachineInstructionStore((s) => s.load)
  const miCreate = useMachineInstructionStore((s) => s.create)
  const miUpdate = useMachineInstructionStore((s) => s.update)
  const miRemove = useMachineInstructionStore((s) => s.remove)
  const miAssign = useMachineInstructionStore((s) => s.assignToMachine)

  const [editingInstruction, setEditingInstruction] = useState<MachineInstruction | null>(null)
  const [creatingInstruction, setCreatingInstruction] = useState(false)
  const [instructionForm, setInstructionForm] = useState({ name: "", content: "", tags: "" })
  const [expandedInstructionId, setExpandedInstructionId] = useState<string | null>(null)
  const [deletingInstructionId, setDeletingInstructionId] = useState<string | null>(null)

  // Connect to real-time events on mount to receive live machine updates
  useEffect(() => {
    if (!realtimeConnected) {
      connectRealtime()
    }
  }, [realtimeConnected, connectRealtime])

  // Fetch registered machines on mount (multi-tenant only)
  useEffect(() => {
    if (isMultiTenant) {
      fetchMachines()
    }
  }, [isMultiTenant, fetchMachines])

  // Load machine instructions
  useEffect(() => {
    if (!miLoaded) miLoad()
  }, [miLoaded, miLoad])

  const liveMachines = Array.from(machines.values())

  // Connected: all machines with a live relay WebSocket connection.
  // In multi-tenant mode, filter to only show machines that belong to
  // the current user's team (registered machines are already team-scoped).
  const registeredMachineIds = new Set(registeredMachines.filter((m) => !m.isRevoked).map((m) => m.id))
  const connectedLiveMachines = isMultiTenant
    ? liveMachines.filter((m) => registeredMachineIds.has(m.machineId))
    : liveMachines
  const liveMachineIds = new Set(connectedLiveMachines.map((m) => m.machineId))

  // Count registered-but-offline machines
  const offlineRegisteredCount = isMultiTenant
    ? registeredMachines.filter((m) => !liveMachineIds.has(m.id) && !m.isRevoked).length
    : 0

  const totalMachines = connectedLiveMachines.length + offlineRegisteredCount
  const connectedCount = connectedLiveMachines.length
  const activeTasks = liveMachines.reduce((sum, m) => sum + m.load.activeTasks, 0)

  // Compute Backends: all backends come from connected machines' execution strategies
  const backendsByMachine = connectedLiveMachines
    .map((m) => ({
      machineId: m.machineId,
      machineName: m.name || m.machineId,
      backends: (m.executionStrategies ?? []).filter((s) => s.available && s.id !== 'direct'),
    }))
    .filter((g) => g.backends.length > 0)
  const computeBackendCount = backendsByMachine.reduce((sum, g) => sum + g.backends.length, 0)

  const handleRefresh = () => {
    if (!realtimeConnected) connectRealtime()
    if (isMultiTenant) fetchMachines()
  }

  const handleMachineClick = (liveMachine: MachineEntry) => {
    // Find registered machine data for this live machine
    const registered = registeredMachines.find((m) => m.id === liveMachine.machineId)
    if (registered) {
      setSelectedMachine(registered)
    } else {
      // Build a minimal RegisteredMachine from live data for display
      setSelectedMachine({
        id: liveMachine.machineId,
        name: liveMachine.name || liveMachine.machineId,
        hostname: liveMachine.machineId,
        platform: 'unknown',
        providers: liveMachine.providers.map((p) => p.type),
        registeredAt: '',
        lastSeenAt: new Date().toISOString(),
        isConnected: true,
        isRevoked: false,
      })
    }
    setDetailLiveMachine(liveMachine)
    setMachineDetailDialogOpen(true)
  }

  const openCreateInstruction = () => {
    setEditingInstruction(null)
    setInstructionForm({ name: "", content: "", tags: "" })
    setCreatingInstruction(true)
  }

  const openEditInstruction = (instruction: MachineInstruction) => {
    setEditingInstruction(instruction)
    setInstructionForm({
      name: instruction.name,
      content: instruction.content,
      tags: instruction.tags.join(", "),
    })
    setCreatingInstruction(true)
  }

  const handleSaveInstruction = async () => {
    const name = instructionForm.name.trim()
    if (!name) return
    const tags = instructionForm.tags.split(",").map((t) => t.trim()).filter(Boolean)
    try {
      if (editingInstruction) {
        await miUpdate(editingInstruction.id, { name, content: instructionForm.content, tags })
      } else {
        await miCreate({ name, content: instructionForm.content, tags })
      }
      setCreatingInstruction(false)
      setEditingInstruction(null)
    } catch (err) {
      addToast({ type: "error", title: "Failed to save instruction", description: err instanceof Error ? err.message : "Unknown error" })
    }
  }

  const handleDeleteInstruction = async (id: string) => {
    try {
      await miRemove(id)
      setDeletingInstructionId(null)
    } catch (err) {
      addToast({ type: "error", title: "Failed to delete instruction", description: err instanceof Error ? err.message : "Unknown error" })
    }
  }

  const handleAssignInstruction = async (machineId: string, instructionId: string | null) => {
    try {
      await miAssign(machineId, instructionId)
    } catch (err) {
      addToast({ type: "error", title: "Failed to assign instruction", description: err instanceof Error ? err.message : "Unknown error" })
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 md:px-10 max-w-[1100px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-primary font-semibold">Environments</h1>
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
          iconBg="bg-info/10"
          iconColor="text-info"
        />
        <StatCard
          label="Connected"
          value={connectedCount}
          icon={Wifi}
          iconBg="bg-teal-600/8 dark:bg-teal-500/10"
          iconColor="text-teal-700 dark:text-teal-400"
        />
        <StatCard
          label="Active Tasks"
          value={activeTasks}
          icon={Activity}
          iconBg="bg-info/10"
          iconColor="text-info"
        />
        <StatCard
          label="Compute Backends"
          value={computeBackendCount}
          icon={Boxes}
          iconBg="bg-primary/10"
          iconColor="text-primary"
        />
      </div>

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {connectedLiveMachines.map((machine) => (
              <ConnectedMachineCard
                key={machine.machineId}
                machine={machine}
                onRemove={(id) => setConfirmingUnregister({ machineId: id, name: machine.name || machine.machineId })}
                onMachineClick={handleMachineClick}
                onAssignInstruction={handleAssignInstruction}
              />
            ))}
          </div>
        </div>
      )}

      {/* Registered (offline) — multi-tenant only */}
      {isMultiTenant && registeredMachines.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="hidden md:flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Registered</h2>
              {offlineRegisteredCount > 0 && (
                <Badge variant="secondary">{offlineRegisteredCount} offline</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              Previously connected machines not currently online. Remove stale entries you no longer need.
            </p>
          </div>
          <p className="md:hidden text-sm font-semibold text-muted-foreground uppercase tracking-wider">Registered</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RegisteredMachinesCard
              machines={registeredMachines}
              liveMachineIds={liveMachineIds}
              onRefresh={fetchMachines}
            />
          </div>
        </div>
      )}

      {/* Machine Instructions */}
      <div className="flex flex-col gap-4">
        <div className="hidden md:flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <ScrollText className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Machine Instructions</h2>
            {miInstructions.length > 0 && (
              <Badge variant="outline">{miInstructions.length}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground ml-8">
            Markdown documents that tell AI agents how to run computation on specific environments. Assign an instruction to a machine using the <ScrollText className="inline h-3 w-3" /> icon.
          </p>
        </div>
        <p className="md:hidden text-sm font-semibold text-muted-foreground uppercase tracking-wider">Machine Instructions</p>

        {/* Built-in presets */}
        {miPresets.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground font-medium">Built-in presets</span>
            <Card>
              <div className="flex flex-col divide-y">
                {miPresets.map((preset) => {
                  const isExpanded = expandedInstructionId === preset.id
                  return (
                    <div key={preset.id} className="flex flex-col">
                      <button
                        type="button"
                        className="flex items-center gap-3 p-4 w-full text-left hover:bg-muted/50 transition-colors"
                        onClick={() => setExpandedInstructionId(isExpanded ? null : preset.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{preset.name}</span>
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">built-in</Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{preset.description}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4">
                          <div className="rounded-lg bg-muted/50 p-3 text-sm leading-relaxed max-h-[300px] overflow-y-auto">
                            {preset.content
                              ? <MarkdownRenderer content={preset.content} className="text-xs" />
                              : <span className="text-muted-foreground italic">No content</span>
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        )}

        {/* User-created instructions */}
        {miInstructions.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground font-medium">Custom instructions</span>
            <Card>
              <div className="flex flex-col divide-y">
                {miInstructions.map((instruction) => {
                  const isExpanded = expandedInstructionId === instruction.id
                  const isDeleting = deletingInstructionId === instruction.id
                  return (
                    <div key={instruction.id} className="flex flex-col">
                      <button
                        type="button"
                        className="flex items-center gap-3 p-4 w-full text-left hover:bg-muted/50 transition-colors"
                        onClick={() => setExpandedInstructionId(isExpanded ? null : instruction.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{instruction.name}</span>
                            {instruction.source === 'auto' && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0">auto</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {instruction.tags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                            {instruction.content && (
                              <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                                {instruction.content.slice(0, 60)}{instruction.content.length > 60 ? "…" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isDeleting ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <span className="text-xs text-muted-foreground mr-1">Delete?</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteInstruction(instruction.id)}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDeletingInstructionId(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={(e) => { e.stopPropagation(); openEditInstruction(instruction) }}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeletingInstructionId(instruction.id) }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4">
                          <div className="rounded-lg bg-muted/50 p-3 text-sm leading-relaxed max-h-[300px] overflow-y-auto">
                            {instruction.content
                              ? <MarkdownRenderer content={instruction.content} className="text-xs" />
                              : <span className="text-muted-foreground italic">No content</span>
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        ) : miPresets.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={ScrollText}
                title="No instructions yet"
                description="Create instructions that tell AI agents how to run computation jobs — include specific commands, namespaces, or resource constraints."
                action={{
                  label: "Create Instruction",
                  onClick: openCreateInstruction,
                }}
                className="py-8"
              />
            </CardContent>
          </Card>
        ) : null}

        <Button variant="outline" size="sm" className="w-fit" onClick={openCreateInstruction}>
          <Plus className="h-3.5 w-3.5" />
          Create Instruction
        </Button>
      </div>

      {/* Compute Backends */}
      <div className="flex flex-col gap-4">
        <div className="hidden md:flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Boxes className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Compute Backends</h2>
            {computeBackendCount > 0 && (
              <Badge variant="outline">
                {computeBackendCount} detected
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground ml-8">
            Execution environments detected by agent runners on each connected machine. Click any backend to see details and the AI context that gets injected into agent sessions.
          </p>
        </div>
        <p className="md:hidden text-sm font-semibold text-muted-foreground uppercase tracking-wider">Compute Backends</p>
        {backendsByMachine.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {backendsByMachine.map((group) => (
              <LocalBackendsCard
                key={group.machineId}
                backends={group.backends}
                title={group.machineName}
                subtitle={`${group.backends.length} backend${group.backends.length !== 1 ? 's' : ''} detected`}
                onBackendClick={(b) => handleRemoteBackendClick(b, group.machineId)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Container}
                title="No compute backends detected"
                description="Connect a machine with the agent runner. It auto-detects available backends (SLURM, Docker, Kubernetes, SSH hosts) and reports them here."
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
        machineId={selectedMachineId}
      />

      {/* Machine Detail Dialog */}
      <MachineDetailDialog
        open={machineDetailDialogOpen}
        onOpenChange={setMachineDetailDialogOpen}
        machine={selectedMachine}
        liveMachine={detailLiveMachine}
      />

      {/* Create/Edit Instruction Dialog */}
      <Dialog open={creatingInstruction} onOpenChange={(open) => { if (!open) { setCreatingInstruction(false); setEditingInstruction(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingInstruction ? "Edit Instruction" : "Create Instruction"}</DialogTitle>
            <DialogDescription>
              Keep instructions succinct — tell the agent how to run computation jobs from this machine. Include specific commands, namespaces, partitions, or resource constraints the agent should know about.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Name</label>
              <input
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="e.g., Kubernetes Execution"
                value={instructionForm.name}
                onChange={(e) => setInstructionForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Tags</label>
              <input
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="e.g., kubernetes, k8s, gpu (comma-separated)"
                value={instructionForm.tags}
                onChange={(e) => setInstructionForm((f) => ({ ...f, tags: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Content (Markdown)</label>
              <textarea
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring font-mono min-h-[200px] resize-y"
                placeholder="# How to run jobs on this machine&#10;&#10;Use `kubectl exec` to..."
                value={instructionForm.content}
                onChange={(e) => setInstructionForm((f) => ({ ...f, content: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setCreatingInstruction(false); setEditingInstruction(null) }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveInstruction} disabled={!instructionForm.name.trim()}>
              {editingInstruction ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unregister confirmation dialog */}
      <Dialog open={!!confirmingUnregister} onOpenChange={(open) => { if (!open) setConfirmingUnregister(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unregister Machine</DialogTitle>
            <DialogDescription>
              Are you sure you want to unregister{" "}
              <span className="font-medium text-foreground">{confirmingUnregister?.name}</span>?
              The machine will need to re-authenticate to reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmingUnregister(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirmingUnregister) {
                  revokeMachine(confirmingUnregister.machineId)
                  setConfirmingUnregister(null)
                }
              }}
            >
              Unregister
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
