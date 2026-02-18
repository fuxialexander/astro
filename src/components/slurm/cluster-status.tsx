/**
 * Slurm Cluster Status Component
 *
 * Displays the status of connected HPC clusters with Slurm.
 */

import { useEffect } from "react"
import {
  Server,
  Cpu,
  HardDrive,
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useSlurmStore, type SlurmCluster } from "@/stores/slurm-store"

interface ClusterStatusProps {
  compact?: boolean
  showPartitions?: boolean
}

export function ClusterStatus({ compact = false, showPartitions = false }: ClusterStatusProps) {
  const clusters = useSlurmStore((s) => s.clusters)
  const loading = useSlurmStore((s) => s.loading)
  const fetchClusters = useSlurmStore((s) => s.fetchClusters)
  const getTotalGpuCount = useSlurmStore((s) => s.getTotalGpuCount)
  const getAvailableGpuCount = useSlurmStore((s) => s.getAvailableGpuCount)

  useEffect(() => {
    fetchClusters()
    // Refresh every 30 seconds
    const interval = setInterval(fetchClusters, 30000)
    return () => clearInterval(interval)
  }, [fetchClusters])

  const connectedClusters = clusters.filter(c => c.connectionStatus === 'connected')
  const totalGpus = getTotalGpuCount()
  const availableGpus = getAvailableGpuCount()

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : connectedClusters.length > 0 ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-warning" />
              )}
              <span className="text-xs text-muted-foreground">
                {loading
                  ? "Checking..."
                  : connectedClusters.length > 0
                    ? `${connectedClusters.length} cluster${connectedClusters.length > 1 ? 's' : ''}`
                    : "No clusters"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {connectedClusters.length > 0
              ? `Connected to ${connectedClusters.map(c => c.name).join(', ')}`
              : "No HPC clusters connected"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">HPC Clusters</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchClusters}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary stats */}
      {connectedClusters.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted p-2 text-center">
            <p className="text-lg font-bold">{connectedClusters.length}</p>
            <p className="text-xs text-muted-foreground">Clusters</p>
          </div>
          <div className="rounded-lg bg-muted p-2 text-center">
            <p className="text-lg font-bold">
              {connectedClusters.reduce((sum, c) => sum + c.load.activeTasks, 0)}
            </p>
            <p className="text-xs text-muted-foreground">Active Jobs</p>
          </div>
          <div className="rounded-lg bg-muted p-2 text-center">
            <p className="text-lg font-bold">
              {availableGpus}/{totalGpus}
            </p>
            <p className="text-xs text-muted-foreground">GPUs Free</p>
          </div>
        </div>
      )}

      {/* Cluster list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading clusters...
        </div>
      ) : clusters.length === 0 ? (
        <div className="rounded-lg bg-muted p-4 text-center">
          <Server className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">No HPC Clusters</p>
          <p className="text-xs text-muted-foreground mt-1">
            Connect a cluster by running the Astro CLI on a login node
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {clusters.map((cluster) => (
            <ClusterCard
              key={cluster.machineId}
              cluster={cluster}
              showPartitions={showPartitions}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ClusterCardProps {
  cluster: SlurmCluster
  showPartitions?: boolean
}

function ClusterCard({ cluster, showPartitions }: ClusterCardProps) {
  const isConnected = cluster.connectionStatus === 'connected'
  const isAvailable = cluster.provider.status === 'available'

  return (
    <Card className={!isConnected ? "opacity-60" : ""}>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className={`h-4 w-4 ${isConnected ? "text-primary" : "text-muted-foreground"}`} />
            <CardTitle className="text-sm font-medium">{cluster.name}</CardTitle>
          </div>
          <Badge
            variant={isConnected && isAvailable ? "success" : isConnected ? "warning" : "secondary"}
          >
            {isConnected && isAvailable
              ? "Ready"
              : isConnected
                ? "Busy"
                : "Disconnected"}
          </Badge>
        </div>
        {cluster.hostname && (
          <p className="text-xs text-muted-foreground">{cluster.hostname}</p>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {/* Resource usage */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">CPU:</span>
            <span>{Math.round(cluster.load.cpuPercent)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Mem:</span>
            <span>{Math.round(cluster.load.memoryPercent)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Jobs:</span>
            <span>
              {cluster.load.activeTasks}
              {cluster.load.queuedTasks > 0 && ` (+${cluster.load.queuedTasks} queued)`}
            </span>
          </div>
          {cluster.provider.version && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Slurm:</span>
              <span>v{cluster.provider.version}</span>
            </div>
          )}
        </div>

        {/* Partitions */}
        {showPartitions && cluster.clusterInfo?.partitions && (
          <div className="mt-3 pt-2 border-t">
            <p className="text-xs font-medium mb-1">Partitions</p>
            <div className="flex flex-wrap gap-1">
              {cluster.clusterInfo.partitions.slice(0, 5).map((partition) => (
                <Badge
                  key={partition.name}
                  variant={partition.isDefault ? "default" : "secondary"}
                  className="text-[10px]"
                >
                  {partition.name}
                  {partition.gpuInfo && ` (${partition.gpuInfo.availableGpus}/${partition.gpuInfo.totalGpus} GPUs)`}
                </Badge>
              ))}
              {cluster.clusterInfo.partitions.length > 5 && (
                <Badge variant="outline" className="text-[10px]">
                  +{cluster.clusterInfo.partitions.length - 5} more
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
