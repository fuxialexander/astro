/**
 * Agent binary setup channels.
 *
 * The Electron app bundles astro-agent.mjs and astro-cli.mjs in
 * resources/binaries/ (via extraResources in forge.config.ts). These channels
 * let the renderer check setup status and trigger first-run installation,
 * which copies those bundles to ~/.astro/bin/ and adds that directory to
 * the user's shell PATH.
 *
 * Platform notes:
 *   macOS / Linux — installs to ~/.astro/bin, updates ~/.zshrc / ~/.bashrc
 *   Windows — installs to %USERPROFILE%\.astro\bin (PATH update via setx)
 */

import { existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { app } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/agent.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ─── Path resolution ────────────────────────────────────────────────────────

/** Where the bundled .mjs files live inside the app package (or repo in dev). */
function resolveBundlesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'binaries')
  }
  // dev: electron/dist/main/channels/agent.js → ../../../../../electron/resources/binaries
  return resolve(__dirname, '../../../../electron/resources/binaries')
}

/** Where installed binaries live on the user's machine. */
function binDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'astro', 'bin')
  }
  return join(homedir(), '.astro', 'bin')
}

function installedPath(name: string): string {
  return join(binDir(), process.platform === 'win32' ? `${name}.cmd` : name)
}

function bundlePath(name: string): string {
  const ext = name === 'astro-agent' ? 'astro-agent.mjs' : 'astro-cli.mjs'
  return join(resolveBundlesDir(), ext)
}

// ─── PATH detection ─────────────────────────────────────────────────────────

function isPathConfigured(): boolean {
  const bin = binDir()
  // The user's shell PATH at this point may not include ~/.astro/bin yet,
  // so we check by probing whether the binary resolves via `which`/`where`.
  try {
    if (process.platform === 'win32') {
      execSync('where astro-agent', { stdio: 'pipe' })
    } else {
      execSync('which astro-agent', { stdio: 'pipe', env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` } })
      // Also verify it's truly on the system PATH (not just our injected one)
      execSync('which astro-agent', { stdio: 'pipe' })
    }
    return true
  } catch {
    return false
  }
}

// ─── Shell profile update ────────────────────────────────────────────────────

const PATH_EXPORT = (bin: string) => `\n# Added by Astro desktop app\nexport PATH="$PATH:${bin}"\n`
const PATH_COMMENT_MARKER = '# Added by Astro desktop app'

function shellProfileCandidates(): string[] {
  const home = homedir()
  return [
    join(home, '.zshrc'),
    join(home, '.bashrc'),
    join(home, '.bash_profile'),
    join(home, '.profile'),
  ]
}

function updateShellProfiles(bin: string): string[] {
  const updated: string[] = []
  for (const profile of shellProfileCandidates()) {
    if (!existsSync(profile)) continue
    const content = readFileSync(profile, 'utf8')
    if (content.includes(PATH_COMMENT_MARKER)) continue // already present
    appendFileSync(profile, PATH_EXPORT(bin), 'utf8')
    updated.push(profile)
  }
  return updated
}

function updateWindowsPath(bin: string): string[] {
  try {
    execSync(`setx PATH "%PATH%;${bin}"`, { stdio: 'pipe' })
    return ['Windows Registry (setx)']
  } catch {
    return []
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export function registerAgentChannels(): void {
  defineHandler('agent:binary-paths', schema.binaryPaths, () => {
    const bundlesDir = resolveBundlesDir()
    return {
      bundledAgentPath: join(bundlesDir, 'astro-agent.mjs'),
      bundledCliPath: join(bundlesDir, 'astro-cli.mjs'),
      installedAgentPath: existsSync(installedPath('astro-agent')) ? installedPath('astro-agent') : null,
      installedCliPath: existsSync(installedPath('astro-cli')) ? installedPath('astro-cli') : null,
    }
  })

  defineHandler('agent:setup-status', schema.setupStatus, () => {
    const bin = binDir()
    const agentPath = installedPath('astro-agent')
    const cliPath = installedPath('astro-cli')
    const agentInstalled = existsSync(agentPath)
    const cliInstalled = existsSync(cliPath)
    return {
      installed: agentInstalled && cliInstalled,
      binDir: bin,
      agentPath: agentInstalled ? agentPath : null,
      cliPath: cliInstalled ? cliPath : null,
      pathConfigured: isPathConfigured(),
    }
  })

  defineHandler('agent:setup', schema.setup, () => {
    const bin = binDir()
    mkdirSync(bin, { recursive: true })

    // Copy bundled .mjs files to the bin directory.
    const agentBundle = bundlePath('astro-agent')
    const cliBundle = bundlePath('astro-cli')

    if (!existsSync(agentBundle)) {
      throw new Error(`Bundled astro-agent not found at ${agentBundle}. Run npm run build:binaries first.`)
    }
    if (!existsSync(cliBundle)) {
      throw new Error(`Bundled astro-cli not found at ${cliBundle}. Run npm run build:binaries first.`)
    }

    const agentDest = installedPath('astro-agent')
    const cliDest = installedPath('astro-cli')

    if (process.platform === 'win32') {
      // On Windows, create .cmd wrappers that delegate to node <bundle>.
      const agentMjs = join(bin, 'astro-agent.mjs')
      const cliMjs = join(bin, 'astro-cli.mjs')
      copyFileSync(agentBundle, agentMjs)
      copyFileSync(cliBundle, cliMjs)
      writeFileSync(agentDest, `@echo off\nnode "%~dp0astro-agent.mjs" %*\n`, 'utf8')
      writeFileSync(cliDest, `@echo off\nnode "%~dp0astro-cli.mjs" %*\n`, 'utf8')
    } else {
      // On Unix, the .mjs files already carry #!/usr/bin/env node shebangs.
      copyFileSync(agentBundle, agentDest)
      copyFileSync(cliBundle, cliDest)
      chmodSync(agentDest, 0o755)
      chmodSync(cliDest, 0o755)
    }

    const shellProfilesUpdated =
      process.platform === 'win32' ? updateWindowsPath(bin) : updateShellProfiles(bin)

    return {
      ok: true as const,
      agentPath: agentDest,
      cliPath: cliDest,
      binDir: bin,
      shellProfilesUpdated,
    }
  })
}
