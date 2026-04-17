/**
 * Find-in-page overlay window (Phase 5).
 *
 * A small frameless always-on-top panel that hovers near the top of the
 * currently focused window and drives `webContents.findInPage()` against
 * that target. The overlay window itself has NO findInPage capability —
 * it's just a tiny UI shell that proxies find/stop/next/prev commands
 * back to the main process via IPC, which forwards them to the target.
 *
 * Target resolution:
 *   - On open, remember the currently focused BrowserWindow as the
 *     `targetId` (looked up via `windowRegistry`).
 *   - The overlay bridge (preload/find-in-page.ts) calls
 *     `window.astro.find(text, opts)` → ipcRenderer.invoke('find-in-page:find')
 *     which this module handles by calling `target.webContents.findInPage()`.
 *   - Found-in-page results are listened for on the target webContents and
 *     forwarded back to the overlay via `overlay.webContents.send('find:result')`.
 *
 * Security: contextIsolation + sandbox + nodeIntegration:false + webSecurity:true.
 */

import { app, BrowserWindow, ipcMain, type Event, type Result } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { windowRegistry } from './registry.js'

const findReqSchema = z.object({
  text: z.string(),
  forward: z.boolean().default(true),
  matchCase: z.boolean().default(false),
  findNext: z.boolean().default(false),
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173'

export interface CreateFindInPageOptions {
  preloadDir: string
}

interface FindIpcState {
  registered: boolean
  overlay: BrowserWindow | null
  targetId: number | null
  onFound: ((event: Event, result: Result) => void) | null
}

const state: FindIpcState = {
  registered: false,
  overlay: null,
  targetId: null,
  onFound: null,
}

function attachResultListener(target: BrowserWindow, overlay: BrowserWindow): void {
  detachResultListener()
  const handler = (_e: Event, result: Result) => {
    if (overlay.isDestroyed()) return
    overlay.webContents.send('find:result', {
      requestId: result.requestId,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate,
    })
  }
  target.webContents.on('found-in-page', handler)
  state.onFound = handler
  state.targetId = target.id
}

function detachResultListener(): void {
  if (state.targetId != null && state.onFound) {
    const target = BrowserWindow.fromId(state.targetId)
    if (target && !target.isDestroyed()) {
      target.webContents.off('found-in-page', state.onFound)
    }
  }
  state.onFound = null
  state.targetId = null
}

function registerIpcOnce(): void {
  if (state.registered) return
  state.registered = true

  ipcMain.handle('find-in-page:find', (_event, raw) => {
    const parsed = findReqSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`find-in-page:find: invalid request — ${parsed.error.message}`)
    }
    const req = parsed.data
    if (state.targetId == null) throw new Error('find-in-page: no target window')
    const target = BrowserWindow.fromId(state.targetId)
    if (!target || target.isDestroyed()) throw new Error('find-in-page: target window gone')
    if (!req.text) {
      target.webContents.stopFindInPage('clearSelection')
      return { ok: true as const }
    }
    target.webContents.findInPage(req.text, {
      forward: req.forward,
      matchCase: req.matchCase,
      findNext: req.findNext,
    })
    return { ok: true as const }
  })

  ipcMain.handle('find-in-page:stop', () => {
    if (state.targetId == null) return { ok: true as const }
    const target = BrowserWindow.fromId(state.targetId)
    if (target && !target.isDestroyed()) {
      target.webContents.stopFindInPage('clearSelection')
    }
    return { ok: true as const }
  })

  ipcMain.handle('find-in-page:close', () => {
    hideFindInPage()
    return { ok: true as const }
  })
}

/**
 * Show (creating if needed) the find-in-page overlay. The currently
 * focused BrowserWindow becomes the target.
 */
export async function showFindInPage(options: CreateFindInPageOptions): Promise<BrowserWindow> {
  registerIpcOnce()

  // Resolve target = currently focused window (excluding the overlay itself).
  const focused = BrowserWindow.getFocusedWindow()
  const target =
    focused && state.overlay !== focused ? focused : windowRegistry.get('main') ?? null
  if (!target) throw new Error('find-in-page: no target window to search')

  if (state.overlay && !state.overlay.isDestroyed()) {
    attachResultListener(target, state.overlay)
    positionOverTarget(state.overlay, target)
    state.overlay.show()
    state.overlay.focus()
    return state.overlay
  }

  const overlay = new BrowserWindow({
    width: 360,
    height: 48,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#1A1A1D',
    parent: target,
    webPreferences: {
      preload: path.join(options.preloadDir, 'find-in-page.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  state.overlay = overlay
  windowRegistry.register('find-in-page', overlay)

  overlay.on('closed', () => {
    detachResultListener()
    if (state.overlay === overlay) state.overlay = null
  })
  overlay.on('blur', () => {
    // Auto-hide on blur so it behaves like a native find bar.
    if (!overlay.isDestroyed()) overlay.hide()
  })

  attachResultListener(target, overlay)
  positionOverTarget(overlay, target)

  if (isDev) {
    await overlay.loadURL(`${DEV_SERVER_URL}/electron/renderers/find_in_page/index.html`)
  } else {
    // Forge vite plugin packs additional HTML entries under
    // .vite/renderer/main_window/. Main bundle lives in .vite/build/.
    const indexPath = path.join(
      __dirname,
      '../renderer/main_window/electron/renderers/find_in_page/index.html',
    )
    await overlay.loadFile(indexPath)
  }

  overlay.once('ready-to-show', () => {
    overlay.show()
    overlay.focus()
  })

  return overlay
}

export function hideFindInPage(): void {
  if (state.overlay && !state.overlay.isDestroyed()) {
    state.overlay.hide()
  }
  detachResultListener()
}

function positionOverTarget(overlay: BrowserWindow, target: BrowserWindow): void {
  const tb = target.getBounds()
  const ob = overlay.getBounds()
  const x = Math.round(tb.x + tb.width - ob.width - 24)
  const y = Math.round(tb.y + 60)
  overlay.setBounds({ x, y, width: ob.width, height: ob.height })
}
