#!/usr/bin/env node
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
