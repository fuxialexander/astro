/**
 * Post-install hook.
 *
 * Two jobs:
 *   1. Install agent-runner submodule deps (best-effort — the submodule may
 *      be absent in some checkouts, e.g. CI builds that don't need it).
 *   2. Rebuild node-pty against Electron's ABI. This MUST succeed if Electron
 *      is installed; the in-app Terminal panel doesn't work otherwise. The
 *      previous shell-pipe version swallowed failures and left users with a
 *      broken terminal until they manually re-ran electron-rebuild.
 *
 * Skip rules (each emits a single log line, then exit 0):
 *   - ASTRO_SKIP_NATIVE_REBUILD=1            opt-out for non-desktop builds
 *   - npm config 'ignore-scripts' is true    npm itself wants no scripts
 *   - node_modules/electron is missing       not a desktop install
 *
 * Failure rules (exit 1, npm install fails loudly):
 *   - electron-rebuild exits non-zero (toolchain missing, etc.)
 *   - the resulting pty.node binary is missing or empty
 *
 * Diagnostic hints are printed before exit so the user can self-serve.
 *
 * Plain ESM `.mjs` (no TypeScript) so it runs even when tsx isn't installed
 * (e.g. `npm install --omit=dev`).
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function info(msg) { console.log(`[postinstall] ${msg}`) }
function warn(msg) { console.warn(`[postinstall] ${msg}`) }
function fail(msg) {
  console.error(`\n[postinstall] ${msg}\n`)
  process.exit(1)
}

// ─── Submodule deps (best-effort) ───────────────────────────────────────────

function installSubmoduleDeps() {
  const sub = join(ROOT, 'packages', 'agent-runner')
  if (!existsSync(sub)) return
  if (!existsSync(join(sub, 'package.json'))) return
  try {
    execSync('npm install --ignore-scripts --no-audit --no-fund --silent', {
      cwd: sub,
      stdio: 'inherit',
    })
  } catch {
    // Non-fatal: the submodule's own deps are needed only if you're going to
    // run its tests/build locally, not for the parent app's runtime.
    warn('agent-runner submodule deps did not install — run `cd packages/agent-runner && npm install --ignore-scripts` if you need to work on the agent.')
  }
}

// ─── node-pty rebuild ───────────────────────────────────────────────────────

function shouldSkipRebuild() {
  if (process.env.ASTRO_SKIP_NATIVE_REBUILD === '1') {
    return 'ASTRO_SKIP_NATIVE_REBUILD=1 set; skipping node-pty rebuild'
  }
  if (process.env.npm_config_ignore_scripts === 'true') {
    return 'npm config ignore-scripts=true; skipping node-pty rebuild'
  }
  if (!existsSync(join(ROOT, 'node_modules', 'electron', 'package.json'))) {
    return 'electron not installed; skipping node-pty rebuild (this is fine for non-desktop builds)'
  }
  if (!existsSync(join(ROOT, 'node_modules', 'node-pty', 'package.json'))) {
    return 'node-pty not installed; skipping rebuild'
  }
  return null
}

function rebuildNodePty() {
  const skipReason = shouldSkipRebuild()
  if (skipReason) {
    info(skipReason)
    return
  }

  info('rebuilding node-pty against Electron ABI...')
  const r = spawnSync(
    'npx',
    ['--no-install', 'electron-rebuild', '-f', '-w', 'node-pty'],
    { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
  )

  if (r.status !== 0) {
    console.error('\n[postinstall] electron-rebuild FAILED for node-pty.')
    console.error('  The in-app Terminal panel will not work until this is fixed.')
    console.error('  Common causes:')
    console.error('    - macOS:   Xcode Command Line Tools missing → run `xcode-select --install`')
    console.error('    - Linux:   build-essential / make / Python 3 missing')
    console.error('    - Windows: windows-build-tools missing → install Visual Studio Build Tools')
    console.error('  Manual recovery once dependencies are installed:')
    console.error('    npx electron-rebuild -f -w node-pty')
    console.error('  To skip this rebuild for non-desktop builds, set ASTRO_SKIP_NATIVE_REBUILD=1.')
    fail(`electron-rebuild exited with code ${r.status ?? '?'}`)
  }

  const binding = join(ROOT, 'node_modules', 'node-pty', 'build', 'Release', 'pty.node')
  if (!existsSync(binding)) {
    fail(`electron-rebuild reported success but ${binding} is missing.`)
  }
  if (statSync(binding).size === 0) {
    fail(`electron-rebuild produced an empty ${binding}.`)
  }
  info('node-pty rebuilt successfully against Electron')
}

// ─── Main ───────────────────────────────────────────────────────────────────

installSubmoduleDeps()
rebuildNodePty()
