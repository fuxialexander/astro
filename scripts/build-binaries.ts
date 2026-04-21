#!/usr/bin/env tsx
/**
 * build-binaries.ts — bundle astro-agent and astro-cli into single-file
 * Node.js scripts for the Electron app's extraResources.
 *
 * Output:
 *   electron/resources/binaries/astro-agent.mjs
 *   electron/resources/binaries/astro-cli.mjs
 *
 * Modes:
 *   default     — install latest published npm releases (for distribution builds)
 *   --local     — bundle from local workspace source (for dev / testing local changes)
 *   --debug     — skip minification, emit inline sourcemaps, verbose esbuild output
 *
 * The default npm mode guarantees the packaged Electron app always ships the
 * latest published versions of each package, independent of whatever is checked
 * out in the workspace.
 *
 * Usage:
 *   tsx scripts/build-binaries.ts            # latest npm releases (default)
 *   tsx scripts/build-binaries.ts --local    # local workspace source
 *   tsx scripts/build-binaries.ts --debug    # npm + unminified + sourcemaps
 */

import { build } from 'esbuild'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'fs'
import { resolve, join, dirname } from 'path'

const ROOT    = resolve(dirname(new URL(import.meta.url).pathname), '..')
const OUT_DIR = join(ROOT, 'electron', 'resources', 'binaries')
const useLocal = process.argv.includes('--local')
const debug    = process.argv.includes('--debug')

function log(msg: string) { console.log(`\x1b[36m[build-binaries]\x1b[0m ${msg}`) }
function ok(msg: string)  { console.log(`\x1b[32m[build-binaries]\x1b[0m ${msg}`) }
function run(cmd: string, cwd?: string) {
  if (debug) log(`> ${cmd}`)
  execSync(cmd, { cwd: cwd ?? ROOT, stdio: debug ? 'inherit' : 'pipe' })
}

// Shebang + CJS-require shim so bundled ESM output can interop with any
// transitive CommonJS modules at runtime.
const BANNER = [
  '#!/usr/bin/env node',
  "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
].join('\n')

// Modules that are native addons, optional devtools, or otherwise non-bundleable.
const COMMON_EXTERNALS = [
  'node-pty', 'cpu-features', 'ssh2', 'better-sqlite3', 'bufferutil', 'utf-8-validate',
  // ink imports react-devtools-core only in development
  'react-devtools-core',
]

// ─── npm-release mode ─────────────────────────────────────────────────────────

function installLatestPackages(): { dir: string; agentVersion: string; cliVersion: string } {
  const dir = join(ROOT, 'electron', 'resources', 'binaries', '.npm-install')
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  // Minimal package.json so npm doesn't complain
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'astro-bin-staging', private: true }))

  log('Installing @astroanywhere/agent@latest and @astroanywhere/cli@latest from npm...')
  run(`npm install @astroanywhere/agent@latest @astroanywhere/cli@latest --prefix ${dir} --no-audit --no-fund --loglevel=error`)

  const agentPkg = JSON.parse(readFileSync(join(dir, 'node_modules', '@astroanywhere', 'agent', 'package.json'), 'utf8')) as { version: string }
  const cliPkg   = JSON.parse(readFileSync(join(dir, 'node_modules', '@astroanywhere', 'cli',   'package.json'), 'utf8')) as { version: string }

  ok(`  @astroanywhere/agent@${agentPkg.version}`)
  ok(`  @astroanywhere/cli@${cliPkg.version}`)

  return { dir, agentVersion: agentPkg.version, cliVersion: cliPkg.version }
}

// ─── Bundle helpers ───────────────────────────────────────────────────────────

async function bundleAgent(entry: string) {
  const out = join(OUT_DIR, 'astro-agent.mjs')
  log(`Bundling astro-agent → astro-agent.mjs`)
  if (!existsSync(entry)) throw new Error(`agent-runner cli entry missing: ${entry}`)

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    external: COMMON_EXTERNALS,
    banner: { js: BANNER },
    treeShaking: true,
    minify: !debug,
    sourcemap: debug ? 'inline' : false,
    logLevel: debug ? 'info' : 'warning',
  })

  ok(`  astro-agent.mjs written (${Math.round(statSync(out).size / 1024)}KB)`)
}

async function bundleCli(entry: string) {
  const out = join(OUT_DIR, 'astro-cli.mjs')
  log(`Bundling astro-cli → astro-cli.mjs`)
  if (!existsSync(entry)) throw new Error(`cli entry missing: ${entry}`)

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    external: COMMON_EXTERNALS,
    banner: { js: BANNER },
    treeShaking: true,
    minify: !debug,
    sourcemap: debug ? 'inline' : false,
    loader: { '.tsx': 'tsx', '.jsx': 'jsx' },
    jsx: 'automatic',
    logLevel: debug ? 'info' : 'warning',
  })

  ok(`  astro-cli.mjs written (${Math.round(statSync(out).size / 1024)}KB)`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now()
  log(`=== Building Electron binaries (${useLocal ? 'local workspace' : 'latest npm releases'}) ===`)

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  if (useLocal) {
    // Bundle from workspace source — used during development to test local changes
    // before publishing to npm.
    await bundleAgent(join(ROOT, 'packages', 'agent-runner', 'src', 'cli.ts'))
    await bundleCli(join(ROOT, 'packages', 'cli', 'src', 'index.ts'))
  } else {
    // Default: install latest published releases and bundle from those.
    // This guarantees the packaged app ships the latest versions regardless
    // of what is checked out locally.
    const { dir } = installLatestPackages()

    const agentEntry = join(dir, 'node_modules', '@astroanywhere', 'agent', 'dist', 'cli.js')
    const cliEntry   = join(dir, 'node_modules', '@astroanywhere', 'cli',   'dist', 'index.js')

    await bundleAgent(agentEntry)
    await bundleCli(cliEntry)

    // Clean up the staging install — binaries are now in OUT_DIR
    rmSync(dir, { recursive: true, force: true })
  }

  ok(`=== Done in ${((Date.now() - start) / 1000).toFixed(1)}s ===`)
}

main().catch((err) => {
  console.error('\x1b[31m[build-binaries]\x1b[0m', err)
  process.exit(1)
})
