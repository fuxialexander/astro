/**
 * TerminalTab — a single xterm.js instance backed by an Electron PTY session.
 *
 * Ported from the legacy Tauri shell. This version routes through
 * `desktopBridge.terminal.*`, where:
 *
 *   - `terminal:spawn` returns a `{ sessionId, pid }` once the PTY is up
 *   - `terminal.onData(sessionId, ...)` subscribes to the broker stream
 *   - `terminal.write` / `resize` / `kill` are typed RPCs
 *
 * NOTE: the Electron terminal channel is a NOT_IMPLEMENTED stub until
 * `node-pty` is rebuilt against the Electron ABI (Phase 2B follow-up). Any
 * call from this component will currently throw a structured IPC error —
 * the component will catch and render the error inline rather than crash.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'

import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import '@xterm/xterm/css/xterm.css'

interface TerminalTabProps {
  /** Working directory the PTY should spawn in. */
  cwd: string
  /** Whether this tab is currently visible — drives focus + fit. */
  active: boolean
  /** Optional shell override (defaults to user's login shell). */
  shell?: string
}

export function TerminalTab({ cwd, active, shell }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  // Lock in the cwd on first mount — changing the working directory mid-session
  // would kill the running PTY and show a spurious exit message.
  const cwdRef = useRef(cwd)
  // Set to true during cleanup so the onExit callback doesn't print the exit
  // banner when the PTY is killed by us (unmount, cwd change, toggle-off).
  const cleaningUpRef = useRef(false)
  const [error, setError] = useState<string | null>(() =>
    isDesktop() ? null : 'Terminal is only available in the desktop app',
  )

  const getTerminalColors = useCallback(() => {
    const rootStyles = getComputedStyle(document.documentElement)
    const background = rootStyles.getPropertyValue('--background').trim() || '#ffffff'
    const foreground = rootStyles.getPropertyValue('--foreground').trim() || '#1a1a1a'
    const border = rootStyles.getPropertyValue('--border').trim() || '#e4e4e7'
    const accent = rootStyles.getPropertyValue('--accent').trim() || '#f0f0f2'
    return { background, foreground, border, accent }
  }, [])

  // Initialize xterm + spawn PTY session.
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return
    if (!isDesktop()) return

    const colors = getTerminalColors()
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: [
        '"MesloLGS NF"',
        '"JetBrainsMono Nerd Font"',
        '"Hack Nerd Font Mono"',
        '"Symbols Nerd Font Mono"',
        '"SauceCodePro Nerd Font"',
        'ui-monospace',
        '"SF Mono"',
        '"Cascadia Code"',
        '"Fira Code"',
        'Menlo',
        'monospace',
      ].join(', '),
      lineHeight: 1,
      scrollback: 10000,
      theme: {
        background: colors.background,
        foreground: colors.foreground,
        cursor: colors.foreground,
        cursorAccent: colors.background,
        selectionBackground: colors.accent,
        selectionForeground: colors.foreground,
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => webglAddon.dispose())
      term.loadAddon(webglAddon)
    } catch {
      // Canvas fallback
    }

    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon
    initializedRef.current = true

    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null
    let cancelled = false

    void (async () => {
      try {
        const { sessionId } = await desktopBridge.terminal.spawn({
          cwd: cwdRef.current,
          shell,
          cols: term.cols,
          rows: term.rows,
        })
        if (cancelled) {
          await desktopBridge.terminal.kill(sessionId).catch(() => {})
          return
        }
        sessionIdRef.current = sessionId

        unsubData = desktopBridge.terminal.onData(sessionId, (chunk) => {
          termRef.current?.write(chunk)
        })
        unsubExit = desktopBridge.terminal.onExit(sessionId, (info) => {
          if (!cleaningUpRef.current) {
            termRef.current?.write(`\r\n[exited code=${info.code} signal=${info.signal}]\r\n`)
          }
        })

        term.onData((data: string) => {
          void desktopBridge.terminal.write(sessionId, data).catch(() => {})
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cleaningUpRef.current = true
      cancelled = true
      unsubData?.()
      unsubExit?.()
      const id = sessionIdRef.current
      sessionIdRef.current = null
      if (id) void desktopBridge.terminal.kill(id).catch(() => {})
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      initializedRef.current = false
      cleaningUpRef.current = false
    }
  }, [getTerminalColors, shell])

  // Fit + resync PTY dimensions.
  //
  // xterm v6.1's `term.resize()` (invoked internally by FitAddon.fit()) does
  // reflow the buffer — long lines get re-wrapped at the new column width,
  // and wrapped lines get re-joined when expanding. But the WebGL renderer
  // doesn't always repaint after a buffer reflow: the cells move but the
  // texture cache still shows the old layout. Forcing `term.refresh(0, rows-1)`
  // after fit guarantees a full redraw so the reflowed lines actually appear.
  const fit = useCallback(() => {
    if (!active || !fitAddonRef.current || !termRef.current) return
    try {
      const term = termRef.current
      fitAddonRef.current.fit()
      // Force a full repaint so the WebGL renderer picks up the reflowed cells.
      term.refresh(0, term.rows - 1)
      const { cols, rows } = term
      const id = sessionIdRef.current
      if (id) void desktopBridge.terminal.resize(id, cols, rows).catch(() => {})
    } catch {
      // ignore transient fit failures during panel transitions
    }
  }, [active])

  useEffect(() => {
    fit()
  }, [active, fit])

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(fit)
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [fit])

  useEffect(() => {
    if (active) termRef.current?.focus()
  }, [active])

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-xs text-muted-foreground">
        <div className="max-w-md text-center">
          <div className="font-medium text-foreground mb-1">Terminal unavailable</div>
          <div className="font-mono text-[10px] break-words">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{
        display: active ? 'block' : 'none',
        backgroundColor: 'var(--background)',
        padding: '4px 0 0 8px',
      }}
    />
  )
}
