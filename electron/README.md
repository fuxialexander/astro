# Electron shell

This directory contains the Electron desktop shell for Astro. It replaces the
legacy Tauri shell, which has now been removed from the repo. See
`/Users/xf2217/.claude/plans/piped-sleeping-robin.md` for the full migration
plan (architecture, phases, file map).

## Layout (Phase 0)

```
electron/
├── main/                       # main process (Node)
│   ├── index.ts                # app entry
│   ├── security/csp.ts         # CSP installer
│   └── windows/
│       ├── main-window.ts      # primary shell window factory
│       └── registry.ts         # WindowRegistry singleton
├── preload/
│   └── main.ts                 # contextBridge for main window
├── tsconfig.electron.json      # tsc config for main + preload
└── dist/                       # tsc output (gitignored)
```

Future phases add `services/`, `ipc/`, `workers/`, `plugin/`, `plugin-runtime/`,
`renderers/`, and additional windows. Reference
`/Users/xf2217/.claude/plans/piped-sleeping-robin.md` for the full target
layout.

## Dev workflow

```bash
# Phase 0: just the shell + existing SPA, no server, no IPC
pnpm run electron:dev
# This concurrently starts:
#   - Vite dev server on http://localhost:5173 (existing src/main.tsx SPA)
#   - tsc -w on electron/ → electron/dist/
#   - electron electron/dist/main/index.js once Vite + tsc are ready
```

## Architectural invariants

These rules are non-negotiable (from the migration plan, design principles 1–9):

1. Main process is thin. No business logic, no file I/O on the main thread.
2. Everything blocking lives elsewhere (utilityProcess for server + plugins,
   worker_threads for terminal/git/fs-watcher).
3. Every BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true`, `webSecurity: true`.
4. All IPC channels are typed via Zod schemas (Phase 2).
5. High-frequency streams use MessagePort, not ipcMain round-trips.
6. Plugin code never runs in the main renderer process.
7. Web deploy (Cloudflare Pages + Fly.io) is unaffected by anything in this
   directory — same `src/` ships to both targets.
