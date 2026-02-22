/**
 * Plugin system type definitions
 *
 * Astro plugins extend the app with custom pages, themes, commands,
 * sidebar items, signals, and more. Plugins can also contribute
 * OpenClaw-compatible skills for agent-level extensions.
 */

import type { CommandItem } from './index'
import type { OpenClawSkill } from './skill'

// --- Plugin Capabilities ---

export type PluginCapability =
  | 'routes'
  | 'sidebar'
  | 'commands'
  | 'theme'
  | 'signals'
  | 'connectors'
  | 'providers'
  | 'hooks'
  | 'node-metadata'
  | 'store'
  | 'skills'

// --- Plugin Manifest ---

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  capabilities: PluginCapability[]
  configSchema?: Record<string, unknown>  // JSON Schema for plugin config
}

// --- Plugin Context (passed to activate) ---

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
}

export interface PluginContext {
  /** Read-only snapshots of core stores */
  stores: {
    getProjects: () => unknown[]
    getPlanNodes: () => unknown[]
    getSessions: () => unknown[]
    getSettings: () => Record<string, unknown>
  }
  /** Current plugin configuration */
  config: Record<string, unknown>
  /** Update plugin configuration (persisted) */
  updateConfig: (config: Record<string, unknown>) => void
  /** Namespaced storage for plugin data */
  storage: PluginStorage
  /** Subscribe to frontend events, returns unsubscribe */
  onEvent: (handler: (event: PluginEvent) => void) => () => void
}

export interface PluginEvent {
  type: string
  payload?: unknown
}

// --- Contribution Types ---

export interface SidebarItemContribution {
  id: string
  to: string
  icon: string          // lucide-react icon name
  label: string
  defaultVisible?: boolean
}

export interface CommandItemContribution extends Omit<CommandItem, 'icon'> {
  icon?: string         // lucide-react icon name
}

export interface RouteContribution {
  path: string
  component: React.ComponentType
}

export interface ThemeContribution {
  id: string
  name: string
  baseTheme: 'light' | 'dark'
  cssVariables: Record<string, string>
}

export interface SignalContribution {
  type: string
  evaluator: (payload: unknown) => boolean
}

export interface NodeMetadataFieldContribution {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  options?: string[]
  render?: React.ComponentType<{ value: unknown; onChange: (value: unknown) => void }>
}

export interface StoreContribution {
  id: string
  store: unknown
}

export type SkillContribution = OpenClawSkill

// --- Plugin Contributions (returned from activate) ---

export interface PluginContributions {
  sidebarItems?: SidebarItemContribution[]
  commands?: CommandItemContribution[]
  routes?: RouteContribution[]
  themes?: ThemeContribution[]
  signals?: SignalContribution[]
  nodeMetadataFields?: NodeMetadataFieldContribution[]
  stores?: StoreContribution[]
  settingsPanel?: React.ComponentType
  skills?: SkillContribution[]
}

// --- AstroPlugin Interface ---

export interface AstroPlugin {
  manifest: PluginManifest
  activate: (context: PluginContext) => Promise<PluginContributions>
  deactivate: () => Promise<void>
}

// --- Plugin Entry (stored in plugin-store) ---

export interface PluginEntry {
  manifest: PluginManifest
  enabled: boolean
  config: Record<string, unknown>
  /** Runtime-only: the activated plugin instance */
  instance?: AstroPlugin
  /** Runtime-only: contributions from activate() */
  contributions?: PluginContributions
  /** Activation error if plugin failed to load */
  error?: string
}

// --- Serializable plugin data for persistence ---

export interface PluginPersistData {
  id: string
  manifest: PluginManifest
  enabled: boolean
  config: Record<string, unknown>
  /** URL or module path for dynamic loading */
  source?: string
}
