/**
 * Server-side plugin types
 *
 * Types for plugins that run on the Hono backend,
 * providing routes, hooks, providers, and signal evaluators.
 */

import type { Hono } from 'hono'
import type { PluginManifest } from '../../src/types/plugin.js'

/**
 * Context passed to server plugin activate()
 */
export interface ServerPluginContext {
  /** Event transport for emitting/subscribing to server events */
  eventTransport: unknown
  /** Provider registry for registering agent providers */
  providerRegistry: unknown
  /** Plugin configuration from persistent storage */
  config: Record<string, unknown>
}

/**
 * Contributions returned from a server plugin's activate()
 */
export interface ServerPluginContributions {
  /** Hono sub-app mounted at /api/plugins/{pluginId}/ */
  routes?: Hono
  /** Lifecycle hooks */
  hooks?: Array<{ name: string; handler: (...args: unknown[]) => void | Promise<void> }>
  /** Additional agent providers */
  providers?: unknown[]
  /** Signal evaluators for webhook processing */
  signalEvaluators?: Array<{ type: string; evaluator: (payload: unknown) => boolean }>
}

/**
 * Server-side plugin interface
 */
export interface AstroServerPlugin {
  manifest: PluginManifest
  activate: (context: ServerPluginContext) => Promise<ServerPluginContributions>
  deactivate: () => Promise<void>
}

/**
 * Entry tracking a loaded server plugin
 */
export interface ServerPluginEntry {
  manifest: PluginManifest
  contributions?: ServerPluginContributions
  error?: string
}
