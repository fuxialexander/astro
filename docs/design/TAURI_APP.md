# Tauri Desktop App Vision

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

### Proposed (Tauri)

```
┌─────────────────────────────────────────┐
│ Tauri App (single binary)               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Webview (React frontend)        │    │
│  │ Same React app, same components │    │
│  └──────────┬──────────────────────┘    │
│             │ Tauri commands            │
│  ┌──────────▼──────────────────────┐    │
│  │ Rust Backend                    │    │
│  │  ├── PGlite (local Postgres)   │    │
│  │  ├── Filesystem (direct)       │    │
│  │  ├── Agent Runner (embedded)   │    │
│  │  └── Claude SDK (API calls)    │    │
│  └──────────┬──────────────────────┘    │
│             │                           │
│  ┌──────────▼──────────────────────┐    │
│  │ Optional Network               │    │
│  │  ├── → Supabase (sync/teams)   │    │
│  │  └── → Relay (remote machines) │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

1 component for local ops, 0 network hops.

## Mode Spectrum

A Tauri app doesn't force a choice between local and server mode — it supports a spectrum:

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

## What's Still Needed

### Relay Server (for remote dispatch)

The relay **does not go away**. It serves remote dispatch — sending tasks to:
- HPC clusters (SLURM)
- Cloud GPU instances
- Other developer machines
- CI/CD environments

What changes is that for **local tasks**, there's no relay hop. The embedded agent runner handles them directly.

### Supabase (for teams and sync)

Supabase remains needed for:
- Multi-user authentication and RLS
- Real-time collaboration
- Multi-device sync
- Team features

### What's Eliminated

| Component | Current Role | Tauri Replacement |
|-----------|-------------|-------------------|
| Hono backend (for local ops) | Prompt assembly, Claude SDK calls, SSE | Tauri commands, in-process |
| Relay (for local machine) | Bridge frontend ↔ local agent runner | Unnecessary — same process |
| IndexedDB caching | Cache file trees, skills in browser | Direct filesystem access |
| Device auth flow | Register local machine with relay | Unnecessary — app IS the machine |

## What This Solves

### Plugin System

Currently blocked because plugins are filesystem artifacts but the frontend has no filesystem:

- **Web**: Agent runner discovers plugins → reports metadata via relay → frontend caches in memory
- **Tauri**: Direct filesystem access to `~/.claude/skills/`, `~/.claude/plugins/`, project `.claude/`

With Tauri, plugin installation is just writing files to disk. Plugin discovery is just reading directories. No relay, no caching, no staleness.

### File Maps

Currently requires relay round-trip for remote machines and caching for local:

- **Web**: `git ls-files` on agent runner → relay → frontend cache (ephemeral, 5min TTL)
- **Tauri**: Direct `git ls-files` call, instant, always fresh

### Skills

Currently three disconnected systems (server SkillManager, agent runner scan, frontend skill-store):

- **Web**: Merge server skills + relay machine skills, cache in Zustand memory
- **Tauri**: Direct scan of `.claude/skills/`, single source of truth

## Tauri Command Surface

The Rust backend exposes commands that the React frontend invokes:

```rust
// File operations (replaces relay file_list protocol)
#[tauri::command]
fn list_files(path: &str) -> Vec<String> { /* git ls-files */ }

// Skill discovery (replaces relay slash_commands protocol)
#[tauri::command]
fn scan_skills(workdir: &str) -> Vec<Skill> { /* scan .claude/skills/ */ }

// Agent execution (replaces relay task dispatch)
#[tauri::command]
async fn run_agent(task: Task) -> TaskResult { /* Claude SDK query() */ }

// Git operations (replaces /api/repo/* endpoints)
#[tauri::command]
fn git_status(workdir: &str) -> GitStatus { /* git status */ }

// Plugin management (new capability)
#[tauri::command]
fn install_plugin(path: &str) -> Plugin { /* copy to ~/.claude/plugins/ */ }
```

## Frontend Adaptation

The key abstraction point is the `useProjectMetadata()` hook (from the ephemeral cache architecture):

```typescript
// Web mode (current)
function useProjectMetadata(projectId: string): void {
  // Fetch via API/relay
  fetch(apiUrl('/api/repo/file-tree?...'))
  fetch(apiUrl('/api/relay/slash-commands?...'))
}

// Tauri mode (future)
function useProjectMetadata(projectId: string): void {
  // Invoke Tauri commands (direct, no network)
  invoke('list_files', { path: workingDirectory })
  invoke('scan_skills', { workdir: workingDirectory })
}
```

Detection:

```typescript
const isTauri = () => typeof window !== 'undefined' && '__TAURI__' in window

// In hooks and stores:
if (isTauri()) {
  // Use Tauri commands
} else {
  // Use HTTP API + relay
}
```

## Migration Path

### Phase 1: Proof of Concept

- Wrap existing React app in Tauri webview
- Implement `list_files` and `scan_skills` Tauri commands
- Detect Tauri environment, swap file tree and skill fetching
- Verify same UI works in both web and Tauri modes

### Phase 2: Embedded Agent Runner

- Port Claude SDK `query()` call to Rust sidecar (or Node.js sidecar via Tauri)
- Implement `run_agent` Tauri command for local task execution
- Bypass relay for local tasks, keep relay for remote

### Phase 3: PGlite Integration

- Embed PGlite in Tauri app
- Same Postgres schema as Supabase
- Add sync layer for connected/team mode

### Phase 4: Full Feature Parity

- Plugin management UI with filesystem access
- Git operations (status, diff, commit) via Tauri commands
- System tray for background task monitoring
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

The Tauri app is a **power user upgrade** — same React frontend, better local integration. The web app is the floor, the Tauri app is the ceiling.

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

### Why Not a Browser Extension

- Same filesystem access limitations as the web app
- Extension APIs are sandboxed and limited
- Cross-browser maintenance burden
- Can't run background tasks reliably
