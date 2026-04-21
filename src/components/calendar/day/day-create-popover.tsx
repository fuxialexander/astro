import { useEffect, useRef } from 'react'
import { EventCreateDialog } from '../shared/event-create-dialog'
import type { CreateDraft } from '../types'
import { useCalendarStore } from '@/stores/calendar-store'

interface DayCreatePopoverProps {
  draft: CreateDraft
}

export function DayCreatePopover({ draft }: DayCreatePopoverProps) {
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)
  const ref = useRef<HTMLDivElement>(null)

  // Position the popover near the anchor rect, clamped within viewport
  const anchorRect = draft.anchorRect
  const style: React.CSSProperties = anchorRect
    ? (() => {
        const popupW = 288 // w-72
        const popupH = 320
        const spaceRight = window.innerWidth - anchorRect.right
        const left = spaceRight >= popupW + 16
          ? anchorRect.right + 8
          : Math.max(8, anchorRect.left - popupW - 8)
        return {
          position: 'fixed',
          top: Math.min(Math.max(8, anchorRect.top), window.innerHeight - popupH - 8),
          left: Math.max(8, Math.min(left, window.innerWidth - popupW - 8)),
          zIndex: 50,
        }
      })()
    : { position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)', zIndex: 50 }

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
    <div ref={ref} style={style} className="animate-in fade-in-0 zoom-in-95 duration-150">
      <EventCreateDialog
        draft={draft}
        onClose={() => setCreateDraft(null)}
      />
    </div>
  )
}
