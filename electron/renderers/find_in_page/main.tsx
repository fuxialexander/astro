/**
 * Find-in-page overlay renderer.
 *
 * Tiny React UI driving the main-process `findInPage()` bridge. Keeps
 * only the strict minimum: an input, prev/next, a match counter, and
 * a close button. No app-wide state, no store. This is a leaf window.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

interface FindResult {
  requestId: number
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

interface FindBridge {
  find: (text: string, opts?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) => Promise<{ ok: true }>
  stop: () => Promise<{ ok: true }>
  close: () => Promise<{ ok: true }>
  onResult: (cb: (r: FindResult) => void) => () => void
}

// Each aux window's preload exposes its own `window.astro` surface.
// Cast through `unknown` so we don't conflict with the main-window
// bridge type that lives in `electron/preload/main.ts`.
const bridge = (window as unknown as { astro: FindBridge }).astro

export function App(): React.ReactElement {
  const [text, setText] = useState('')
  const [result, setResult] = useState<FindResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Displayed counts are derived from text + latest result — no need
  // to mirror them into state.
  const active = text ? (result?.activeMatchOrdinal ?? 0) : 0
  const total = text ? (result?.matches ?? 0) : 0

  useEffect(() => {
    const off = bridge.onResult((r) => {
      setResult(r)
    })
    inputRef.current?.focus()
    return off
  }, [])

  const runFind = useCallback(
    (forward: boolean, findNext: boolean) => {
      if (!text) {
        void bridge.stop()
        return
      }
      void bridge.find(text, { forward, findNext })
    },
    [text]
  )

  // Kick off a fresh search whenever the text changes.
  useEffect(() => {
    if (!text) {
      void bridge.stop()
      return
    }
    void bridge.find(text, { forward: true, findNext: false })
  }, [text])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      runFind(!e.shiftKey, true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      void bridge.close()
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Find"
        style={{
          flex: 1,
          background: '#2a2a2e',
          color: '#e6e6e6',
          border: '1px solid #3a3a3e',
          borderRadius: 4,
          padding: '4px 8px',
          font: 'inherit',
          outline: 'none',
        }}
      />
      <span style={{ fontVariantNumeric: 'tabular-nums', color: '#9a9a9f', minWidth: 36, textAlign: 'right' }}>
        {total === 0 ? '0/0' : `${active}/${total}`}
      </span>
      <button type="button" onClick={() => runFind(false, true)} title="Previous" style={btnStyle}>
        {'\u2191'}
      </button>
      <button type="button" onClick={() => runFind(true, true)} title="Next" style={btnStyle}>
        {'\u2193'}
      </button>
      <button type="button" onClick={() => bridge.close()} title="Close" style={btnStyle}>
        {'\u00d7'}
      </button>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#c6c6c9',
  border: '1px solid #3a3a3e',
  borderRadius: 4,
  width: 24,
  height: 24,
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('find-in-page: #root missing')
createRoot(rootEl).render(<App />)
