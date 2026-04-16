/**
 * Vite config for the Electron main process bundle.
 *
 * Forge's VitePlugin drives this when running electron:package /
 * electron:make. The main process is Node/ESM, externalizes electron
 * and native modules, and emits to .vite/build per Forge convention.
 */

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'electron/main/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: '.vite/build',
    emptyOutDir: false,
    target: 'node20',
    rollupOptions: {
      external: [
        'electron',
        'electron-updater',
        'better-sqlite3',
        '@electric-sql/pglite',
        'node-pty',
        'ssh2',
        // Node built-ins are handled automatically by Vite's ssr target,
        // but we're building a lib — mark the common ones explicitly.
        /^node:/,
      ],
      output: {
        format: 'es',
      },
    },
    minify: false,
    sourcemap: true,
  },
})
