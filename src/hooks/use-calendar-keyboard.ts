import { useEffect } from 'react'
import { useCalendarStore } from '@/stores/calendar-store'
import { useUIStore } from '@/stores/ui-store'

export function useCalendarKeyboard() {
  const setView = useCalendarStore((s) => s.setView)
  const navigateBy = useCalendarStore((s) => s.navigateBy)
  const setFocusedDate = useCalendarStore((s) => s.setFocusedDate)
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (commandPaletteOpen) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case 'd':
          e.preventDefault()
          setView('day')
          break
        case 'w':
          e.preventDefault()
          setView('week')
          break
        case 'm':
          e.preventDefault()
          setView('month')
          break
        case 't':
          e.preventDefault()
          setFocusedDate(new Date().toISOString().slice(0, 10))
          break
        case 'ArrowLeft':
          e.preventDefault()
          navigateBy(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          navigateBy(1)
          break
        case 'Escape':
          setCreateDraft(null)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commandPaletteOpen, navigateBy, setCreateDraft, setFocusedDate, setView])
}
