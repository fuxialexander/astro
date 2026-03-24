# Tauri Desktop App Vision

> **Status: IN PROGRESS** -- The `src-tauri/` scaffold is implemented (Rust app shell, Node.js sidecar lifecycle, native menus, system tray, deep links). The next milestone is adding Rust native commands for filesystem and terminal operations, followed by a dedicated desktop frontend.

> **See also:** [PACKAGE_ARCHITECTURE.md](./PACKAGE_ARCHITECTURE.md) for the full monorepo package structure (`@astro/core`, `@astro/cli`, `server/`, `@astroanywhere/agent-runner`, Tauri desktop) and how they compose across deployment scenarios. See [DESKTOP_UI_SPEC.md](./DESKTOP_UI_SPEC.md) for the three-panel desktop frontend specification.

## Motivation

The current Astro architecture has a fundamental filesystem gap:

```
Frontend (Cloudflare Pages)  -->  no filesystem access
Backend (Fly.io)             -->  no access to user's filesystem
Agent Runner (user machine)  -->  has filesystem, no UI
```

No single component has **both** filesystem access and UI rendering. This forces a complex relay architecture to bridge the gap: the frontend asks the backend, which asks the relay, which asks the agent runner on the user's machine.

For machine-local resources -- plugins, skills, file trees, git operations -- this indirection adds latency, complexity, and fragility. A desktop app eliminates this gap.

Beyond the technical benefits, the desktop app enables a **Codex-like UX** -- a focused, three-panel interface designed for conversational AI-assisted development, with direct filesystem access, integrated terminal, and zero-latency local operations.

## Desktop-First UI Vision

The desktop app breaks from the web app's general-purpose layout. It follows a **Codex-like three-panel pattern** optimized for AI-assisted planning and execution:

```
+------------------+----------------------------+--------------------+
|                  |                            |                    |
|  Project         |  Thread / Chat Panel       |  Review / Diff     |
|  Sidebar         |                            |  Pane              |
|                  |  > User: Build the auth    |                    |
|  [P] astro       |    module with passkeys    |  src/auth.ts       |
|  [P] research    |                            |  + import { ... }  |
|  [P] cli         |  > AI: I'll break this     |  + export class    |
|                  |    into 3 tasks:            |    AuthProvider {  |
|  Threads         |    1. Schema migration     |  - // old impl     |
|  > Auth module   |    2. Provider class       |  + // new impl     |
|  > Bug fix #42   |    3. UI components        |                    |
|  > Deploy prep   |                            |  Terminal           |
|                  |  [Input area]              |  $ npm test        |
|                  |                            |  PASS 12/12        |
+------------------+----------------------------+--------------------+
```

**Key UX principles:**
- **Conversation-first**: The center panel is always a chat thread -- planning, execution, and review all flow through conversation
- **Instant context**: The review pane shows diffs, file contents, and terminal output relevant to the current thread
- **Keyboard-driven**: Panel focus with Cmd+1/2/3, command palette with Cmd+K, new thread with Cmd+T
- **Smooth transitions**: 200ms panel resize animations, spring-based drag handles, 150ms hover states

See [DESKTOP_UI_SPEC.md](./DESKTOP_UI_SPEC.md) for the complete component inventory, layout spec, keyboard shortcuts, and animation details.

## Architecture

### Current (Web + Agent Runner)

```
Browser (Cloudflare)
    |
    |  HTTPS
    v
Hono API (Fly.io)
    |
    |  WebSocket
    v
Relay Server (port 3002)
    |
    |  WebSocket
    v
Agent Runner (user machine) --> Filesystem
```

4 components, 3 network hops for local operations.

### Implemented (Tauri + Node.js Sidecar)

The current `src-tauri/` scaffold wraps the existing web frontend in a native Tauri window, with the Hono API server running as a managed Node.js sidecar process:

```
+-------------------------------------------+
| Tauri App (single binary)                 |
|                                           |
|  +-------------------------------------+ |
|  | Webview (React frontend)            | |
|  | Same React app as web, loaded from  | |
|  | dist/ or localhost:5173 (dev)       | |
|  +------------------+------------------+ |
|                     | Tauri IPC           |
|  +------------------v------------------+ |
|  | Rust Shell                          | |
|  |  +-- Sidecar lifecycle (spawn/stop) | |
|  |  +-- System tray                    | |
|  |  +-- Native menus                   | |
|  |  +-- Deep links (astro://)          | |
|  +------------------+------------------+ |
|                     | Process spawn       |
|  +------------------v------------------+ |
|  | Node.js Sidecar (port 3001)         | |
|  |  +-- Hono API server               | |
|  |  +-- PGlite (local Postgres)        | |
|  |  +-- Claude Agent SDK               | |
|  |  +-- WebSocket relay (port 3002)    | |
|  +-------------------------------------+ |
+-------------------------------------------+
```

### Target (Tauri + Rust Native + Sidecar)

The next evolution adds Rust-native commands for performance-critical operations while keeping the Node.js sidecar for API/DB/AI:

```
+---------------------------------------------------+
| Tauri App                                         |
|                                                   |
|  +---------------------------------------------+ |
|  | Desktop Frontend (Vite+React)               | |
|  | Codex-like three-panel layout               | |
|  | Separate from web app in src-tauri/frontend/ | |
|  +---------------------+-----------------------+ |
|                        | Tauri IPC                |
|  +---------------------v-----------------------+ |
|  | Rust Backend                                | |
|  |  +-- File tree (git ls-files, ripgrep)     | |
|  |  +-- File read/write (direct syscalls)      | |
|  |  +-- Terminal PTY (portable-pty)            | |
|  |  +-- File watcher (notify crate)            | |
|  |  +-- Sidecar lifecycle                      | |
|  |  +-- System tray, menus, deep links         | |
|  +---------------------+-----------------------+ |
|                        | HTTP to localhost:3001   |
|  +---------------------v-----------------------+ |
|  | Node.js Sidecar                             | |
|  |  +-- Hono API (plan gen, dispatch, data)    | |
|  |  +-- PGlite / Postgres                      | |
|  |  +-- Claude Agent SDK (SSE streaming)       | |
|  |  +-- WebSocket relay                        | |
|  +---------------------------------------------+ |
+---------------------------------------------------+
```

## Current Implementation (src-tauri/)

The `src-tauri/` directory contains a working Tauri 2 application scaffold:

### File Inventory

| File | Lines | Role |
|------|-------|------|
| `src/lib.rs` | 261 | App builder: registers commands, plugins (shell, log, deep-link, window-state), creates tray + menus, manages sidecar lifecycle, handles deep links |
| `src/sidecar.rs` | 392 | Sidecar manager: spawn/stop Node.js process, health check polling, port conflict detection, SIGTERM/SIGKILL shutdown, log piping |
| `src/menu.rs` | ~200 | Native menu bar: File (New/Open Project), Edit (standard), View (Reload/DevTools/Zoom), Help (Docs/About) |
| `src/tray.rs` | ~80 | System tray: icon, status indicator ("Sidecar: Connected/Disconnected"), Open/Quit actions |
| `src/main.rs` | 5 | Entry point, calls `lib::run()` |
| `tauri.conf.json` | 76 | App config: window (1400x900, min 800x600), CSP, tray icon, plugins, deep-link scheme (`astro://`) |
| `Cargo.toml` | 34 | Dependencies: tauri 2, plugins (shell, window-state, log, deep-link), reqwest, tokio, serde |
| `build.rs` | 3 | Standard tauri-build |
| `sidecar/.gitignore` | 1 | Ignores built sidecar bundle |

### Supporting Scripts

| File | Role |
|------|------|
| `scripts/build-sidecar.ts` | esbuild bundler: compiles `server/index.ts` into `src-tauri/sidecar/astro-sidecar.js`, copies drizzle migrations + skills + landing page |

### Tauri Commands (Current)

```rust
// Sidecar health check -- returns running/healthy/port/external_process
sidecar_status(state) -> SidecarStatus

// Restart sidecar (stop + start + wait_for_ready)
sidecar_restart(state) -> SidecarStatus

// Update tray icon status indicator
set_sidecar_status(app, connected)

// Navigate webview to a project (deep link handler)
navigate_to_project(app, project_id)
```

### Implemented Features

- [x] Tauri 2 app shell with window config (1400x900, resizable, centered)
- [x] Node.js sidecar lifecycle (spawn, health poll, graceful SIGTERM, SIGKILL fallback)
- [x] Port conflict detection (reuses existing healthy server)
- [x] Sidecar log piping to `~/.astro/logs/tauri-sidecar.log` and stdout
- [x] System tray with status indicator and Open/Quit actions
- [x] Native menu bar (File, Edit, View, Help) with accelerators
- [x] Deep link handling (`astro://project/{id}`)
- [x] Window-close-to-tray behavior (sidecar keeps running)
- [x] Plugin: structured logging (file + stdout)
- [x] Plugin: shell (open URLs in default browser)
- [x] Plugin: deep-link registration (`astro://` URL scheme)
- [x] Plugin: window-state persistence (remember size/position)
- [x] CSP configured for localhost:3001, ws://localhost:3002, Anthropic API, Supabase
- [x] Build script (esbuild) bundles server into single sidecar JS file

## Mode Spectrum

A Tauri app doesn't force a choice between local and server mode -- it supports a spectrum:

| Feature | Standalone | Connected | Team |
|---------|-----------|-----------|------|
| Database | PGlite only | PGlite + Supabase sync | PGlite + Supabase + RLS |
| Auth | None | Passkey (for sync) | Passkey + team RLS |
| Plugins/Skills | Local filesystem | Local filesystem | Local filesystem |
| File maps | Direct `git ls-files` | Direct `git ls-files` | Direct `git ls-files` |
| Agent execution | Embedded runner | Embedded + remote relay | Embedded + remote relay |
| Collaboration | No | Multi-device | Multi-user |
| Offline | Full | Partial (queue syncs) | Partial |

### Standalone Mode

- PGlite as the only database
- No network required
- Full offline capability
- Single-user, single-device

### Connected Mode

- PGlite locally + Supabase sync for multi-device
- Passkey auth for sync identity
- Queue operations when offline, sync when online

### Team Mode

- Connected mode + Supabase RLS for data isolation
- Real-time collaboration via Supabase Realtime
- Shared projects with team permissions

## Communication Architecture

### Overview: Web vs Tauri

The fundamental difference is **where the orchestration layer runs**:

```
+-------------------------------------------------------------------------+
|                          WEB MODE (current)                             |
|                                                                         |
|  User's Browser              Cloud (Fly.io)            User's Machine   |
|  +----------+    HTTPS     +--------------+    WS    +-------------+   |
|  |  React   |------------>|  Hono API    |-------->  | Agent Runner|   |
|  |  App     |<------------|  + Relay     |<--------  |  (CLI)      |   |
|  +----------+    SSE       +------+-------+          +------+------+   |
|                                   | HTTPS                   | fs       |
|                            +------v-------+          +------v------+   |
|                            | Claude API   |          | Filesystem  |   |
|                            | Supabase     |          | Git, Skills |   |
|                            +--------------+          +-------------+   |
|                                                                         |
|  Orchestration: Cloud          Data: Cloud + Machine        UI: Browser |
+-------------------------------------------------------------------------+

+-------------------------------------------------------------------------+
|                         TAURI MODE (current)                            |
|                                                                         |
|  +----------------------------------------------------+  Optional Cloud |
|  |  Tauri App (user's machine)                        |  +-------------+|
|  |  +----------+  IPC   +---------------------------+ |  | Supabase    ||
|  |  |  React   |<------>| Rust shell                | |->| (sync)      ||
|  |  |  Webview |        |  +-- tray, menus, links   | |  +-------------+|
|  |  +----------+        +------------+--------------+ |  +-------------+|
|  |       |  HTTP                     | spawn          |->| Relay       ||
|  |       v                           v                |  | (remote     ||
|  |  +--------------------------------------------+   |  |  machines)  ||
|  |  |  Node.js Sidecar (port 3001)               |   |  +-------------+|
|  |  |  Hono API + PGlite + Claude SDK            |---|->| Claude API  ||
|  |  +--------------------------------------------+   |  +-------------+|
|  +----------------------------------------------------+                 |
|                                                                         |
|  Orchestration: Local          Data: Local + Sync       UI: Local       |
+-------------------------------------------------------------------------+

+-------------------------------------------------------------------------+
|                     TAURI MODE (target architecture)                     |
|                                                                         |
|  +----------------------------------------------------+  Optional Cloud |
|  |  Tauri App (user's machine)                        |  +-------------+|
|  |  +----------+                                      |  | Supabase    ||
|  |  |  Desktop |    IPC (in-process, ~0ms)            |->| (sync)      ||
|  |  |  React   |<-----------------------------+       |  +-------------+|
|  |  +----------+                              |       |  +-------------+|
|  |  +----------------------------------------+--+    |->| Relay       ||
|  |  |  Rust Backend                             |    |  | (remote     ||
|  |  |  +-- File tree (git ls-files, ripgrep)    |    |  |  machines)  ||
|  |  |  +-- Terminal PTY                         |    |  +-------------+|
|  |  |  +-- File watcher                         |    |  +-------------+|
|  |  +---------------------+---------------------+    |->| Claude API  ||
|  |                        | HTTP localhost            |  +-------------+|
|  |  +---------------------v---------------------+    |                  |
|  |  |  Node.js Sidecar                          |    |                  |
|  |  |  +-- Hono API, PGlite, Claude SDK         |    |                  |
|  |  +-------------------------------------------+    |                  |
|  +----------------------------------------------------+                 |
+-------------------------------------------------------------------------+
```

### Why Node.js Sidecar + Rust Native Commands

The architecture uses a hybrid approach:

**Rust handles performance-critical, latency-sensitive operations** via direct Tauri IPC:
- File tree listing (`git ls-files` / recursive walk) -- must be instant for UI responsiveness
- File read/write -- zero-copy, direct syscalls
- Text search (`ripgrep` integration) -- must be fast across large codebases
- Terminal PTY -- low-latency character-by-character streaming
- File watching -- OS-native events (FSEvents/inotify/ReadDirectoryChanges)

**Node.js sidecar handles API/DB/AI orchestration** via HTTP on localhost:
- Claude Agent SDK streaming (SSE) -- the SDK is JavaScript-only
- Drizzle ORM + PGlite -- the entire data layer is TypeScript
- Hono API routes -- plan generation, dispatch, data persistence
- WebSocket relay -- remote machine communication

This split avoids rewriting the entire backend in Rust while getting native performance where it matters most (filesystem and terminal). The frontend talks to Rust via IPC for fast ops and to the sidecar via HTTP for everything else.

### Data Flow Comparison by Operation

#### 1. Plan Generation (User --> AI --> Plan Graph)

```
WEB:
  Browser                    Fly.io                      Anthropic
  +------+   POST /agent   +------+   POST /messages   +-------+
  |React |---------------->| Hono |-------------------->|Claude |
  |      |<================|      |<====================|  API  |
  +------+   SSE stream    +------+   SSE stream       +-------+

  Latency: Browser -> Fly.io (50-200ms) + Fly.io -> Anthropic (varies)
  Failure points: 2 network hops, SSE proxy through Cloudflare

TAURI:
  +------------------------------+                      Anthropic
  | Tauri App                    |                      +-------+
  | Webview --HTTP--> Sidecar ---|---POST /messages---->|Claude |
  |         <==SSE===            |<=====================|  API  |
  +------------------------------+   SSE stream        +-------+

  Latency: localhost (~0ms) + Sidecar -> Anthropic (varies)
  Failure points: 1 network hop, no proxy
```

#### 2. Task Execution (Dispatch --> Agent --> Results)

```
WEB (local machine):
  Browser         Fly.io          Relay (3002)      Agent Runner
  +------+ POST  +------+  WS   +-------+   WS   +----------+
  |React |------>| Hono |------>|Relay  |------->| Claude   |
  |      |       |      |       |Server |        | Code CLI |
  |      |<======|      |<======|       |<=======|          |--> Filesystem
  +------+ SSE   +------+ events+-------+ stdout +----------+
                                  + result

  Latency: ~100-300ms per hop x 3 hops = 300-900ms round-trip

TAURI (local task):
  +---------------------------------------------------+
  | Tauri App                                         |
  |                                                   |
  | Webview --HTTP--> Sidecar --spawn--> Agent Runner |
  |         <==SSE===    |                |           |
  |                      |<== pipe =======+           |
  |                      |         stdout + result    |
  |                      |                            |
  |                      +---> Filesystem (direct)    |
  |                      +---> PGlite (save result)   |
  +---------------------------------------------------+

  Latency: localhost (~0ms) + process spawn (~50ms)
  Stdout: Agent -> pipe -> Sidecar -> SSE -> Webview (0 network hops)
```

#### 3. File Operations (New with Rust Native Commands)

```
WEB (current):
  Browser         Fly.io          Relay            Agent Runner
  +------+ GET   +------+  WS   +-------+  WS   +----------+
  |React |------>| Hono |------>|Relay  |------->| scan     |
  |      |<------|      |<------|       |<-------| workdir  |
  +------+ JSON  +------+       +-------+        +----------+

  Latency: 200-500ms, stale for up to 5 minutes

TAURI (target):
  +-------------------------------------------+
  | Tauri App                                 |
  |                                           |
  | Webview ==IPC==> Rust                     |
  |                    |  git ls-files         |
  |                    |  ripgrep              |
  |                    |  fs::read / write     |
  |                    |  notify (watcher)     |
  |         <==IPC==   |                      |
  +-------------------------------------------+

  Latency: <5ms, always fresh
  No caching needed -- reads are fast enough for every interaction
```

#### 4. Data Persistence

```
WEB (local mode):
  Browser         Hono (localhost:3001)
  +------+ POST  +------------------+
  |React |------>| Drizzle ORM      |
  |      |<------|    v              |
  +------+ JSON  | PGlite (WASM)    |
                 +------------------+

TAURI (current -- same as web local mode, sidecar hosts PGlite):
  +-------------------------------------------+
  | Tauri App                                 |
  |                                           |
  | Webview --HTTP--> Sidecar                 |
  |         <--JSON--   |                     |
  |                     v                     |
  |                  Drizzle ORM              |
  |                     v                     |
  |                  PGlite (WASM in Node)    |
  +-------------------------------------------+

TAURI (connected / team):
  +-----------------------------------+         Supabase
  | Tauri App                         |  HTTPS +----------+
  |                                   |------->| Postgres |
  | Webview --HTTP--> Sidecar         |<-------| + RLS    |
  |                     |             |  WS    | Realtime |
  |                     v             |        +----------+
  |                  PGlite           |
  |                  (local cache)    |
  +-----------------------------------+

  Writes: PGlite first (instant) --> sync to Supabase (async)
  Reads: PGlite (instant), updated via Supabase Realtime
```

### Protocol Summary

| Channel | Protocol | Latency | Used For |
|---------|----------|---------|----------|
| Webview <-> Rust | Tauri IPC (JSON over OS pipes) | ~0.1ms | File ops, terminal, search |
| Webview <-> Sidecar | HTTP localhost:3001 | ~1ms | API routes, plan gen, data |
| Sidecar -> Claude API | HTTPS + SSE | 100-500ms | Plan generation, chat |
| Sidecar -> Supabase | HTTPS + WebSocket | 50-200ms | Data sync, realtime (connected/team only) |
| Sidecar -> Relay | WebSocket | 50-200ms | Remote machine dispatch only |
| Rust -> Filesystem | Direct syscalls | <1ms | File tree, read, write, search |
| Rust -> Terminal | PTY (portable-pty) | <1ms | Terminal input/output |
| Sidecar -> Agent Runner | Process spawn + pipes | ~50ms startup | Local task execution |

### What Disappears in Tauri Mode

```
Web Mode                              Tauri Mode
--------                              ----------
Browser --HTTPS--> Hono               Webview --HTTP--> Sidecar (localhost)
Browser --HTTPS--> Cloudflare Pages   Webview loads from dist/ (no CDN)
Hono --WS--> Relay --WS--> Runner    Sidecar --spawn--> Runner (no Relay for local)
Browser --fetch--> /api/skills        Rust --fs--> scan dirs (IPC, no HTTP)
Browser --fetch--> /api/repo/*        Rust --fs--> git commands (IPC, no HTTP)
Device auth flow (register machine)   N/A -- app IS the machine
```

## Plugin System Architecture

### The Problem with the Current Layout

The Hono backend (`server/`) currently contains filesystem-dependent plugin/skill code:

- `server/lib/skill-manager.ts` -- uses `readdirSync`, `readFileSync`, `rmSync` to scan a `skills/` directory
- `server/lib/plugin-loader.ts` -- uses `readdirSync`, `existsSync` to scan `server/plugins/`

This is architecturally wrong. The Hono backend deploys to Fly.io -- a cloud server with **no access to the user's filesystem**. The `skills/` directory it reads is whatever was deployed alongside the server binary, not the user's local skills. User-local skills (`~/.astro/skills/`, project `.astro/`, `~/.claude/commands/`) live on the user's machine and can only be accessed by something running there.

The backend should be a **stateless API** that receives skill/plugin metadata as input -- it should never touch the filesystem for plugin discovery or management.

### Where Each Concern Belongs

| Concern | Location | Why |
|---------|----------|-----|
| SKILL.md parsing (pure logic) | `src/lib/skill-parser.ts` (shared) | No filesystem deps, reusable across all runtimes |
| Plugin manifest validation | `src/lib/plugin-manifest.ts` (shared) | Same -- pure data validation |
| Skill/plugin **discovery from disk** | Rust native commands (Phase 1.5) | Requires native filesystem access, benefits from speed |
| Skill/plugin **install/uninstall** | Rust native commands (Phase 1.5) | Writes to `~/.astro/skills/`, project dirs |
| Skill prompt injection assembly | `server/lib/skill-injector.ts` | Stateless: receives `OpenClawSkill[]` as input, returns XML string |
| Web-mode skill fetch (remote machines) | `server/routes/relay.ts` -> agent runner | Relay proxies to the machine that has the filesystem |
| Web-mode skill fetch (local dev) | `server/routes/skills.ts` -> local `skills/` | Only works because dev server IS on the user's machine |

### Three Discovery Paths

Skill/plugin discovery happens differently depending on runtime:

```
+-------------------------------------------------------------+
| 1. Tauri Mode (desktop app) -- Target                       |
|                                                              |
|    React frontend                                            |
|      |  invoke('scan_skills', { workdir })                   |
|      v                                                       |
|    Rust backend (via Tauri IPC)                              |
|      |  Direct filesystem: ~/.astro/skills/                  |
|      |                     .astro/skills/                     |
|      |                     ~/.claude/commands/                |
|      v                                                       |
|    Returns Vec<Skill> instantly, always fresh                 |
+-------------------------------------------------------------+

+-------------------------------------------------------------+
| 2. Web Mode -- Remote Machine                               |
|                                                              |
|    React frontend                                            |
|      |  GET /api/relay/slash-commands?machineId=X            |
|      v                                                       |
|    Hono backend (server/)                                    |
|      |  WebSocket: relay -> agent runner                     |
|      v                                                       |
|    Agent runner (user's machine)                             |
|      |  Filesystem scan: ~/.astro/skills/, project dir       |
|      v                                                       |
|    Returns skills via relay, cached in Zustand (5min TTL)    |
+-------------------------------------------------------------+

+-------------------------------------------------------------+
| 3. Web Mode -- Local Dev (npm run dev)                      |
|                                                              |
|    React frontend                                            |
|      |  GET /api/skills                                      |
|      v                                                       |
|    Hono backend (running locally on same machine)            |
|      |  Reads skills/ dir relative to server                 |
|      v                                                       |
|    Works only because dev server IS the user's machine       |
|    (Breaks in production -- Fly.io has no user skills)       |
+-------------------------------------------------------------+
```

### Plugin Locations

Skills and plugins are discovered from multiple directories, merged with priority:

| Priority | Path | Scope | Description |
|----------|------|-------|-------------|
| 1 (highest) | `{workdir}/.astro/skills/` | Project | Project-specific skills |
| 2 | `~/.astro/skills/` | User | User's global skills |
| 3 | `~/.claude/commands/` | User | Claude Code slash commands (compatibility) |
| 4 (lowest) | Built-in (bundled with app) | System | Default skills shipped with Astro |

Name collisions: higher priority wins. Source field tracks origin for UI display.

## Tauri Command Surface

### Current Commands (Implemented)

```rust
#[tauri::command]
async fn sidecar_status(state: State<SidecarState>) -> Result<SidecarStatus, String>

#[tauri::command]
async fn sidecar_restart(state: State<SidecarState>) -> Result<SidecarStatus, String>

#[tauri::command]
fn set_sidecar_status(app: AppHandle, connected: bool)

#[tauri::command]
fn navigate_to_project(app: AppHandle, project_id: String)
```

### Planned Commands (Phase 1.5: Rust Native)

```rust
// File tree -- fast listing via git ls-files or recursive walk
#[tauri::command]
fn list_files(workdir: &str, git_only: bool) -> Result<Vec<FileEntry>, String>

// File read/write -- direct syscalls, zero network
#[tauri::command]
fn read_file(path: &str) -> Result<String, String>

#[tauri::command]
fn write_file(path: &str, content: &str) -> Result<(), String>

// Search -- ripgrep integration for fast codebase search
#[tauri::command]
fn search_files(workdir: &str, query: &str, glob: Option<&str>) -> Result<Vec<SearchResult>, String>

// Terminal PTY -- spawn and interact with terminal sessions
#[tauri::command]
fn terminal_spawn(workdir: &str, shell: Option<&str>) -> Result<TerminalId, String>

#[tauri::command]
fn terminal_write(id: TerminalId, data: &str) -> Result<(), String>

#[tauri::command]
fn terminal_resize(id: TerminalId, cols: u16, rows: u16) -> Result<(), String>

#[tauri::command]
fn terminal_kill(id: TerminalId) -> Result<(), String>

// File watcher -- OS-native filesystem events
#[tauri::command]
fn watch_directory(workdir: &str) -> Result<WatcherId, String>

#[tauri::command]
fn unwatch_directory(id: WatcherId) -> Result<(), String>

// Skill/plugin discovery -- direct filesystem scan
#[tauri::command]
fn scan_skills(workdir: &str) -> Result<Vec<Skill>, String>

#[tauri::command]
fn install_skill(name: &str, content: &str) -> Result<Skill, String>

#[tauri::command]
fn uninstall_skill(name: &str) -> Result<bool, String>

// Git operations
#[tauri::command]
fn git_status(workdir: &str) -> Result<GitStatus, String>

#[tauri::command]
fn git_diff(workdir: &str, path: Option<&str>) -> Result<String, String>
```

## Migration Path

### Phase 1: Tauri Scaffold -- DONE

Implemented in `src-tauri/`:

- [x] Tauri 2 app initialization with `tauri.conf.json`
- [x] Node.js sidecar lifecycle (spawn, health poll, stop, port conflict detection)
- [x] Native menu bar with accelerators (File, Edit, View, Help)
- [x] System tray with sidecar status indicator
- [x] Deep link handling (`astro://project/{id}`)
- [x] Window-close-to-tray behavior
- [x] Plugins: shell, log, deep-link, window-state
- [x] Build script (`scripts/build-sidecar.ts`) -- bundles server into single JS file
- [x] CSP configuration for local and remote endpoints

### Phase 1.5: Rust Native Commands -- NEXT

Add Rust-native Tauri commands for performance-critical operations. These bypass the sidecar entirely, going straight from the frontend through IPC to Rust syscalls.

**Filesystem commands:**
- `list_files` -- file tree via `git ls-files` (with fallback to recursive walk)
- `read_file` / `write_file` -- direct file I/O
- `search_files` -- ripgrep integration for fast codebase search

**Terminal PTY integration:**
- `terminal_spawn` -- create PTY session with configurable shell
- `terminal_write` / `terminal_resize` / `terminal_kill` -- PTY control
- Terminal output streaming via Tauri events (not IPC return values)

**File watcher:**
- `watch_directory` / `unwatch_directory` -- OS-native file change events
- Events emitted to frontend via Tauri event system

**Skill/plugin discovery:**
- `scan_skills` -- merge skills from project, user, and system directories
- `install_skill` / `uninstall_skill` -- filesystem management

**New Rust dependencies:**
- `portable-pty` -- cross-platform PTY
- `grep-regex` / `grep-searcher` (ripgrep crates) -- fast search
- `notify` -- cross-platform file watching
- `ignore` -- gitignore-aware directory walking

### Phase 2: Desktop Frontend

Build a new desktop-specific frontend in `src-tauri/frontend/`, separate from the web app. This is the Codex-like three-panel layout described in [DESKTOP_UI_SPEC.md](./DESKTOP_UI_SPEC.md).

- New Vite+React app in `src-tauri/frontend/`
- Three-panel layout: project sidebar | thread/chat | review/diff
- Uses Tauri IPC for file ops and terminal, HTTP for sidecar API
- Tailwind CSS with desktop-specific tokens (see COLOR_PALETTE.md)
- Smooth animations: 200ms panel transitions, spring-based resize handles
- Command palette, keyboard shortcuts, focus management

The web app continues to work independently -- the desktop frontend is a separate entry point optimized for the native experience.

### Phase 3: PGlite Integration

- Embed PGlite in Tauri app (via sidecar, already working)
- Same Postgres schema as Supabase
- Add sync layer for connected/team mode

### Phase 4: Full Feature Parity

- Plugin management UI with filesystem access
- Git operations (status, diff, commit) via Rust native commands
- Auto-updates via Tauri's built-in updater

### Phase 5: Distribution

- macOS (Apple Silicon + Intel)
- Linux (AppImage, deb)
- Windows (MSI, NSIS)
- Code signing and notarization

## Relationship to Web App

The web app **does not go away**. It remains the primary interface for:

- Users who don't want to install a desktop app
- Quick access from any device
- Server-mode-only deployments (enterprise, team)
- Onboarding and first impressions

The Tauri app is a **power user upgrade** -- same data model and backend, but with a purpose-built desktop UI, native filesystem access, and zero-latency local operations. The web app is the floor, the Tauri app is the ceiling.

## Technical Choices

### Why Tauri (not Electron)

- **Binary size**: Tauri ~5-10 MB vs Electron ~100+ MB
- **Memory**: Uses system webview, not bundled Chromium
- **Rust backend**: Fast filesystem operations, safe concurrency
- **Security**: Fine-grained IPC permissions
- **Updates**: Built-in auto-updater

### Why Not a VS Code Extension

- Astro is a standalone planning tool, not an IDE feature
- VS Code extensions can't own their own window/layout
- Plugin ecosystem would be tied to VS Code's extension model
- Limits users to VS Code (excludes JetBrains, Neovim, etc.)

### Why Node.js Sidecar + Rust (not Pure Rust)

- The entire Astro backend is TypeScript (Hono, Drizzle, Claude Agent SDK)
- Rewriting in Rust would take months and duplicate the web backend
- The sidecar IS the web backend -- same code runs in both modes
- Rust handles the performance-sensitive layer (FS, terminal, search)
- Sidecar handles the logic-heavy layer (API routes, AI streaming, data)
- The split is clean: Rust for I/O-bound ops, Node.js for compute/network ops

---

## Reflection: Potential Issues

1. **PGlite in sidecar**: PGlite runs in the Node.js sidecar as WASM, which works but adds overhead. A future optimization could use native Postgres or SQLite via Rust for the desktop app.
2. **Two frontends**: Maintaining both a web frontend and a desktop frontend increases surface area. Shared component libraries and the same design system (COLOR_PALETTE.md) help, but divergence is a risk.
3. **Sidecar startup latency**: The Node.js sidecar takes ~2-5 seconds to start. The health poll loop (200ms intervals, 10s timeout) handles this, but the user sees a loading state. Pre-warming or lazy sidecar start could help.
4. **Desktop frontend scope**: The Codex-like three-panel layout is a significant frontend effort. Starting with a minimal version (sidebar + single chat panel) and iterating is safer than building all three panels at once.
