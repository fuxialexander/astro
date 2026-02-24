import { useState } from "react"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ComputeBackendInfo } from "@/stores/execution-store"

interface BackendDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  backend: ComputeBackendInfo | null
  contextString: string
  loading: boolean
}

export function BackendDetailDialog({
  open,
  onOpenChange,
  backend,
  contextString,
  loading,
}: BackendDetailDialogProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(contextString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!backend) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col">
        <DialogHeader>
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

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="flex flex-col gap-5 pb-4">
            {/* Summary stats */}
            <SummarySection backend={backend} loading={loading} />

            {/* Detail section per type */}
            <DetailSection backend={backend} />

            {/* AI Context Preview */}
            {contextString && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">AI Context Preview</h3>
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
                <div className="rounded-lg border bg-muted/50 p-3">
                  <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
                    {contextString}
                  </pre>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This text is injected into agent sessions so the AI knows your compute environment.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
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
    name: string; isDefault?: boolean; available?: boolean; maxTime?: string; nodes?: number; features?: string
  }> | undefined
  const accounts = meta.accounts as string[] | undefined
  const qos = meta.qos as string[] | undefined

  return (
    <div className="flex flex-col gap-4">
      {clusterName && (
        <div className="text-xs text-muted-foreground">
          Cluster: <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">{clusterName}</code>
        </div>
      )}

      {partitions && partitions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Partitions</h3>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left font-medium p-2 pl-3">Name</th>
                      <th className="text-left font-medium p-2">Status</th>
                      <th className="text-right font-medium p-2">Nodes</th>
                      <th className="text-left font-medium p-2">Max Time</th>
                      <th className="text-left font-medium p-2 pr-3">Features</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partitions.map((p) => (
                      <tr key={p.name} className="border-b last:border-0">
                        <td className="p-2 pl-3 font-mono">
                          {p.name}
                          {p.isDefault && (
                            <Badge variant="outline" className="ml-1.5 text-[10px]">default</Badge>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant={p.available ? "success" : "secondary"} className="text-[10px]">
                            {p.available ? "up" : "down"}
                          </Badge>
                        </td>
                        <td className="p-2 text-right">{p.nodes ?? "-"}</td>
                        <td className="p-2">{p.maxTime ?? "-"}</td>
                        <td className="p-2 pr-3 text-muted-foreground">{p.features ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
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
