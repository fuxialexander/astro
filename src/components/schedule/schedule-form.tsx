import { useState, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronRight, Monitor, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  { label: 'Mo', value: 1 },
  { label: 'Tu', value: 2 },
  { label: 'We', value: 3 },
  { label: 'Th', value: 4 },
  { label: 'Fr', value: 5 },
  { label: 'Sa', value: 6 },
  { label: 'Su', value: 0 },
]

const HOUR_INTERVALS = [
  { label: '1h', value: 1 },
  { label: '2h', value: 2 },
  { label: '4h', value: 4 },
  { label: '6h', value: 6 },
  { label: '12h', value: 12 },
]

const MISSED_RUN_POLICIES = [
  { label: 'Skip missed runs', value: 'skip' as const },
  { label: 'Retry on reconnect', value: 'retry_on_reconnect' as const },
]

// ── Cron building / parsing ────────────────────────────────────────

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
        ? `0 * * * *`
        : `0 */${config.hourInterval} * * *`
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

  if ((hourPart === '*' || hourPart.startsWith('*/')) && domPart === '*' && dowPart === '*') {
    const interval = hourPart === '*' ? 1 : parseInt(hourPart.slice(2), 10)
    if (HOUR_INTERVALS.some(h => h.value === interval) && !isNaN(minute)) {
      return { frequency: 'hourly', hourInterval: interval, minute, hour: 9, daysOfWeek: [1], dayOfMonth: 1 }
    }
  }

  const hour = parseInt(hourPart, 10)
  if (isNaN(hour) || isNaN(minute)) return { frequency: 'custom', hourInterval: 1, minute: 0, hour: 9, daysOfWeek: [1], dayOfMonth: 1 }

  if (domPart === '*' && dowPart !== '*') {
    const days = dowPart.split(',').map(Number).filter(n => !isNaN(n))
    if (days.length > 0) return { frequency: 'weekly', hourInterval: 1, minute, hour, daysOfWeek: days, dayOfMonth: 1 }
  }

  if (domPart !== '*' && dowPart === '*') {
    const dom = parseInt(domPart, 10)
    if (!isNaN(dom) && dom >= 1 && dom <= 31) return { frequency: 'monthly', hourInterval: 1, minute, hour, daysOfWeek: [1], dayOfMonth: dom }
  }

  if (domPart === '*' && dowPart === '*') {
    return { frequency: 'daily', hourInterval: 1, minute, hour, daysOfWeek: [1], dayOfMonth: 1 }
  }

  return { frequency: 'custom', hourInterval: 1, minute: 0, hour: 9, daysOfWeek: [1], dayOfMonth: 1 }
}

// ── Human-readable description ────────────────────────────────────

function describeSchedule(
  frequency: Frequency,
  config: { hourInterval: number; hour: number; minute: number; daysOfWeek: number[]; dayOfMonth: number; customCron: string },
  timezone: string,
): string {
  const fmt12 = (h: number, m: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }
  const tz = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone

  switch (frequency) {
    case 'hourly':
      return config.hourInterval === 1 ? `Every hour` : `Every ${config.hourInterval} hours`
    case 'daily':
      return `Every day at ${fmt12(config.hour, config.minute)} ${tz}`
    case 'weekly': {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const days = [...config.daysOfWeek].sort().map(d => dayNames[d]).join(', ')
      return `Every ${days} at ${fmt12(config.hour, config.minute)} ${tz}`
    }
    case 'monthly':
      return `${ordinalSuffix2(config.dayOfMonth)} of each month at ${fmt12(config.hour, config.minute)} ${tz}`
    case 'custom':
      return config.customCron ? `cron: ${config.customCron}` : 'Custom expression'
  }
}

function ordinalSuffix2(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function getNextRun(cronExpr: string, timezone: string): Date | null {
  try {
    const parts = cronExpr.trim().split(/\s+/)
    if (parts.length !== 5) return null

    const matchField = (field: string, value: number): boolean => {
      if (field === '*') return true
      if (field.startsWith('*/')) {
        const step = parseInt(field.slice(2), 10)
        return !isNaN(step) && step > 0 && value % step === 0
      }
      return field.split(',').some(p => {
        if (p.includes('-')) {
          const [lo, hi] = p.split('-').map(Number)
          return !isNaN(lo) && !isNaN(hi) && value >= lo && value <= hi
        }
        return parseInt(p, 10) === value
      })
    }

    const now = new Date()
    const step = 60_000
    let t = new Date(now.getTime() + step - (now.getTime() % step))
    for (let i = 0; i < 60 * 24 * 400; i++) {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric', minute: 'numeric', day: 'numeric', month: 'numeric',
        weekday: 'short', hour12: false,
      })
      const p = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type, x.value]))
      const min = parseInt(p.minute, 10)
      const hr = parseInt(p.hour === '24' ? '0' : p.hour, 10)
      const dom = parseInt(p.day, 10)
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
      const monthNum = parseInt(p.month, 10)
      if (
        matchField(parts[0], min) &&
        matchField(parts[1], hr) &&
        matchField(parts[2], dom) &&
        matchField(parts[3], monthNum) &&
        matchField(parts[4], dow)
      ) return t
      t = new Date(t.getTime() + step)
    }
    return null
  } catch {
    return null
  }
}

function formatNextRun(d: Date): string {
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffMins = Math.round(diffMs / 60000)
  if (diffMins < 60) return `in ${diffMins}m`
  const diffHrs = Math.round(diffMins / 60)
  if (diffHrs < 24) return `in ${diffHrs}h`
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
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

  const initial = useMemo(() => {
    if (!schedule) return { frequency: 'daily' as Frequency, hourInterval: 1, minute: 0, hour: 9, daysOfWeek: [1, 2, 3, 4, 5], dayOfMonth: 1 }
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
  const [editingTz, setEditingTz] = useState(false)
  const [targetMachineId, setTargetMachineId] = useState(
    schedule?.targetMachineId || (machines.length === 1 ? machines[0].id : '')
  )
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)
  const [activeHoursStart, setActiveHoursStart] = useState(schedule?.activeHoursStart || '')
  const [activeHoursEnd, setActiveHoursEnd] = useState(schedule?.activeHoursEnd || '')
  const [maxConcurrency, setMaxConcurrency] = useState(schedule?.maxConcurrency ?? 1)
  const [missedRunPolicy, setMissedRunPolicy] = useState<'skip' | 'retry_on_reconnect'>(schedule?.missedRunPolicy || 'skip')
  const [retryTtlMinutes, setRetryTtlMinutes] = useState(schedule?.retryTtlMinutes ?? 60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const cronExpression = buildCron(frequency, { hourInterval, minute, hour, daysOfWeek, dayOfMonth, customCron })

  const description = useMemo(
    () => describeSchedule(frequency, { hourInterval, hour, minute, daysOfWeek, dayOfMonth, customCron }, timezone),
    [frequency, hourInterval, hour, minute, daysOfWeek, dayOfMonth, customCron, timezone]
  )

  const nextRun = useMemo(
    () => getNextRun(cronExpression, timezone),
    [cronExpression, timezone]
  )

  const handleSubmit = useCallback(async () => {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (!cronExpression.trim()) { setError('Schedule is required'); return }
    if (!targetMachineId) { setError('Machine is required'); return }

    setSaving(true)
    try {
      if (schedule) {
        await updateSchedule(schedule.id, {
          name, cronExpression, timezone, targetMachineId, enabled,
          activeHoursStart: activeHoursStart || null,
          activeHoursEnd: activeHoursEnd || null,
          maxConcurrency, missedRunPolicy, retryTtlMinutes,
        })
      } else {
        await createSchedule({
          projectId, scope, nodeId: scope === 'node' ? nodeId : undefined,
          name, cronExpression, timezone, targetMachineId, enabled,
          activeHoursStart: activeHoursStart || undefined,
          activeHoursEnd: activeHoursEnd || undefined,
          maxConcurrency, missedRunPolicy, retryTtlMinutes,
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
    try { return Intl.supportedValuesOf('timeZone') }
    catch { return ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'] }
  }, [])

  const toggleDay = (day: number) => {
    setDaysOfWeek(prev => {
      if (prev.includes(day) && prev.length === 1) return prev
      return prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    })
  }

  const timeValue = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const handleTimeChange = (val: string) => {
    const [h, m] = val.split(':').map(Number)
    if (!isNaN(h) && h >= 0 && h <= 23) setHour(h)
    if (!isNaN(m) && m >= 0 && m <= 59) setMinute(m)
  }

  return (
    <div className="space-y-4 text-sm">
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Name + enabled row */}
      <div className="flex items-center gap-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Schedule name"
          className="flex-1 h-8 text-sm"
        />
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            id="schedule-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            className="scale-90"
          />
          <label htmlFor="schedule-enabled" className="text-xs text-muted-foreground select-none cursor-pointer">
            {enabled ? 'On' : 'Off'}
          </label>
        </div>
      </div>

      {/* Frequency pills */}
      <div className="flex gap-1">
        {(['hourly', 'daily', 'weekly', 'monthly', 'custom'] as Frequency[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFrequency(f)}
            className={cn(
              'flex-1 py-1 text-xs font-medium rounded transition-colors border',
              frequency === f
                ? 'bg-foreground text-background border-foreground'
                : 'bg-transparent text-muted-foreground border-border/50 hover:border-border hover:text-foreground',
            )}
          >
            {f === 'hourly' ? 'Hourly' : f === 'daily' ? 'Daily' : f === 'weekly' ? 'Weekly' : f === 'monthly' ? 'Monthly' : 'Custom'}
          </button>
        ))}
      </div>

      {/* Frequency options */}
      <div className="space-y-3">
        {frequency === 'hourly' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Every</span>
            <div className="flex gap-1 flex-1">
              {HOUR_INTERVALS.map((h) => (
                <button
                  key={h.value}
                  type="button"
                  onClick={() => setHourInterval(h.value)}
                  className={cn(
                    'flex-1 py-1 text-xs rounded border transition-colors',
                    hourInterval === h.value
                      ? 'bg-foreground text-background border-foreground'
                      : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {frequency === 'weekly' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Days</span>
            <div className="flex gap-1 flex-1">
              {DAYS_OF_WEEK.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={cn(
                    'flex-1 py-1 text-xs rounded border transition-colors',
                    daysOfWeek.includes(d.value)
                      ? 'bg-foreground text-background border-foreground'
                      : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {frequency === 'monthly' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Day</span>
            <Select value={String(dayOfMonth)} onValueChange={(v) => setDayOfMonth(parseInt(v, 10))}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <SelectItem key={d} value={String(d)} className="text-xs">{ordinalSuffix2(d)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {frequency === 'custom' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Cron</span>
            <Input
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="0 9 * * 1-5"
              className="flex-1 h-8 text-xs font-mono"
            />
          </div>
        )}

        {frequency !== 'hourly' && frequency !== 'custom' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">At</span>
            <Input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="h-8 text-xs w-32"
            />
          </div>
        )}
      </div>

      {/* Schedule preview strip */}
      <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-xs text-foreground/80">{description}</span>
        {nextRun && (
          <span className="text-[11px] text-muted-foreground shrink-0">
            next {formatNextRun(nextRun)}
          </span>
        )}
      </div>

      {/* Machine */}
      <div className="flex items-center gap-2">
        <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {machines.length === 0 ? (
          <span className="text-xs text-muted-foreground">No machines connected</span>
        ) : machines.length === 1 ? (
          <span className="text-xs text-muted-foreground">{machines[0].name || machines[0].id}</span>
        ) : (
          <Select value={targetMachineId} onValueChange={setTargetMachineId}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="Select machine" />
            </SelectTrigger>
            <SelectContent>
              {machines.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">{m.name || m.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Timezone */}
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {editingTz ? (
          <Select value={timezone} onValueChange={(v) => { setTimezone(v); setEditingTz(false) }}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs text-muted-foreground">{timezone}</span>
            <button
              type="button"
              onClick={() => setEditingTz(true)}
              className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground underline underline-offset-2 transition-colors"
            >
              change
            </button>
          </div>
        )}
      </div>

      {/* Advanced settings */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors py-0.5"
        >
          {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Advanced
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-3 pl-3 border-l border-border/40">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-28 shrink-0">Active window</span>
              <div className="flex items-center gap-1.5 flex-1">
                <Input
                  type="time"
                  value={activeHoursStart}
                  onChange={(e) => setActiveHoursStart(e.target.value)}
                  className="h-7 text-xs w-24"
                  placeholder="09:00"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="time"
                  value={activeHoursEnd}
                  onChange={(e) => setActiveHoursEnd(e.target.value)}
                  className="h-7 text-xs w-24"
                  placeholder="17:00"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-28 shrink-0">If offline</span>
              <Select value={missedRunPolicy} onValueChange={(v) => setMissedRunPolicy(v as typeof missedRunPolicy)}>
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MISSED_RUN_POLICIES.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {missedRunPolicy === 'retry_on_reconnect' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-28 shrink-0">Retry window</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={retryTtlMinutes}
                    onChange={(e) => setRetryTtlMinutes(parseInt(e.target.value, 10) || 60)}
                    className="h-7 text-xs w-20"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-28 shrink-0">Max concurrent</span>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(parseInt(e.target.value, 10) || 1)}
                className="h-7 text-xs w-20"
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          onClick={handleSubmit}
          disabled={saving}
          size="sm"
          className="flex-1 h-8"
        >
          {saving ? 'Saving…' : schedule ? 'Update' : 'Create Schedule'}
        </Button>
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel} className="h-8">
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

