/**
 * External editor channel handlers. Detects installed editors via PATH and
 * opens files in them. shell.openExternal handles arbitrary URIs (links,
 * mail:, etc.).
 *
 * Phase 2A: detection is best-effort — checks PATH for a small list of
 * known editor commands. A future iteration can read OS-specific metadata
 * (e.g. macOS LaunchServices) for richer discovery.
 */

import { spawn } from 'node:child_process'
import { shell } from 'electron'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/editor.js'

interface EditorDef {
  id: string
  name: string
  command: string
  /** Build argv for opening a file at an optional line. */
  argv: (path: string, line?: number) => string[]
}

const KNOWN_EDITORS: EditorDef[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor',
    argv: (p, line) => (line != null ? ['-g', `${p}:${line}`] : [p]),
  },
  {
    id: 'vscode',
    name: 'VS Code',
    command: 'code',
    argv: (p, line) => (line != null ? ['-g', `${p}:${line}`] : [p]),
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    command: 'subl',
    argv: (p, line) => (line != null ? [`${p}:${line}`] : [p]),
  },
  {
    id: 'zed',
    name: 'Zed',
    command: 'zed',
    argv: (p, line) => (line != null ? [`${p}:${line}`] : [p]),
  },
]

async function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: 'ignore',
    })
    check.on('close', (code) => resolve(code === 0))
    check.on('error', () => resolve(false))
  })
}

export function registerEditorChannels(): void {
  defineHandler('editor:detect', schema.detect, async () => {
    const checks = await Promise.all(
      KNOWN_EDITORS.map(async (e) => ((await commandExists(e.command)) ? e : null))
    )
    const found = checks.filter((e): e is EditorDef => e !== null)
    return {
      editors: found.map((e) => ({ id: e.id, name: e.name, command: e.command })),
    }
  })

  defineHandler('editor:open', schema.openInEditor, async (req) => {
    const editor = KNOWN_EDITORS.find((e) => e.id === req.editorId)
    if (!editor) throw new Error(`unknown editor: ${req.editorId}`)
    const child = spawn(editor.command, editor.argv(req.path, req.line), {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return { ok: true as const }
  })

  defineHandler('editor:open-external', schema.openExternal, async (req) => {
    await shell.openExternal(req.url)
    return { ok: true as const }
  })
}
