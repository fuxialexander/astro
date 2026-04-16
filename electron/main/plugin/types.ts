/**
 * Local mirror of the subset of the renderer-side plugin types we need in
 * the Electron main process. We don't import from `src/types/plugin.ts`
 * because the electron tsconfig has `rootDir: ./electron`, and reaching
 * across the boundary breaks the build. Phase 4B can extract a shared
 * package once the surface stabilises.
 *
 * Keep these in sync with `src/types/plugin.ts` — it's a small surface.
 */

export type PluginPermission =
  | 'storage'
  | 'projects:read'
  | 'plans:read'
  | 'plans:write'
  | 'tasks:dispatch'
  | 'fs:read'
  | 'fs:write'
  | 'http:fetch'
  | 'ui:contribute'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  capabilities: string[]
  configSchema?: Record<string, unknown>
  runtime?: 'sandbox'
  entry?: string
  permissions?: PluginPermission[]
  ui?: { webviewPath: string }
}
