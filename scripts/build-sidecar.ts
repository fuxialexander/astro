#!/usr/bin/env tsx
/**
 * build-sidecar.ts - Build the Node.js sidecar for Astro Desktop (Tauri)
 *
 * Bundles:
 *   1. The Hono backend server (server/index.ts)
 *   2. The CLI (packages/cli/)
 *   3. The agent-runner (packages/agent-runner/)
 *
 * Also copies PGlite WASM files, generates a manifest, and runs a
 * post-build smoke test.
 *
 * Usage:
 *   tsx scripts/build-sidecar.ts [--skip-verify] [--debug]
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, cpSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'fs';
import { resolve, join, dirname } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SIDECAR_DIR = join(ROOT, 'src-tauri', 'sidecar');
const NODE_MODULES_DIR = join(SIDECAR_DIR, 'node_modules');
const MANIFEST_PATH = join(SIDECAR_DIR, 'manifest.json');

const skipVerify = process.argv.includes('--skip-verify');
const debugMode = process.argv.includes('--debug');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`\x1b[36m[sidecar]\x1b[0m ${msg}`);
}

function logError(msg: string) {
  console.error(`\x1b[31m[sidecar]\x1b[0m ${msg}`);
}

function logSuccess(msg: string) {
  console.log(`\x1b[32m[sidecar]\x1b[0m ${msg}`);
}

function run(cmd: string, cwd = ROOT): string {
  log(`> ${cmd}`);
  return execSync(cmd, { cwd, stdio: debugMode ? 'inherit' : 'pipe', encoding: 'utf-8' }) ?? '';
}

function getPackageVersion(pkgPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Step 1: Clean previous build
// ---------------------------------------------------------------------------

function clean() {
  log('Cleaning previous sidecar build...');
  if (existsSync(SIDECAR_DIR)) {
    rmSync(SIDECAR_DIR, { recursive: true, force: true });
  }
  ensureDir(SIDECAR_DIR);
  ensureDir(NODE_MODULES_DIR);
}

// ---------------------------------------------------------------------------
// Step 2: Bundle the backend server
// ---------------------------------------------------------------------------

function bundleServer() {
  log('Bundling backend server (server/index.ts)...');

  const entryPoint = join(ROOT, 'server', 'index.ts');
  if (!existsSync(entryPoint)) {
    throw new Error(`Server entry point not found: ${entryPoint}`);
  }

  const outfile = join(SIDECAR_DIR, 'server.mjs');

  // Use esbuild to bundle the server into a single file
  // External: native modules that can't be bundled
  const externals = [
    'better-sqlite3',
    '@electric-sql/pglite',
    'portable-pty',
    'cpu-features',
    'ssh2',
    'pg-native',
    'bufferutil',
    'utf-8-validate',
  ];

  const externalFlags = externals.map(e => `--external:${e}`).join(' ');

  run(
    `npx esbuild ${entryPoint} ` +
    `--bundle --platform=node --format=esm --target=node20 ` +
    `--outfile=${outfile} ` +
    `${externalFlags} ` +
    `--define:process.env.NODE_ENV='"production"' ` +
    `${debugMode ? '--sourcemap' : '--minify'} ` +
    `--tree-shaking=true`
  );

  if (!existsSync(outfile)) {
    throw new Error('Server bundle was not created');
  }
  logSuccess(`Server bundle: ${outfile}`);
}

// ---------------------------------------------------------------------------
// Step 3: Bundle the CLI
// ---------------------------------------------------------------------------

function bundleCLI() {
  log('Bundling CLI (packages/cli/)...');

  const cliDir = join(ROOT, 'packages', 'cli');
  const cliEntry = join(cliDir, 'src', 'index.ts');

  if (!existsSync(cliEntry)) {
    log('CLI entry point not found, skipping CLI bundle');
    return;
  }

  const outfile = join(SIDECAR_DIR, 'astro-cli.mjs');

  const externals = [
    'better-sqlite3',
    '@electric-sql/pglite',
    'ink',
    'yoga-wasm-web',
    'portable-pty',
  ];
  const externalFlags = externals.map(e => `--external:${e}`).join(' ');

  run(
    `npx esbuild ${cliEntry} ` +
    `--bundle --platform=node --format=esm --target=node20 ` +
    `--outfile=${outfile} ` +
    `${externalFlags} ` +
    `--define:process.env.NODE_ENV='"production"' ` +
    `${debugMode ? '--sourcemap' : '--minify'} ` +
    `--tree-shaking=true`
  );

  if (!existsSync(outfile)) {
    log('CLI bundle was not created (non-fatal)');
    return;
  }
  logSuccess(`CLI bundle: ${outfile}`);
}

// ---------------------------------------------------------------------------
// Step 4: Bundle the agent-runner
// ---------------------------------------------------------------------------

function bundleAgentRunner() {
  log('Bundling agent-runner (packages/agent-runner/)...');

  const agentDir = join(ROOT, 'packages', 'agent-runner');
  const agentEntry = join(agentDir, 'src', 'cli.ts');

  if (!existsSync(agentEntry)) {
    log('Agent-runner entry point not found, skipping agent-runner bundle');
    return;
  }

  const outfile = join(SIDECAR_DIR, 'astro-agent.mjs');

  const externals = [
    'better-sqlite3',
    '@electric-sql/pglite',
    'portable-pty',
    'cpu-features',
    'ssh2',
  ];
  const externalFlags = externals.map(e => `--external:${e}`).join(' ');

  run(
    `npx esbuild ${agentEntry} ` +
    `--bundle --platform=node --format=esm --target=node20 ` +
    `--outfile=${outfile} ` +
    `${externalFlags} ` +
    `--define:process.env.NODE_ENV='"production"' ` +
    `${debugMode ? '--sourcemap' : '--minify'} ` +
    `--tree-shaking=true`
  );

  if (!existsSync(outfile)) {
    log('Agent-runner bundle was not created (non-fatal)');
    return;
  }
  logSuccess(`Agent-runner bundle: ${outfile}`);
}

// ---------------------------------------------------------------------------
// Step 5: Copy PGlite WASM files
// ---------------------------------------------------------------------------

function copyPGliteWasm() {
  log('Copying PGlite WASM files...');

  const pgliteSrc = join(ROOT, 'node_modules', '@electric-sql', 'pglite');
  const pgliteDest = join(NODE_MODULES_DIR, '@electric-sql', 'pglite');

  if (!existsSync(pgliteSrc)) {
    log('PGlite not found in node_modules, skipping WASM copy');
    return;
  }

  ensureDir(join(NODE_MODULES_DIR, '@electric-sql'));

  // Copy the full pglite package (includes WASM, JS, and dist).
  // dereference:true resolves pnpm symlinks so we get real files in the sidecar.
  cpSync(pgliteSrc, pgliteDest, { recursive: true, dereference: true });

  // Verify WASM files exist
  const wasmFiles = findFiles(pgliteDest, '.wasm');
  if (wasmFiles.length === 0) {
    log('Warning: No .wasm files found in PGlite copy');
  } else {
    logSuccess(`Copied PGlite with ${wasmFiles.length} WASM file(s)`);
  }
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(full, ext));
      } else if (entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
  } catch {
    // Ignore permission errors
  }
  return results;
}

// ---------------------------------------------------------------------------
// Step 6: Copy native module dependencies
// ---------------------------------------------------------------------------

function copyNativeModules() {
  log('Copying native module dependencies...');

  const nativeModules = ['better-sqlite3'];

  for (const mod of nativeModules) {
    const src = join(ROOT, 'node_modules', mod);
    const dest = join(NODE_MODULES_DIR, mod);

    if (!existsSync(src)) {
      log(`  ${mod}: not found, skipping`);
      continue;
    }

    ensureDir(dirname(dest));
    cpSync(src, dest, { recursive: true, dereference: true });
    logSuccess(`  ${mod}: copied`);
  }
}

// ---------------------------------------------------------------------------
// Step 7: Create sidecar entry point (bootstrap)
// ---------------------------------------------------------------------------

function createEntryPoint() {
  log('Creating sidecar entry point...');

  const entryContent = `#!/usr/bin/env node
/**
 * Astro Desktop Sidecar - Entry point
 * Starts the Hono backend server for the Tauri desktop app.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set up environment for local/desktop mode
process.env.ASTRO_MODE = process.env.ASTRO_MODE || 'local';
process.env.ASTRO_DESKTOP = '1';

// Ensure PGlite can find its WASM files
process.env.PGLITE_DATA_DIR = process.env.PGLITE_DATA_DIR || join(__dirname, 'data');

async function main() {
  try {
    // Import and start the server
    await import('./server.mjs');
    console.log('[sidecar] Server started successfully');
  } catch (err) {
    console.error('[sidecar] Failed to start server:', err);
    process.exit(1);
  }
}

main();
`;

  writeFileSync(join(SIDECAR_DIR, 'index.mjs'), entryContent, 'utf-8');
  logSuccess('Entry point: src-tauri/sidecar/index.mjs');
}

// ---------------------------------------------------------------------------
// Step 8: Generate manifest
// ---------------------------------------------------------------------------

function generateManifest() {
  log('Generating manifest...');

  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

  const manifest = {
    name: 'astro-desktop-sidecar',
    version: rootPkg.version ?? '0.0.1',
    buildTime: new Date().toISOString(),
    nodeTarget: 'node20',
    platform: process.platform,
    arch: process.arch,
    components: {
      server: {
        entry: 'server.mjs',
        version: rootPkg.version ?? '0.0.1',
        bundled: existsSync(join(SIDECAR_DIR, 'server.mjs')),
      },
      cli: {
        entry: 'astro-cli.mjs',
        version: getPackageVersion(join(ROOT, 'packages', 'cli')),
        bundled: existsSync(join(SIDECAR_DIR, 'astro-cli.mjs')),
      },
      agentRunner: {
        entry: 'astro-agent.mjs',
        version: getPackageVersion(join(ROOT, 'packages', 'agent-runner')),
        bundled: existsSync(join(SIDECAR_DIR, 'astro-agent.mjs')),
      },
    },
    externals: {
      pglite: existsSync(join(NODE_MODULES_DIR, '@electric-sql', 'pglite')),
      betterSqlite3: existsSync(join(NODE_MODULES_DIR, 'better-sqlite3')),
    },
  };

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  logSuccess(`Manifest: ${MANIFEST_PATH}`);
  return manifest;
}

// ---------------------------------------------------------------------------
// Step 9: Post-build verification
// ---------------------------------------------------------------------------

async function verify(): Promise<boolean> {
  if (skipVerify) {
    log('Skipping verification (--skip-verify)');
    return true;
  }

  log('Running post-build verification...');

  // Check that essential files exist
  const requiredFiles = ['index.mjs', 'server.mjs', 'manifest.json'];
  let allPresent = true;

  for (const file of requiredFiles) {
    const filePath = join(SIDECAR_DIR, file);
    if (existsSync(filePath)) {
      logSuccess(`  ${file}: present`);
    } else {
      logError(`  ${file}: MISSING`);
      allPresent = false;
    }
  }

  // Check optional components
  const optionalFiles = ['astro-cli.mjs', 'astro-agent.mjs'];
  for (const file of optionalFiles) {
    const filePath = join(SIDECAR_DIR, file);
    if (existsSync(filePath)) {
      logSuccess(`  ${file}: present`);
    } else {
      log(`  ${file}: not bundled (optional)`);
    }
  }

  // Try to start the sidecar and verify it responds
  log('Checking sidecar can be loaded (syntax check)...');
  try {
    run(`node --check ${join(SIDECAR_DIR, 'index.mjs')}`);
    logSuccess('  Sidecar entry point: valid syntax');
  } catch {
    logError('  Sidecar entry point: syntax error');
    allPresent = false;
  }

  if (existsSync(join(SIDECAR_DIR, 'server.mjs'))) {
    try {
      run(`node --check ${join(SIDECAR_DIR, 'server.mjs')}`);
      logSuccess('  Server bundle: valid syntax');
    } catch {
      logError('  Server bundle: syntax error');
      allPresent = false;
    }
  }

  // Health check: try to start and immediately stop
  log('Attempting sidecar health check (5s timeout)...');
  const healthOk = await new Promise<boolean>((resolvePromise) => {
    const child = spawn('node', [join(SIDECAR_DIR, 'index.mjs')], {
      env: {
        ...process.env,
        ASTRO_MODE: 'local',
        ASTRO_DESKTOP: '1',
        PORT: '0', // Let OS pick a port
      },
      stdio: 'pipe',
      timeout: 5000,
    });

    let output = '';
    child.stdout?.on('data', (data) => { output += data.toString(); });
    child.stderr?.on('data', (data) => { output += data.toString(); });

    const timer = setTimeout(() => {
      // If it's still running after 3s without crashing, that's a pass
      child.kill('SIGTERM');
      logSuccess('  Health check: sidecar stayed alive for 3s');
      resolvePromise(true);
    }, 3000);

    child.on('error', () => {
      clearTimeout(timer);
      logError('  Health check: failed to spawn');
      resolvePromise(false);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== null && code !== 0) {
        logError(`  Health check: exited with code ${code}`);
        if (debugMode) console.log(output);
        resolvePromise(false);
      }
      // Exit code 0 before timeout is fine (could be port conflict)
    });
  });

  return allPresent && healthOk;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();

  log('=== Astro Desktop Sidecar Build ===');
  log(`Root: ${ROOT}`);
  log(`Output: ${SIDECAR_DIR}`);
  log(`Debug: ${debugMode}`);
  log('');

  try {
    clean();
    bundleServer();
    bundleCLI();
    bundleAgentRunner();
    copyPGliteWasm();
    copyNativeModules();
    createEntryPoint();

    const manifest = generateManifest();

    log('');
    log('=== Build Summary ===');
    log(`  Server:       ${manifest.components.server.bundled ? 'bundled' : 'MISSING'}`);
    log(`  CLI:          ${manifest.components.cli.bundled ? 'bundled' : 'skipped'}`);
    log(`  Agent Runner: ${manifest.components.agentRunner.bundled ? 'bundled' : 'skipped'}`);
    log(`  PGlite WASM:  ${manifest.externals.pglite ? 'copied' : 'skipped'}`);
    log(`  SQLite:       ${manifest.externals.betterSqlite3 ? 'copied' : 'skipped'}`);
    log('');

    const ok = await verify();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('');
    if (ok) {
      logSuccess(`=== Sidecar build complete in ${elapsed}s ===`);
      process.exit(0);
    } else {
      logError(`=== Sidecar build completed with warnings in ${elapsed}s ===`);
      process.exit(1);
    }
  } catch (err) {
    logError(`Build failed: ${err}`);
    process.exit(1);
  }
}

main();
