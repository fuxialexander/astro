/**
 * About window renderer. Displays app/runtime versions pulled from the
 * main process via `window.astro.getVersions()`.
 */

import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

interface AboutVersions {
  appName: string
  appVersion: string
  electron: string
  chrome: string
  node: string
  v8: string
}

interface AboutBridge {
  getVersions: () => Promise<AboutVersions>
}

const bridge = (window as unknown as { astro: AboutBridge }).astro

export function App(): React.ReactElement {
  const [v, setV] = useState<AboutVersions | null>(null)

  useEffect(() => {
    void bridge.getVersions().then(setV)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 24,
        boxSizing: 'border-box',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 22, margin: '0 0 4px', fontWeight: 600 }}>
        {v?.appName ?? 'Astro'}
      </h1>
      <div style={{ color: '#9a9a9f', marginBottom: 18 }}>
        Version {v?.appVersion ?? '...'}
      </div>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          columnGap: 12,
          rowGap: 4,
          margin: 0,
          fontSize: 12,
          color: '#c6c6c9',
        }}
      >
        <dt style={{ textAlign: 'right', color: '#7a7a7f' }}>Electron</dt>
        <dd style={{ margin: 0, textAlign: 'left' }}>{v?.electron ?? '...'}</dd>
        <dt style={{ textAlign: 'right', color: '#7a7a7f' }}>Chromium</dt>
        <dd style={{ margin: 0, textAlign: 'left' }}>{v?.chrome ?? '...'}</dd>
        <dt style={{ textAlign: 'right', color: '#7a7a7f' }}>Node</dt>
        <dd style={{ margin: 0, textAlign: 'left' }}>{v?.node ?? '...'}</dd>
        <dt style={{ textAlign: 'right', color: '#7a7a7f' }}>V8</dt>
        <dd style={{ margin: 0, textAlign: 'left' }}>{v?.v8 ?? '...'}</dd>
      </dl>
      <div
        style={{
          marginTop: 18,
          fontSize: 11,
          color: '#7a7a7f',
          maxWidth: 340,
          lineHeight: 1.5,
        }}
      >
        Licensed under the terms in the repository LICENSE file.
      </div>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('about-window: #root missing')
createRoot(rootEl).render(<App />)
