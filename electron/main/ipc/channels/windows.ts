/**
 * Window management channel handlers. Phase 2A: focus / list / close work;
 * detach-pane is stubbed until the dockview pane system lands in Phase 3
 * (it needs the detached-pane-window factory and pane-state schema).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/windows.js'
import { windowRegistry } from '../../windows/registry.js'
import { showFindInPage } from '../../windows/find-in-page.js'
import { showAboutWindow } from '../../windows/about-window.js'
import { createDetachedPaneWindow } from '../../windows/detached-pane-window.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// channels/ → main/ipc/channels/ → preload lives at electron/dist/preload/
// relative to the compiled main bundle. Matches the path used by main/index.ts.
const PRELOAD_DIR = path.join(__dirname, '../../../preload')

export function registerWindowsChannels(): void {
  defineHandler('windows:focus', schema.focus, async (req) => {
    const win = windowRegistry.get(req.id)
    if (!win) throw new Error(`unknown window id: ${req.id}`)
    if (win.isMinimized()) win.restore()
    win.focus()
    return { ok: true as const }
  })

  defineHandler('windows:list', schema.list, async () => {
    const ids = windowRegistry.ids()
    return {
      windows: ids
        .map((id) => {
          const win = windowRegistry.get(id)
          if (!win) return null
          return { id, title: win.getTitle(), focused: win.isFocused() }
        })
        .filter((w): w is { id: string; title: string; focused: boolean } => w !== null),
    }
  })

  defineHandler('windows:detach-pane', schema.detachPane, async (req) => {
    const { windowId } = await createDetachedPaneWindow({
      preloadDir: PRELOAD_DIR,
      paneKind: req.paneKind,
      paneId: req.paneId,
      paneTitle: req.paneTitle,
      paneState: req.paneState,
    })
    return { windowId }
  })

  defineHandler('windows:close', schema.closeWindow, async (req) => {
    const win = windowRegistry.get(req.id)
    if (!win) throw new Error(`unknown window id: ${req.id}`)
    win.close()
    return { ok: true as const }
  })

  defineHandler('windows:open-find', schema.openFind, async () => {
    await showFindInPage({ preloadDir: PRELOAD_DIR })
    return { ok: true as const }
  })

  defineHandler('windows:open-about', schema.openAbout, async () => {
    await showAboutWindow({ preloadDir: PRELOAD_DIR })
    return { ok: true as const }
  })
}
