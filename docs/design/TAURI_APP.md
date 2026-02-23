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

### File Maps

Currently requires relay round-trip for remote machines and caching for local:

- **Web**: `git ls-files` on agent runner → relay → frontend cache (ephemeral, 5min TTL)
- **Tauri**: Direct `git ls-files` call, instant, always fresh

---

## Plugin System Architecture

### The Problem with the Current Layout

The Hono backend (`server/`) currently contains filesystem-dependent plugin/skill code:

- `server/lib/skill-manager.ts` — uses `readdirSync`, `readFileSync`, `rmSync` to scan a `skills/` directory
- `server/lib/plugin-loader.ts` — uses `readdirSync`, `existsSync` to scan `server/plugins/`

This is architecturally wrong. The Hono backend deploys to Fly.io — a cloud server with **no access to the user's filesystem**. The `skills/` directory it reads is whatever was deployed alongside the server binary, not the user's local skills. User-local skills (`~/.astro/skills/`, project `.astro/`, `~/.claude/commands/`) live on the user's machine and can only be accessed by something running there.

The backend should be a **stateless API** that receives skill/plugin metadata as input — it should never touch the filesystem for plugin discovery or management.

### Where Each Concern Belongs

| Concern | Location | Why |
|---------|----------|-----|
| SKILL.md parsing (pure logic) | `src/lib/skill-parser.ts` (shared) | No filesystem deps, reusable across all runtimes |
| Plugin manifest validation | `src/lib/plugin-manifest.ts` (shared) | Same — pure data validation |
| Skill/plugin **discovery from disk** | `src-tauri/src/commands/plugins.rs` | Requires native filesystem access |
| Skill/plugin **install/uninstall** | `src-tauri/src/commands/plugins.rs` | Writes to `~/.astro/skills/`, project dirs |
| Skill prompt injection assembly | `server/lib/skill-injector.ts` | Stateless: receives `OpenClawSkill[]` as input, returns XML string |
| Web-mode skill fetch (remote machines) | `server/routes/relay.ts` → agent runner | Relay proxies to the machine that has the filesystem |
| Web-mode skill fetch (local dev) | `server/routes/skills.ts` → local `skills/` | Only works because dev server IS on the user's machine |

### Three Discovery Paths

Skill/plugin discovery happens differently depending on runtime:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Tauri Mode (desktop app)                                 │
│                                                             │
│    React frontend                                           │
│      │  invoke('scan_skills', { workdir })                  │
│      ▼                                                      │
│    Rust backend (src-tauri/)                                 │
│      │  Direct filesystem: ~/.astro/skills/                 │
│      │                     .astro/skills/                    │
│      │                     ~/.claude/commands/               │
│      ▼                                                      │
│    Returns Vec<Skill> instantly, always fresh                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 2. Web Mode — Remote Machine                                │
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

┌─────────────────────────────────────────────────────────────┐
│ 3. Web Mode — Local Dev (npm run dev)                       │
│                                                             │
│    React frontend                                           │
│      │  GET /api/skills                                     │
│      ▼                                                      │
│    Hono backend (running locally on same machine)           │
│      │  Reads skills/ dir relative to server                │
│      ▼                                                      │
│    Works only because dev server IS the user's machine      │
│    (Breaks in production — Fly.io has no user skills)       │
└─────────────────────────────────────────────────────────────┘
```

### Refactoring the Server

The current `server/lib/skill-manager.ts` needs to be split:

**Keep in `server/`** — stateless injection logic:

```typescript
// server/lib/skill-injector.ts
// Pure function: skills in, XML out. No filesystem.
export function buildSkillPromptInjection(skills: OpenClawSkill[]): string {
  const eligible = skills.filter(s => s.enabled && !s.disableModelInvocation)
  if (eligible.length === 0) return ''
  const blocks = eligible.map(
    s => `  <skill name="${s.name}" description="${s.description}">\n${s.instructions}\n  </skill>`
  )
  return `<skills>\n${blocks.join('\n')}\n</skills>`
}
```

**Move to shared** — SKILL.md parsing:

```typescript
// src/lib/skill-parser.ts
// Pure function: string in, OpenClawSkill out. No filesystem.
export function parseSkillMd(content: string, source: OpenClawSkill['source']): OpenClawSkill | null
```

**Move to `src-tauri/`** — filesystem discovery:

```rust
// src-tauri/src/commands/skills.rs
#[tauri::command]
fn scan_skills(workdir: &str) -> Result<Vec<Skill>, String> {
    let mut skills = Vec::new();
    // Scan: ~/.astro/skills/
    // Scan: {workdir}/.astro/skills/
    // Scan: ~/.claude/commands/
    // Parse each SKILL.md
    Ok(skills)
}

#[tauri::command]
fn install_skill(name: &str, content: &str) -> Result<Skill, String> {
    // Write to ~/.astro/skills/{name}/SKILL.md
}

#[tauri::command]
fn uninstall_skill(name: &str) -> Result<bool, String> {
    // Remove ~/.astro/skills/{name}/
}
```

**Move to agent runner** — relay-mode discovery:

The agent runner already runs on the user's machine. It should expose skill discovery as a relay message type (`skills.list` / `skills.list.result`) so the web frontend can fetch user-local skills via the relay, without the Hono backend ever touching the filesystem.

### `src-tauri/` Directory Structure

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── build.rs
├── icons/
└── src/
    ├── main.rs                    # Tauri app entry, command registration
    ├── lib.rs
    └── commands/
        ├── mod.rs
        ├── skills.rs              # scan_skills, install_skill, uninstall_skill
        ├── plugins.rs             # scan_plugins, install_plugin, plugin lifecycle
        ├── files.rs               # list_files (git ls-files), read_file, file_tree
        ├── git.rs                 # git_status, git_diff, git_commit
        └── agent.rs               # run_agent (embedded agent runner, local dispatch)
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

### Frontend Adaptation

The frontend uses a provider pattern to abstract the discovery mechanism:

```typescript
// src/lib/skill-provider.ts
export interface SkillProvider {
  scanSkills(workdir: string): Promise<OpenClawSkill[]>
  installSkill(name: string, content: string): Promise<OpenClawSkill>
  uninstallSkill(name: string): Promise<boolean>
}

// Tauri: direct filesystem via IPC
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

The `useProjectMetadata()` hook (from the ephemeral cache architecture) uses this provider internally:

```typescript
export function useProjectMetadata(projectId: string): void {
  const provider = useMemo(() => createSkillProvider(), [])

  useEffect(() => {
    if (!workingDirectory) return
    provider.scanSkills(workingDirectory).then(skills => {
      updateProjectSkills(projectId, skills)
    })
  }, [projectId, workingDirectory, defaultMachineId])
}
```

### What Changes in `server/`

After the refactor, `server/` has **zero filesystem access for plugins/skills**:

| Before | After |
|--------|-------|
| `server/lib/skill-manager.ts` — reads `skills/` from disk, builds XML | **Deleted.** Split into `src/lib/skill-parser.ts` (shared) + `server/lib/skill-injector.ts` (stateless XML builder) |
| `server/lib/plugin-loader.ts` — reads `server/plugins/` from disk | **Deleted.** Server plugins become Hono middleware registered explicitly in `server/index.ts`, not discovered from filesystem |
| `server/routes/skills.ts` — calls `skillManager.getAllSkills()` | **Changed.** In web mode, proxies to relay. In local dev, can optionally read local `skills/` for convenience, but this is dev-only |

The dispatch flow changes too. When the dispatch engine needs to inject skills into an agent prompt:

```
Before:  dispatchEngine → skillManager.getSkillPromptInjection() → reads disk
After:   dispatchEngine → buildSkillPromptInjection(task.skills) → pure function
```

The `skills` array is assembled by whoever owns the task context:
- **Tauri**: frontend scanned them via Rust commands, sent them with the dispatch request
- **Web**: relay fetched them from the agent runner machine during context assembly

## Tauri Command Surface

The full Rust command surface exposed to the React frontend:

```rust
// File operations (replaces relay file_list protocol)
#[tauri::command]
fn list_files(path: &str) -> Vec<String> { /* git ls-files */ }

// Skill discovery (replaces relay slash_commands + server skill-manager)
#[tauri::command]
fn scan_skills(workdir: &str) -> Vec<Skill> {
    // Merge: {workdir}/.astro/skills/ + ~/.astro/skills/ + ~/.claude/commands/
}

#[tauri::command]
fn install_skill(name: &str, content: &str) -> Skill { /* write SKILL.md */ }

#[tauri::command]
fn uninstall_skill(name: &str) -> bool { /* rm skill dir */ }

// Plugin discovery and management
#[tauri::command]
fn scan_plugins(workdir: &str) -> Vec<Plugin> { /* scan plugin dirs */ }

#[tauri::command]
fn install_plugin(source: &str) -> Plugin { /* copy to ~/.astro/plugins/ */ }

// Agent execution (replaces relay task dispatch for local tasks)
#[tauri::command]
async fn run_agent(task: Task) -> TaskResult { /* Claude SDK query() */ }

// Git operations (replaces /api/repo/* endpoints)
#[tauri::command]
fn git_status(workdir: &str) -> GitStatus { /* git status */ }

#[tauri::command]
fn git_diff(workdir: &str) -> String { /* git diff */ }
```

## Migration Path

### Phase 0: Server-Side Refactor (prerequisite, no Tauri yet)

Decouple filesystem access from the Hono backend so `server/` is clean before wrapping in Tauri:

- Extract `parseSkillMd()` from `server/lib/skill-manager.ts` → `src/lib/skill-parser.ts` (shared, pure)
- Create `server/lib/skill-injector.ts` — stateless `buildSkillPromptInjection(skills[])` function
- Remove filesystem reads from `server/lib/skill-manager.ts` and `server/lib/plugin-loader.ts`
- Add relay message types `skills.list` / `skills.list.result` so agent runner can report local skills
- Create `SkillProvider` interface in `src/lib/skill-provider.ts` with `WebSkillProvider` implementation
- Update dispatch engine to receive skills as input rather than reading from disk

This phase improves the web app too — skills from remote machines work properly instead of relying on server-local `skills/` dir.

### Phase 1: Proof of Concept

- Initialize `src-tauri/` with Tauri CLI, wrap existing React app in webview
- Implement `list_files` and `scan_skills` Rust commands
- Create `TauriSkillProvider` implementing the same `SkillProvider` interface
- Detect Tauri environment (`__TAURI__` in window), swap provider
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

- Plugin management UI with filesystem access (install/uninstall via Tauri commands)
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
