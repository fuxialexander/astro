/**
 * TerminalTab — a single xterm.js instance connected to a Rust PTY.
 *
 * Listens for `terminal-output-{sessionId}` Tauri events for output.
 * Sends keystrokes via invoke('write_terminal') for input.
 * Auto-fits to the container on resize.
 */
import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { writeTerminal } from '@desktop/lib/tauri-bridge'
import '@xterm/xterm/css/xterm.css'

interface TerminalTabProps {
  sessionId: string
  active: boolean
}

export function TerminalTab({ sessionId, active }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const initializedRef = useRef(false)

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
      lineHeight: 1,
      scrollback: 10000,
      theme: {
        // Light theme matching app palette
        background: '#ffffff',
        foreground: '#1a1a1a',
        cursor: '#333333',
        cursorAccent: '#ffffff',
        selectionBackground: '#b4d5fe',
        selectionForeground: '#1a1a1a',
        black: '#000000',
        red: '#cd3131',
        green: '#00bc00',
        yellow: '#949800',
        blue: '#0451a5',
        magenta: '#bc05bc',
        cyan: '#0598bc',
        white: '#555555',
        brightBlack: '#686868',
        brightRed: '#cd3131',
        brightGreen: '#14ce14',
        brightYellow: '#b5ba00',
        brightBlue: '#0451a5',
        brightMagenta: '#bc05bc',
        brightCyan: '#0598bc',
        brightWhite: '#a5a5a5',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(containerRef.current)

    // Try WebGL renderer for performance, fall back gracefully
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch {
      // Canvas renderer fallback — no action needed
    }

    fitAddon.fit()
    // Initial PTY size sync — use actual rendered dimensions
    void invoke('resize_terminal', {
      id: sessionId,
      cols: term.cols,
      rows: term.rows,
    })

    // Handle user input → send to Rust PTY
    term.onData((data: string) => {
      void writeTerminal(sessionId, data)
    })

    termRef.current = term
    fitAddonRef.current = fitAddon
    initializedRef.current = true

    return () => {
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      initializedRef.current = false
    }
  }, [sessionId])

  // Listen for output from the Rust PTY
  useEffect(() => {
    const unlisten = listen<string>(`terminal-output-${sessionId}`, (event) => {
      termRef.current?.write(event.payload)
    })

    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [sessionId])

  // Fit xterm to container AND sync PTY dimensions in Rust
  const fit = useCallback(() => {
    if (!active || !fitAddonRef.current || !termRef.current) return
    try {
      fitAddonRef.current.fit()
      const { cols, rows } = termRef.current
      void invoke('resize_terminal', { id: sessionId, cols, rows })
    } catch {
      // Ignore fit errors during panel transitions
    }
  }, [active, sessionId])

  useEffect(() => {
    fit()
  }, [active, fit])

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(fit)
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => observer.disconnect()
  }, [fit])

  // Focus terminal when active
  useEffect(() => {
    if (active) {
      termRef.current?.focus()
    }
  }, [active])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{
        display: active ? 'block' : 'none',
        backgroundColor: '#ffffff',
        padding: '4px 0 0 8px',
      }}
    />
  )
}
