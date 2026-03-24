# Tauri Desktop App Vision

> **Status: PROPOSED — Not yet implemented.** This document describes the planned Tauri desktop app architecture using a Node.js sidecar approach. No Tauri code exists in the codebase yet. See [PACKAGE_ARCHITECTURE.md](./PACKAGE_ARCHITECTURE.md) for the current monorepo structure.

> **See also:** [PACKAGE_ARCHITECTURE.md](./PACKAGE_ARCHITECTURE.md) for the full monorepo package structure (`@astro/core`, `@astro/cli`, `server/`, `@astroanywhere/agent-runner`, Tauri desktop) and how they compose across deployment scenarios.

## Motivation

The current Astro architecture has a fundamental filesystem gap:

```
Frontend (Cloudflare Pages)  →  no filesystem access
Backend (Fly.io)             →  no access to user's filesystem
Agent Runner (user machine)  →  has filesystem, no UI
```

No single component has **both** filesystem access and UI rendering. This forces a complex relay architecture to bridge the gap: the frontend asks the backend, which asks the relay, which asks the agent runner on the user's machine.

For machine-local resources — plugins, skills, file trees, git operations — this indirection adds latency, complexity, and fragility. A desktop app eliminates this gap.

## Architecture

### Current (Web + Agent Runner)

```
Browser (Cloudflare)
    │
    │  HTTPS
    ▼
Hono API (Fly.io)
    │
    │  WebSocket
    ▼
Relay Server (port 3002)
    │
    │  WebSocket
    ▼
Agent Runner (user machine) → Filesystem
```

4 components, 3 network hops for local operations.

### Proposed (Tauri + Node.js Sidecar)

```
┌─────────────────────────────────────────┐
│ Tauri App (single binary)               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Webview (React frontend)        │    │
│  │ Same React app, same components │    │
│  └──────────┬──────────────────────┘    │
│             │ HTTP localhost:3001        │
│             │ (same as dev mode)        │
│  ┌──────────▼──────────────────────┐    │
│  │ Node.js Sidecar                 │    │
│  │  ├── Hono API (port 3001)       │    │
│  │  ├── WebSocket Relay (port 3002)│    │
│  │  ├── PGlite (local Postgres)    │    │
│  │  ├── Agent Runner (embedded)    │    │
│  │  └── CLI (astro-cli)            │    │
│  └──────────┬──────────────────────┘    │
│             │                           │
│  ┌──────────▼──────────────────────┐    │
│  │ Rust Layer (Tauri)              │    │
│  │  ├── Sidecar lifecycle mgmt     │    │
│  │  ├── System tray                │    │
│  │  ├── Native menus               │    │
│  │  ├── Auto-updater               │    │
│  │  └── Optional: direct fs cmds  │    │
│  └──────────┬──────────────────────┘    │
│             │                           │
│  ┌──────────▼──────────────────────┐    │
│  │ Optional Network               │    │
│  │  ├── → Supabase (sync/teams)   │    │
│  │  └── → Relay (remote machines) │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

The key insight: the **webview connects to localhost:3001** exactly as it does in `npm run dev:local`. The Rust layer is thin — it starts the sidecar, manages the system tray, and optionally exposes native filesystem commands for performance-sensitive operations. The Node.js sidecar is the existing `server/index.ts` bundled as a self-contained executable.

1 bundled binary for local ops, 0 network hops to external services.

## Sidecar Bundling

The Node.js sidecar is a single-file bundle of the entire server stack:

```
Build pipeline:
  server/index.ts
    + packages/core/       (DB schema, dispatch, skill injection)
    + packages/agent-runner/ (AI execution, worktree management)
    + packages/cli/        (project/plan/task management)
  ──────────────────────────
  esbuild → sidecar.js    (single CommonJS bundle, ~5-15 MB)

Runtime:
  Tauri spawns: node sidecar.js   (or bundled Node.js binary)
  Sidecar starts:
    - Hono API on localhost:3001
    - WebSocket relay on localhost:3002
    - PGlite (same as npm run dev:local)
    - Waits for connections
```

### Sidecar Entry Point

```typescript
// server/sidecar-entry.ts  (thin wrapper for Tauri mode)
// Sets LOCAL_MODE=true so server/lib/app-mode.ts returns isLocalMode() = true
// Starts Hono + relay exactly as server/index.ts does in dev:local
process.env.LOCAL_MODE = 'true'
process.env.SIDECAR_PORT = process.env.SIDECAR_PORT ?? '3001'
import './index.ts'
```

### Bundled vs System Node.js

Two options for the Node.js runtime:

| Option | Pros | Cons |
|--------|------|------|
| Bundle Node.js binary (~40 MB) | Zero dependency on host, works everywhere | Large binary, slower startup |
| Use system Node.js | Small distribution size, fast startup | Requires Node.js to be installed |

The recommended approach is to **require system Node.js** for MVP and optionally bundle it for production distribution. Tauri's `sidecar` feature handles both via `tauri.conf.json`.

### Build Configuration

```json
// src-tauri/tauri.conf.json (relevant excerpt)
{
  "bundle": {
    "externalBin": ["binaries/sidecar"],
    "resources": ["binaries/sidecar.js"]
  },
  "tauri": {
    "allowlist": {
      "shell": {
        "sidecar": true,
        "scope": [{ "name": "sidecar", "sidecar": true }]
      }
    }
  }
}
```

## Mode Spectrum

A Tauri app doesn't force a choice between local and server mode — it supports a spectrum:

| Feature | Standalone | Connected | Team |
|---------|-----------|-----------|------|
| Database | PGlite in Node.js sidecar | Sidecar PGlite + Supabase sync | PGlite + Supabase + RLS |
| Auth | None (local mode) | Passkey (for sync) | Passkey + team RLS |
| Plugins/Skills | Via relay to agent runner | Via relay to agent runner | Via relay to agent runner |
| File maps | Via relay (agent runner on same machine) | Via relay | Via relay |
| Agent execution | Embedded runner (sidecar) | Embedded + remote relay | Embedded + remote relay |
| Collaboration | No | Multi-device | Multi-user |
| Offline | Full | Partial (queue syncs) | Partial |

### Standalone Mode

- PGlite runs inside the Node.js sidecar, same as `npm run dev:local`
- No network required (except Anthropic API for AI calls)
- Full offline capability for everything except AI generation
- Single-user, single-device
- No Rust FFI required — PGlite is a WASM module loaded by Node.js

### Connected Mode

- Sidecar switches from PGlite to postgres-js pointing at Supabase
- Or: keeps PGlite locally + a sync layer for multi-device
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
┌─────────────────────────────────────────────────────────────────────────┐
│                          WEB MODE (current)                             │
│                                                                         │
│  User's Browser              Cloud (Fly.io)            User's Machine   │
│  ┌──────────┐    HTTPS     ┌──────────────┐    WS    ┌─────────────┐  │
│  │  React   │─────────────▶│  Hono API    │────────▶ │ Agent Runner│  │
│  │  App     │◀─────────────│  + Relay     │◀────────│  (CLI)      │  │
│  └──────────┘    SSE       └──────┬───────┘         └──────┬──────┘  │
│                                   │ HTTPS                   │ fs      │
│                            ┌──────▼───────┐         ┌──────▼──────┐  │
│                            │ Claude API   │         │ Filesystem  │  │
│                            │ Supabase     │         │ Git, Skills │  │
│                            └──────────────┘         └─────────────┘  │
│                                                                         │
│  Orchestration: Cloud          Data: Cloud + Machine        UI: Browser │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         TAURI MODE (proposed)                           │
│                                                                         │
│  ┌──────────────────────────────────────────────────┐   Optional Cloud  │
│  │  Tauri App (user's machine)                      │  ┌─────────────┐ │
│  │  ┌──────────┐                                    │  │ Supabase    │ │
│  │  │  React   │   HTTP localhost:3001              │─▶│ (sync)      │ │
│  │  │  Webview │◀─────────────────────────┐         │  └─────────────┘ │
│  │  └──────────┘  SSE / fetch (same API)  │         │  ┌─────────────┐ │
│  │  ┌─────────────────────────────────────┴──┐      │─▶│ Relay       │ │
│  │  │  Node.js Sidecar                        │      │  │ (remote     │ │
│  │  │  ├── Hono API (port 3001)               │      │  │  machines)  │ │
│  │  │  ├── Relay WS (port 3002)               │      │  └─────────────┘ │
│  │  │  ├── PGlite (local Postgres in WASM)    │      │  ┌─────────────┐ │
│  │  │  ├── Agent Runner (embedded)            │──────│─▶│ Claude API  │ │
│  │  │  └── CLI (astro-cli)                    │      │  └─────────────┘ │
│  │  └────────────────────────────────────────┘      │                   │
│  │  ┌────────────────────────────────────────┐       │                   │
│  │  │  Rust (Tauri shell)                    │       │                   │
│  │  │  ├── Sidecar spawn/lifecycle           │       │                   │
│  │  │  ├── System tray, menus               │       │                   │
│  │  │  ├── Auto-updater                     │       │                   │
│  │  │  └── Optional: direct fs commands     │       │                   │
│  │  └────────────────────────────────────────┘       │                   │
│  └──────────────────────────────────────────────────┘                   │
│                                                                         │
│  Orchestration: Local          Data: Local + Sync       UI: Local       │
└─────────────────────────────────────────────────────────────────────────┘
```

### What "Same as Dev Mode" Means

The React frontend in the Tauri webview makes the **identical HTTP/SSE requests** it does in `npm run dev:local`:

- `GET /api/data/projects` → localhost:3001
- `POST /api/agent/generate-plan` → localhost:3001
- `GET /api/events` (SSE) → localhost:3001

No Tauri IPC bridge needed for data flow. The only Tauri IPC used is:
1. **Sidecar lifecycle** — Rust starts/stops the Node.js sidecar process
2. **Optional performance shortcuts** — e.g., `invoke('list_files')` could bypass HTTP for large file trees

### Data Flow Comparison by Operation

#### 1. Plan Generation (User → AI → Plan Graph)

```
WEB:
  Browser                    Fly.io                      Anthropic
  ┌──────┐   POST /agent   ┌──────┐   POST /messages   ┌───────┐
  │React │──────────────── ▶│ Hono │───────────────────▶│Claude │
  │      │◀════════════════│      │◀═══════════════════│  API  │
  └──────┘   SSE stream    └──────┘   SSE stream       └───────┘

  Latency: Browser → Fly.io (50-200ms) + Fly.io → Anthropic (varies)
  Failure points: 2 network hops, SSE proxy through Cloudflare

TAURI:
  ┌──────────────────────────────────────────────────────────┐
  │ Tauri App                                                │
  │ Webview ──POST /agent──▶ Node.js Sidecar (localhost:3001) │
  │         ◀══SSE stream══                                   │
  │                              │  POST /messages           │
  │                              ▼                Anthropic  │
  │                          ┌───────┐           ┌───────┐   │
  │                          │ Hono  │──────────▶│Claude │   │
  │                          └───────┘◀══SSE════│  API  │   │
  └──────────────────────────────────────────────┴───────┘   │

  Latency: loopback (~0ms) + Node.js sidecar → Anthropic (varies)
  Failure points: 1 network hop, no proxy
```

#### 2. Task Execution (Dispatch → Agent → Results)

```
WEB (local machine):
  Browser         Fly.io          Relay (3002)      Agent Runner
  ┌──────┐ POST  ┌──────┐  WS   ┌───────┐   WS   ┌──────────┐
  │React │──────▶│ Hono │──────▶│Relay  │───────▶│ Claude   │
  │      │       │      │       │Server │        │ Code CLI │
  │      │◀══════│      │◀══════│       │◀═══════│          │──▶ Filesystem
  └──────┘ SSE   └──────┘ events└───────┘ stdout └──────────┘

  Latency: ~100-300ms per hop × 3 hops = 300-900ms round-trip

WEB (remote machine, e.g. HPC):
  Same as above, but Relay → Agent Runner crosses the internet.
  This path REMAINS in Tauri mode for remote dispatch.

TAURI (local task):
  ┌───────────────────────────────────────────────────────────────┐
  │ Tauri App                                                     │
  │                                                               │
  │ Webview ──POST /dispatch──▶ Node.js Sidecar (localhost:3001)  │
  │         ◀══SSE stream══════                                   │
  │                              │                               │
  │                     ┌────────▼────────┐                      │
  │                     │ Hono + Relay    │                      │
  │                     │ (in sidecar)    │──spawn──▶ Agent Runner│
  │                     │                 │◀══ pipe ═════════════│
  │                     │                 │    stdout + result    │
  │                     │                 │                      │
  │                     │                 ├──▶ PGlite (save)     │
  │                     └─────────────────┘                      │
  └───────────────────────────────────────────────────────────────┘

  Latency: loopback (~0ms) + process spawn (~50ms)
  Stdout: Agent → pipe → Hono → SSE → Webview (0 external network hops)

TAURI (remote task — e.g. HPC cluster):
  ┌────────────────────────────┐
  │ Tauri App                  │        Relay           Remote Machine
  │                            │  WS   ┌───────┐  WS  ┌──────────┐
  │ Webview ──POST──▶ Sidecar ─│──────▶│Relay  │─────▶│ Agent    │
  │         ◀══SSE══           │◀══════│Server │◀═════│ Runner   │
  └────────────────────────────┘       └───────┘      └──────────┘

  Same relay path as web mode — Hono sidecar dispatches via WebSocket relay
```

#### 3. Skill/Plugin Discovery

```
WEB (remote machine):
  Browser         Fly.io           Relay            Agent Runner
  ┌──────┐ GET   ┌──────┐  WS    ┌───────┐  WS   ┌──────────┐
  │React │──────▶│ Hono │───────▶│Relay  │──────▶│ scan     │
  │      │◀──────│      │◀───────│       │◀──────│ ~/.astro │
  └──────┘ JSON  └──────┘        └───────┘       └──────────┘
  Cache in Zustand (5min TTL)

  Latency: 200-500ms, stale for up to 5 minutes

TAURI:
  Webview ──GET /api/relay/slash-commands──▶ Sidecar (localhost:3001)
                                              │
                                     ┌────────▼────────┐
                                     │ Hono (sidecar)  │──WS──▶ Agent Runner
                                     │                 │◀══════ (on same machine)
                                     └─────────────────┘
  OR (if agent runner IS the sidecar's embedded runner):
    Sidecar scans ~/.astro/skills/ directly (Node.js fs, no relay hop)

  Latency: loopback + optional fs scan
  Optional: Rust Tauri command for fastest scan (invoke('scan_skills'))
```

#### 4. Data Persistence

```
WEB (local mode — npm run dev:local):
  Browser         Hono (localhost:3001)
  ┌──────┐ POST  ┌──────────────────┐
  │React │──────▶│ Drizzle ORM      │
  │      │◀──────│    ▼             │
  └──────┘ JSON  │ PGlite (WASM)   │
                 └──────────────────┘

TAURI (standalone — identical to above):
  Webview         Sidecar (localhost:3001)
  ┌──────┐ POST  ┌──────────────────┐
  │React │──────▶│ Drizzle ORM      │
  │      │◀──────│    ▼             │
  └──────┘ JSON  │ PGlite (WASM)   │  ← same Node.js code, same schema
                 └──────────────────┘

  No Rust FFI. No custom PGlite embedding. PGlite runs exactly as it does
  in local dev mode — it's a WASM module inside the Node.js process.

WEB (server mode):
  Browser         Fly.io                Supabase
  ┌──────┐ POST  ┌──────┐  TCP/SSL    ┌──────────┐
  │React │──────▶│ Hono │────────────▶│ Postgres │
  │      │◀──────│      │◀────────────│ + RLS    │
  └──────┘ JSON  └──────┘             └──────────┘

TAURI (connected / team — sidecar switches to Supabase):
  Webview         Sidecar (localhost:3001)        Supabase
  ┌──────┐ POST  ┌──────────────────┐  TCP/SSL  ┌──────────┐
  │React │──────▶│ Drizzle ORM      │──────────▶│ Postgres │
  │      │◀──────│  (postgres-js)   │◀──────────│ + RLS    │
  └──────┘ JSON  └──────────────────┘           └──────────┘

  Sidecar connects to Supabase instead of PGlite — controlled by env vars
  passed to the sidecar at startup by the Rust layer.
```

#### 5. Real-Time Collaboration

```
WEB:
  Browser A                Supabase                Browser B
  ┌──────┐   WS (RT)     ┌──────────┐  WS (RT)  ┌──────┐
  │React │◀══════════════▶│ Realtime │◀══════════▶│React │
  └──────┘                └──────────┘            └──────┘

  Direct browser ↔ Supabase. Works well.

TAURI (team mode):
  Tauri App A              Supabase                Tauri App B
  ┌────────────────┐ WS(RT)┌──────────┐WS(RT) ┌────────────────┐
  │Sidecar (Hono)  │◀════▶│ Realtime │◀════▶│Sidecar (Hono)  │
  │  ▲             │       └──────────┘       │           ▲    │
  │  │ HTTP/SSE    │                           │  HTTP/SSE │    │
  │  ▼             │                           │           ▼    │
  │Webview         │                           │       Webview  │
  └────────────────┘                           └────────────────┘

  Same as web mode — Supabase Realtime events flow through the sidecar's
  existing realtime subscription logic, then SSE to the webview.
```

### Protocol Summary

| Channel | Protocol | Latency | Used For |
|---------|----------|---------|----------|
| Webview ↔ Sidecar | HTTP + SSE (localhost:3001) | <1ms (loopback) | All frontend-backend communication |
| Webview ↔ Rust (optional) | Tauri IPC | ~0.1ms | Sidecar lifecycle, native menus, optional fast fs ops |
| Sidecar → Claude API | HTTPS + SSE | 100-500ms | Plan generation, chat |
| Sidecar → Supabase | HTTPS + WebSocket | 50-200ms | Data sync, realtime (connected/team only) |
| Sidecar → Relay | WebSocket | 50-200ms | Remote machine dispatch |
| Sidecar → PGlite | In-process WASM | <1ms | All data persistence (standalone mode) |
| Sidecar → Agent Runner | Process spawn + pipes | ~50ms startup | Local task execution |
| Rust → Filesystem (optional) | Direct syscalls | <1ms | Fast skill/file scans via Tauri commands |

### What Disappears in Tauri Mode

```
Web Mode                              Tauri Mode
────────                              ──────────
Browser ──HTTPS──▶ Hono (Fly.io)      Webview ──HTTP──▶ Sidecar (localhost:3001)
Relay ──WS──▶ Fly.io machine          Sidecar relay runs on same machine
Device auth flow (register machine)   N/A — app IS the machine
SSE through Cloudflare proxy          Direct SSE from sidecar (no proxy latency)
```

### Network Requests in Each Mode

**Standalone (offline-capable):**
- Sidecar → `api.anthropic.com` (Claude API only)
- That's it. Everything else is local.

**Connected (multi-device sync):**
- Sidecar → `api.anthropic.com` (Claude API)
- Sidecar → Supabase (data sync + realtime WebSocket)

**Team (full collaboration):**
- Sidecar → `api.anthropic.com` (Claude API)
- Sidecar → Supabase (data sync + realtime + RLS)
- Sidecar → Relay server (remote machine dispatch, if needed)

## What's Still Needed

### Relay Server (for remote dispatch)

The relay **does not go away**. It serves remote dispatch — sending tasks to:
- HPC clusters (SLURM)
- Cloud GPU instances
- Other developer machines
- CI/CD environments

What changes is that for **local tasks**, the sidecar's embedded relay handles them. For standalone mode, the webview talks to the sidecar relay directly (localhost:3002).

### Supabase (for teams and sync)

Supabase remains needed for:
- Multi-user authentication and RLS
- Real-time collaboration
- Multi-device sync
- Team features

### What's Eliminated

| Component | Current Role | Tauri Replacement |
|-----------|-------------|-------------------|
| Hono backend (Fly.io, for local ops) | Prompt assembly, Claude SDK calls, SSE | Sidecar Hono on localhost:3001 |
| Relay (Fly.io, for local machine) | Bridge frontend ↔ local agent runner | Sidecar relay on localhost:3002 |
| IndexedDB caching | (Already removed — now uses PGlite/API) | N/A |
| Device auth flow | Register local machine with relay | Unnecessary — app IS the machine |

## What This Solves

### File Maps

Currently requires relay round-trip for remote machines and caching for local:

- **Web**: `git ls-files` on agent runner → relay → frontend cache (ephemeral, 5min TTL)
- **Tauri**: Sidecar agent runner runs on the same machine → direct scan, instant, always fresh

---

## Plugin System Architecture

### The Problem with the Current Layout

The Hono backend (`server/`) currently contains filesystem-dependent plugin/skill code:

- `server/lib/skill-manager.ts` — uses `readdirSync`, `readFileSync`, `rmSync` to scan a `skills/` directory
- `server/lib/plugin-loader.ts` — uses `readdirSync`, `existsSync` to scan `server/plugins/`

This is architecturally wrong. The Hono backend deploys to Fly.io — a cloud server with **no access to the user's filesystem**. The `skills/` directory it reads is whatever was deployed alongside the server binary, not the user's local skills. User-local skills (`~/.astro/skills/`, project `.astro/`, `~/.claude/commands/`) live on the user's machine and can only be accessed by something running there.

The backend should be a **stateless API** that receives skill/plugin metadata as input — it should never touch the filesystem for plugin discovery or management.

### Current State (Phase 0 Complete)

The server-side refactor is **largely complete**:

| File | Status | Role |
|------|--------|------|
| `src/lib/skill-parser.ts` | **EXISTS** | Pure function: parses SKILL.md content → `OpenClawSkill`. No filesystem. |
| `src/lib/skill-provider.ts` | **EXISTS** | Provider interface + `WebSkillProvider` / `TauriSkillProvider`. |
| `server/lib/skill-injector.ts` | **EXISTS** | Stateless: `buildSkillPromptInjection(skills[])` → XML string. No filesystem. |

### Where Each Concern Belongs

| Concern | Location | Why |
|---------|----------|-----|
| SKILL.md parsing (pure logic) | `src/lib/skill-parser.ts` (shared) | No filesystem deps, reusable across all runtimes |
| Plugin manifest validation | `src/lib/plugin-manifest.ts` (shared) | Same — pure data validation |
| Skill/plugin **discovery from disk** (Tauri) | `src-tauri/src/commands/plugins.rs` | Requires native filesystem access (optional perf shortcut) |
| Skill/plugin **discovery from disk** (Sidecar) | Node.js `fs` inside sidecar agent runner | Works because sidecar runs on user's machine |
| Skill prompt injection assembly | `server/lib/skill-injector.ts` | Stateless: receives `OpenClawSkill[]` as input, returns XML string |
| Web-mode skill fetch (remote machines) | `server/routes/relay.ts` → agent runner | Relay proxies to the machine that has the filesystem |
| Web-mode skill fetch (local dev) | `server/routes/skills.ts` → local `skills/` | Only works because dev server IS on the user's machine |

### Three Discovery Paths

Skill/plugin discovery happens differently depending on runtime:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Tauri Mode (desktop app) — optional fast path            │
│                                                             │
│    React frontend (webview)                                 │
│      │  invoke('scan_skills', { workdir })                  │
│      ▼                                                      │
│    Rust backend (src-tauri/)                                │
│      │  Direct filesystem: ~/.astro/skills/                 │
│      │                     .astro/skills/                   │
│      │                     ~/.claude/commands/              │
│      ▼                                                      │
│    Returns Vec<Skill> instantly, always fresh                │
│    (bypasses sidecar HTTP — pure Rust syscalls)             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 2. Tauri Mode — standard path (same as web local dev)       │
│                                                             │
│    React frontend (webview)                                 │
│      │  GET /api/relay/slash-commands?machineId=local       │
│      ▼                                                      │
│    Sidecar (localhost:3001)                                 │
│      │  Agent runner (embedded in sidecar, local machine)   │
│      ▼                                                      │
│    Filesystem scan: ~/.astro/skills/, project dir           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 3. Web Mode — Remote Machine                                │
│                                                             │
│    React frontend                                           │
│      │  GET /api/relay/slash-commands?machineId=X           │
│      ▼                                                      │
│    Hono backend (server/)                                   │
│      │  WebSocket: relay → agent runner                     │
│      ▼                                                      │
│    Agent runner (user's machine)                            │
│      │  Filesystem scan: ~/.astro/skills/, project dir      │
│      ▼                                                      │
│    Returns skills via relay, cached in Zustand (5min TTL)   │
└─────────────────────────────────────────────────────────────┘
```

### Frontend Adaptation

The frontend uses a provider pattern to abstract the discovery mechanism (already implemented):

```typescript
// src/lib/skill-provider.ts  (EXISTS)
export interface SkillProvider {
  scanSkills(workdir: string): Promise<OpenClawSkill[]>
  installSkill(name: string, content: string): Promise<OpenClawSkill>
  uninstallSkill(name: string): Promise<boolean>
}

// Tauri: optional direct filesystem via IPC (fast path)
class TauriSkillProvider implements SkillProvider {
  async scanSkills(workdir: string) {
    return invoke<OpenClawSkill[]>('scan_skills', { workdir })
  }
  // ...
}

// Web: HTTP API (relay for remote, /api/skills for local dev)
class WebSkillProvider implements SkillProvider {
  async scanSkills(workdir: string) {
    const [serverSkills, machineSkills] = await Promise.all([
      fetch(apiUrl('/api/skills')).then(r => r.json()),
      fetch(apiUrl('/api/relay/slash-commands?machineId=...')).then(r => r.json()).catch(() => []),
    ])
    return mergeSkills(serverSkills, machineSkills)
  }
  // ...
}

// Detection
const isTauri = () => typeof window !== 'undefined' && '__TAURI__' in window

export function createSkillProvider(): SkillProvider {
  return isTauri() ? new TauriSkillProvider() : new WebSkillProvider()
}
```

### What Changes in `server/`

After the refactor (now largely complete), `server/` has **zero filesystem access for plugins/skills**:

| Before | After |
|--------|-------|
| `server/lib/skill-manager.ts` — reads `skills/` from disk, builds XML | **Deleted.** Split into `src/lib/skill-parser.ts` (shared) + `server/lib/skill-injector.ts` (stateless XML builder) |
| `server/lib/plugin-loader.ts` — reads `server/plugins/` from disk | **Deleted.** Server plugins become Hono middleware registered explicitly in `server/index.ts`, not discovered from filesystem |
| `server/routes/skills.ts` — calls `skillManager.getAllSkills()` | **Changed.** In web mode, proxies to relay. In local dev, can optionally read local `skills/` for convenience, but this is dev-only |

The dispatch flow:

```
Before:  dispatchEngine → skillManager.getSkillPromptInjection() → reads disk
After:   dispatchEngine → buildSkillPromptInjection(task.skills) → pure function
```

The `skills` array is assembled by whoever owns the task context:
- **Tauri (fast path)**: frontend scanned via Rust `invoke('scan_skills')`, sent with dispatch request
- **Tauri (standard)**: sidecar agent runner scanned locally (same machine)
- **Web**: relay fetched from agent runner machine during context assembly

## Optional Rust Command Surface

The Rust layer exposes a **minimal** command surface — primarily performance shortcuts for filesystem operations that would otherwise require HTTP round-trips through the sidecar:

```rust
// Optional: faster than HTTP to sidecar for file operations
// These bypass the sidecar when raw speed matters (large repos, etc.)

// Skill discovery (alternative to GET /api/relay/slash-commands)
#[tauri::command]
fn scan_skills(workdir: &str) -> Vec<Skill> {
    // Merge: {workdir}/.astro/skills/ + ~/.astro/skills/ + ~/.claude/commands/
}

#[tauri::command]
fn install_skill(name: &str, content: &str) -> Skill { /* write SKILL.md */ }

#[tauri::command]
fn uninstall_skill(name: &str) -> bool { /* rm skill dir */ }

// File listing (alternative to relay file_list for large repos)
#[tauri::command]
fn list_files(path: &str) -> Vec<String> { /* git ls-files */ }

// These are NOT needed for correctness — the sidecar handles everything.
// They exist for cases where eliminating the HTTP loopback overhead matters.
```

Most features work without these commands. The Rust layer's **required** responsibilities are:

```rust
// Required: sidecar lifecycle
#[tauri::command]
async fn start_sidecar() -> Result<(), String> { /* spawn node sidecar.js */ }

#[tauri::command]
async fn stop_sidecar() -> Result<(), String> { /* terminate child process */ }

// Required: system integration
// - System tray (show/hide window, quit)
// - Native menus
// - Auto-updater
// - App data directory paths (for sidecar to know where to store PGlite data)
```

## Migration Path

### Phase 0: Server-Side Refactor (COMPLETE)

The prerequisite work — decoupling filesystem access from the Hono backend — is **largely complete**:

- `src/lib/skill-parser.ts` — pure SKILL.md parser, no filesystem
- `server/lib/skill-injector.ts` — stateless `buildSkillPromptInjection(skills[])` function
- `src/lib/skill-provider.ts` — `SkillProvider` interface with `WebSkillProvider` implementation
- Dispatch engine receives skills as input rather than reading from disk

### Phase 1: Tauri Scaffold + Sidecar Bundling

- Initialize `src-tauri/` with Tauri CLI
- Write sidecar build script: esbuild `server/index.ts` + packages into `sidecar.js`
- Configure `tauri.conf.json` to bundle and launch sidecar
- Implement Rust `start_sidecar()` / `stop_sidecar()` commands
- Webview loads the existing React app, points to `localhost:3001`
- Verify same UI works — no code changes to frontend needed

### Phase 2: Frontend Tauri Detection + Sidecar Lifecycle

- Add `isTauri()` detection utility (check `window.__TAURI__`)
- Wait for sidecar ready before rendering (health check on localhost:3001)
- Show loading splash while sidecar starts
- Wire `TauriSkillProvider` (uses Rust `scan_skills` command)
- Handle sidecar crash/restart gracefully

### Phase 3: Native Desktop Features

- System tray: show/hide window, running task indicator, quit
- Native menus: File, Edit, View menus with keyboard shortcuts
- Auto-updater: check for new versions on startup, prompt user
- Optional: Rust filesystem commands for large-repo performance

### Phase 4: Packaging & Distribution

- macOS (Apple Silicon + Intel universal binary)
- Linux (AppImage, deb)
- Windows (MSI, NSIS)
- Code signing and notarization (required for macOS Gatekeeper)
- CI/CD: GitHub Actions build matrix for all platforms

## Relationship to Web App

The web app **does not go away**. It remains the primary interface for:

- Users who don't want to install a desktop app
- Quick access from any device
- Server-mode-only deployments (enterprise, team)
- Onboarding and first impressions

The Tauri app is a **power user upgrade** — same React frontend, better local integration. The web app is the floor, the Tauri app is the ceiling.

## Technical Choices

### Why Tauri (not Electron)

- **Binary size**: Tauri ~5-10 MB (+ ~40 MB Node.js if bundled) vs Electron ~100+ MB
- **Memory**: Uses system webview (WKWebView/WebView2/WebKitGTK), not bundled Chromium
- **Rust shell**: Thin, safe process management and system integration
- **Security**: Fine-grained IPC permissions via `allowlist`
- **Updates**: Built-in auto-updater

### Why Node.js Sidecar (not Rust Backend)

- **Zero rewrite**: The existing `server/index.ts` + packages work unchanged
- **PGlite just works**: PGlite is a WASM module that runs in Node.js — no Rust FFI, no embedding complexity
- **Same code path**: Local dev mode (`npm run dev:local`) and the Tauri sidecar are identical — bugs found in one fix the other
- **Rapid iteration**: Ship the desktop app without waiting for a Rust port of the server logic
- **Agent runner included**: `packages/agent-runner` already runs in Node.js — it bundles naturally

### Why Not a VS Code Extension

- Astro is a standalone planning tool, not an IDE feature
- VS Code extensions can't own their own window/layout
- Plugin ecosystem would be tied to VS Code's extension model
- Limits users to VS Code (excludes JetBrains, Neovim, etc.)

### Why Not a Browser Extension

- Same filesystem access limitations as the web app
- Extension APIs are sandboxed and limited
- Cross-browser maintenance burden
- Can't run background tasks reliably

---

## Reflection: Potential Issues & Improvements

1. **No implementation exists yet.** This is a design document. No Tauri code is in the codebase.
2. **Sidecar startup time** — Node.js process initialization + PGlite WASM load takes 1-3 seconds. The app needs a loading splash screen and a health-check loop before showing the UI.
3. **Node.js binary size** — Bundling Node.js adds ~40 MB to the distributable. For MVP, requiring system Node.js keeps the download small but adds a dependency. Consider a tiered approach: require Node.js for beta, bundle it for GA.
4. **Keeping the sidecar alive** — If the sidecar crashes, the webview loses its backend. The Rust layer must monitor the sidecar process and restart it, surfacing errors to the user via a native dialog (not just a broken UI).
5. **Port conflicts** — The sidecar uses ports 3001 and 3002. If another process occupies them, startup fails. The sidecar should pick a random free port and pass it to the webview at launch via a Tauri event or environment variable.
6. **Scope creep risk** — The document covers standalone, connected, and team modes. Phase 1 should target **standalone mode only** — get the webview → sidecar → PGlite path working before tackling Supabase sync.
7. **Web app parity** — Phase 0 (server refactor) is largely done, but any remaining filesystem reads in `server/` should be cleaned up before bundling to avoid confusing behavior where the sidecar tries to read paths that only make sense on Fly.io.
