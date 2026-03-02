# Astro Plugin System

This document describes Astro's plugin system architecture, including how to create plugins, available contribution types, the OpenClaw skill system, and the sharing infrastructure.

## Overview

Astro uses a **two-layer extension model**:

1. **Astro Plugins** — App-level extensions that add UI pages, themes, commands, sidebar items, signals, and custom node metadata fields.
2. **OpenClaw Skills** — Agent-level extensions that inject instructions into AI agent prompts during task execution. Skills follow the OpenClaw `SKILL.md` format for compatibility with ClawHub's ecosystem.

Plugins can contribute skills, and skills can exist standalone.

---

## Architecture

### Key Files

| File | Description |
|------|-------------|
| `src/types/plugin.ts` | Plugin type definitions (manifest, context, contributions) |
| `src/types/skill.ts` | OpenClaw-compatible skill types |
| `src/stores/plugin-store.ts` | Plugin registry Zustand store |
| `src/stores/skill-store.ts` | Skill registry Zustand store |
| `src/lib/plugin-context.ts` | PluginContext factory with namespaced storage |
| `src/lib/plugin-loader.ts` | Dynamic plugin loading from URLs/modules |
| `src/lib/skill-loader.ts` | SKILL.md parser (frontend) |
| `src/components/plugin-loader.tsx` | React component that activates plugins |
| `src/components/plugin-routes.tsx` | Dynamic route renderer for plugin pages |
| `src/components/plugin-error-boundary.tsx` | Error isolation for plugin components |
| `src/components/plugin-settings.tsx` | Plugin management UI |
| `src/components/skill-settings.tsx` | Skill management UI |
| `server/lib/skill-manager.ts` | Server-side skill loading and prompt injection |
| `server/routes/skills.ts` | Skills REST API |
| `server/lib/dispatch/context-assembler.ts` | Injects skill instructions into agent execution prompts |

### Data Flow

```
Plugin Registration
    │
    ├── Frontend: plugin-store.registerPlugin(manifest)
    │       │
    │       ├── PluginLoader calls activate(context)
    │       │       │
    │       │       └── Returns PluginContributions
    │       │           ├── sidebarItems → sidebar-store.externalItems
    │       │           ├── commands → commands.externalCommands
    │       │           ├── routes → PluginRoutes (/plugins/*)
    │       │           ├── themes → theme-provider.availableThemes
    │       │           ├── nodeMetadataFields → PlanNode.metadata
    │       │           └── skills → skill-store
    │       │
    │       └── Persisted via dataClient → /api/data/*
    │
    └── Backend: skill-manager.loadSkills()
            │
            ├── Reads skills/ directory for SKILL.md files
            ├── Parses frontmatter + markdown body
            └── Injects into agent prompts via ContextAssembler
```

---

## Creating a Plugin

### Plugin Interface

Every plugin implements the `AstroPlugin` interface:

```typescript
interface AstroPlugin {
  manifest: PluginManifest
  activate: (context: PluginContext) => Promise<PluginContributions>
  deactivate: () => Promise<void>
}
```

### Plugin Manifest

```typescript
interface PluginManifest {
  id: string                        // Unique identifier (e.g., "my-plugin")
  name: string                      // Display name
  version: string                   // Semver version
  description?: string
  author?: string
  capabilities: PluginCapability[]  // What the plugin contributes
  configSchema?: Record<string, unknown>  // JSON Schema for config
}
```

Available capabilities: `'routes'`, `'sidebar'`, `'commands'`, `'theme'`, `'signals'`, `'connectors'`, `'providers'`, `'hooks'`, `'node-metadata'`, `'store'`, `'skills'`.

### Minimal Example

```typescript
import type { AstroPlugin, PluginContributions, PluginContext } from "@/types/plugin"

const plugin: AstroPlugin = {
  manifest: {
    id: "hello-world",
    name: "Hello World",
    version: "1.0.0",
    description: "A minimal example plugin",
    capabilities: ["sidebar", "routes"],
  },

  activate: async (context: PluginContext): Promise<PluginContributions> => {
    return {
      sidebarItems: [
        {
          id: "hello",
          to: "/plugins/hello",
          icon: "Smile",           // lucide-react icon name
          label: "Hello",
          defaultVisible: true,
        },
      ],
      routes: [
        {
          path: "hello",
          component: () => <div>Hello from my plugin!</div>,
        },
      ],
    }
  },

  deactivate: async () => {
    // Cleanup resources
  },
}

export default plugin
```

### Plugin Context

The `PluginContext` passed to `activate()` provides:

```typescript
interface PluginContext {
  stores: {
    getProjects: () => unknown[]           // Read-only project snapshots
    getPlanNodes: () => unknown[]           // Read-only plan node snapshots
    getSessions: () => unknown[]           // Read-only session snapshots
    getSettings: () => Record<string, unknown>  // Settings snapshot
  }
  config: Record<string, unknown>          // Current plugin config
  updateConfig: (config) => void           // Persist config changes
  storage: PluginStorage                   // Namespaced plugin storage
  onEvent: (handler) => () => void         // Event bus subscription
}
```

**Namespaced storage**: Each plugin gets isolated storage keys prefixed with `plugin-{id}-`. For example, plugin `"my-plugin"` calling `storage.set("data", value)` stores under `plugin-my-plugin-data`.

---

## Contribution Types

### Sidebar Items

Add navigation items to the sidebar under the "PLUGINS" section.

```typescript
interface SidebarItemContribution {
  id: string          // Unique item ID
  to: string          // Route path (e.g., "/plugins/my-page")
  icon: string        // lucide-react icon name (e.g., "BookOpen", "Puzzle")
  label: string       // Display label
  defaultVisible?: boolean
}
```

Available icons: `Puzzle`, `BookOpen`, `Palette`, `Zap`, `Globe`, `FileText`, `Layers`, `Box`, `Wrench`, `Code`, plus all standard sidebar icons (`LayoutDashboard`, `FolderKanban`, etc.).

### Routes

Add pages accessible at `/plugins/{path}`.

```typescript
interface RouteContribution {
  path: string                    // Route segment (e.g., "gtd" → /plugins/gtd)
  component: React.ComponentType  // Page component
}
```

Plugin routes are rendered inside a `PluginErrorBoundary` for isolation.

### Commands

Add items to the command palette (Cmd+K).

```typescript
interface CommandItemContribution extends Omit<CommandItem, 'icon'> {
  icon?: string       // lucide-react icon name
}
```

### Themes

Add custom color themes.

```typescript
interface ThemeContribution {
  id: string                              // Theme identifier
  name: string                            // Display name
  baseTheme: 'light' | 'dark'            // Base class applied to <html>
  cssVariables: Record<string, string>    // CSS custom property overrides
}
```

CSS variables use HSL values (matching Tailwind/shadcn conventions):

```typescript
{
  id: "nord",
  name: "Nord",
  baseTheme: "dark",
  cssVariables: {
    "--background": "220 16% 16%",
    "--foreground": "218 27% 92%",
    "--primary": "213 32% 52%",
    "--muted": "220 16% 22%",
    "--card": "220 16% 18%",
    "--border": "220 16% 24%",
  },
}
```

When a custom theme is selected, Astro:
1. Applies the `baseTheme` class (`light` or `dark`) to `<html>`
2. Sets each CSS variable via `document.documentElement.style.setProperty()`
3. Cleans up custom variables when switching to another theme

### Node Metadata Fields

Extend plan nodes with custom data fields stored in `PlanNode.metadata`.

```typescript
interface NodeMetadataFieldContribution {
  key: string                     // Metadata key (e.g., "gtd-context")
  label: string                   // Display label
  type: 'string' | 'number' | 'boolean' | 'select'
  options?: string[]              // For 'select' type
  render?: React.ComponentType    // Optional custom renderer
}
```

### Signals

Register event evaluators for webhook-based triggers.

```typescript
interface SignalContribution {
  type: string
  evaluator: (payload: unknown) => boolean
}
```

### Skills

Contribute OpenClaw-compatible skills (see Skills section below).

---

## Built-in Example Plugins

### Example Theme (`src/plugins/example-theme/`)

Provides three additional dark themes: Solarized Dark, Nord, and Catppuccin Mocha. Demonstrates the `ThemeContribution` capability.

### GTD Workflow (`src/plugins/gtd-workflow/`)

Adds a Getting Things Done workflow:
- **Sidebar item**: "GTD" with BookOpen icon at `/plugins/gtd`
- **Route**: GTD page with Inbox, Next Actions, and Waiting For columns
- **Node metadata fields**: `gtd-context` (select: @computer, @phone, etc.), `gtd-energy` (select: high/medium/low), `gtd-next-action` (boolean)

---

## OpenClaw Skill System

### SKILL.md Format

Skills are defined in `SKILL.md` files with YAML frontmatter and a markdown body:

```markdown
---
name: my-skill
description: What this skill does
userInvocable: true
metadata: {"openclaw":{"emoji":"🔧","requires":{"bins":["git"],"env":["MY_API_KEY"]},"primaryEnv":"MY_API_KEY"}}
---

Instructions for the AI agent go here. This markdown body is injected
into the agent's system prompt during task execution.

You can include:
- Step-by-step procedures
- Tool usage instructions
- Domain-specific knowledge
```

### Skill Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | string | required | Skill identifier |
| `description` | string | required | Short description |
| `userInvocable` | boolean | `true` | Expose as slash command |
| `disableModelInvocation` | boolean | `false` | Exclude from auto-injection |
| `commandDispatch` | `'tool'` | — | Direct tool invocation mode |
| `commandTool` | string | — | Tool name for direct dispatch |

### Metadata (OpenClaw Format)

The `metadata` field contains an `openclaw` object with gating requirements:

```json
{
  "openclaw": {
    "always": false,
    "emoji": "🔧",
    "os": ["darwin", "linux"],
    "requires": {
      "bins": ["git", "node"],
      "anyBins": ["npm", "yarn", "pnpm"],
      "env": ["GITHUB_TOKEN"],
      "config": ["github.token"]
    },
    "primaryEnv": "GITHUB_TOKEN",
    "skillKey": "my-skill",
    "install": [
      { "id": "node", "kind": "brew", "formula": "node", "bins": ["node", "npm"], "label": "Node.js" }
    ]
  }
}
```

### Skill Sources

Skills are loaded from multiple sources with the following precedence:

1. **workspace** — Project's `skills/` directory (highest priority)
2. **plugin** — Contributed by installed plugins
3. **clawhub** — Installed from ClawHub (not yet implemented)
4. **builtin** — Shipped with Astro

### Server-side Prompt Injection

The `SkillManager` on the server builds XML-formatted skill instructions that are injected into the agent's execution prompt:

```xml
<skills>
  <skill name="my-skill" description="What this skill does">
    Instructions for the AI agent go here...
  </skill>
</skills>
```

This injection happens in `ContextAssembler.buildExecutionPrompt()`, placed after the project vision document but before task-specific context.

### Frontend Skill Store

The `skill-store` (Zustand) manages skills on the frontend:

- `skills: Map<string, OpenClawSkill>` — All loaded skills
- `addSkill(skill)` / `removeSkill(name)` — Manage skills
- `enableSkill(name)` / `disableSkill(name)` — Toggle skills
- `updateSkillConfig(name, config)` — Per-skill configuration
- `getSkillPromptInjection()` — Formatted XML for prompt injection

Persisted via `dataClient` → `/api/data/*`.

---

## Skills REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/skills` | List all skills with eligibility status |
| `POST` | `/api/skills/install` | Install from ClawHub (stub) |
| `DELETE` | `/api/skills/:name` | Uninstall a skill |
| `PUT` | `/api/skills/:name/config` | Update skill configuration |

### Example: List Skills

```
GET /api/skills

Response:
{
  "skills": [
    {
      "name": "git-helper",
      "description": "Git workflow assistance",
      "source": "workspace",
      "enabled": true,
      "eligible": true,
      "userInvocable": true,
      "config": {}
    }
  ],
  "total": 1
}
```

---

## Plugin Management UI

Plugins and skills are managed in **Settings > Plugins** and **Settings > Skills**.

### Plugin Settings

- View installed plugins with name, version, capabilities, and status
- Enable/disable individual plugins
- View activation errors
- Add plugins from URL (dynamic `import()`)

### Skill Settings

- View loaded skills with source badges (workspace, plugin, builtin)
- Enable/disable individual skills
- Expand to preview skill instructions
- Configure per-skill API keys (when `primaryEnv` is set)
- Paste raw `SKILL.md` content to add skills manually

---

## Sharing System

Astro supports exporting and importing projects and configurations via JSON files.

### Export Bundle Format

```typescript
interface AstroExportBundle {
  $schema: 'astro-export'
  version: '1.0'
  type: 'project' | 'workspace-config' | 'plugin-config'
  exportedAt: string              // ISO 8601
  astroVersion: string
  name: string
  description?: string
  data: ProjectExportData | WorkspaceConfigExportData | PluginConfigExportData
}
```

### Project Export/Import

**Export** (from Plan View header):
- Reads project, nodes, and edges from stores
- Sanitizes data: strips `workingDirectory`, `defaultMachineId`, `fileTree*` fields
- Resets node execution state (`executionId`, `executionOutput`, etc.)
- Resets all node statuses to `'planned'`
- Downloads as `{project-name}.astro.json`

**Import** (from Projects page):
- Generates new UUIDs for project, all nodes, and all edges
- Remaps all node references (dependencies, parentId, milestoneId)
- Remaps edge source/target references
- Reports warnings for unmapped references

### Workspace Config Export/Import

Exports sidebar items, display settings, and user preferences. Import merges with existing config.

### Plugin Config Export/Import

Exports installed plugin list with enabled/disabled state and configuration.

### Link-based Sharing

The server provides a share API for link-based sharing (requires Supabase):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/share` | Store bundle, returns short ID |
| `GET` | `/api/share/:id` | Retrieve bundle (7-day expiry) |

---

## Plugin Lifecycle

1. **Registration**: `plugin-store.registerPlugin(manifest, config)` persists manifest and config via the data layer
2. **Loading**: `PluginLoader` component runs in the React tree after `DataLoader`
3. **Activation**: Calls `plugin.activate(context)` with a `PluginContext` providing stores, storage, and event subscription
4. **Contribution Collection**: Returned `PluginContributions` are stored in the plugin entry
5. **Rendering**: `PluginRoutes` renders contributed routes; sidebar reads `externalItems`; theme provider reads custom themes
6. **Deactivation**: On unmount or disable, `plugin.deactivate()` is called for cleanup
7. **Error Handling**: Activation errors are captured and displayed in settings; contributed components render inside `PluginErrorBoundary`

---

## Persistence

| Data | Storage | Contents |
|------|---------|----------|
| Plugin registry | `dataClient` → `/api/data/*` | Array of `PluginPersistData` (manifest, enabled, config) |
| Skill registry | `dataClient` → `/api/data/*` | Array of `OpenClawSkill` objects |
| Plugin storage | `plugin-{id}-{key}` | Per-plugin namespaced data |

Runtime-only data (plugin instances, contributions, error messages) is NOT persisted.

---

## Error Isolation

- **PluginErrorBoundary**: React error boundary wrapping each plugin's contributed routes. Catches render errors and displays a fallback UI with the plugin ID and error message.
- **Activation errors**: `try-catch` around `activate()` calls. Errors stored in `PluginEntry.error` and displayed in Plugin Settings.
- **Event handler errors**: `try-catch` around each event handler in `PluginEventBus.emit()`.
- **Manifest validation**: `validateManifest()` checks for required fields (`id`, `name`, `version`, `capabilities` array) before loading.
