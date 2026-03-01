# Skills UI, Lifecycle, and Cross-Machine Synchronization

## Overview

This document designs the complete skills experience in Astro: browsing, creating, editing, sharing, and synchronizing skills across machines. Skills are the primary mechanism for extending agent capabilities — they are reusable instruction sets that teach AI agents how to use specific tools, follow specific workflows, or apply domain expertise.

## Current Architecture (Gaps)

### What Exists
- `OpenClawSkill` type definition (name, description, instructions, source, enabled, config)
- Server-side `skillManager` — in-memory registry (no database persistence)
- API: `GET /api/skills`, `POST /api/skills/register`, `DELETE /api/skills/:name`, `PUT /api/skills/:name/config`
- Frontend `useSkillStore` — Zustand store, loads from API
- Agent runner: scans `~/.claude/skills/` and `{workdir}/.claude/skills/` for SKILL.md files
- Relay: `slash_commands.request/response` for skill discovery from agent runners
- Skill injector: builds `<skills>...</skills>` XML for prompt injection

### What's Missing
- No database table for skills (in-memory only, lost on restart)
- No UI page for skills (no browsing, editing, creating)
- No sidebar entry for Skills
- No skill creation flow (chat-based or form-based)
- No cross-machine synchronization
- No community skill sharing
- No skill versioning or history
- No visualization (categories, tags, counts)

## Design

### Skill Storage: The Synchronization Question

**Core problem:** Users have multiple machines (laptop, HPC, cloud). Skills on `~/.claude/skills/` are local to each machine. How do we synchronize?

**Proposed: Hybrid Storage Model**

```
┌─────────────────────────────────────────────────────┐
│ Astro Server (Source of Truth for server mode)      │
│                                                      │
│  Database: skills table                              │
│  ├── User-created skills (persisted)                │
│  ├── Community skills (shared)                      │
│  └── Builtin skills (seeded on startup)             │
│                                                      │
│  On machine connect:                                 │
│  1. Agent runner reports local skills (relay)        │
│  2. Server merges with DB skills                    │
│  3. Sends combined skill set back to runner          │
│  4. Runner writes server skills to ~/.astro/skills/ │
└─────────────────────────────────────────────────────┘
          ↕ Relay (WebSocket)
┌─────────────────────────────────────────────────────┐
│ Agent Runner (Machine-local)                         │
│                                                      │
│  ~/.claude/skills/        ← Claude Code native      │
│  ~/.astro/skills/         ← Astro-managed (synced)  │
│  {workdir}/.claude/skills/ ← Project-specific       │
│                                                      │
│  On connect:                                         │
│  1. Scan all skill locations                        │
│  2. Report to server via relay                      │
│  3. Receive server-managed skills                   │
│  4. Write to ~/.astro/skills/ for persistence       │
└─────────────────────────────────────────────────────┘
```

**Why this works:**
- **Server mode**: Skills are persisted in PostgreSQL, synced to all connected machines
- **Local mode**: Skills are stored in `~/.astro/skills/` (PGlite for metadata, files on disk)
- **Cross-machine sync**: When a machine connects, it gets the latest skill set from the server
- **Offline**: Machines always have a local copy in `~/.astro/skills/`, usable without server

### Database Schema

```sql
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name VARCHAR(100) NOT NULL UNIQUE,
  version VARCHAR(20) DEFAULT '1.0.0',

  -- Content
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,         -- Full SKILL.md markdown body
  category VARCHAR(50),               -- tools, prompts, research, daily, infrastructure
  tags TEXT[],
  icon VARCHAR(50),                   -- Lucide icon name

  -- Source and attribution
  source VARCHAR(20) DEFAULT 'custom',  -- builtin, workspace, community, custom, imported
  source_url TEXT,                     -- GitHub URL or marketplace reference
  author_id UUID REFERENCES user_profiles(id),
  author_name VARCHAR(100),

  -- Configuration
  enabled BOOLEAN DEFAULT true,
  allowed_tools TEXT[],               -- Claude Code tools this skill uses
  metadata JSONB,                     -- OpenClawSkillMetadata
  config JSONB,                       -- Per-skill user config overrides

  -- Community
  is_shared BOOLEAN DEFAULT false,    -- Published to community
  stars_count INTEGER DEFAULT 0,
  forks_count INTEGER DEFAULT 0,

  -- Scope
  team_id UUID REFERENCES teams(id),  -- Team-scoped skill (null = personal)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_skills_name ON skills(name);
CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_author ON skills(author_id);
CREATE INDEX idx_skills_shared ON skills(is_shared) WHERE is_shared = true;
```

### Skill Lifecycle States

```
        ┌──────────┐
        │ Discovery │ ← From GitHub URL, marketplace, or manual creation
        └────┬─────┘
             │
        ┌────▼─────┐
        │  Draft    │ ← Being created/edited via chat interface
        └────┬─────┘
             │
        ┌────▼─────┐
        │  Saved    │ ← Persisted to DB + synced to machines
        └────┬─────┘
             │
        ┌────▼─────┐
        │ Enabled   │ ← Active, injected into agent prompts
        └────┬─────┘
             │
        ┌────▼──────┐
        │ Published  │ ← Shared to community (optional)
        └───────────┘
```

## UI Design

### Sidebar: Add "Skills" Navigation Item

Position between "Workflows" and "Grand Plans" in the sidebar:

```
Dashboard
Plan
Playground
Projects
Environments
Active
Workflows
Skills          ← NEW (with count badge showing total skills)
Grand Plans
```

### Skills Page (`/skills`)

```
/skills
├── Header: "Skills" + [+ Create Skill] button
│
├── Tabs:
│   ├── My Skills (default) — User's own + builtin skills
│   ├── Community — Shared skills from all users
│   └── Categories — Category-based browsing with counts
│
├── Toolbar:
│   ├── Search (full-text on name, description, tags)
│   ├── Filter by: Category | Source | Enabled/Disabled
│   ├── Sort by: Name | Recently Updated | Most Stars
│   └── View: Cards | List
│
├── Skill Cards (My Skills tab):
│   ├── Grid of cards, each showing:
│   │   ├── Icon (from category or custom)
│   │   ├── Name
│   │   ├── Description (truncated, 2 lines)
│   │   ├── Category badge + Source badge (builtin/custom/imported/community)
│   │   ├── Tags (as small chips)
│   │   ├── Enabled toggle (inline)
│   │   └── Menu: View | Edit | Share | Delete
│   │
│   ├── Builtin skills shown with a "Built-in" badge (not deletable)
│   └── Empty state: "No skills yet. Create one or browse the community."
│
├── Skill Cards (Community tab):
│   ├── Same card layout but with:
│   │   ├── Author name
│   │   ├── Stars count + Fork count
│   │   └── [Use This Skill] button (forks to your skills)
│   │
│   └── Trending / Recently Added / Most Stars sections
│
├── Categories Tab:
│   ├── Category cards with count:
│   │   ├── Infrastructure (5 skills) — K8s, SkyPilot, Docker, SLURM, SSH
│   │   ├── AI/ML (3 skills) — DSPy, training, evaluation
│   │   ├── Research (2 skills) — Literature review, paper writing
│   │   ├── Development (4 skills) — GitHub, testing, documentation
│   │   └── Custom (N skills) — User-created
│   └── Click category → filtered view
│
└── Stats bar at bottom:
    ├── Total: 15 skills
    ├── Enabled: 12
    ├── Builtin: 5
    └── Custom: 10
```

### Skill Detail View (`/skills/:name`)

When clicking on a skill card:

```
/skills/:name
├── Header:
│   ├── Icon + Name + Version badge
│   ├── Category badge + Source badge
│   ├── Enabled toggle
│   └── Buttons: [Edit] [Share] [Delete]
│
├── Tabs:
│   ├── Overview (default)
│   │   ├── Description
│   │   ├── Tags
│   │   ├── Allowed tools list
│   │   ├── Source URL (if imported)
│   │   └── Author + dates
│   │
│   ├── Instructions
│   │   ├── Rendered markdown of the SKILL.md body
│   │   ├── Syntax-highlighted code blocks
│   │   └── Collapsible sections for long content
│   │
│   ├── Configuration
│   │   ├── User-specific config overrides (JSON editor)
│   │   ├── E.g., K8s: namespace, PVC name, queue name
│   │   └── "These values are injected into the skill context"
│   │
│   └── Usage
│       ├── How many times this skill was used in tasks
│       ├── Which projects reference it
│       └── Last used date
│
└── Sidebar info:
    ├── Created: date
    ├── Updated: date
    ├── Stars: N (if shared)
    └── Machines synced to: [laptop, hpc-node, ...]
```

### Skill Creation: Chat-Based Interface (`/skills/new`)

When the user clicks "+ Create Skill", they enter a chat-based creation flow:

```
/skills/new
├── Left panel: Chat interface
│   ├── System message:
│   │   "I'll help you create a new skill. You can:
│   │    1. Describe what the skill should do
│   │    2. Provide a GitHub repo URL to learn from
│   │    3. Paste documentation or examples
│   │    Let's start — what should this skill help with?"
│   │
│   ├── User messages + AI responses
│   │   ├── User: "Create a skill for managing my GCP VMs"
│   │   ├── AI: "I'll create a GCP VM management skill. Let me ask..."
│   │   ├── AI: Asks about specific use cases, auth method, regions
│   │   ├── User: Provides details
│   │   └── AI: Generates SKILL.md draft
│   │
│   └── Input bar: Text + attach file/URL
│
├── Right panel: Live preview
│   ├── Rendered SKILL.md preview (updates as AI generates)
│   ├── YAML frontmatter display (name, version, category, tags)
│   ├── Markdown body preview
│   └── [Save Skill] button (saves to DB + syncs)
│
└── Footer:
    ├── Source input: "Import from GitHub URL" (optional)
    │   User provides: https://github.com/org/repo/tree/main/docs
    │   AI: Downloads, reads, extracts relevant patterns
    │   AI: Generates SKILL.md incorporating the knowledge
    └── [Save Draft] [Save & Enable]
```

**Creation from GitHub repo:**

```
1. User provides: https://github.com/org/repo
2. Agent (Claude/Codex) clones the repo (or specific folder)
3. Agent reads README, key files, examples
4. Agent generates a SKILL.md that teaches how to use the package
5. User reviews and refines via chat
6. Skill saved to ~/.astro/skills/ AND database
```

### Skill Editing: Chat-Based Refinement (`/skills/:name/edit`)

Similar to creation but starts with existing content:

```
/skills/:name/edit
├── Left panel: Chat interface
│   ├── System message:
│   │   "You're editing the '{{skillName}}' skill.
│   │    Current instructions are shown on the right.
│   │    Tell me what you'd like to change."
│   │
│   ├── User: "Add information about my specific K8s cluster"
│   ├── AI: "What's your cluster name, namespaces, and GPU types?"
│   ├── User: "Cluster: scale-lab, NS: training, GPUs: H100"
│   ├── AI: Updates the skill with cluster-specific instructions
│   │
│   └── User: "Also add our Kueue queue: skypilot-jobs-8-gpu"
│       AI: Updates accordingly
│
├── Right panel: Live editor
│   ├── Editable markdown (Monaco editor)
│   ├── Changes highlighted (diff view)
│   └── [Save] [Revert] [Save as New Skill]
│
└── Footer:
    └── [Save Changes] — Updates DB + syncs to machines
```

### Skill Sharing to Community

From the skill detail view, click "Share":

```
Share Skill Dialog:
├── Title (pre-filled from skill name)
├── Description (editable, from skill.description)
├── Category
├── Tags
├── Visibility: Public | Team Only
├── "Strip personal config?" (checkbox, default: yes)
│   Removes cluster-specific details like PVC names, namespaces
└── [Share to Community] [Cancel]
```

## Cross-Machine Skill Synchronization

### The Sync Protocol

```
Machine A (laptop) creates skill "gcp-workflow"
  ↓
POST /api/skills → saved to DB with author_id
  ↓
Machine B (HPC) connects via relay
  ↓
Server sends skill list (including "gcp-workflow") in:
  relay message: skills.sync { skills: OpenClawSkill[] }
  ↓
Machine B writes to ~/.astro/skills/gcp-workflow/SKILL.md
  ↓
Skill available on Machine B for agent execution
```

### New Relay Messages

```typescript
// Server → Agent Runner: push updated skills
interface SkillsSyncMessage {
  type: 'skills.sync'
  skills: Array<{
    name: string
    version: string
    description: string
    instructions: string  // SKILL.md body
    category: string
    enabled: boolean
    config?: Record<string, unknown>
  }>
}

// Agent Runner → Server: report local-only skills
interface SkillsReportMessage {
  type: 'skills.report'
  skills: Array<{
    name: string
    description: string
    source: 'workspace' | 'builtin'
    // instructions NOT sent (too large) — server fetches on demand
  }>
}
```

### Sync Flow

```
1. Machine connects → sends skills.report (local skill names)
2. Server compares with DB skills
3. Server sends skills.sync with:
   - DB skills not on machine (to be written locally)
   - Updated versions of skills machine already has
4. Machine writes missing/updated skills to ~/.astro/skills/
5. Machine confirms via skills.report (updated list)
```

### Conflict Resolution

When the same skill exists locally and on server:
- **Server wins for server-created skills** (source: 'custom', 'community')
- **Local wins for workspace skills** (source: 'workspace', from `.claude/skills/`)
- **Neither overwrites builtin skills** (source: 'builtin')
- Version comparison: higher version wins

### API Extensions

```
GET  /api/skills                    # List all (existing)
POST /api/skills                    # Create new skill (NEW)
GET  /api/skills/:name              # Get full skill with instructions (NEW)
PUT  /api/skills/:name              # Update skill content (NEW)
DELETE /api/skills/:name            # Delete skill (existing)
PUT  /api/skills/:name/config       # Update config (existing)
POST /api/skills/register           # Bulk register from relay (existing)

# Community
GET  /api/skills/community          # List shared skills (NEW)
POST /api/skills/:name/share        # Share to community (NEW)
POST /api/skills/:name/star         # Star a community skill (NEW)
POST /api/skills/:name/fork         # Copy community skill to personal (NEW)

# Sync
POST /api/skills/sync               # Trigger sync to specific machine (NEW)
```

## Zustand Store Extensions

```typescript
// src/stores/skill-store.ts — extended

interface SkillStore {
  // Existing
  skills: Map<string, OpenClawSkill>
  loaded: boolean

  // New
  categories: { name: string; count: number; icon: string }[]
  communitySkills: OpenClawSkill[]
  selectedSkill: OpenClawSkill | null
  searchQuery: string
  activeCategory: string | null
  viewMode: 'cards' | 'list'

  // Actions — existing
  load: () => Promise<void>
  addSkill: (skill: OpenClawSkill) => void
  removeSkill: (name: string) => void
  enableSkill: (name: string) => void
  disableSkill: (name: string) => void
  updateSkillConfig: (name: string, config: Record<string, unknown>) => void

  // Actions — new
  createSkill: (skill: Partial<OpenClawSkill>) => Promise<void>
  updateSkill: (name: string, updates: Partial<OpenClawSkill>) => Promise<void>
  fetchSkillDetail: (name: string) => Promise<OpenClawSkill>
  searchSkills: (query: string) => void
  filterByCategory: (category: string | null) => void

  // Community
  loadCommunitySkills: () => Promise<void>
  shareSkill: (name: string, options: ShareOptions) => Promise<void>
  starSkill: (name: string) => Promise<void>
  forkSkill: (name: string) => Promise<void>
}
```

## Component Architecture

```
src/
├── pages/
│   ├── skills.tsx                    # Main skills page with tabs
│   ├── skill-detail.tsx              # Skill detail view
│   ├── skill-create.tsx              # Chat-based creation
│   └── skill-edit.tsx                # Chat-based editing
│
├── components/
│   └── skills/
│       ├── skill-card.tsx            # Card component
│       ├── skill-gallery.tsx         # Grid of cards with search/filter
│       ├── skill-preview.tsx         # Rendered SKILL.md preview
│       ├── skill-editor.tsx          # Monaco editor for SKILL.md
│       ├── skill-chat.tsx            # Chat interface for creation/editing
│       ├── skill-share-dialog.tsx    # Share to community dialog
│       ├── skill-config-editor.tsx   # JSON config editor
│       ├── skill-category-view.tsx   # Category cards with counts
│       └── skill-stats-bar.tsx       # Bottom stats (total, enabled, etc.)
```

## Implementation Phases

### Phase 1: Database + API + Basic UI (2 weeks)

1. **Database migration**: Create `skills` table in Drizzle schema
2. **CRUD API**: `POST/GET/PUT/DELETE /api/skills` with full content
3. **Skills page**: Basic list/grid view with search and category filter
4. **Skill detail page**: View rendered markdown + enable/disable toggle
5. **Sidebar**: Add "Skills" nav item
6. **Seed builtin skills**: Load K8s, SkyPilot, SLURM, GitHub skills on server start

### Phase 2: Skill Creation + Editing (2 weeks)

1. **Chat-based creation** (`/skills/new`): Chat panel + live preview
2. **Chat-based editing** (`/skills/:name/edit`): Same with pre-loaded content
3. **GitHub import**: User provides URL → agent downloads and generates skill
4. **Config editor**: Per-skill configuration overrides (namespace, queue, etc.)

### Phase 3: Cross-Machine Sync (1 week)

1. **Relay messages**: `skills.sync` and `skills.report`
2. **Agent runner changes**: Write synced skills to `~/.astro/skills/`
3. **Conflict resolution**: Version-based, source-priority rules
4. **Sync status UI**: Show which machines have which skills

### Phase 4: Community Sharing (1-2 weeks)

1. **Share dialog**: Publish skill to community with sanitization
2. **Community tab**: Browse shared skills with stars/forks
3. **Fork flow**: Copy community skill to personal collection
4. **Star/comment**: Social features on community skills

### Phase 5: Advanced Visualization (1 week)

1. **Categories view**: Cards with counts per category
2. **Tags**: Tag-based filtering and discovery
3. **Usage stats**: How often each skill is used
4. **Dependency graph**: Which skills reference others

## Priority Summary

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| Phase 1: DB + API + Basic UI | 2 weeks | Foundation for everything | **Critical** |
| Phase 2: Chat creation/editing | 2 weeks | Core UX differentiator | **High** |
| Phase 3: Cross-machine sync | 1 week | Multi-machine users | **High** |
| Phase 4: Community sharing | 1-2 weeks | Network effect | **Medium** |
| Phase 5: Advanced visualization | 1 week | Polish | **Low** |

**Total: ~7-8 weeks for full implementation**
**MVP (Phase 1-2): ~4 weeks**
