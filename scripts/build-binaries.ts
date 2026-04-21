#!/usr/bin/env tsx
/**
 * build-binaries.ts — bundle astro-agent and astro-cli into single-file
 * Node.js scripts for the Electron app's extraResources.
 *
 * Output:
 *   electron/resources/binaries/astro-agent.mjs
 *   electron/resources/binaries/astro-cli.mjs
 *
 * Both files carry a #!/usr/bin/env node shebang so they can be installed
 * as executable scripts in ~/.astro/bin/ by the agent:setup IPC handler.
 *
 * Usage:
 *   tsx scripts/build-binaries.ts [--debug]
 */

import { build } from 'esbuild'
import { existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { resolve, join, dirname } from 'path'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const OUT_DIR = join(ROOT, 'electron', 'resources', 'binaries')
const debug = process.argv.includes('--debug')

function log(msg: string) { console.log(`\x1b[36m[build-binaries]\x1b[0m ${msg}`) }
function ok(msg: string) { console.log(`\x1b[32m[build-binaries]\x1b[0m ${msg}`) }

// Shebang + CJS-require shim so bundled ESM output can interop with any
// transitive CommonJS modules at runtime.
const BANNER = [
  '#!/usr/bin/env node',
  "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
].join('\n')

// Modules that are native addons, optional devtools, or otherwise non-bundleable.
const COMMON_EXTERNALS = [
  // Native addons
  'node-pty', 'cpu-features', 'ssh2', 'better-sqlite3', 'bufferutil', 'utf-8-validate',
  // ink imports react-devtools-core only in development — mark external so
  // production bundles don't fail trying to resolve this optional peer dep.
  'react-devtools-core',
]

async function buildAgent() {
  const entry = join(ROOT, 'packages', 'agent-runner', 'src', 'cli.ts')
  if (!existsSync(entry)) throw new Error(`agent-runner cli entry missing: ${entry}`)
  const out = join(OUT_DIR, 'astro-agent.mjs')
  log('Bundling packages/agent-runner/src/cli.ts → astro-agent.mjs')

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

async function buildCli() {
  const entry = join(ROOT, 'packages', 'cli', 'src', 'index.ts')
  if (!existsSync(entry)) throw new Error(`cli entry missing: ${entry}`)
  const out = join(OUT_DIR, 'astro-cli.mjs')
  log('Bundling packages/cli/src/index.ts → astro-cli.mjs')

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    // ink/react/zustand are pure JS — bundle them in so the output is
    // fully self-contained (no npm install needed on the target machine).
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

async function main() {
  const start = Date.now()
  log('=== Building Electron binaries ===')

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  await buildAgent()
  await buildCli()

  ok(`=== Done in ${((Date.now() - start) / 1000).toFixed(1)}s ===`)
}

main().catch((err) => {
  console.error('\x1b[31m[build-binaries]\x1b[0m', err)
  process.exit(1)
})
