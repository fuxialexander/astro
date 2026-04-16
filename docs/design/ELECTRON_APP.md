# Electron Desktop App

> **Status: IMPLEMENTED** — Astro ships as an Electron desktop app. The shell, server sidecar, IPC broker, typed channel surface, auto-updater, and packaging pipeline (electron-forge) are all in place. Source lives under `electron/`.
>
> **See also:** [DESKTOP_UI_SPEC.md](./DESKTOP_UI_SPEC.md) for the renderer-side three-panel layout and pane system. [PACKAGE_ARCHITECTURE.md](./PACKAGE_ARCHITECTURE.md) for how the desktop app composes with `@astro/core`, the CLI, and the agent runner.

## Overview

The desktop app is a thin Electron shell that hosts the existing React renderer and forks the Hono server as a child utility process. The same `src/` frontend ships to both the web deploy (Cloudflare Pages) and the desktop build — the renderer feature-detects desktop mode via `isDesktop()` and opts into the native IPC surface when available.

The Electron shell replaced the legacy Tauri scaffold. What was previously a Rust app with a Node.js sidecar is now a Node main process with a `utilityProcess`-hosted server; Rust native commands for filesystem and terminal were reimplemented as typed IPC handlers in `electron/main/ipc/channels/`.

## Architecture

```
+-----------------------------------------------------------------+
|  Electron Main Process (electron/main/index.ts)                 |
|  - Thin coordinator: window lifecycle, CSP, single-instance     |
|  - Registers every typed IPC channel before windows load        |
|  - Starts the server supervisor + auto-updater                  |
|                                                                 |
|  +-------------------+    +--------------------+                |
|  |  IPC Registry     |    |  Stream Broker     |                |
|  |  (registry.ts)    |    |  (broker.ts)       |                |
|  |  request/response |    |  MessagePort fan-  |                |
|  |  Zod-validated    |    |  out for PTY, fs,  |                |
|  |  invoke handlers  |    |  git watchers      |                |
|  +-------------------+    +--------------------+                |
|           |                         |                           |
|           | ipcMain.handle          | MessageChannelMain        |
+-----------|-------------------------|---------------------------+
            |                         |
            |                         | (one port per window)
+-----------|-------------------------|---------------------------+
|  Renderer (BrowserWindow)                                       |
|  - contextIsolation + sandbox + nodeIntegration:false           |
|  - Preload exposes `window.astro.{invoke, streams, platform}`   |
|  - src/ renderer calls through src/lib/desktop-bridge.ts        |
+-----------------------------------------------------------------+
            |
            | HTTP on 127.0.0.1:<port>  (same as web)
            v
+-----------------------------------------------------------------+
|  Server utilityProcess (electron/main/services/server-process.ts)|
|  - Forks server/dist/index.js                                   |
|  - Hono API + relay WS + PGlite + dispatch engine, unchanged    |
|  - Supervised with restart/backoff; killed cleanly on quit      |
|  - stdout/stderr piped to main-process logs                     |
+-----------------------------------------------------------------+
```

### Architectural invariants

These rules are enforced in `electron/main/index.ts` and the channel registration code:

1. The main process is thin — coordination + window lifecycle only. No business logic, no file I/O on the main thread.
2. Blocking work lives elsewhere: `utilityProcess` for the server and plugins; `worker_threads` for terminal, git, fs-watcher.
3. Every `BrowserWindow` uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
4. All IPC channels are typed via Zod schemas (`electron/main/ipc/schema/`).
5. High-frequency streams (PTY output, watcher events) use `MessagePortMain`, not `ipcMain` round-trips.
6. Plugin code never runs in the main renderer process.
7. The web deploy is unaffected — the same `src/` ships to both targets.

## IPC Channel Surface

Channels are registered in `electron/main/ipc/channels/index.ts` via `registerAllChannels()` during `app.whenReady`, before any window loads. Each channel has a matching Zod schema under `electron/main/ipc/schema/`.

| Group | Channel file | Purpose |
|-------|-------------|---------|
| `fs` | `channels/fs.ts` | Stat, list-dir, read-file, write-file — replaces Tauri's Rust FS commands |
| `git` | `channels/git.ts` | Worker-backed status, diff, log, branch operations |
| `pdf` | `channels/pdf.ts` | PDF rendering + extraction for the research pane |
| `terminal` | `channels/terminal.ts` | PTY session management (lifecycle) |
| `terminal-spawn` | `channels/terminal-spawn.ts` | Spawn a new PTY in a worker, pipe output over the broker |
| `dialog` | `channels/dialog.ts` | Native open/save dialogs |
| `editor` | `channels/editor.ts` | Detect installed external editors (VS Code, Cursor, etc.) and hand off files |
| `layout` | `channels/layout.ts` | Persist and restore pane layouts |
| `plugin` | `channels/plugin.ts` | Plugin lifecycle: load/unload sandboxed plugin bundles |
| `server` | `channels/server.ts` | Query the server supervisor: port, status, restart |
| `watcher` | `channels/watcher.ts` | Filesystem watchers, batched events via the broker |
| `windows` | `channels/windows.ts` | List/focus/create additional windows |

Every renderer call flows through a single entry point exposed by the preload:

```ts
// src/lib/desktop-bridge.ts
window.astro.invoke('fs:stat', { path: '/tmp/foo' })
window.astro.streams.subscribe('terminal:pane-7:data', (chunk) => ...)
```

Types for every `invoke` channel are generated from the Zod schemas by `scripts/gen-ipc-bridge.ts` into `src/lib/desktop-bridge.generated.ts`, so the renderer gets end-to-end type safety without hand-written glue. Run `npm run gen:ipc` after editing any schema.

## Security Posture

- **Context isolation:** the preload bridge is the only way the renderer touches Node APIs. Everything else is blocked.
- **Typed schemas:** every IPC request and response is validated against a Zod schema in `electron/main/ipc/schema/` before the handler runs. Invalid payloads are rejected at the broker boundary.
- **CSP:** installed via `webRequest` response headers in `electron/main/security/csp.ts`. No `unsafe-eval`, strict `connect-src` to the local server port and known remotes.
- **Plugin protocol:** plugin bundles load over a custom `astro-plugin://` scheme registered in `electron/main/security/plugin-protocol.ts`, not `file://` — so plugin code can't escape its sandbox via path traversal.
- **Sandbox:** `sandbox: true` on every window; plugin code additionally runs in a separate utility process (`electron/plugin-runtime/`) rather than the main renderer.
- **Single-instance lock:** a second launch focuses the existing window rather than racing PGlite for the data-dir lockfile.

## Server Sidecar Lifecycle

`electron/main/services/server-process.ts` forks `server/dist/index.js` as an Electron `utilityProcess`. The wrapper around it, `services/supervisor.ts`, handles restart-with-backoff and ties the process to the app lifecycle so `app.quit()` tears the server down cleanly (critical for PGlite's data-dir lockfile).

- `scripts/build-server.ts` bundles the server into `server/dist/` using esbuild, which `forge.config.ts` then copies into the packaged app as an extra resource.
- The main process blocks on `/api/health` before showing the first window — the renderer never sees an "API offline" flash.
- stdout/stderr are piped into the main-process logs (prefixed `[server]` / `[server!]`) for debugging.

## Build & Packaging

Build is driven by **electron-forge** with the Vite plugin (`electron/forge.config.ts`):

- `VitePlugin` builds the main process (`electron/main/index.ts`), the preload (`electron/preload/index.ts`), and the renderer (`src/` via `electron/vite.renderer.config.ts`).
- `extraResource` copies `server/dist/`, `drizzle/` (migrations), and `skills/` into `Contents/Resources` on macOS (or `resources/` on Win/Linux) so `env.ts`'s `process.resourcesPath` lookups resolve in packaged builds.
- **Makers:** `MakerDMG` + `MakerZIP` (macOS), `MakerSquirrel` (Windows), `MakerDeb` + `MakerRpm` (Linux).
- **Signing/notarization** (macOS): gated on `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`. Entitlements live at `electron/entitlements.mac.plist`. Local builds without these env vars skip signing (unsigned dev builds still run).
- **Publishing:** `PublisherGithub` is attached when `GITHUB_TOKEN` is set, producing draft prereleases on the `astro-anywhere/astro` repo.

## Renderer Desktop-Mode Detection

The renderer is mode-aware without a compile-time split:

```ts
// src/lib/desktop-detect.ts
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as any).astro?.platform?.isElectron)
}
```

The preload sets `window.astro.platform.isElectron = true`. In the web build this global is never present, so `isDesktop()` returns `false` and every desktop-only method in `src/lib/desktop-bridge.ts` throws a clear "desktop only" error. Components under `src/components/desktop/` (FileBrowser, TerminalTab, GitChangesPanel, QuickLook) gate their rendering on `isDesktop()`. The pane system (`src/components/panes/`) registers desktop-only pane kinds conditionally.

## What Moved From Tauri

| Tauri artifact | Electron equivalent |
|----------------|--------------------|
| `src-tauri/src/main.rs` | `electron/main/index.ts` |
| `#[tauri::command]` Rust functions for fs/terminal/git | Typed IPC handlers under `electron/main/ipc/channels/` with Zod schemas |
| Tauri sidecar (Node.js) | `utilityProcess` managed by `electron/main/services/server-process.ts` + `supervisor.ts` |
| `tauri.conf.json` | `electron/forge.config.ts` |
| Tauri IPC (`invoke(cmd)`) | `window.astro.invoke(channel, payload)` via preload contextBridge |
| Tauri events | `MessagePortMain` streams fanned out by the broker (`electron/main/ipc/broker.ts`) |
| `__TAURI__` window global | `window.astro` exposed by `electron/preload/main.ts` |
| `tauri-build.rs` | Vite plugin inside electron-forge |
| Tauri updater plugin | `electron-updater` wired in `electron/main/updater.ts` |
| Rust-backed CSP | `webRequest` header injection in `electron/main/security/csp.ts` |

The broad shape is preserved — main process remains a thin coordinator, the renderer remains the existing React app, and the server remains the unchanged Hono + PGlite + dispatch engine. Only the host runtime changed from Rust to Node, trading ~5 MB of binary size for a single-language stack and first-class access to the npm ecosystem (notably `node-pty`, `chokidar`, `isomorphic-git`, and `electron-updater`).

## Key Files

| File | Role |
|------|------|
| `electron/main/index.ts` | Main process entry: windows, CSP, supervisor, IPC bootstrap |
| `electron/main/ipc/broker.ts` | `MessageChannelMain`-based stream broker for high-frequency events |
| `electron/main/ipc/registry.ts` | `ipcMain.handle` registrar, dedup + collision detection |
| `electron/main/ipc/channels/` | Typed handlers, grouped by surface (fs, git, pdf, terminal, etc.) |
| `electron/main/ipc/schema/` | Zod request/response schemas — source for codegen |
| `electron/main/services/server-process.ts` | `utilityProcess` fork + health-check |
| `electron/main/services/supervisor.ts` | Restart/backoff + lifecycle binding |
| `electron/main/security/csp.ts` | CSP via `webRequest` header injection |
| `electron/main/security/plugin-protocol.ts` | `astro-plugin://` scheme registration |
| `electron/preload/main.ts` | contextBridge: exposes `window.astro.invoke` + streams |
| `electron/forge.config.ts` | Packaging: makers, signing, extraResource |
| `electron/entitlements.mac.plist` | macOS hardened-runtime entitlements |
| `src/lib/desktop-bridge.ts` | Renderer-side typed wrapper around `window.astro.*` |
| `src/lib/desktop-bridge.generated.ts` | Codegen output of `scripts/gen-ipc-bridge.ts` |
| `src/lib/desktop-detect.ts` | `isDesktop()` runtime check |
| `src/components/desktop/` | Desktop-only components (FileBrowser, TerminalTab, …) |
| `src/components/panes/` | Pane host + registry for the three-panel layout |
| `scripts/build-server.ts` | esbuild bundler for the server sidecar |
| `scripts/gen-ipc-bridge.ts` | Generates typed IPC surface from Zod schemas |
