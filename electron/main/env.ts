/**
 * Environment synthesis for the server utilityProcess.
 *
 * Ported from the legacy Tauri sidecar. We compute the env in main (not in
 * the child) so the child gets a clean object via utilityProcess.fork({ env }).
 *
 * Notes:
 *   - Paths use Electron's app.getPath('userData') and process.resourcesPath.
 *     In dev, resourcesPath points at the Electron binary, so we fall back
 *     to repo paths.
 *   - JWT secrets are generated per-launch with crypto.randomBytes — no
 *     token survives a restart.
 */

import { app } from 'electron'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface ServerEnv extends Record<string, string> {
  ASTRO_MODE: string
  ASTRO_DESKTOP: string
  NODE_ENV: string
  PORT: string
  RELAY_PORT: string
  PGLITE_DATA_DIR: string
  ASTRO_MIGRATIONS_FOLDER: string
  ASTRO_SKILLS_DIR: string
  RELAY_JWT_SECRET: string
  DEVICE_AUTH_JWT_SECRET: string
  DEVICE_AUTH_REFRESH_SECRET: string
}

/**
 * Where the bundled server lives. In dev (electron CLI from repo) it's at
 * <repo>/server/dist. In a packaged app, Forge's `extraResource` copies
 * `server/dist` → `resources/dist` (Forge uses the source basename), so
 * the bundle entry resolves to `resources/dist/index.js`.
 */
export function resolveServerBundleDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'dist')
  }
  // electron/dist/main/env.js → ../../../server/dist
  return path.resolve(__dirname, '../../../server/dist')
}

export function buildServerEnv(): ServerEnv {
  const bundleDir = resolveServerBundleDir()
  const userData = app.getPath('userData')

  // In dev, drizzle/skills sit next to the bundle. In prod, Forge copies
  // them as siblings under resources/ (resources/drizzle, resources/skills).
  const drizzleDir = app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.join(bundleDir, 'drizzle')
  const skillsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'skills')
    : path.join(bundleDir, 'skills')

  // PGlite data lives under userData so it survives uninstalls of the app
  // but persists across upgrades — keeping the DB out of the bundle.
  const pgliteDataDir = path.join(userData, 'pglite')

  return {
    // Pass through the user's existing env so things like ANTHROPIC_API_KEY
    // and OS PATH are preserved.
    ...(process.env as Record<string, string>),

    ASTRO_MODE: process.env.ASTRO_MODE ?? 'local',
    ASTRO_DESKTOP: '1',
    // Mirrors the sidecar: desktop is always "local single user", so we
    // explicitly mark NODE_ENV=development to relax strict prod checks
    // (JWT secret length, etc.). Override only if user set it.
    NODE_ENV: process.env.NODE_ENV ?? 'development',

    PORT: process.env.PORT ?? '3001',
    RELAY_PORT: process.env.RELAY_PORT ?? '3002',

    PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR ?? pgliteDataDir,
    ASTRO_MIGRATIONS_FOLDER: process.env.ASTRO_MIGRATIONS_FOLDER ?? drizzleDir,
    ASTRO_SKILLS_DIR: process.env.ASTRO_SKILLS_DIR ?? skillsDir,

    // Ephemeral per-launch secrets — same as sidecar's __astroDefault().
    RELAY_JWT_SECRET: process.env.RELAY_JWT_SECRET ?? randomBytes(32).toString('hex'),
    DEVICE_AUTH_JWT_SECRET: process.env.DEVICE_AUTH_JWT_SECRET ?? randomBytes(32).toString('hex'),
    DEVICE_AUTH_REFRESH_SECRET:
      process.env.DEVICE_AUTH_REFRESH_SECRET ?? randomBytes(32).toString('hex'),
  }
}
