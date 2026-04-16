/**
 * Vite config for the preload bundle.
 *
 * Preload runs in a sandboxed context with contextIsolation enabled,
 * so it must be CommonJS (Electron's sandbox loader doesn't support
 * ESM preloads yet as of v33).
 */

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'electron/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    outDir: '.vite/build',
    emptyOutDir: false,
    target: 'node20',
    rollupOptions: {
      external: ['electron', /^node:/],
    },
    minify: false,
    sourcemap: true,
  },
})
