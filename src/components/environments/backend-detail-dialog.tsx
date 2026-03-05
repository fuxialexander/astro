import { useState, useEffect } from "react"
import {
  Copy,
  Check,
  Server,
  Cpu,
  HardDrive,
  Container,
  Network,
  Terminal,
  Layers,
  MonitorDot,
  Pencil,
  Save,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import type { ComputeBackendInfo } from "@/stores/execution-store"
import { useEnvironmentConfigStore } from "@/stores/environment-config-store"
import { useToastStore } from "@/stores/toast-store"

interface BackendDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  backend: ComputeBackendInfo | null
  contextString: string
  loading: boolean
  machineId?: string
}

export function BackendDetailDialog({
  open,
  onOpenChange,
  backend,
  contextString,
  loading,
  machineId,
}: BackendDetailDialogProps) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const { getForBackend, upsert, remove, load, loaded } = useEnvironmentConfigStore()
  const addToast = useToastStore((s) => s.add)

  useEffect(() => {
    if (open && !loaded) load()
    if (!open) {
      setEditing(false)
      setDraft("")
    }
  }, [open, loaded, load])

  const config = backend ? getForBackend(backend.id, machineId) : undefined
  const configId = config?.id
  const configCustomContext = config?.customContext

  useEffect(() => {
    if (configCustomContext !== undefined) setDraft(configCustomContext)
    else setDraft("")
  }, [configId, configCustomContext])

  const handleCopy = () => {
    const fullContext = config?.customContext
      ? `${contextString}\n\n--- Custom Instructions ---\n${config.customContext}`
      : contextString
    navigator.clipboard.writeText(fullContext)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSave = async () => {
    if (!backend) return
    setSaving(true)
    try {
      if (draft.trim()) {
        await upsert(backend.id, machineId, draft.trim())
      } else if (config) {
        await remove(config.id)
      }
      setEditing(false)
    } catch (err) {
      console.error('[backend-detail] Failed to save custom context:', err)
      addToast({ type: "error", title: "Failed to save custom instructions" })
    } finally {
      setSaving(false)
    }
  }

  if (!backend) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-hidden flex flex-col [display:flex]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <BackendIcon id={backend.id} />
            {backend.name}
            {backend.version && (
              <span className="text-sm font-normal text-muted-foreground">
                v{backend.version}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {backendDescription(backend.id, backend.metadata as Record<string, unknown> | undefined)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <div className="flex flex-col gap-5 pb-4">
            {/* Summary stats */}
            <SummarySection backend={backend} loading={loading} />

            {/* Agent Context — combined auto-detected + custom */}
            {(contextString || config?.customContext) && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Agent Context</h3>
                  <div className="flex items-center gap-1">
                    {!editing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => {
                          if (!config?.customContext && backend) {
                            setDraft(generateTemplate(backend))
                          }
                          setEditing(true)
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={handleCopy}
                    >
                      {copied ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>

                {editing ? (
                  <div className="flex flex-col gap-2">
                    {/* Auto-detected context (read-only) */}
                    {contextString && (
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground/60 leading-relaxed">
                          {contextString}
                        </pre>
                      </div>
                    )}
                    {contextString && (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <div className="h-px flex-1 bg-border" />
                        <span>Custom Instructions</span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Add custom instructions for this environment..."
                      className="min-h-[120px] font-mono text-xs"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => {
                          setDraft(config?.customContext ?? "")
                          setEditing(false)
                        }}
                      >
                        <X className="h-3 w-3" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        <Save className="h-3 w-3" />
                        {saving ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/50 p-3">
                    {contextString && (
                      <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
                        {contextString}
                      </pre>
                    )}
                    {config?.customContext && (
                      <>
                        {contextString && <div className="my-2 border-t border-border/50" />}
                        <div className="border-l-2 border-primary/30 pl-3">
                          <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
                            {config.customContext}
                          </pre>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {!editing && !config?.customContext && (
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline text-left"
                    onClick={() => {
                      if (backend) setDraft(generateTemplate(backend))
                      setEditing(true)
                    }}
                  >
                    + Add custom instructions
                  </button>
                )}

                {/* Link to curated skills in skills-lib */}
                <SkillsLibHint />
              </div>
            )}

            {/* Show edit-only section if no context string exists yet */}
            {!contextString && !config?.customContext && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Agent Context</h3>
                  {!editing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => {
                        if (backend) setDraft(generateTemplate(backend))
                        setEditing(true)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Button>
                  )}
                </div>
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Add custom instructions for this environment..."
                      className="min-h-[120px] font-mono text-xs"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => {
                          setDraft(config?.customContext ?? "")
                          setEditing(false)
                        }}
                      >
                        <X className="h-3 w-3" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        <Save className="h-3 w-3" />
                        {saving ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    No context available. Click Edit to add SSH details, module loads, sbatch templates, or other environment-specific context for agents.
                  </p>
                )}
              </div>
            )}

            {/* Detail section per type */}
            <DetailSection backend={backend} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Skills-lib hint per backend type
// ---------------------------------------------------------------------------

function SkillsLibHint() {
  return (
    <p className="text-[11px] text-muted-foreground">
      To help agents understand your specific compute backend, consider adding a customized skill. See{" "}
      <a
        href="https://github.com/astro-anywhere/skills-lib/tree/main/compute_backend"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
      >
        examples
      </a>.
    </p>
  )
}

// ---------------------------------------------------------------------------
// Template generator
// ---------------------------------------------------------------------------

function generateTemplate(backend: ComputeBackendInfo): string {
  const meta = (backend.metadata ?? {}) as Record<string, unknown>

  if (backend.id === "slurm") {
    const clusterName = meta.clusterName as string | undefined
    const partitions = meta.partitions as Array<{
      name: string; isDefault?: boolean; maxTime?: string
    }> | undefined
    const accounts = meta.accounts as string[] | undefined
    const totalGpus = meta.totalGpus as number | undefined

    const defaultPartition = partitions?.find((p) => p.isDefault) ?? partitions?.[0]
    const lines: string[] = []

    lines.push("# SSH Access")
    lines.push(clusterName ? `# ssh ${clusterName}` : "# ssh <cluster-alias>")
    lines.push("")
    lines.push("# Module Loads")
    lines.push("# module load cuda/12.1")
    lines.push("# module load anaconda3")
    lines.push("")
    lines.push("# Default sbatch Resources")
    if (defaultPartition) {
      const parts = [`--partition=${defaultPartition.name}`]
      if (defaultPartition.maxTime) parts.push(`--time=${defaultPartition.maxTime}`)
      parts.push("--mem=64G")
      if (totalGpus && totalGpus > 0) parts.push("--gres=gpu:1")
      if (accounts?.[0]) parts.push(`--account=${accounts[0]}`)
      lines.push(`# ${parts.join(" ")}`)
    } else {
      lines.push("# --partition=short --time=12:00:00 --mem=64G")
    }
    lines.push("")
    lines.push("# Data & Paths")
    lines.push("# Project data: /path/to/data")
    lines.push("# Scratch: /scratch/$USER")
    lines.push("")
    lines.push("# Network Notes")
    lines.push("# Compute nodes have no internet access.")
    lines.push("# Install dependencies on the login node first.")

    return lines.join("\n")
  }

  if (backend.id.startsWith("ssh:")) {
    const alias = meta.alias as string | undefined
    const hostname = meta.hostname as string | undefined
    const user = meta.user as string | undefined
    const connectTarget = alias ?? (user && hostname ? `${user}@${hostname}` : hostname ?? "<host>")
    const viaNote = alias && (user && hostname)
      ? ` (via ${user}@${hostname})`
      : alias && hostname && hostname !== alias
        ? ` (via ${hostname})`
        : ""

    const lines: string[] = []
    lines.push("# Connection")
    lines.push(`# ssh ${connectTarget}${viaNote}`)
    lines.push("")
    lines.push("# Environment Setup")
    lines.push("# (module loads, conda activate, etc.)")
    lines.push("")
    lines.push("# Paths")
    lines.push("# Working directory: ~")

    return lines.join("\n")
  }

  if (backend.id === "docker") {
    return [
      "# Docker Environment",
      "# Default image: <image:tag>",
      "",
      "# Volume Mounts",
      "# -v /host/path:/container/path",
      "",
      "# Resource Limits",
      "# --gpus all --memory 16g",
    ].join("\n")
  }

  if (backend.id === "k8s-exec") {
    const context = meta.context as string | undefined
    return [
      "# Kubernetes Environment",
      context ? `# Context: ${context}` : "# Context: <cluster-context>",
      "",
      "# Default Namespace",
      "# kubectl config set-context --current --namespace=<ns>",
      "",
      "# Resource Requests",
      "# cpu: 4, memory: 16Gi",
    ].join("\n")
  }

  // Generic fallback
  return [
    "# Environment Notes",
    "# Add any setup instructions, paths, or constraints for this environment.",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function BackendIcon({ id }: { id: string }) {
  const className = "h-5 w-5"
  if (id.startsWith("ssh:")) return <Terminal className={className} />
  switch (id) {
    case "k8s-exec":
      return <Network className={className} />
    case "docker":
      return <Container className={className} />
    case "slurm":
      return <Layers className={className} />
    default:
      return <Server className={className} />
  }
}

function backendDescription(id: string, meta?: Record<string, unknown>): string {
  if (id.startsWith("ssh:")) {
    const hostname = meta?.hostname as string | undefined
    const user = meta?.user as string | undefined
    const target = user && hostname ? `${user}@${hostname}` : hostname
    return target ? `Remote host via SSH (${target})` : "Remote host via SSH"
  }
  switch (id) {
    case "k8s-exec":
      return "Kubernetes cluster accessible via kubectl"
    case "docker":
      return "Docker engine on this machine"
    case "slurm":
      return "HPC cluster managed by Slurm scheduler"
    default:
      return "Compute backend"
  }
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function MiniStat({ label, value, icon: Icon }: {
  label: string
  value: string | number
  icon: typeof Server
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3 min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] text-muted-foreground truncate">{label}</span>
      </div>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  )
}

function SummarySection({ backend, loading }: { backend: ComputeBackendInfo; loading: boolean }) {
  const meta = backend.metadata ?? {}

  if (loading && Object.keys(meta).length === 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[68px] rounded-lg border bg-muted animate-pulse" />
        ))}
      </div>
    )
  }

  // Individual SSH host
  if (backend.id.startsWith("ssh:")) {
    const hostname = meta.hostname as string ?? "-"
    const user = meta.user as string ?? "-"
    const reachable = meta.reachable as boolean | null
    const reachableLabel = reachable === true ? "Yes" : reachable === false ? "No" : "Unknown"
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MiniStat label="Hostname" value={hostname} icon={Network} />
        <MiniStat label="User" value={user} icon={Terminal} />
        <MiniStat label="Reachable" value={reachableLabel} icon={Server} />
      </div>
    )
  }

  switch (backend.id) {
    case "k8s-exec": {
      const totalNodes = (meta.totalNodes as number) ?? (meta.nodes as unknown[])?.length ?? 0
      const totalCPU = meta.totalCPU as number ?? 0
      const totalMemoryGi = meta.totalMemoryGi as number ?? 0
      const totalGPUs = meta.totalGPUs as number ?? 0
      const podCount = meta.podCount as number ?? 0
      const podsByNamespace = meta.podsByNamespace as Record<string, number> | undefined

      if (totalNodes === 0 && podCount > 0) {
        const nsCount = podsByNamespace ? Object.keys(podsByNamespace).length : 0
        return (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MiniStat label="Running Pods" value={podCount} icon={Container} />
              <MiniStat label="Namespaces" value={nsCount} icon={Network} />
              <MiniStat label="Nodes" value="N/A" icon={Server} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Node-level details not available (RBAC restricted or nodes auto-scaled to zero)
            </p>
          </div>
        )
      }

      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniStat label="Nodes" value={totalNodes} icon={Server} />
          <MiniStat label="Total CPUs" value={totalCPU} icon={Cpu} />
          <MiniStat label="Memory" value={`${totalMemoryGi}Gi`} icon={HardDrive} />
          <MiniStat label="GPUs" value={totalGPUs} icon={MonitorDot} />
        </div>
      )
    }

    case "docker": {
      const cpus = meta.cpus as number ?? 0
      const memoryGb = meta.memoryGb as number ?? 0
      const running = meta.runningContainers as number ?? 0
      const images = (meta.images as unknown[])?.length ?? 0
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniStat label="CPUs" value={cpus} icon={Cpu} />
          <MiniStat label="Memory" value={`${memoryGb}GB`} icon={HardDrive} />
          <MiniStat label="Running" value={running} icon={Container} />
          <MiniStat label="Images" value={images} icon={Layers} />
        </div>
      )
    }

    case "slurm": {
      const partitions = (meta.partitions as unknown[])?.length ?? 0
      const accounts = (meta.accounts as unknown[])?.length ?? 0
      const qos = (meta.qos as unknown[])?.length ?? 0
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <MiniStat label="Partitions" value={partitions} icon={Layers} />
          <MiniStat label="Accounts" value={accounts} icon={Server} />
          <MiniStat label="QOS Levels" value={qos} icon={Cpu} />
        </div>
      )
    }

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Detail section
// ---------------------------------------------------------------------------

function DetailSection({ backend }: { backend: ComputeBackendInfo }) {
  const meta = backend.metadata ?? {}

  if (backend.id.startsWith("ssh:")) {
    return <SSHHostDetail meta={meta} />
  }

  switch (backend.id) {
    case "k8s-exec":
      return <K8sDetail meta={meta} />
    case "docker":
      return <DockerDetail meta={meta} />
    case "slurm":
      return <SlurmDetail meta={meta} />
    default:
      return null
  }
}

// --- K8s ---

function K8sDetail({ meta }: { meta: Record<string, unknown> }) {
  const nodes = meta.nodes as Array<{
    name: string; status: string; cpu: string; memory: string; gpus: number
  }> | undefined
  const namespaces = meta.namespaces as string[] | undefined
  const context = meta.context as string | undefined
  const podsByNamespace = meta.podsByNamespace as Record<string, number> | undefined
  const hasNodes = nodes && nodes.length > 0
  const hasPodFallback = !hasNodes && podsByNamespace && Object.keys(podsByNamespace).length > 0

  return (
    <div className="flex flex-col gap-4">
      {context && (
        <div className="text-xs text-muted-foreground">
          Context: <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">{context}</code>
        </div>
      )}

      {hasPodFallback && (
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border border-info/20 bg-info/5 p-3">
            <p className="text-xs text-info">
              Node listing may be restricted by RBAC or nodes may be auto-scaled to zero.
              Showing pod-level data instead.
            </p>
          </div>
        </div>
      )}

      {hasNodes && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Nodes</h3>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left font-medium p-2 pl-3">Name</th>
                      <th className="text-left font-medium p-2">Status</th>
                      <th className="text-right font-medium p-2">CPU</th>
                      <th className="text-right font-medium p-2">Memory</th>
                      <th className="text-right font-medium p-2 pr-3">GPUs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((n) => (
                      <tr key={n.name} className="border-b last:border-0">
                        <td className="p-2 pl-3 font-mono">{n.name}</td>
                        <td className="p-2">
                          <Badge variant={n.status === "Ready" ? "success" : "warning"} className="text-[10px]">
                            {n.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-right">{n.cpu}</td>
                        <td className="p-2 text-right">{n.memory}</td>
                        <td className="p-2 pr-3 text-right">{n.gpus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {hasPodFallback && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Pods by Namespace</h3>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left font-medium p-2 pl-3">Namespace</th>
                      <th className="text-right font-medium p-2 pr-3">Pods</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(podsByNamespace)
                      .sort(([, a], [, b]) => b - a)
                      .map(([ns, count]) => (
                        <tr key={ns} className="border-b last:border-0">
                          <td className="p-2 pl-3 font-mono">{ns}</td>
                          <td className="p-2 pr-3 text-right">{count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!hasPodFallback && namespaces && namespaces.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Namespaces</h3>
          <div className="flex flex-wrap gap-1.5">
            {namespaces.map((ns) => (
              <Badge key={ns} variant="outline" className="text-[11px] font-mono">
                {ns}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Docker ---

function DockerDetail({ meta }: { meta: Record<string, unknown> }) {
  const osArch = meta.osArch as string | undefined
  const images = meta.images as Array<{
    repository: string; tag: string; size: string
  }> | undefined

  return (
    <div className="flex flex-col gap-4">
      {osArch && (
        <div className="text-xs text-muted-foreground">
          Platform: <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">{osArch}</code>
        </div>
      )}

      {images && images.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Images</h3>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left font-medium p-2 pl-3">Repository</th>
                      <th className="text-left font-medium p-2">Tag</th>
                      <th className="text-right font-medium p-2 pr-3">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {images.map((img, i) => (
                      <tr key={`${img.repository}-${img.tag}-${i}`} className="border-b last:border-0">
                        <td className="p-2 pl-3 font-mono truncate max-w-[200px]">{img.repository}</td>
                        <td className="p-2">{img.tag}</td>
                        <td className="p-2 pr-3 text-right">{img.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// --- SLURM ---

function SlurmDetail({ meta }: { meta: Record<string, unknown> }) {
  const clusterName = meta.clusterName as string | undefined
  const partitions = meta.partitions as Array<{
    name: string; isDefault?: boolean; features?: string
  }> | undefined
  const accounts = meta.accounts as string[] | undefined
  const qos = meta.qos as string[] | undefined
  const defaultPartition = partitions?.find((p) => p.isDefault)

  return (
    <div className="flex flex-col gap-4">
      {clusterName && (
        <div className="text-xs text-muted-foreground">
          Cluster: <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">{clusterName}</code>
        </div>
      )}

      {partitions && partitions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Partitions ({partitions.length})</h3>
          <div className="flex flex-wrap gap-1.5">
            {partitions.map((p) => (
              <Badge
                key={p.name}
                variant={p.isDefault ? "default" : "outline"}
                className="text-[11px]"
              >
                {p.name}{p.features ? ` [${p.features}]` : ""}
              </Badge>
            ))}
          </div>
          {defaultPartition && (
            <p className="text-[11px] text-muted-foreground">
              Default: <code className="font-mono bg-muted px-1 py-0.5 rounded">{defaultPartition.name}</code>
            </p>
          )}
        </div>
      )}

      {accounts && accounts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Accounts</h3>
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => (
              <Badge key={a} variant="outline" className="text-[11px]">{a}</Badge>
            ))}
          </div>
        </div>
      )}

      {qos && qos.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">QOS Levels</h3>
          <div className="flex flex-wrap gap-1.5">
            {qos.map((q) => (
              <Badge key={q} variant="outline" className="text-[11px]">{q}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Individual SSH Host ---

function SSHHostDetail({ meta }: { meta: Record<string, unknown> }) {
  const alias = meta.alias as string | undefined
  const hostname = meta.hostname as string | undefined
  const user = meta.user as string | undefined
  const port = meta.port as number | undefined
  const identityFile = meta.identityFile as string | undefined
  const proxyJump = meta.proxyJump as string | undefined
  const source = meta.source as string | undefined
  const reachable = meta.reachable as boolean | null | undefined

  // Build the ssh command for display
  const parts = ["ssh"]
  if (port && port !== 22) parts.push("-p", String(port))
  if (identityFile) parts.push("-i", identityFile)
  if (proxyJump) parts.push("-J", proxyJump)
  const target = user ? `${user}@${hostname}` : (hostname ?? alias ?? "")
  parts.push(target)
  const sshCommand = parts.join(" ")

  return (
    <div className="flex flex-col gap-4">
      {/* Connection details */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Connection Details</h3>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y text-xs">
              <DetailRow label="Alias" value={alias} mono />
              <DetailRow label="Hostname" value={hostname} mono />
              <DetailRow label="User" value={user} />
              <DetailRow label="Port" value={port && port !== 22 ? String(port) : "22 (default)"} />
              {proxyJump && <DetailRow label="ProxyJump" value={proxyJump} mono />}
              {identityFile && <DetailRow label="Identity File" value={identityFile} mono />}
              <DetailRow label="Source" value={source ?? "ssh-config"} />
              <DetailRow
                label="Reachable"
                value={reachable === true ? "Yes" : reachable === false ? "No" : "Unknown (behind proxy)"}
                badge={reachable === true ? "success" : reachable === false ? "secondary" : "warning"}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick connect command */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Connect Command</h3>
        <div className="rounded-lg border bg-muted/50 p-3">
          <code className="text-xs font-mono text-muted-foreground">{sshCommand}</code>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono, badge }: {
  label: string
  value?: string
  mono?: boolean
  badge?: "success" | "secondary" | "warning"
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      {badge ? (
        <Badge variant={badge} className="text-[10px]">{value ?? "-"}</Badge>
      ) : (
        <span className={mono ? "font-mono" : ""}>{value ?? "-"}</span>
      )}
    </div>
  )
}
