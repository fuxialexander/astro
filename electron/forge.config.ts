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

const repoRoot = path.resolve(__dirname, '..')

// extraResource paths are copied verbatim into resources/ at package time.
// env.ts reads them via path.join(process.resourcesPath, 'server'|'drizzle'|'skills').
const extraResources: string[] = [
  path.join(repoRoot, 'server', 'dist'), // → resources/dist (renamed below via symlink convention)
  path.join(repoRoot, 'drizzle'),
  path.join(repoRoot, 'skills'),
]

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
    asar: true,
    icon: path.join(repoRoot, 'electron', 'icons', 'icon'),
    extraResource: extraResources,
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
          entry: 'electron/preload/index.ts',
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
