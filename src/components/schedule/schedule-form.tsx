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
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────

type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

const DAYS_OF_WEEK = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
]

const HOUR_INTERVALS = [
  { label: 'Every hour', value: 1 },
  { label: 'Every 2 hours', value: 2 },
  { label: 'Every 3 hours', value: 3 },
  { label: 'Every 4 hours', value: 4 },
  { label: 'Every 6 hours', value: 6 },
  { label: 'Every 8 hours', value: 8 },
  { label: 'Every 12 hours', value: 12 },
]

const MISSED_RUN_POLICIES = [
  { label: 'Skip', value: 'skip' as const },
  { label: 'Retry on reconnect', value: 'retry_on_reconnect' as const },
]

// ── Cron parsing / building ────────────────────────────────────────

function buildCron(frequency: Frequency, config: {
  hourInterval: number
  minute: number
  hour: number
  daysOfWeek: number[]
  dayOfMonth: number
  customCron: string
}): string {
  switch (frequency) {
    case 'hourly':
      return config.hourInterval === 1
        ? `${config.minute} * * * *`
        : `${config.minute} */${config.hourInterval} * * *`
    case 'daily':
      return `${config.minute} ${config.hour} * * *`
    case 'weekly': {
      const days = config.daysOfWeek.length > 0 ? config.daysOfWeek.sort((a, b) => a - b).join(',') : '1'
      return `${config.minute} ${config.hour} * * ${days}`
    }
    case 'monthly':
      return `${config.minute} ${config.hour} ${config.dayOfMonth} * *`
    case 'custom':
      return config.customCron
  }
}

/** Parse a cron expression back into frequency + config for the builder. */
function parseCron(expr: string): {
  frequency: Frequency
  hourInterval: number
  minute: number
  hour: number
  daysOfWeek: number[]
  dayOfMonth: number
} {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { frequency: 'custom', hourInterval: 1, minute: 0, hour: 9, daysOfWeek: [1], dayOfMonth: 1 }

  const [minPart, hourPart, domPart, , dowPart] = parts
  const minute = parseInt(minPart, 10)

  // Hourly: minute H * * * or minute */N * * *
  if ((hourPart === '*' || hourPart.startsWith('*/')) && domPart === '*' && dowPart === '*') {
    const interval = hourPart === '*' ? 1 : parseInt(hourPart.slice(2), 10)
    if (HOUR_INTERVALS.some(h => h.value === interval) && !isNaN(minute)) {
      return { frequency: 'hourly', hourInterval: interval, minute, hour: 9, daysOfWeek: [1], dayOfMonth: 1 }
    }
  }

  const hour = parseInt(hourPart, 10)
  if (isNaN(hour) || isNaN(minute)) return { frequency: 'custom', hourInterval: 1, minute: 0, hour: 9, daysOfWeek: [1], dayOfMonth: 1 }

  // Weekly: M H * * D,D,...
  if (domPart === '*' && dowPart !== '*') {
    const days = dowPart.split(',').map(Number).filter(n => !isNaN(n))
    if (days.length > 0) {
      return { frequency: 'weekly', hourInterval: 1, minute, hour, daysOfWeek: days, dayOfMonth: 1 }
    }
  }

  // Monthly: M H D * *
  if (domPart !== '*' && dowPart === '*') {
    const dom = parseInt(domPart, 10)
    if (!isNaN(dom) && dom >= 1 && dom <= 31) {
      return { frequency: 'monthly', hourInterval: 1, minute, hour, daysOfWeek: [1], dayOfMonth: dom }
    }
  }

  // Daily: M H * * *
  if (domPart === '*' && dowPart === '*') {
    return { frequency: 'daily', hourInterval: 1, minute, hour, daysOfWeek: [1], dayOfMonth: 1 }
  }

  return { frequency: 'custom', hourInterval: 1, minute: 0, hour: 9, daysOfWeek: [1], dayOfMonth: 1 }
}

/** Compute next N run times from a cron expression. */
function getNextRuns(cronExpr: string, timezone: string, count: number): Date[] {
  try {
    // Simple forward-walk: check each minute from now for up to 400 days
    const now = new Date()
    const runs: Date[] = []
    const parts = cronExpr.trim().split(/\s+/)
    if (parts.length !== 5) return []

    const matchesCron = (d: Date): boolean => {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric', minute: 'numeric', day: 'numeric', month: 'numeric',
        weekday: 'short', hour12: false,
      })
      const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]))
      const min = parseInt(p.minute, 10)
      const hr = parseInt(p.hour === '24' ? '0' : p.hour, 10)
      const dom = parseInt(p.day, 10)
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)

      const monthNum = parseInt(p.month, 10)
      return matchField(parts[0], min)
        && matchField(parts[1], hr)
        && matchField(parts[2], dom)
        && matchField(parts[3], monthNum)
        && matchField(parts[4], dow)
    }

    // Walk forward minute-by-minute (capped at ~30 days of minutes)
    const maxIter = 60 * 24 * 400
    const step = 60_000
    let t = new Date(now.getTime() + step - (now.getTime() % step)) // next whole minute
    for (let i = 0; i < maxIter && runs.length < count; i++) {
      if (matchesCron(t)) runs.push(new Date(t))
      t = new Date(t.getTime() + step)
    }
    return runs
  } catch {
    return []
  }
}

function matchField(field: string, value: number): boolean {
  if (field === '*') return true
  // */N
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10)
    return !isNaN(step) && step > 0 && value % step === 0
  }
  // comma-separated
  return field.split(',').some(p => {
    // range N-M
    if (p.includes('-')) {
      const [lo, hi] = p.split('-').map(Number)
      return !isNaN(lo) && !isNaN(hi) && value >= lo && value <= hi
    }
    return parseInt(p, 10) === value
  })
}

function formatTime(d: Date, tz: string): string {
  return d.toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// ── Component ──────────────────────────────────────────────────────

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

  // Parse existing cron into builder state
  const initial = useMemo(() => {
    if (!schedule) return { frequency: 'daily' as Frequency, hourInterval: 1, minute: 0, hour: 9, daysOfWeek: [1], dayOfMonth: 1 }
    return parseCron(schedule.cronExpression)
  }, [schedule])

  const [name, setName] = useState(schedule?.name || '')
  const [frequency, setFrequency] = useState<Frequency>(initial.frequency)
  const [hourInterval, setHourInterval] = useState(initial.hourInterval)
  const [minute, setMinute] = useState(initial.minute)
  const [hour, setHour] = useState(initial.hour)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initial.daysOfWeek)
  const [dayOfMonth, setDayOfMonth] = useState(initial.dayOfMonth)
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

  const cronExpression = buildCron(frequency, { hourInterval, minute, hour, daysOfWeek, dayOfMonth, customCron })

  // Preview next 3 runs
  const nextRuns = useMemo(
    () => getNextRuns(cronExpression, timezone, 3),
    [cronExpression, timezone],
  )

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

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai']
    }
  }, [])

  const toggleDay = (day: number) => {
    setDaysOfWeek(prev => {
      if (prev.includes(day) && prev.length === 1) return prev
      return prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    })
  }

  // Format hour/minute as HH:MM for the time input
  const timeValue = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const handleTimeChange = (val: string) => {
    const [h, m] = val.split(':').map(Number)
    if (!isNaN(h) && h >= 0 && h <= 23) setHour(h)
    if (!isNaN(m) && m >= 0 && m <= 59) setMinute(m)
  }

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

      {/* ── Frequency selector ── */}
      <div className="space-y-2">
        <Label>Frequency</Label>
        <div className="flex gap-1">
          {(['hourly', 'daily', 'weekly', 'monthly', 'custom'] as Frequency[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFrequency(f)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                frequency === f
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted',
              )}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Frequency-specific options ── */}
      {frequency === 'hourly' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Interval</Label>
            <Select value={String(hourInterval)} onValueChange={(v) => setHourInterval(parseInt(v, 10))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOUR_INTERVALS.map((h) => (
                  <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>At minute</Label>
            <Select value={String(minute)} onValueChange={(v) => setMinute(parseInt(v, 10))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <SelectItem key={m} value={String(m)}>:{String(m).padStart(2, '0')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {frequency === 'daily' && (
        <div className="space-y-2">
          <Label>Time</Label>
          <Input
            type="time"
            value={timeValue}
            onChange={(e) => handleTimeChange(e.target.value)}
          />
        </div>
      )}

      {frequency === 'weekly' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Days</Label>
            <div className="flex gap-1">
              {DAYS_OF_WEEK.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={cn(
                    'w-10 h-8 text-xs font-medium rounded-md border transition-colors',
                    daysOfWeek.includes(d.value)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Time</Label>
            <Input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
            />
          </div>
        </div>
      )}

      {frequency === 'monthly' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Day of month</Label>
            <Select value={String(dayOfMonth)} onValueChange={(v) => setDayOfMonth(parseInt(v, 10))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <SelectItem key={d} value={String(d)}>{d}{ordinalSuffix(d)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Time</Label>
            <Input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
            />
          </div>
        </div>
      )}

      {frequency === 'custom' && (
        <div className="space-y-2">
          <Label>Cron expression</Label>
          <Input
            value={customCron}
            onChange={(e) => setCustomCron(e.target.value)}
            placeholder="*/30 * * * *"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Format: minute hour day-of-month month day-of-week
          </p>
        </div>
      )}

      {/* ── Next runs preview ── */}
      {nextRuns.length > 0 && (
        <div className="rounded-md bg-muted/50 px-3 py-2 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Next runs</p>
          {nextRuns.map((d, i) => (
            <p key={i} className="text-xs text-muted-foreground">{formatTime(d, timezone)}</p>
          ))}
        </div>
      )}

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

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] || s[v] || s[0]
}
