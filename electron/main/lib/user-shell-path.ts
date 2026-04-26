/**
 * Resolve the user's interactive shell PATH and patch process.env.PATH at
 * boot.
 *
 * Why: when an Electron app launches from Finder/Dock, it inherits a minimal
 * PATH (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS). Anything the user
 * installed via Homebrew, npm-global, nvm, asdf, mise, etc. is unreachable
 * via `which <tool>` — even though it works in their terminal. This breaks
 * provider detection (Claude Code, Codex, Pi) and any other `spawn(...)`
 * that depends on user-installed CLIs.
 *
 * Fix: ask the user's shell what its login + interactive PATH is. Run
 * `$SHELL -ilc 'echo __PATH__:$PATH'` and parse. Cache for the session
 * (it doesn't change at runtime), and patch process.env.PATH so all
 * subsequent spawn calls inherit it.
 *
 * Skipped on Windows — PATH inheritance there isn't shell-dependent.
 */

import { spawnSync } from 'node:child_process'

let cached: string | null = null

/**
 * Best-effort: resolve the user's shell PATH and merge it into the existing
 * process.env.PATH. Idempotent — second call is a no-op.
 *
 * Returns true if the PATH was patched, false on Windows or on failure.
 */
export function patchProcessPathFromShell(): boolean {
  if (process.platform === 'win32') return false
  if (cached !== null) return true

  // Most macOS users use zsh; some use bash or fish. The default on Apple
  // silicon since 2019 is /bin/zsh. Fall through to /bin/bash if unset.
  const shell = process.env.SHELL || '/bin/zsh'

  // Marker before $PATH so we can find it deterministically even if the
  // shell startup files print other things to stdout (motd, conda init,
  // pyenv banners, etc.). Without a marker we'd be reading garbage.
  const MARKER = '__ASTRO_SHELL_PATH__='
  try {
    const r = spawnSync(shell, ['-ilc', `printf '%s' '${MARKER}'; printf '%s' "$PATH"`], {
      stdio: 'pipe',
      timeout: 5000,
      encoding: 'utf8',
      // Inherit the existing minimal env so the shell can find itself.
      env: process.env,
    })
    if (r.status !== 0 && r.status !== null) return false
    const out = (r.stdout ?? '').toString()
    const idx = out.lastIndexOf(MARKER)
    if (idx < 0) return false
    const userPath = out.slice(idx + MARKER.length).trim()
    if (!userPath) return false

    // Merge: prepend user paths we don't already have, keep existing entries
    // for completeness. Avoid duplicates.
    const existing = (process.env.PATH ?? '').split(':').filter(Boolean)
    const merged: string[] = []
    const seen = new Set<string>()
    for (const p of [...userPath.split(':'), ...existing]) {
      if (!p || seen.has(p)) continue
      seen.add(p)
      merged.push(p)
    }
    process.env.PATH = merged.join(':')
    cached = process.env.PATH
    return true
  } catch {
    return false
  }
}

export function getUserShellPath(): string | null {
  return cached
}
