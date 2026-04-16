import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './globals.css'
import './i18n/config'
import './i18n/types'
import App from './app'
import { PanesDetachedPage } from './pages/panes-detached'
import { ThemeProvider } from './components/theme-provider'
// Short-circuit for detached pane BrowserWindows spawned by the Electron
// main process (see electron/main/windows/detached-pane-window.ts). These
// windows load the same index.html but pass `?astroDetached=1` so we skip
// the full App tree (router, DataLoader, auth) and render a single pane.
const isDetachedPaneWindow =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('astroDetached') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDetachedPaneWindow ? (
      <ThemeProvider defaultTheme="system">
        <PanesDetachedPage />
      </ThemeProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
)
