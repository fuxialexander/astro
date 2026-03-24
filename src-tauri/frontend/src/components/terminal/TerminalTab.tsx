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
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
      lineHeight: 1.3,
      scrollback: 10000,
      theme: {
        background: 'transparent',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#d7ba7d',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#d7ba7d',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#e5e5e5',
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

  // Auto-fit on visibility change and resize
  const fit = useCallback(() => {
    if (active && fitAddonRef.current) {
      try {
        fitAddonRef.current.fit()
      } catch {
        // Ignore fit errors during transitions
      }
    }
  }, [active])

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
        backgroundColor: '#1e1e1e',
        padding: '4px 0 0 8px',
      }}
    />
  )
}
