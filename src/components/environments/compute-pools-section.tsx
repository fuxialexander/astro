import { useEffect, useState } from 'react'
import { Cloud, Plus, Zap, CheckCircle2, XCircle, HelpCircle, Settings, Lock } from 'lucide-react'
import { Link } from 'react-router'
import { isDesktop as getIsDesktop } from '@/lib/desktop-detect'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { useRemoteComputeStore, type RemoteComputePool, type RemoteComputeProvider, type ProviderDetection } from '@/stores/remote-compute-store'
import { useToastStore } from '@/stores/toast-store'
import { CreateComputePoolDialog, ScalePoolDialog } from '@/components/environments/create-compute-pool-dialog'
import { ConnectLocalCloudDialog } from '@/components/environments/connect-local-cloud-dialog'
import { formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

const PROVIDER_COLORS: Record<RemoteComputeProvider, string> = {
  'astro-cloud': 'text-primary',
  'aws': 'text-[#FF9900]',
  'gcp': 'text-[#4285F4]',
  'daytona': 'text-[#6366F1]',
  'runloop': 'text-emerald-500',
}

const PROVIDER_BG: Record<RemoteComputeProvider, string> = {
  'astro-cloud': 'bg-primary/10',
  'aws': 'bg-[#FF9900]/10',
  'gcp': 'bg-[#4285F4]/10',
  'daytona': 'bg-[#6366F1]/10',
  'runloop': 'bg-emerald-500/10',
}

const PROVIDER_LABELS: Record<RemoteComputeProvider, string> = {
  'astro-cloud': 'Astro Cloud',
  'aws': 'AWS',
  'gcp': 'GCP',
  'daytona': 'Daytona',
  'runloop': 'Runloop',
}

const PULSING_STATUSES = new Set(['provisioning', 'scaling', 'terminating'])

function StatusDot({ status }: { status: RemoteComputePool['status'] }) {
  const color =
    status === 'active' ? 'bg-emerald-500' :
    status === 'failed' ? 'bg-destructive' :
    status === 'terminated' ? 'bg-muted-foreground' :
    'bg-amber-400'

  return (
    <span className={cn(
      'inline-block h-2 w-2 rounded-full shrink-0',
      color,
      PULSING_STATUSES.has(status) && 'animate-pulse'
    )} />
  )
}

interface PoolCardProps {
  pool: RemoteComputePool
}

function PoolCard({ pool }: PoolCardProps) {
  const terminatePool = useRemoteComputeStore((s) => s.terminatePool)
  const addToast = useToastStore((s) => s.add)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [terminating, setTerminating] = useState(false)
  const onDesktop = getIsDesktop()
  const isLocalPool = pool.provisionerType === 'local'
  // Locally-provisioned pools can only be managed from the device that holds
  // the credentials. On web (or another desktop without those creds) we hide
  // the live controls — the store would also throw, but disabling the buttons
  // is clearer.
  const lifecycleDisabled = isLocalPool && !onDesktop

  const handleTerminate = async () => {
    setTerminating(true)
    try {
      await terminatePool(pool.id)
      addToast({ type: 'success', title: 'Pool terminating', description: 'Runner pool is shutting down.' })
    } catch (err) {
      addToast({ type: 'error', title: 'Terminate failed', description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setTerminating(false)
    }
  }

  const { cpu, memoryGb, ttlMinutes } = pool.resourceProfile
  const hourlyCost = pool.costMetadata.estimatedHourlyCostUsd

  const isTerminated = pool.status === 'terminated' || pool.status === 'terminating'

  return (
    <>
      <div className={cn(
        'flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-opacity',
        isTerminated && 'opacity-50'
      )}>
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          PROVIDER_BG[pool.provider]
        )}>
          <Cloud className={cn('h-4 w-4', PROVIDER_COLORS[pool.provider])} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-xs font-semibold', PROVIDER_COLORS[pool.provider])}>
              {PROVIDER_LABELS[pool.provider]}
            </span>
            {isLocalPool && (
              <Lock
                className="h-3 w-3 text-emerald-500 shrink-0"
                aria-label="Provisioned from this device using local credentials"
              />
            )}
            <StatusDot status={pool.status} />
            <span className="text-xs text-muted-foreground capitalize">{pool.status}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
              ×{pool.activeRunners}/{pool.desiredRunners}
            </Badge>
            {hourlyCost != null && (
              <span className="text-[10px] font-mono text-muted-foreground">
                ${hourlyCost.toFixed(3)}/hr
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {cpu != null && <span className="text-[11px] font-mono text-muted-foreground">{cpu} vCPU</span>}
            {memoryGb != null && <span className="text-[11px] font-mono text-muted-foreground">{memoryGb} GB</span>}
            {ttlMinutes != null && <span className="text-[11px] font-mono text-muted-foreground">TTL {ttlMinutes}m</span>}
            {pool.expiresAt && (
              <span className="text-[11px] text-muted-foreground">
                · expires {formatRelativeTime(new Date(pool.expiresAt))}
              </span>
            )}
            {pool.error && (
              <span className="text-[11px] text-destructive truncate max-w-[200px]" title={pool.error}>
                {pool.error}
              </span>
            )}
          </div>
        </div>

        {!isTerminated && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setScaleOpen(true)}
              disabled={lifecycleDisabled}
              title={lifecycleDisabled ? 'Scale from the desktop app that created this pool' : undefined}
            >
              Scale
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={handleTerminate}
              disabled={terminating || lifecycleDisabled}
              title={lifecycleDisabled ? 'Terminate from the desktop app that created this pool' : undefined}
            >
              Terminate
            </Button>
          </div>
        )}
      </div>

      <ScalePoolDialog
        poolId={pool.id}
        current={pool.desiredRunners}
        open={scaleOpen}
        onOpenChange={setScaleOpen}
      />
    </>
  )
}

interface ProviderRowProps {
  label: string
  detection: ProviderDetection | null
  isDesktop: boolean
  setupHint: React.ReactNode
  action?: React.ReactNode
}

function ProviderRow({ label, detection, isDesktop, setupHint, action }: ProviderRowProps) {
  const detected = detection?.detected
  const connectedLocally = detection?.connectedLocally === true

  const icon = connectedLocally
    ? <Lock className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
    : detected === true
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
    : detected === false
    ? <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    : <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />

  const statusLabel = connectedLocally
    ? <span className="text-[11px] text-emerald-500">configured locally</span>
    : detected === true
    ? <span className="text-[11px] text-emerald-500">detected</span>
    : detected === false
    ? <span className="text-[11px] text-muted-foreground">not configured</span>
    : !isDesktop
    ? <span className="text-[11px] text-muted-foreground/60">unknown — desktop app only</span>
    : null

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium">{label}</span>
          {statusLabel}
        </div>
        {detected === false && (
          <div className="mt-1 text-[11px] text-muted-foreground">{setupHint}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function ByocGuideCard() {
  const detection = useRemoteComputeStore((s) => s.detection)
  const detectionLoaded = useRemoteComputeStore((s) => s.detectionLoaded)
  const detect = useRemoteComputeStore((s) => s.detect)
  const onDesktop = getIsDesktop()
  const [connectProvider, setConnectProvider] = useState<'aws' | 'gcp' | null>(null)

  useEffect(() => {
    if (!detectionLoaded) detect()
  }, [detectionLoaded, detect])

  const isDesktop = detection?.isDesktop ?? false

  const showConnect = (p: 'aws' | 'gcp'): boolean => {
    if (!onDesktop) return false
    const row = detection?.providers[p]
    return row?.detected === true && row.connectedLocally !== true
  }

  const connectButton = (p: 'aws' | 'gcp') =>
    showConnect(p)
      ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() => setConnectProvider(p)}
        >
          <Settings className="h-3 w-3" />Connect
        </Button>
      )
      : null

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Bring Your Own Cloud
      </p>
      <div className="flex flex-col divide-y divide-border/50">
        <ProviderRow
          label="Daytona"
          detection={detection?.providers.daytona ?? null}
          isDesktop={isDesktop}
          setupHint={<>Add your API key in <Link to="/settings?tab=connected-accounts" className="underline underline-offset-2">Settings → Connected Accounts</Link></>}
          action={
            detection?.providers.daytona.detected === false
              ? <Button asChild variant="ghost" size="sm" className="h-6 text-xs gap-1"><Link to="/settings?tab=connected-accounts"><Settings className="h-3 w-3" />Connect</Link></Button>
              : null
          }
        />
        <ProviderRow
          label="AWS"
          detection={detection?.providers.aws ?? null}
          isDesktop={isDesktop}
          setupHint={<>Run <code className="font-mono">aws configure</code> or set <code className="font-mono">AWS_ACCESS_KEY_ID</code> in your environment</>}
          action={connectButton('aws')}
        />
        <ProviderRow
          label="GCP"
          detection={detection?.providers.gcp ?? null}
          isDesktop={isDesktop}
          setupHint={<>Run <code className="font-mono">gcloud auth application-default login</code></>}
          action={connectButton('gcp')}
        />
      </div>
      {!isDesktop && (
        <p className="mt-2 text-[10px] text-muted-foreground/60">
          AWS/GCP credential detection requires the desktop app — credentials live on your machine, not the server.
        </p>
      )}

      {connectProvider && (
        <ConnectLocalCloudDialog
          provider={connectProvider}
          open={connectProvider !== null}
          onOpenChange={(open) => { if (!open) setConnectProvider(null) }}
        />
      )}
    </div>
  )
}

export function ComputePoolsSection() {
  const pools = useRemoteComputeStore((s) => s.pools)
  const loading = useRemoteComputeStore((s) => s.loading)
  const loaded = useRemoteComputeStore((s) => s.loaded)
  const load = useRemoteComputeStore((s) => s.load)
  const detectionLoaded = useRemoteComputeStore((s) => s.detectionLoaded)
  const detect = useRemoteComputeStore((s) => s.detect)
  const [createOpen, setCreateOpen] = useState(false)
  const onDesktop = getIsDesktop()

  useEffect(() => {
    if (!loaded) load()
    if (!detectionLoaded) detect()
  }, [loaded, load, detectionLoaded, detect])

  const activePools = pools.filter((p) => p.status !== 'terminated')
  const hasByoc = activePools.some((p) => p.provider !== 'astro-cloud')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Compute Pools</h2>
            {activePools.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {activePools.length} active
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            Cloud runner instances for parallel task execution.
          </p>
        </div>
        {onDesktop && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New Pool
          </Button>
        )}
      </div>

      {loading && !loaded ? (
        <div className="text-xs text-muted-foreground py-4 text-center">Loading pools…</div>
      ) : activePools.length === 0 ? (
        <div className="flex flex-col gap-3">
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Cloud}
                title="No compute pools"
                description="Create an Astro Cloud pool or provision runners on your own cloud account."
                className="py-6"
              />
            </CardContent>
          </Card>
          <ByocGuideCard />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {activePools.map((pool) => (
            <PoolCard key={pool.id} pool={pool} />
          ))}
          {!hasByoc && <ByocGuideCard />}
        </div>
      )}

      <CreateComputePoolDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
