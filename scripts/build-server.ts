#!/usr/bin/env tsx
/**
 * build-server.ts — bundle server/index.ts into server/dist/index.js for the
 * Electron utilityProcess (Phase 1 of the Tauri → Electron migration).
 *
 * Adapted from scripts/build-sidecar.ts. Differences:
 *   - Output is server/dist/, not src-tauri/sidecar/. Electron consumes it
 *     directly via utilityProcess.fork(), no Tauri sidecar plumbing.
 *   - Only the server is built here. CLI + agent-runner stay as separate
 *     workspace builds; the Electron app spawns agent-runner via the relay
 *     just like the web deploy does.
 *   - PGlite WASM + better-sqlite3 native module are copied to
 *     server/dist/node_modules/ so the bundle can resolve them at runtime
 *     (PGlite uses import.meta.url to find its .wasm sibling).
 *   - Drizzle migrations and skills are copied to server/dist/{drizzle,skills}
 *     so ASTRO_MIGRATIONS_FOLDER and ASTRO_SKILLS_DIR can point at them.
 *
 * Usage:
 *   tsx scripts/build-server.ts [--debug]
 *
 * Externals match the sidecar's list verbatim — these are native modules
 * and dynamic CJS requires that esbuild can't bundle into ESM.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { resolve, join, dirname } from 'path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT_DIR = join(ROOT, 'server', 'dist');
const NODE_MODULES_DIR = join(OUT_DIR, 'node_modules');

const debug = process.argv.includes('--debug');

function log(msg: string) {
  console.log(`\x1b[36m[build-server]\x1b[0m ${msg}`);
}
function ok(msg: string) {
  console.log(`\x1b[32m[build-server]\x1b[0m ${msg}`);
}
function run(cmd: string) {
  if (debug) log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: debug ? 'inherit' : 'pipe' });
}
function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function clean() {
  log('Cleaning server/dist/...');
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDir(OUT_DIR);
  ensureDir(NODE_MODULES_DIR);
}

function bundle() {
  log('Bundling server/index.ts → server/dist/index.js');
  const entry = join(ROOT, 'server', 'index.ts');
  if (!existsSync(entry)) throw new Error(`server entry missing: ${entry}`);

  const externals = [
    'better-sqlite3',
    '@electric-sql/pglite',
    'portable-pty',
    'node-pty',
    'cpu-features',
    'ssh2',
    'pg-native',
    'bufferutil',
    'utf-8-validate',
  ];
  const externalFlags = externals.map((e) => `--external:${e}`).join(' ');

  run(
    `npx esbuild ${entry} ` +
      `--bundle --platform=node --format=esm --target=node20 ` +
      `--outfile=${join(OUT_DIR, 'index.js')} ` +
      `${externalFlags} ` +
      `${debug ? '--sourcemap' : '--minify'} ` +
      `--tree-shaking=true ` +
      // Shim CommonJS require() inside the ESM bundle so transitive deps
      // using dynamic require keep working at runtime.
      `--banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"`
  );
  ok(`Server bundle: ${join(OUT_DIR, 'index.js')}`);
}

function copyPGlite() {
  log('Copying PGlite (WASM + JS)...');
  const src = join(ROOT, 'node_modules', '@electric-sql', 'pglite');
  const dest = join(NODE_MODULES_DIR, '@electric-sql', 'pglite');
  if (!existsSync(src)) {
    log('  PGlite not found in node_modules, skipping');
    return;
  }
  ensureDir(join(NODE_MODULES_DIR, '@electric-sql'));
  cpSync(src, dest, { recursive: true, dereference: true });
  ok('  PGlite copied');
}

function copyBetterSqlite() {
  log('Copying better-sqlite3 native module...');
  const src = join(ROOT, 'node_modules', 'better-sqlite3');
  const dest = join(NODE_MODULES_DIR, 'better-sqlite3');
  if (!existsSync(src)) {
    log('  better-sqlite3 not found, skipping');
    return;
  }
  cpSync(src, dest, { recursive: true, dereference: true });
  ok('  better-sqlite3 copied');
}

function copyResources() {
  log('Copying drizzle migrations + skills...');
  const drizzleSrc = join(ROOT, 'drizzle');
  if (existsSync(drizzleSrc)) {
    cpSync(drizzleSrc, join(OUT_DIR, 'drizzle'), { recursive: true, dereference: true });
    ok('  drizzle copied');
  }
  const skillsSrc = join(ROOT, 'skills');
  if (existsSync(skillsSrc)) {
    cpSync(skillsSrc, join(OUT_DIR, 'skills'), { recursive: true, dereference: true });
    ok('  skills copied');
  }
}

async function main() {
  const start = Date.now();
  log('=== Building server bundle for Electron ===');
  try {
    clean();
    bundle();
    copyPGlite();
    copyBetterSqlite();
    copyResources();
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    ok(`=== Done in ${secs}s ===`);
  } catch (err) {
    console.error('\x1b[31m[build-server]\x1b[0m', err);
    process.exit(1);
  }
}

main();
