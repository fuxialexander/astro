#!/usr/bin/env node --import tsx/esm
/**
 * Astro TUI — Interactive terminal user interface.
 *
 * Usage:
 *   npx tsx packages/tui/src/index.tsx [--server-url <url>]
 *   npm run astro-tui [-- --server-url <url>]
 */
import React from 'react'
import { render } from 'ink'
import { App } from './app.js'

// Parse CLI args
const args = process.argv.slice(2)
let serverUrl: string | undefined

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--server-url' && args[i + 1]) {
    serverUrl = args[i + 1]
    i++
  }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Astro TUI — Interactive terminal user interface

Usage:
  astro-tui [options]

Options:
  --server-url <url>  Backend server URL (default: from config)
  --help, -h          Show this help message

Keybindings:
  hjkl / arrows   Navigate panels and items
  Tab / 1-4       Switch panel focus
  Enter           Select / expand
  :               Command mode
  /               Search mode
  d               Dispatch selected task
  c               Cancel running task
  r               Refresh data
  ?               Show help
  q               Quit
`)
    process.exit(0)
  }
}

// Render the TUI
render(<App serverUrl={serverUrl} />, {
  exitOnCtrlC: true,
})
