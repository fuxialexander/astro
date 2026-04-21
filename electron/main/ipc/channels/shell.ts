/**
 * Shell helpers — operations that invoke OS-level utilities rather than
 * spawning an embedded PTY.
 *
 * `shell:open-terminal` opens the user's default terminal application with
 * a pre-populated command. Used as a fallback when node-pty cannot spawn
 * an embedded PTY (e.g., sandbox restrictions, ABI issues) — in particular
 * for remote-machine projects where the plan is to open a local terminal
 * and SSH in.
 *
 * Platform strategy:
 *   macOS  — shell.openPath on a temp .command script (Terminal.app handles it)
 *   Linux  — tries x-terminal-emulator, then gnome-terminal, xterm in order
 *   Windows — start cmd.exe /k
 */

import { writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec, execFile } from 'node:child_process'
import { shell } from 'electron'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/shell.js'

function tempScriptPath(ext: string): string {
  return join(tmpdir(), `astro-terminal-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
}

function openOnMac(command: string): void {
  // Write to a .command file — macOS associates .command with Terminal.app and
  // executes it directly, so no shell quoting of the command itself is needed.
  const file = tempScriptPath('.command')
  writeFileSync(file, `#!/bin/bash\n${command}\n`, 'utf8')
  chmodSync(file, 0o755)
  // openPath is fire-and-forget; Terminal.app takes ownership of the file.
  void shell.openPath(file)
  // Best-effort cleanup after Terminal.app has had time to read it.
  setTimeout(() => { try { unlinkSync(file) } catch { /* already gone */ } }, 5000)
}

function openOnLinux(command: string): void {
  const file = tempScriptPath('.sh')
  writeFileSync(file, `#!/bin/bash\n${command}\n`, 'utf8')
  chmodSync(file, 0o755)
  // Try common terminal emulators in preference order.
  const candidates = [
    `x-terminal-emulator -e bash "${file}"`,
    `gnome-terminal -- bash "${file}"`,
    `xfce4-terminal -e "bash ${file}"`,
    `xterm -e "bash ${file}"`,
  ]
  let tried = 0
  const tryNext = () => {
    if (tried >= candidates.length) return
    exec(candidates[tried++], (err) => { if (err) tryNext() })
  }
  tryNext()
  setTimeout(() => { try { unlinkSync(file) } catch { /* already gone */ } }, 5000)
}

function openOnWindows(command: string): void {
  // Use execFile with an argument array to avoid cmd.exe metacharacter injection
  execFile('cmd.exe', ['/k', command])
}

function openSystemTerminal(command: string): void {
  switch (process.platform) {
    case 'darwin': return openOnMac(command)
    case 'linux': return openOnLinux(command)
    case 'win32': return openOnWindows(command)
    default: throw new Error(`shell:open-terminal is not supported on platform "${process.platform}"`)
  }
}

export function registerShellChannels(): void {
  defineHandler('shell:open-terminal', schema.openTerminal, (req) => {
    openSystemTerminal(req.command)
    return { ok: true as const }
  })

  defineHandler('shell:open-path', schema.openPath, async (req) => {
    const errorMsg = await shell.openPath(req.path)
    // openPath returns an empty string on success, or an error message on failure
    if (errorMsg) return { ok: true as const, error: errorMsg }
    return { ok: true as const }
  })
}
