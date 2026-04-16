/**
 * Shared metadata for the right-side floating panel stack.
 *
 * Lives in its own file so both PanelStack and PanelMenu can import it
 * without tripping react-refresh's "only export components" rule.
 */
import { FolderTree, GitBranch, Terminal, type LucideIcon } from 'lucide-react'
import type { RightPanelKind } from '@/stores/ui-store'

export interface PanelMeta {
  kind: RightPanelKind
  label: string
  Icon: LucideIcon
  /** Shortcut hint shown in the dropdown. Wired in AppLayout via keydown listener. */
  shortcut?: string
  /** When true, this panel requires Electron IPC and should be hidden on web. */
  desktopOnly?: boolean
  /** When true, this panel requires a project working directory (hide on dashboard). */
  requiresCwd?: boolean
}

export const RIGHT_PANEL_ORDER: RightPanelKind[] = [
  'file-browser',
  'git',
  'terminal',
]

export const PANEL_META: Partial<Record<RightPanelKind, PanelMeta>> = {
  'file-browser': { kind: 'file-browser', label: 'Files', Icon: FolderTree, shortcut: '⇧⌘E', desktopOnly: true, requiresCwd: true },
  git: { kind: 'git', label: 'Diff', Icon: GitBranch, shortcut: '⇧⌘D', desktopOnly: true, requiresCwd: true },
  terminal: { kind: 'terminal', label: 'Terminal', Icon: Terminal, shortcut: '⌃`', desktopOnly: true, requiresCwd: true },
}

/** Return panel kinds available on the current platform and context. */
export function getAvailablePanels(desktop: boolean, hasCwd = true): RightPanelKind[] {
  return RIGHT_PANEL_ORDER.filter((k) => {
    const meta = PANEL_META[k]
    if (!meta) return false
    if (meta.desktopOnly && !desktop) return false
    if (meta.requiresCwd && !hasCwd) return false
    return true
  })
}
