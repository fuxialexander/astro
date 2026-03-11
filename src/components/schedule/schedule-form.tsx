import { useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useScheduleStore } from '@/stores/schedule-store'
import { useMachinesStore } from '@/stores/machines-store'
import type { Schedule } from '@/types'

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 9 AM', value: '0 9 * * *' },
  { label: 'Weekly (Monday 9 AM)', value: '0 9 * * 1' },
  { label: 'Custom', value: 'custom' },
]

const MISSED_RUN_POLICIES = [
  { label: 'Skip', value: 'skip' as const },
  { label: 'Retry on reconnect', value: 'retry_on_reconnect' as const },
]

interface ScheduleFormProps {
  projectId: string
  scope: 'project' | 'node'
  nodeId?: string
  schedule?: Schedule
  onSave?: () => void
  onCancel?: () => void
}

export function ScheduleForm({
  projectId,
  scope,
  nodeId,
  schedule,
  onSave,
  onCancel,
}: ScheduleFormProps) {
  const createSchedule = useScheduleStore((s) => s.createSchedule)
  const updateSchedule = useScheduleStore((s) => s.updateSchedule)
  const machines = useMachinesStore((s) => s.machines)

  const [name, setName] = useState(schedule?.name || '')
  const [cronPreset, setCronPreset] = useState<string>(() => {
    if (!schedule) return '0 0 * * *'
    const match = CRON_PRESETS.find((p) => p.value === schedule.cronExpression)
    return match ? schedule.cronExpression : 'custom'
  })
  const [customCron, setCustomCron] = useState(schedule?.cronExpression || '')
  const [timezone, setTimezone] = useState(schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [targetMachineId, setTargetMachineId] = useState(schedule?.targetMachineId || '')
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)
  const [activeHoursStart, setActiveHoursStart] = useState(schedule?.activeHoursStart || '')
  const [activeHoursEnd, setActiveHoursEnd] = useState(schedule?.activeHoursEnd || '')
  const [maxConcurrency, setMaxConcurrency] = useState(schedule?.maxConcurrency ?? 1)
  const [missedRunPolicy, setMissedRunPolicy] = useState<'skip' | 'retry_on_reconnect'>(
    schedule?.missedRunPolicy || 'skip'
  )
  const [retryTtlMinutes, setRetryTtlMinutes] = useState(schedule?.retryTtlMinutes ?? 60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cronExpression = cronPreset === 'custom' ? customCron : cronPreset

  const handleSubmit = useCallback(async () => {
    setError(null)

    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!cronExpression.trim()) {
      setError('Cron expression is required')
      return
    }
    if (!targetMachineId) {
      setError('Target machine is required')
      return
    }

    setSaving(true)
    try {
      if (schedule) {
        await updateSchedule(schedule.id, {
          name,
          cronExpression,
          timezone,
          targetMachineId,
          enabled,
          // Send null to clear active hours, undefined to keep unchanged
          activeHoursStart: activeHoursStart || null,
          activeHoursEnd: activeHoursEnd || null,
          maxConcurrency,
          missedRunPolicy,
          retryTtlMinutes,
        })
      } else {
        await createSchedule({
          projectId,
          scope,
          nodeId: scope === 'node' ? nodeId : undefined,
          name,
          cronExpression,
          timezone,
          targetMachineId,
          enabled,
          activeHoursStart: activeHoursStart || undefined,
          activeHoursEnd: activeHoursEnd || undefined,
          maxConcurrency,
          missedRunPolicy,
          retryTtlMinutes,
        })
      }
      onSave?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }, [
    name, cronExpression, timezone, targetMachineId, enabled,
    activeHoursStart, activeHoursEnd, maxConcurrency, missedRunPolicy,
    retryTtlMinutes, projectId, scope, nodeId, schedule,
    createSchedule, updateSchedule, onSave,
  ])

  // Get sorted list of timezones (memoized — ~500 entries, stable across renders)
  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai']
    }
  }, [])

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="schedule-name">Name</Label>
        <Input
          id="schedule-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Daily research digest"
        />
      </div>

      <div className="space-y-2">
        <Label>Schedule</Label>
        <Select value={cronPreset} onValueChange={(v) => {
          setCronPreset(v)
          if (v !== 'custom') setCustomCron(v)
        }}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRON_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {cronPreset === 'custom' && (
          <Input
            value={customCron}
            onChange={(e) => setCustomCron(e.target.value)}
            placeholder="*/30 * * * *"
            className="font-mono text-sm"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label>Timezone</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {timezones.map((tz) => (
              <SelectItem key={tz} value={tz}>{tz}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Target Machine</Label>
        <Select value={targetMachineId} onValueChange={setTargetMachineId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a machine" />
          </SelectTrigger>
          <SelectContent>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name || m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Active Hours Start</Label>
          <Input
            type="time"
            value={activeHoursStart}
            onChange={(e) => setActiveHoursStart(e.target.value)}
            placeholder="09:00"
          />
        </div>
        <div className="space-y-2">
          <Label>Active Hours End</Label>
          <Input
            type="time"
            value={activeHoursEnd}
            onChange={(e) => setActiveHoursEnd(e.target.value)}
            placeholder="17:00"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>If Machine Offline</Label>
        <Select
          value={missedRunPolicy}
          onValueChange={(v) => setMissedRunPolicy(v as 'skip' | 'retry_on_reconnect')}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MISSED_RUN_POLICIES.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {missedRunPolicy === 'retry_on_reconnect' && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Retry window (minutes)</Label>
            <Input
              type="number"
              min={1}
              max={1440}
              value={retryTtlMinutes}
              onChange={(e) => setRetryTtlMinutes(parseInt(e.target.value, 10) || 60)}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Max Concurrent Runs</Label>
        <Input
          type="number"
          min={1}
          max={10}
          value={maxConcurrency}
          onChange={(e) => setMaxConcurrency(parseInt(e.target.value, 10) || 1)}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="schedule-enabled">Enabled</Label>
        <Switch
          id="schedule-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit} disabled={saving} className="flex-1">
          {saving ? 'Saving...' : schedule ? 'Update Schedule' : 'Create Schedule'}
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
