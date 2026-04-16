# Electron shell

Electron desktop shell for Astro. Replaces the legacy Tauri scaffold.

Design doc: [`docs/design/ELECTRON_APP.md`](../docs/design/ELECTRON_APP.md) — architecture, IPC surface, and architectural invariants.

## Layout

```
electron/
├── main/                # main process (Node)
│   ├── index.ts         # app entry
│   ├── env.ts
│   ├── updater.ts
│   ├── ipc/             # typed IPC channels (Zod schemas)
│   ├── plugin/
│   ├── security/        # CSP installer
│   ├── services/        # server utilityProcess supervisor, etc.
│   └── windows/         # window factories + registry
├── preload/             # contextBridge scripts (main, about, find-in-page, template)
├── plugin-runtime/      # plugin host runtime
├── renderers/           # auxiliary windows (about, find-in-page, template)
└── dist/                # tsc output (gitignored)
```

## Dev workflow

```bash
pnpm run electron:dev
# Concurrently runs:
#   - Vite dev server on http://localhost:5173 (src/main.tsx SPA)
#   - tsc -w on electron/ → electron/dist/
#   - electron electron/dist/main/index.js once Vite + tsc are ready
```

The web deploy (Cloudflare Pages + Fly.io) ships the same `src/` renderer and is unaffected by this directory.
