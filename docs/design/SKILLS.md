# Skills System

> Design document for Astro's skill registry — built-in skills for examples and compute backends, with prompt injection at dispatch time.

> **Status (March 2026):** Skills are a backend-only system with no dedicated UI page. The Skills page and catalog infrastructure have been removed. Five built-in skills ship in `skills/`:
> - **Example-paired** (3): `academic-presentation`, `academic-review`, `moat-fragility` — referenced by example templates
> - **Compute backend** (2): `kubernetes-workflow`, `skypilot-workflow` — infrastructure workflow guides
>
> Skills are seeded into the DB on server startup, injected into agent prompts at dispatch time, and manageable via Settings > Skills (toggle on/off). The Environments page shows hints encouraging users to explore skills when K8s or SkyPilot backends are detected.

## Overview

The Skills system provides a **database-backed, team-scoped registry** of reusable agent instructions that are injected into Claude's system prompt during plan generation and task execution. Skills teach agents domain-specific workflows (e.g., Kubernetes operations, SkyPilot job management) without requiring changes to the core agent code.

### Design Goals

1. **Declarative**: Skills are defined as SKILL.md files (YAML frontmatter + markdown body), not TypeScript code
2. **Example-integrated**: Example templates reference paired skills for comprehensive agent instructions
3. **Team-scoped**: Skills are isolated per team with RLS; catalog/builtin skills are shared globally
4. **Hot-reloadable**: Enable/disable skills without server restart; in-memory registry syncs on every mutation
5. **Externally curated**: Compute backend skills live in [skills-lib](https://github.com/astro-anywhere/skills-lib), not in Astro

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SKILL.md Files                        │
│              skills/kubernetes-workflow/                 │
│              skills/skypilot-workflow/                   │
└────────────────────┬────────────────────────────────────┘
                     │ loadBuiltinSkillsFromDisk()
                     │ parseBuiltinSkillMd()
                     ▼
┌─────────────────────────────────────────────────────────┐
│               PostgreSQL / PGlite                       │
│                 `skills` table                           │
│   (source of truth — builtins + user + workspace)       │
└────────┬──────────────────────────┬─────────────────────┘
         │ syncSkillsFromDb()      │ GET /api/skills
         ▼                         ▼
┌──────────────────┐    ┌──────────────────────────┐
│  SkillManager    │    │  Frontend Zustand Store   │
│  (in-memory,     │    │  (optimistic updates,     │
│   server-side)   │    │   Map<id, SkillRow>)      │
└────────┬─────────┘    └──────────────────────────┘
         │ getSkillPromptInjection()
         ▼
┌─────────────────────────────────────────────────────────┐
│               Agent System Prompt                       │
│  <skills>                                               │
│    <skill name="astro/..." description="...">           │
│      {instructions markdown}                            │
│    </skill>                                             │
│  </skills>                                              │
└─────────────────────────────────────────────────────────┘
```

### Three-Layer Architecture

| Layer | Component | Role |
|-------|-----------|------|
| **Persistence** | `skills` table (Drizzle ORM) | Source of truth; team-scoped with RLS |
| **In-Memory** | `SkillManager` singleton | Fast prompt injection without DB queries per request |
| **Frontend** | Zustand `useSkillStore` | Optimistic CRUD with rollback on failure |

### Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/db/schema.ts` | `skills` table definition (columns, indexes, constraints) |
| `packages/core/src/skills/types.ts` | `BuiltinSkillDefinition` interface |
| `packages/core/src/skills/builtin-parser.ts` | Pure parser: SKILL.md → `BuiltinSkillDefinition` |
| `packages/core/src/skill-parser.ts` | OpenClaw parser: SKILL.md → `OpenClawSkill` (workspace skills) |
| `packages/core/src/skill-injector.ts` | Pure function: skills → XML prompt injection string |
| `packages/core/src/db/bootstrap-skills.ts` | Seeds built-in skills into DB on server startup |
| `server/lib/load-builtin-skills.ts` | Reads `skills/*/SKILL.md` from disk |
| `server/lib/skill-manager.ts` | In-memory skill registry singleton |
| `server/routes/skills.ts` | REST API: CRUD + toggle endpoints |
| `src/stores/skill-store.ts` | Frontend Zustand store with optimistic updates |
| `src/components/skill-settings.tsx` | Settings UI: list, toggle, create, delete |

---

## SKILL.md Format

Built-in skills use YAML frontmatter + markdown instructions:

```markdown
---
name: kubernetes-workflow
version: "1.0.0"
description: "Use when the user mentions Kubernetes, k8s, kubectl, pods, deployments, or needs to run code on a cluster."
category: tools
tags: [kubernetes, k8s, cloud, devops, infrastructure, gpu, training]
allowedTools: [Bash, Read, Write, Glob, Grep]
---

# Kubernetes Workflow

## Goal
Execute tasks on Kubernetes clusters including pod management,
deployment configuration, and multi-node training jobs.

## Instructions
1. Check cluster connectivity: `kubectl cluster-info`
2. ...
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Kebab-case identifier (e.g., `kubernetes-workflow`) |
| `version` | string | Yes | Semantic version (e.g., `"1.0.0"`) |
| `description` | string | Yes | When to invoke this skill (matched by the AI) |
| `category` | string | No | One of: `tools`, `workflows`, `templates`, `integrations` |
| `tags` | string[] | No | Searchable tags as inline YAML array |
| `allowedTools` | string[] | No | Tools the skill can request: `Bash`, `Read`, `Write`, `Glob`, `Grep`, `Edit` |

### OpenClaw Extension Fields (User/Community Skills)

User-created and community skills support additional fields stored in the `config` JSONB column:

| Field | Type | Description |
|-------|------|-------------|
| `userInvocable` | boolean | Expose as a slash command (default: `true`) |
| `disableModelInvocation` | boolean | Exclude from auto-injection, user must invoke explicitly (default: `false`) |
| `commandDispatch` | `'tool'` | Direct tool invocation mode |
| `commandTool` | string | Tool name for direct dispatch |
| `metadata.openclaw.always` | boolean | Always inject, ignore gating |
| `metadata.openclaw.emoji` | string | UI display emoji |
| `metadata.openclaw.os` | string[] | OS restrictions: `darwin`, `linux`, `win32` |
| `metadata.openclaw.requires.bins` | string[] | Required binaries on PATH |
| `metadata.openclaw.requires.env` | string[] | Required environment variables |
| `metadata.openclaw.primaryEnv` | string | Convenience env var for API key |

---

## Database Schema

### Table: `skills`

```sql
CREATE TABLE skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL DEFAULT '',
  version       TEXT NOT NULL DEFAULT '1.0.0',
  description   TEXT NOT NULL DEFAULT '',
  instructions  TEXT NOT NULL DEFAULT '',
  category      TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  source        TEXT,  -- 'builtin' | 'workspace' | 'clawhub' | 'plugin' | 'user'
  source_url    TEXT,
  author_id     UUID REFERENCES user_profiles(id),
  enabled       BOOLEAN NOT NULL DEFAULT true,
  allowed_tools TEXT[] NOT NULL DEFAULT '{}',
  config        JSONB DEFAULT '{}',
  team_id       UUID REFERENCES teams(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (name, team_id),
  CHECK (source IN ('builtin', 'workspace', 'clawhub', 'plugin', 'user')),
  CHECK (source != 'builtin' OR (team_id IS NULL AND author_id IS NULL))
);
```

### Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| `skills_team_id_idx` | `team_id` | Team-scoped queries |
| `skills_author_id_idx` | `author_id` | Author lookups |
| `skills_category_idx` | `category` | Filter by category |
| `skills_enabled_idx` | `enabled` | Fast enabled-skill queries |
| `skills_team_enabled_idx` | `(team_id, enabled)` | Team + enabled composite |
| `skills_name_source_idx` | `(name, source)` | Bootstrap upsert lookups |
| `skills_builtin_name_unique` | `name` WHERE `source='builtin'` | Prevent duplicate builtins |

### Constraints

- **Unique per team**: `UNIQUE (name, team_id)` — same skill name can exist in different teams
- **Valid source**: `CHECK (source IN ('builtin', 'workspace', 'clawhub', 'plugin', 'user'))`
- **Builtin ownership**: `CHECK (source != 'builtin' OR (team_id IS NULL AND author_id IS NULL))` — builtins are global, owned by nobody

### Source Types

| Source | Origin | Editable | Deletable | Ownership |
|--------|--------|----------|-----------|-----------|
| `builtin` | `skills/` directory, seeded on startup | No | No | Global (NULL team/author) |
| `workspace` | User-created via paste or UI | Yes | Yes | Team-scoped |
| `clawhub` | Imported from ClawHub registry | Yes | Yes | Team-scoped |
| `plugin` | Contributed by Tauri plugins | Yes | Yes | Team-scoped |
| `user` | Legacy per-user skills | Yes | Yes | Team-scoped |

---

## API

All endpoints require authentication. Skills are filtered by team: `teamId = user.teamId OR (teamId IS NULL AND source = 'builtin')`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/skills` | List all skills for user's team (builtins + team-owned) |
| `GET` | `/api/skills/:id` | Get single skill by UUID |
| `POST` | `/api/skills` | Create skill (rejects `source='builtin'`) |
| `PUT` | `/api/skills/:id` | Update skill (rejects builtin edits) |
| `DELETE` | `/api/skills/:id` | Delete skill (rejects builtin deletion) |
| `PUT` | `/api/skills/:id/toggle` | Toggle enabled/disabled (allowed for builtins) |

### Validation Rules

- Config JSONB max size: **100 KB** (overflow error includes byte-level breakdown)
- `source` field is **immutable** after creation
- `source='builtin'` cannot be set via API (403 Forbidden)
- Unique constraint violations return 409 Conflict
- After every mutation, `syncSkillsFromDb(skillManager)` refreshes the in-memory registry

---

## UI Design

### Skills Settings Page

The skills UI lives in Settings and provides:

1. **Skill List** — Cards showing name, description, source badge, and enable/disable toggle
2. **Built-in Skills** — Displayed with a "Built-in" badge; can be toggled but not edited or deleted
3. **Paste Import** — Textarea accepting raw SKILL.md content; parsed via `parseSkillMd()` and created as `source='workspace'`
4. **Skill Detail** — Expandable card showing:
   - Full instruction preview (first 500 chars)
   - API key input (when `metadata.openclaw.primaryEnv` is set)
   - Requirements badges (required binaries, env vars)
   - Delete button (hidden for builtins)

### Optimistic Updates

The frontend uses optimistic updates for responsive UX:

1. **Create**: Adds a `temp-{uuid}` entry immediately, replaced with server UUID on success
2. **Toggle**: Flips `enabled` state locally, reverts + shows toast on failure
3. **Delete**: Removes from local map immediately, re-adds on failure
4. **Cleanup**: On successful create, all `temp-` prefixed entries are swept for safety

---

## Prompt Injection

### Namespace Prefix

All Astro skills are namespaced with an `astro/` prefix when injected into agent prompts. This distinguishes Astro platform skills (cloud-stored, team-scoped, synced across devices) from local agent skills (e.g., Claude Code skills stored in `~/.claude/skills/`).

**Why**: Claude Code and other agents can have their own locally-installed skills. Without namespacing, an Astro skill named `kubernetes-workflow` could collide with a local Claude Code skill of the same name. The `astro/` prefix creates clear isolation — the model sees `astro/kubernetes-workflow` vs `kubernetes-workflow` and understands they come from different sources.

**Implementation**: The prefix is applied at injection time in `buildSkillPromptInjection()` (`packages/core/src/skill-injector.ts`), not stored in the database. Skill names in the DB remain unprefixed (e.g., `kubernetes-workflow`). This keeps the DB clean and allows the prefix convention to evolve without migrations.

### Two-Plane Architecture

Astro skills and local agent skills operate on completely separate planes:

| Plane | Storage | Scope | Injection | Prefix |
|-------|---------|-------|-----------|--------|
| **Astro Server Skills** | `skills` DB table | Team-scoped, synced across devices | `buildSkillPromptInjection()` → XML in system prompt | `astro/` |
| **Local Agent Skills** | `~/.claude/skills/` (or equivalent) | Per-machine, per-user | Agent-runner scans local dir → slash commands / prompt injection | None |

The two planes are independent — no collision detection or deduplication is needed because the `astro/` prefix makes names unambiguous in the prompt.

### XML Format

Skills are injected as XML blocks in the agent's system prompt:

```xml
<skills>
  <skill name="astro/kubernetes-workflow" description="Use when the user mentions...">
# Kubernetes Workflow

## Goal
Execute tasks on Kubernetes clusters...

## Instructions
1. Check cluster connectivity
...
  </skill>
  <skill name="astro/skypilot-workflow" description="Use when the user mentions...">
...
  </skill>
</skills>
```

### Injection Points

| Context | Location | Function |
|---------|----------|----------|
| Plan generation | `server/routes/dispatch.ts` `/generate-plan` | `buildInteractivePlanPrompt(..., { skillsSummary })` |
| Interactive plan chat | `server/routes/dispatch.ts` | `buildInteractivePlanPrompt(..., { skillsSummary })` |
| Task execution | `server/routes/dispatch.ts` | Appended to relay system prompt |

### Gating

A skill is injected into the prompt only when **all** of these are true:
- `enabled = true`
- `disableModelInvocation != true`
- (Future) OS and binary requirements are met

---

## Built-in Skills

### Current Built-ins (5 total)

| Skill | Category | Used By | Description |
|-------|----------|---------|-------------|
| `academic-presentation` | workflows | examples | Academic presentation generation from research papers |
| `academic-review` | workflows | examples | Peer review with structured feedback |
| `moat-fragility` | workflows | examples | Competitive moat analysis and fragility assessment |
| `kubernetes-workflow` | tools | environments hint | Kubernetes cluster operations: pods, deployments, multi-node training, GPU scheduling |
| `skypilot-workflow` | tools | environments hint | SkyPilot cloud job management: distributed training, spot instances, multi-cloud |

### Adding a New Built-in Skill

1. **Create the directory and SKILL.md**:

```bash
mkdir skills/my-new-skill
```

2. **Write `skills/my-new-skill/SKILL.md`**:

```markdown
---
name: my-new-skill
version: "1.0.0"
description: "Use when the user asks to... [trigger phrases the AI should match on]"
category: tools
tags: [relevant, searchable, tags]
allowedTools: [Bash, Read, Write]
---

# My New Skill

## Goal
Concise statement of what this skill enables.

## Prerequisites
- Required tools, credentials, or environment setup

## Instructions
Step-by-step workflow the agent should follow.

## Common Patterns
Frequently needed commands or code snippets.

## Troubleshooting
Known issues and how to resolve them.
```

3. **Restart the server** — `loadBuiltinSkillsFromDisk()` picks up the new file automatically. The bootstrap process inserts it into the DB.

4. **Verify** — Check the server logs for:
```
[bootstrap] Loaded builtin skill: my-new-skill (v1.0.0)
[bootstrap] Built-in skills seeding complete: 1 inserted, 0 updated, 2 unchanged
```

### SKILL.md Authoring Guidelines

- **`description`** is critical — it determines when the AI invokes the skill. Include all relevant trigger phrases, tool names, and keywords users might say
- **`instructions`** should be actionable — write them as if briefing a senior engineer who has never used this tool before
- **`allowedTools`** should be minimal — only list tools the skill actually needs
- **`version`** should follow semver — bump on content changes so the bootstrap detects updates
- Keep instructions under ~2000 lines — very long skills dilute the system prompt
- Use markdown headers (`##`) to organize sections — the AI processes structured content better
- Include concrete command examples — agents perform better with copy-pasteable templates

### Parser Limitations

The built-in parser (`parseBuiltinSkillMd`) is a simple line-by-line YAML parser for flat key-value frontmatter. It does **not** support:
- Multi-line YAML values
- Nested objects
- YAML anchors/aliases

For complex frontmatter needs, consider upgrading to a full YAML parser (`js-yaml`).

---

## Workspace & External Skills

### Workspace Skills

Users can create team-local skills via Settings > Skills:

1. **Paste SKILL.md** — Copy a SKILL.md from any source, paste into the Skills settings textarea
2. **Team sharing** — All skills with `source='workspace'` are visible to the entire team

### Skill Versioning

- Built-in skills track version in the SKILL.md frontmatter
- The bootstrap process compares all fields (version, description, instructions, category, tags, allowedTools) to detect changes
- Only writes to DB when content actually changed (avoids `updatedAt` churn)

### External Skill Repos

- [astro-anywhere/skills-lib](https://github.com/astro-anywhere/skills-lib) — curated skills for compute backends and DSPy workflows
- Skills can be ported by copying their SKILL.md into `skills/{name}/SKILL.md`

---

## Data Flow Summary

### Server Startup

```
skills/*/SKILL.md
  → loadBuiltinSkillsFromDisk()          # Read from disk
  → parseBuiltinSkillMd()                # Parse YAML + markdown
  → bootstrapBuiltinSkills()             # Insert/update DB (transactional)
  → syncSkillsFromDb(skillManager)       # Load DB → in-memory registry
```

### Frontend Page Load

```
DataLoader mount
  → useSkillStore.load()
  → dataClient.listSkills()              # GET /api/skills
  → API returns team-scoped skills       # builtins + user-owned
  → Store updates Map<id, SkillRow>
```

### User Creates Skill

```
User pastes SKILL.md
  → parseSkillMd(content, 'workspace')   # Frontend parser
  → useSkillStore.addSkill(skill)        # Optimistic update (temp-{uuid})
  → dataClient.createSkill(skill)        # POST /api/skills
  → API inserts row                      # Sets authorId, teamId
  → syncSkillsFromDb(skillManager)       # Refresh in-memory
  → Frontend replaces temp ID            # Server UUID
```

### Agent Prompt Injection

```
Plan generation / Task dispatch
  → skillManager.getSkillPromptInjection()
  → getEligibleSkills(allSkills)          # enabled && !disableModelInvocation
  → buildSkillPromptInjection(eligible)   # XML format
  → Injected into system prompt           # Before vision doc
```

---

## Testing

Tests live in `tests/skills-crud.test.ts` (82 test cases) covering:

- **Bootstrap**: Seeding, update detection, unchanged skip, field comparison
- **API CRUD**: Create, read, update, delete with team scoping
- **Builtin protection**: Cannot edit, delete, or impersonate builtins
- **Toggle**: Enable/disable (including builtins)
- **Validation**: Config size limits, source immutability, unique constraints
- **Store**: Optimistic updates, rollback on failure, temp-ID cleanup
- **Parser**: SKILL.md parsing with various frontmatter formats
- **Namespace**: `astro/` prefix in prompt injection XML, XML sanitization

Run with:
```bash
npx vitest run tests/skills-crud.test.ts
```

---

## Implementation Status (Issue #224)

Tracks: [feat: Skills UI, Lifecycle, Cross-Machine Sync, and Community Sharing](https://github.com/fuxialexander/astro/issues/224)

### Phase 0: Publish and Integrate Built-in Skills — COMPLETE

| Deliverable | Status | PR |
|-------------|--------|----|
| K8s + SkyPilot skills as SKILL.md | Done | #346 |
| `skills/` directory at repo root | Done | #346 |
| `parseBuiltinSkillMd()` pure parser | Done | #346 |
| `loadBuiltinSkillsFromDisk()` loader | Done | #346 |
| Auto-seeding on server startup | Done | #346 |
| Prompt injection via `skillManager` | Done | #346 |

**Note**: The `skills-catalog/` directory and catalog infrastructure (collection manifests, catalog bootstrap) have been removed. All skills now live in `skills/`. The external [astro-anywhere/skills-lib](https://github.com/astro-anywhere/skills-lib) repo contains additional skills (dspy-*, skill-onboarder) that can be ported if needed by copying their SKILL.md into `skills/{name}/SKILL.md`.

### Phase 1: Database + API + Basic UI — COMPLETE

| Deliverable | Status | PR |
|-------------|--------|----|
| `skills` table with Drizzle schema | Done | #306 |
| Supabase migration + RLS policies | Done | #318 |
| CRUD API with team scoping | Done | #328 |
| Bootstrap seeding on startup | Done | #329 |
| Frontend Zustand store + dataClient | Done | #333 |
| Skills management page (list/grid) | Done | #337 |
| Skill detail dialog (CRUD) | Done | #339 |
| Test suite (78+ tests) | Done | #343 |
| SKILL.md refactor (TS → files) | Done | #346 |

### Future Considerations

The following features may be revisited if user demand warrants:

- **Workspace skills**: Users can already paste SKILL.md content via Settings > Skills to create team-local skills (`source='workspace'`). No dedicated UI page currently.
- **Cross-machine sync**: Skills synced to connected machines via relay protocol. Would require agent-runner integration.
- **Community skill sharing**: A community skill browser (ClawHub integration or skills-lib fetch). Currently low priority — community focus is on plan sharing.
- **Auto-detection**: Agent-runner detects K8s/SkyPilot on machines and auto-enables relevant skills.

### Timeline Summary

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | Built-in skills (SKILL.md → DB → prompt) | **Complete** |
| Phase 1 | DB + API + Settings UI | **Complete** |
| Catalog removal | Skills page, catalog infrastructure removed | **Complete** |
