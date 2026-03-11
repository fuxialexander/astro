import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { useScheduleStore } from '@/stores/schedule-store'

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  dispatched: 'secondary',
  running: 'default',
  success: 'default',
  failure: 'destructive',
  missed: 'secondary',
}

interface RunHistoryProps {
  scheduleId: string
}

export function RunHistory({ scheduleId }: RunHistoryProps) {
  const runs = useScheduleStore((s) => s.runs[scheduleId] || [])
  const loadRuns = useScheduleStore((s) => s.loadRuns)

  useEffect(() => {
    loadRuns(scheduleId)
  }, [scheduleId, loadRuns])

  if (runs.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-3 text-center">
        No runs yet
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground mb-2">Run History</div>
      {runs.map((run) => (
        <div
          key={run.id}
          className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-muted/50"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground">#{run.runNumber}</span>
            <Badge variant={STATUS_VARIANTS[run.status] || 'outline'} className="text-[10px]">
              {run.status}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>
              {new Date(run.scheduledAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {run.startedAt && run.completedAt && (
              <span>
                {Math.round(
                  (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
                )}s
              </span>
            )}
            {run.errorMessage && (
              <span className="text-destructive truncate max-w-[200px]" title={run.errorMessage}>
                {run.errorMessage}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
