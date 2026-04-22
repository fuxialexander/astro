import { useEffect, useLayoutEffect, useRef } from 'react'
import { EventCreateDialog } from '../shared/event-create-dialog'
import type { CreateDraft } from '../types'
import { useCalendarStore } from '@/stores/calendar-store'

interface DayCreatePopoverProps {
  draft: CreateDraft
}

export function DayCreatePopover({ draft }: DayCreatePopoverProps) {
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const anchorRect = draft.anchorRect
    const node = ref.current
    if (!node) return

    const nextStyle = node.style
    const viewportPad = 8
    const sideGap = 8
    const rect = node.getBoundingClientRect()
    const popupW = rect.width || 288
    const popupH = rect.height || 320

    nextStyle.position = 'fixed'
    nextStyle.zIndex = '50'

    if (!anchorRect) {
      nextStyle.top = '30%'
      nextStyle.left = '50%'
      nextStyle.transform = 'translateX(-50%)'
      nextStyle.visibility = 'visible'
      return
    }

    const fitsRight = anchorRect.right + sideGap + popupW <= window.innerWidth - viewportPad
    const fitsLeft = anchorRect.left - sideGap - popupW >= viewportPad

    let left = anchorRect.right + sideGap
    if (!fitsRight) {
      left = fitsLeft ? anchorRect.left - popupW - sideGap : window.innerWidth - popupW - viewportPad
    }

    nextStyle.top = `${Math.max(viewportPad, Math.min(anchorRect.top, window.innerHeight - popupH - viewportPad))}px`
    nextStyle.left = `${Math.max(viewportPad, Math.min(left, window.innerWidth - popupW - viewportPad))}px`
    nextStyle.transform = ''
    nextStyle.visibility = 'visible'
  }, [draft.anchorRect, draft.endAt, draft.isMultiDay, draft.kind, draft.projectId, draft.startAt, draft.title])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setCreateDraft(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setCreateDraft])

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, visibility: 'hidden' }}
      className="animate-in fade-in-0 zoom-in-95 duration-150 max-w-[calc(100vw-16px)]"
    >
      <EventCreateDialog
        draft={draft}
        onClose={() => setCreateDraft(null)}
      />
    </div>
  )
}
