/**
 * Vite config for the Electron main process bundle.
 *
 * Forge's VitePlugin drives this when running electron:package /
 * electron:make. The main process is Node/ESM, externalizes electron
 * and native modules, and emits to .vite/build per Forge convention.
 */

import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]

export default defineConfig({
  // Force Node resolution so child_process etc. aren't treated as browser stubs.
  // noExternal: true bundles all node_modules into the output (native modules
  // that can't be bundled are still excluded via rollupOptions.external below).
  ssr: { target: 'node', noExternal: true },
  resolve: {
    conditions: ['node'],
  },
  build: {
    ssr: true,
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
        'electron-webauthn-mac',
        ...nodeBuiltins,
      ],
      output: {
        format: 'es',
      },
    },
    minify: false,
    sourcemap: true,
  },
})
