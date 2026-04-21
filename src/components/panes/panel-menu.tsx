/**
 * PanelMenu — dropdown that toggles right-side panels with checkmark items.
 *
 * The trigger is a compact `PanelRight` icon button; clicking opens a menu
 * listing each available panel (Chat, Plan, Files, Diff, Terminal) with a
 * checkmark on currently-visible panels and a decorative shortcut hint.
 */
import { Check, PanelRight } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { isDesktop } from '@/lib/desktop-detect'
import { PANEL_META, getAvailablePanels } from './panel-meta'

/** Split a shortcut string like "⇧⌘E" into individual key tokens. */
function splitShortcut(shortcut: string): string[] {
  const keys: string[] = []
  let i = 0
  while (i < shortcut.length) {
    const cp = shortcut.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    keys.push(ch)
    i += ch.length
  }
  return keys
}

function ShortcutKeys({ shortcut }: { shortcut: string }) {
  const keys = splitShortcut(shortcut)
  return (
    <span className="flex items-center gap-0.5 ml-auto pl-2 shrink-0">
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded font-mono text-[10px] font-medium leading-none text-muted-foreground/70 bg-muted/60 border border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

interface PanelMenuProps {
  disabled?: boolean
  hasCwd?: boolean
}

export function PanelMenu({ disabled, hasCwd = false }: PanelMenuProps) {
  const stack = useUIStore((s) => s.rightPanelStack)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const hasAny = stack.length > 0
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const availablePanels = getAvailablePanels(isDesktop(), hasCwd)

  const handleMouseEnter = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }, [])

  if (availablePanels.length === 0) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          disabled={disabled}
          title="Panels"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={cn(
            // Matches TITLEBAR_BTN in app-layout.tsx so the panel menu
            // reads as a sibling of sidebar-toggle, search, and close-all.
            'flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-[120ms]',
            'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
            'disabled:opacity-30 disabled:pointer-events-none',
            hasAny && 'bg-foreground/[0.06] text-foreground',
          )}
        >
          <PanelRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          'min-w-[220px] rounded-lg border-border/80 p-1',
          'shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)]',
        )}
      >
        {availablePanels.map((kind) => {
          const meta = PANEL_META[kind]
          if (!meta) return null
          const active = stack.includes(kind)

          return (
            <DropdownMenuItem
              key={kind}
              onSelect={(e) => {
                // Keep menu open for multi-select flow — users often want to
                // toggle several panels in a row without reopening.
                e.preventDefault()
                toggleRightPanel(kind)
              }}
              className={cn(
                'group flex items-center gap-2.5 rounded-md px-2 py-1.5',
                'text-[13px] font-normal cursor-pointer',
                'focus:bg-muted/70 focus:text-foreground',
              )}
            >
              <meta.Icon
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-focus:text-foreground"
                strokeWidth={1.75}
              />
              <span className="flex-1 text-foreground/90">{meta.label}</span>
              {active && (
                <Check className="h-3.5 w-3.5 shrink-0 text-foreground" strokeWidth={2.25} />
              )}
              {meta.shortcut && <ShortcutKeys shortcut={meta.shortcut} />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
