/**
 * Template window renderer — scaffold to copy when adding a new aux
 * window. See ./README.md for the step-by-step.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

interface TemplateBridge {
  ping: () => Promise<{ ok: true }>
}

// Example of accessing the preload bridge. Unused in this scaffold —
// wire it up when you add real behavior.
void ((window as unknown as { astro: TemplateBridge }).astro)

export function App(): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
      }}
    >
      <h1 style={{ fontSize: 18, margin: 0 }}>Template Window</h1>
      <p style={{ color: '#9a9a9f', margin: 0, fontSize: 12 }}>
        Copy this scaffold to add a new aux window. See README.md.
      </p>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('template-window: #root missing')
createRoot(rootEl).render(<App />)
