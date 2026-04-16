/**
 * Vite config for the renderer bundle.
 *
 * Re-exports the repo's top-level vite.config.ts so the renderer build
 * used by Forge matches the dev server exactly — same plugins, same
 * aliases, same Tailwind setup. Forge overrides `root` and `outDir`
 * at runtime.
 *
 * Phase 5: in addition to the main window's `index.html`, we register
 * the small auxiliary windows under `electron/renderers/` as extra
 * Rollup inputs. They ship alongside the main bundle and are loaded
 * by their factories in `electron/main/windows/`.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig, type UserConfig, type UserConfigFnPromise } from 'vite'
import baseConfigFactory from '../vite.config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AUX_RENDERERS = {
  find_in_page: path.resolve(__dirname, 'renderers/find_in_page/index.html'),
  about_window: path.resolve(__dirname, 'renderers/about_window/index.html'),
  template_window: path.resolve(__dirname, 'renderers/template_window/index.html'),
} as const

// The base config is a function `({ mode }) => UserConfig`. We wrap it
// so Forge / vite still sees a function, and we merge in the extra
// Rollup inputs for the aux windows.
const config: UserConfigFnPromise = async (env) => {
  const base = (await (baseConfigFactory as UserConfigFnPromise)(env)) as UserConfig
  return mergeConfig(base, {
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, '../index.html'),
          ...AUX_RENDERERS,
        },
      },
    },
  } satisfies UserConfig)
}

export default config
