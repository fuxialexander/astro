#!/usr/bin/env tsx
/**
 * build-electron-main.ts — bundle the Electron main process + preload with
 * esbuild for `npm run electron:dev`.
 *
 * Why not just `tsc`?
 *   The previous tsc-based build emitted TypeScript verbatim and left workspace
 *   imports like `@astro/core` as bare specifiers. Node's ESM loader then tried
 *   to import the package's `main` (`./src/index.ts`) and exploded with
 *   `ERR_UNKNOWN_FILE_EXTENSION`. esbuild bundles the workspace TS into the
 *   output so Node only ever sees plain `.js`.
 *
 *   Forge's VitePlugin already does this for production builds (electron:make
 *   / electron:publish). This script is the dev-time equivalent.
 */
import { execSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { existsSync, mkdirSync, rmSync } from 'node:fs'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const MAIN_OUT = join(ROOT, 'electron', 'dist', 'main')
const PRELOAD_OUT = join(ROOT, 'electron', 'dist', 'preload')

const log = (m: string) => console.log(`\x1b[36m[build-electron-main]\x1b[0m ${m}`)

function clean(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

function run(cmd: string) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}

const externals = [
  'electron',
  'better-sqlite3',
  '@electric-sql/pglite',
  'node-pty',
  'ssh2',
  'cpu-features',
  '@vscode/ripgrep',
  // Cloud SDKs: large CJS trees (google-gax uses __dirname, AWS SDK has dynamic
  // requires) that don't survive ESM bundling. Resolve from node_modules at runtime.
  '@google-cloud/compute',
  '@aws-sdk/*',
  '@smithy/*',
].map((m) => `--external:${m}`).join(' ')

log('Bundling electron/main/index.ts → electron/dist/main/index.js')
clean(MAIN_OUT)
run(
  `npx esbuild electron/main/index.ts ` +
    `--bundle --platform=node --format=esm --target=node20 ` +
    `--outfile=${join(MAIN_OUT, 'index.js')} ` +
    `${externals} ` +
    // Sources already use fileURLToPath(import.meta.url) for __dirname, so
    // only inject the CommonJS require shim here.
    `--banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"`
)

log('Bundling electron/preload/main.ts → electron/dist/preload/main.js')
clean(PRELOAD_OUT)
run(
  `npx esbuild electron/preload/main.ts ` +
    `--bundle --platform=node --format=cjs --target=node20 ` +
    `--outfile=${join(PRELOAD_OUT, 'main.js')} ` +
    `--external:electron`
)

log('Done.')
