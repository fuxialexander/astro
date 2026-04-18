/**
 * Electron Forge configuration — Phase 5 packaging.
 *
 * Produces signed/notarized installers for macOS (dmg + zip), Windows
 * (Squirrel), and Linux (deb + rpm). The Vite plugin handles the main,
 * preload, and renderer bundles; extraResource copies the server bundle,
 * drizzle migrations, and skills into <app>/Contents/Resources (macOS)
 * or resources/ (Windows/Linux) so env.ts's `process.resourcesPath`
 * lookups resolve at runtime.
 *
 * Signing is gated on APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID — the
 * config emits unsigned builds locally when those are absent, so dev
 * builds work without certs. CI must inject them.
 */

import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { PublisherGithub } from '@electron-forge/publisher-github'
import path from 'node:path'
import fs from 'node:fs'

const repoRoot = path.resolve(__dirname, '..')

// The packaged app is a thin shell over the production web app — no embedded
// Hono backend, PGlite, or bundled skills. Native modules (node-pty, ssh2,
// cpu-features) are still packaged via `afterCopy` + `asar.unpack` because
// the desktop shell needs them for the local terminal/SSH flows.
const extraResources: string[] = []

// Apple signing/notarization — only attach the blocks when all three env
// vars are present. Missing any one means "local dev build, skip signing".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const osxSign: any = process.env.APPLE_ID
  ? {
      identity: process.env.APPLE_SIGNING_IDENTITY,
      optionsForFile: () => ({
        entitlements: path.join(repoRoot, 'electron', 'entitlements.mac.plist'),
        hardenedRuntime: true,
      }),
    }
  : undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const osxNotarize: any =
  process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Astro',
    executableName: 'astro',
    // Unpack the entire native-module directories from asar. Unlike
    // auto-unpack-natives (which only matches `.node`), this pulls out helper
    // executables too — node-pty ships a `spawn-helper` binary with no
    // extension that it exec()s during fork; stuck inside asar it triggers
    // posix_spawnp failures at runtime. VSCode does the same.
    asar: {
      unpack:
        '**/{node_modules/node-pty/**,node_modules/ssh2/**,node_modules/cpu-features/**}',
    },
    icon: path.join(repoRoot, 'electron', 'icons', 'icon'),
    extraResource: extraResources,
    // @electron/universal merges the per-arch packaged apps and bails on any
    // file that differs between x64 and arm64 without a rule saying which
    // arch it belongs to. node-pty / ssh2 / cpu-features ship arch-specific
    // prebuilds, so we route them through x64ArchFiles. Keep this glob in
    // sync with `asar.unpack` above and the `afterCopy` natives list below.
    osxUniversal: {
      x64ArchFiles: '**/node_modules/{node-pty,ssh2,cpu-features}/**',
      mergeASARs: false,
    },
    // The vite plugin bundles main.js but leaves native modules external,
    // so we have to copy them into the packaged app's node_modules ourselves.
    // auto-unpack-natives then picks up their .node binaries and moves them
    // to app.asar.unpacked so Electron can dlopen them at runtime.
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        const natives = ['node-pty', 'ssh2', 'cpu-features']
        try {
          for (const name of natives) {
            const src = path.join(repoRoot, 'node_modules', name)
            if (!fs.existsSync(src)) continue
            const dest = path.join(buildPath, 'node_modules', name)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.cpSync(src, dest, { recursive: true, dereference: true })
          }
          callback()
        } catch (err) {
          callback(err as Error)
        }
      },
    ],
    ...(osxSign ? { osxSign } : {}),
    ...(osxNotarize ? { osxNotarize } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      name: 'Astro',
      // background / icon can be added later; defaults are fine for now.
    }),
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({
      name: 'astro',
      setupExe: 'AstroSetup.exe',
    }),
    new MakerDeb({
      options: {
        name: 'astro',
        productName: 'Astro',
        maintainer: 'Astro Anywhere',
        homepage: 'https://astroanywhere.com',
      },
    }),
    new MakerRpm({
      options: {
        name: 'astro',
        productName: 'Astro',
        homepage: 'https://astroanywhere.com',
      },
    }),
  ],
  publishers: process.env.GITHUB_TOKEN
    ? [
        new PublisherGithub({
          repository: {
            owner: 'astro-anywhere',
            name: 'astro',
          },
          prerelease: true,
          draft: true,
        }),
      ]
    : [],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'electron/main/index.ts',
          config: 'electron/vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'electron/preload/main.ts',
          config: 'electron/vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'electron/vite.renderer.config.ts',
        },
      ],
    }),
  ],
}

export default config
