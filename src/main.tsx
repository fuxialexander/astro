import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './globals.css'
import './i18n/config'
import './i18n/types'
import App from './app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
