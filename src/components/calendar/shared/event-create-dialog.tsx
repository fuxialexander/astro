import { useState, useEffect, useRef } from 'react'
import { useProjectStore } from '@/stores/project-store'
import { usePlanStore } from '@/stores/plan-store'
import { useCalendarStore } from '@/stores/calendar-store'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CreateDraft, CreateDraftKind } from '../types'
import { CREATE_DRAFT_CYCLE } from '../types'
import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import { useCalendarStore as useStore } from '@/stores/calendar-store'

const KIND_LABELS: Record<CreateDraftKind, string> = {
  task: 'Task',
  milestone: 'Milestone',
  project: 'Project',
  'apple-event': 'Apple Event',
}

function formatTimeRange(startAt: string, endAt: string, allDay: boolean): string {
  if (allDay) {
    const s = new Date(startAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    const e = new Date(endAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    return s === e ? s : `${s} – ${e}`
  }
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${fmt(startAt)} – ${fmt(endAt)}`
}

interface EventCreateDialogProps {
  draft: CreateDraft
  anchorRect?: DOMRect
  onClose: () => void
}

export function EventCreateDialog({ draft, onClose }: EventCreateDialogProps) {
  const [kind, setKind] = useState<CreateDraftKind>(draft.kind)
  const [title, setTitle] = useState(draft.title ?? '')
  const [projectId, setProjectId] = useState(draft.projectId ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const projects = useProjectStore((s) => s.projects)
  const addNode = usePlanStore((s) => s.addNode)
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)
  const addExternalEvent = useStore((s) => s.addExternalEvent)
  const navigate = useNavigate()

  useEffect(() => { inputRef.current?.focus() }, [])

  const cycleKind = () => {
    const idx = CREATE_DRAFT_CYCLE.indexOf(kind)
    const next = CREATE_DRAFT_CYCLE[(idx + 1) % CREATE_DRAFT_CYCLE.length]
    // Skip apple-event if not on desktop
    if (next === 'apple-event' && !isDesktop()) {
      setKind(CREATE_DRAFT_CYCLE[(idx + 2) % CREATE_DRAFT_CYCLE.length])
    } else {
      setKind(next)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') { e.preventDefault(); cycleKind() }
    if (e.key === 'Escape') { onClose() }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit() }
  }

  const handleSubmit = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      if (kind === 'task' || kind === 'milestone') {
        if (!projectId) return
        const id = crypto.randomUUID()
        addNode({
          id,
          projectId,
          type: kind === 'milestone' ? 'milestone' : 'task',
          title: title.trim(),
          description: '',
          status: 'planned',
          parentId: null,
          dependencies: [],
          verification: 'human',
          position: { x: 0, y: 0 },
          startDate: draft.startAt.slice(0, 10),
          dueDate: draft.endAt.slice(0, 10),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        navigate(`/project/${projectId}`)
      } else if (kind === 'project') {
        // Navigate to dashboard where project creation is inline
        navigate('/dashboard')
      } else if (kind === 'apple-event' && isDesktop()) {
        const res = await desktopBridge.calendar.createEvent({
          title: title.trim(),
          startDate: draft.startAt,
          endDate: draft.endAt,
          allDay: draft.isMultiDay,
        })
        if (res.ok) {
          addExternalEvent({
            id: `apple-calendar:${res.id}`,
            sourceId: res.id,
            source: 'apple-calendar',
            kind: 'external',
            startAt: draft.startAt,
            endAt: draft.endAt,
            allDay: draft.isMultiDay,
            title: title.trim(),
            color: 'external',
            isCompleted: false,
            isCancelled: false,
            isDraggable: true,
            isReadOnly: false,
          })
        }
      }
      setCreateDraft(null)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const needsProject = kind === 'task' || kind === 'milestone'
  const isDesktopApp = isDesktop()
  const availableKinds = CREATE_DRAFT_CYCLE.filter((k) => k !== 'apple-event' || isDesktopApp)

  return (
    <div
      className="calendar-popup-surface rounded-xl p-3 w-72 flex flex-col gap-2"
      onKeyDown={handleKeyDown}
    >
      {/* Kind selector */}
      <div className="flex gap-1">
        {availableKinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              'text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors',
              kind === k
                ? 'bg-primary text-primary-foreground border-primary'
                : 'text-muted-foreground border-border hover:border-primary/50',
            )}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-muted-foreground self-center">Tab to cycle</span>
      </div>

      {/* Time range */}
      <p className="text-[10px] text-muted-foreground">
        {formatTimeRange(draft.startAt, draft.endAt, draft.isMultiDay)}
      </p>

      {/* Title */}
      <Input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`${KIND_LABELS[kind]} title…`}
        className="h-8 text-sm"
      />

      {/* Project selector (for task/milestone) */}
      {needsProject && (
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Select project…</option>
          {projects.filter((p) => p.status === 'active').map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      <div className="flex justify-end gap-1.5 mt-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => void handleSubmit()}
          disabled={saving || !title.trim() || (needsProject && !projectId)}
        >
          {saving ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  )
}
