import { useState } from 'react'
import { Loader2, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useRemoteComputeStore, type CreatePoolParams, type RemoteComputeProvider } from '@/stores/remote-compute-store'
import { useConnectedAccountsStore } from '@/stores/connected-accounts-store'
import { useToastStore } from '@/stores/toast-store'
import { cn } from '@/lib/utils'

// Client-side cost estimates ($/hr per runner)
const COST_PER_RUNNER: Record<string, number> = {
  'astro-cloud': 0.08,
  'daytona': 0.05,
  'aws': 0.042,
  'gcp': 0.048,
}

function estimateCost(provider: RemoteComputeProvider, cpu: number, memoryGb: number, runners: number): number {
  const base = COST_PER_RUNNER[provider] ?? 0.08
  const scale = Math.max(1, (cpu / 2) * (memoryGb / 4))
  return base * scale * runners
}

interface ProviderOption {
  id: RemoteComputeProvider
  label: string
  description: string
  badge?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateComputePoolDialog({ open, onOpenChange }: Props) {
  const createPool = useRemoteComputeStore((s) => s.createPool)
  const getAccountsForChannel = useConnectedAccountsStore((s) => s.getAccountsForChannel)
  const addToast = useToastStore((s) => s.add)

  const hasDaytona = getAccountsForChannel('daytona').length > 0

  const providerOptions: ProviderOption[] = [
    { id: 'aws', label: 'AWS (BYOC)', description: 'Your own AWS account · uses local credentials' },
    { id: 'gcp', label: 'GCP (BYOC)', description: 'Your own GCP account · uses local credentials' },
    ...(hasDaytona ? [{ id: 'daytona' as RemoteComputeProvider, label: 'Daytona', description: 'Your connected Daytona workspace' }] : []),
  ]

  const [provider, setProvider] = useState<RemoteComputeProvider>('aws')
  const [cpu, setCpu] = useState(1)
  const [memoryGb, setMemoryGb] = useState(2)
  const [ttlMinutes, setTtlMinutes] = useState(60)
  const [runners, setRunners] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const daytonaAccount = getAccountsForChannel('daytona')[0]
  const cost = estimateCost(provider, cpu, memoryGb, runners)

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const params: CreatePoolParams = {
        provider,
        desiredRunners: runners,
        resourceProfile: { cpu, memoryGb, ttlMinutes },
        limits: { maxEstimatedHourlyCostUsd: Math.max(cost * 3, 5) },
        ...(provider === 'daytona' && daytonaAccount ? { accountId: daytonaAccount.id } : {}),
      }
      await createPool(params)
      addToast({ type: 'success', title: 'Pool created', description: 'Runner pool is provisioning and will be ready shortly.' })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pool')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Compute Pool</DialogTitle>
          <DialogDescription>
            Provision cloud runner instances for task execution.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* Provider selection */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Provider</Label>
            <div className="flex flex-col gap-2">
              {providerOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setProvider(opt.id)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    provider === opt.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:bg-muted/50'
                  )}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Server className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{opt.label}</span>
                      {opt.badge && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {opt.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                  </div>
                  <div className={cn(
                    'mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors',
                    provider === opt.id ? 'border-primary bg-primary' : 'border-border'
                  )} />
                </button>
              ))}
            </div>
          </div>

          {/* Resource profile */}
          <div className="flex flex-col gap-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Resources per runner</Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cpu" className="text-xs">vCPU</Label>
                <Input
                  id="cpu"
                  type="number"
                  min={1}
                  max={64}
                  value={cpu}
                  onChange={(e) => setCpu(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mem" className="text-xs">Memory (GB)</Label>
                <Input
                  id="mem"
                  type="number"
                  min={0.5}
                  step={0.5}
                  max={512}
                  value={memoryGb}
                  onChange={(e) => setMemoryGb(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ttl" className="text-xs">TTL (min)</Label>
                <Input
                  id="ttl"
                  type="number"
                  min={1}
                  max={1440}
                  value={ttlMinutes}
                  onChange={(e) => setTtlMinutes(Math.max(1, parseInt(e.target.value) || 60))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Runner count */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="runners" className="text-xs">Runners</Label>
            <Input
              id="runners"
              type="number"
              min={1}
              max={32}
              value={runners}
              onChange={(e) => setRunners(Math.max(1, Math.min(32, parseInt(e.target.value) || 1)))}
              className="h-8 text-sm"
            />
          </div>

          {/* Live cost estimate */}
          <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
            <span className="text-xs text-muted-foreground">Estimated cost</span>
            <span className="font-mono text-sm font-semibold">
              ~${cost.toFixed(3)}/hr total
            </span>
          </div>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Create Pool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Scale dialog — separate small dialog for changing runner count
interface ScaleDialogProps {
  poolId: string
  current: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ScalePoolDialog({ poolId, current, open, onOpenChange }: ScaleDialogProps) {
  const scalePool = useRemoteComputeStore((s) => s.scalePool)
  const addToast = useToastStore((s) => s.add)
  const [count, setCount] = useState(current)
  const [submitting, setSubmitting] = useState(false)

  const handleScale = async () => {
    setSubmitting(true)
    try {
      await scalePool(poolId, count)
      addToast({ type: 'success', title: 'Scaling pool', description: `Adjusting to ${count} runner${count !== 1 ? 's' : ''}.` })
      onOpenChange(false)
    } catch (err) {
      addToast({ type: 'error', title: 'Scale failed', description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Scale Pool</DialogTitle>
          <DialogDescription>Adjust the number of active runners.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Label htmlFor="scale-count">Runners</Label>
          <Input
            id="scale-count"
            type="number"
            min={0}
            max={32}
            value={count}
            onChange={(e) => setCount(Math.max(0, Math.min(32, parseInt(e.target.value) || 0)))}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button size="sm" onClick={handleScale} disabled={submitting || count === current}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Scale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
