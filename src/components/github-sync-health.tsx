/**
 * GitHub Sync Health Dashboard
 *
 * Shows sync health metrics for a GitHub-linked project:
 * - Last successful sync with relative time
 * - 24h sync count with success/error breakdown
 * - Recent error log table
 * - Retry failed syncs button
 */

import { useState, useCallback, useMemo } from 'react'
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useToastStore } from '@/stores/toast-store'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import { cn } from '@/lib/utils'
import { useSyncHealth } from '@/hooks/use-sync-health'

// ── Types ──────────────────────────────────────────────────────────

interface SyncError {
  id: string
  nodeId: string | null
  direction: string
  action: string
  errorMessage: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface SyncHealthData {
  health: 'healthy' | 'degraded' | 'failing' | 'unknown'
  lastSuccessAt: string | null
  stats24h: {
    total: number
    success: number
    errors: number
  }
  recentErrors: SyncError[]
}

// ── Helpers ────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

function healthColor(health: SyncHealthData['health']): string {
  switch (health) {
    case 'healthy': return 'text-emerald-500'
    case 'degraded': return 'text-amber-500'
    case 'failing': return 'text-red-500'
    default: return 'text-muted-foreground'
  }
}

function healthBg(health: SyncHealthData['health']): string {
  switch (health) {
    case 'healthy': return 'bg-emerald-500'
    case 'degraded': return 'bg-amber-500'
    case 'failing': return 'bg-red-500'
    default: return 'bg-muted-foreground'
  }
}

function healthLabel(health: SyncHealthData['health']): string {
  switch (health) {
    case 'healthy': return 'Healthy'
    case 'degraded': return 'Degraded'
    case 'failing': return 'Failing'
    default: return 'No data'
  }
}

function HealthIcon({ health }: { health: SyncHealthData['health'] }) {
  switch (health) {
    case 'healthy': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    case 'degraded': return <AlertTriangle className="h-4 w-4 text-amber-500" />
    case 'failing': return <XCircle className="h-4 w-4 text-red-500" />
    default: return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === 'github_to_astro') {
    return <ArrowDownLeft className="h-3 w-3 text-muted-foreground" />
  }
  return <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
}

// ── Status Indicator Dot ───────────────────────────────────────────

interface SyncHealthDotProps {
  projectId: string | undefined
  className?: string
}

/**
 * Small colored dot that indicates sync health status.
 * Green = healthy, Yellow = degraded, Red = failing, Gray = no data.
 */
export function SyncHealthDot({ projectId, className }: SyncHealthDotProps) {
  const { data } = useSyncHealth(projectId)
  const health = data?.health ?? 'unknown'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-block h-2 w-2 rounded-full', healthBg(health), className)} />
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-xs">
          Sync: {healthLabel(health)}
          {data?.lastSuccessAt && ` (last: ${relativeTime(data.lastSuccessAt)})`}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

// ── Dashboard Panel ────────────────────────────────────────────────

interface SyncHealthDashboardProps {
  projectId: string
}

/**
 * Full sync health dashboard panel for the GitHub sync settings.
 */
export function SyncHealthDashboard({ projectId }: SyncHealthDashboardProps) {
  const { data, loading, error, refresh } = useSyncHealth(projectId)
  const [retrying, setRetrying] = useState(false)

  const handleRetryFailed = useCallback(async () => {
    if (!data?.recentErrors.length) return
    setRetrying(true)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`

      // Retry each failed sync that has a nodeId (Astro→GitHub direction)
      const retryableErrors = data.recentErrors.filter(
        (e) => e.nodeId && e.direction === 'astro_to_github'
      )

      let successCount = 0
      for (const err of retryableErrors) {
        try {
          const res = await fetch(apiUrl('/api/github/issues/sync-fields'), {
            method: 'POST',
            headers,
            body: JSON.stringify({ nodeId: err.nodeId }),
          })
          if (res.ok) successCount++
        } catch {
          // Continue retrying others
        }
      }

      useToastStore.getState().add({
        type: successCount > 0 ? 'success' : 'error',
        title: successCount > 0
          ? `Retried ${successCount}/${retryableErrors.length} failed syncs`
          : 'No syncs could be retried',
      })

      // Refresh health data
      await refresh()
    } catch (err) {
      useToastStore.getState().add({
        type: 'error',
        title: 'Retry failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setRetrying(false)
    }
  }, [data, refresh])

  const retryableCount = useMemo(
    () => data?.recentErrors.filter((e) => e.nodeId && e.direction === 'astro_to_github').length ?? 0,
    [data]
  )

  if (error) {
    return (
      <div className="text-sm text-muted-foreground p-4 text-center">
        Failed to load sync health data.{' '}
        <button onClick={refresh} className="text-primary underline">Retry</button>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center p-6">
        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  const { health, lastSuccessAt, stats24h, recentErrors } = data

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HealthIcon health={health} />
          <span className={cn('text-sm font-medium', healthColor(health))}>
            {healthLabel(health)}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="h-7 px-2">
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 space-y-1">
          <p className="text-xs text-muted-foreground">Last sync</p>
          <p className="text-sm font-medium">
            {lastSuccessAt ? relativeTime(lastSuccessAt) : 'Never'}
          </p>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <p className="text-xs text-muted-foreground">24h syncs</p>
          <p className="text-sm font-medium">{stats24h.total}</p>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <p className="text-xs text-muted-foreground">24h errors</p>
          <p className={cn('text-sm font-medium', stats24h.errors > 0 ? 'text-red-500' : '')}>
            {stats24h.errors}
          </p>
        </div>
      </div>

      {/* Success/error bar */}
      {stats24h.total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{stats24h.success} successful</span>
            <span>{stats24h.errors} failed</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
            <div
              className="bg-emerald-500 h-full transition-all"
              style={{ width: `${(stats24h.success / stats24h.total) * 100}%` }}
            />
            <div
              className="bg-red-500 h-full transition-all"
              style={{ width: `${(stats24h.errors / stats24h.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Error log */}
      {recentErrors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Recent Errors
            </h4>
            {retryableCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryFailed}
                disabled={retrying}
                className="h-6 text-xs px-2"
              >
                <RefreshCw className={cn('h-3 w-3 mr-1', retrying && 'animate-spin')} />
                Retry ({retryableCount})
              </Button>
            )}
          </div>
          <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
            {recentErrors.map((err) => (
              <div key={err.id} className="px-3 py-2 text-xs space-y-0.5">
                <div className="flex items-center gap-2">
                  <DirectionIcon direction={err.direction} />
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {err.action}
                  </Badge>
                  <span className="text-muted-foreground ml-auto">
                    {relativeTime(err.createdAt)}
                  </span>
                </div>
                {err.errorMessage && (
                  <p className="text-red-500/80 truncate" title={err.errorMessage}>
                    {err.errorMessage}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
