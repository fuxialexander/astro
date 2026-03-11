import { useEffect, useState } from 'react'
import { Clock, Play, Trash2, Pencil, ToggleLeft, ToggleRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useScheduleStore } from '@/stores/schedule-store'
import { ScheduleForm } from './schedule-form'
import { RunHistory } from './run-history'
import type { Schedule } from '@/types'

interface ScheduleListProps {
  projectId: string
}

export function ScheduleList({ projectId }: ScheduleListProps) {
  const { schedules, loading, loadSchedules, deleteSchedule, updateSchedule, triggerSchedule } =
    useScheduleStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    loadSchedules(projectId)
  }, [projectId, loadSchedules])

  if (loading && schedules.length === 0) {
    return <div className="text-sm text-muted-foreground py-4 text-center">Loading schedules...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Schedules</h3>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
          <Clock className="h-3.5 w-3.5 mr-1.5" />
          New Schedule
        </Button>
      </div>

      {showCreate && (
        <div className="border rounded-lg p-4">
          <ScheduleForm
            projectId={projectId}
            scope="project"
            onSave={() => {
              setShowCreate(false)
              loadSchedules(projectId)
            }}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {schedules.length === 0 && !showCreate && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No schedules configured. Create one to run tasks on a recurring basis.
        </div>
      )}

      {schedules.map((schedule) => (
        <div key={schedule.id} className="border rounded-lg">
          {editingId === schedule.id ? (
            <div className="p-4">
              <ScheduleForm
                projectId={projectId}
                scope={schedule.scope}
                nodeId={schedule.nodeId ?? undefined}
                schedule={schedule}
                onSave={() => {
                  setEditingId(null)
                  loadSchedules(projectId)
                }}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
            <ScheduleRow
              schedule={schedule}
              isExpanded={expandedId === schedule.id}
              onToggleExpand={() => setExpandedId(expandedId === schedule.id ? null : schedule.id)}
              onEdit={() => setEditingId(schedule.id)}
              onDelete={() => deleteSchedule(schedule.id)}
              onToggle={() => updateSchedule(schedule.id, { enabled: !schedule.enabled })}
              onTrigger={() => triggerSchedule(schedule.id)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function ScheduleRow({
  schedule,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggle,
  onTrigger,
}: {
  schedule: Schedule
  isExpanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onTrigger: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between p-3">
        <button
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          onClick={onToggleExpand}
        >
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{schedule.name}</span>
              <Badge variant={schedule.enabled ? 'default' : 'secondary'} className="text-[10px]">
                {schedule.enabled ? 'active' : 'paused'}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {schedule.scope}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
              <code className="bg-muted px-1 rounded">{schedule.cronExpression}</code>
              <span>{schedule.timezone}</span>
              {schedule.nextRunAt && (
                <span>Next: {new Date(schedule.nextRunAt).toLocaleString()}</span>
              )}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onTrigger} title="Run now">
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle} title={schedule.enabled ? 'Pause' : 'Enable'}>
            {schedule.enabled ? (
              <ToggleRight className="h-3.5 w-3.5" />
            ) : (
              <ToggleLeft className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t px-3 py-2">
          <RunHistory scheduleId={schedule.id} />
        </div>
      )}
    </div>
  )
}
