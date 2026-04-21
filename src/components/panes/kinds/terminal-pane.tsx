/**
 * Terminal pane — wraps the desktop TerminalTab in a single-active container.
 *
 * Behaviour is controlled by the project's `terminalOpenIn` setting:
 *   - 'remote' (or machine configured with a hostname): open a local PTY and
 *     immediately send `ssh -t <hostname> '...'` to land on the remote host
 *     in the right working directory.
 *   - 'local' / unset: open a local PTY directly in workingDirectory.
 *
 * The PTY always spawns on the local machine — we never try to spawn it on
 * the remote host. For remote projects this means the embedded terminal falls
 * back gracefully to an "Open in System Terminal" button if node-pty can't
 * spawn (e.g. sandbox restrictions), rather than failing silently.
 */
import { useMemo, useRef, useState, useCallback } from 'react'

import { TerminalTab } from '@/components/desktop/TerminalTab'
import { useProjectStore } from '@/stores/project-store'
import { useMachinesStore } from '@/stores/machines-store'
import { desktopBridge } from '@/lib/desktop-bridge'
import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

// Strict allowlist for hostnames: alnum, dot, dash, underscore, optional
// `user@` prefix. Anything outside that means we refuse to build an ssh
// command rather than try to escape something unexpected.
const HOSTNAME_SAFE = /^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9_.-]+$/

/** Base64-encode a UTF-8 string using only browser-available APIs. */
function b64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function TerminalPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)
  const [spawnError, setSpawnError] = useState<string | null>(null)
  const [openingExternal, setOpeningExternal] = useState(false)

  const project = useProjectStore((s) =>
    paneState.projectId ? s.projects.find((p) => p.id === paneState.projectId) : undefined,
  )
  const machine = useMachinesStore((s) =>
    project?.defaultMachineId
      ? s.machines.find((m) => m.id === project.defaultMachineId)
      : undefined,
  )

  const workingDirectory = paneState.cwd ?? project?.workingDirectory ?? ''
  const isRemote = project?.terminalOpenIn === 'remote'

  const { cwd, initialInput } = useMemo(() => {
    if (!isRemote || !machine?.hostname || !HOSTNAME_SAFE.test(machine.hostname)) {
      // Local: open the PTY directly in the working directory.
      return { cwd: workingDirectory || '.', initialInput: undefined as string | undefined }
    }

    // Remote: PTY spawns locally, then sends an SSH command that lands on the
    // remote host in workingDirectory. Base64-encoding avoids shell-quoting
    // issues with paths containing backticks, $(...), or single quotes.
    // openssl base64 -d -A works on both Linux and macOS (older macOS wants
    // -D for plain `base64 -d`, so we use openssl instead).
    const remoteInner = workingDirectory
      ? `cd -- "$ASTRO_REMOTE_CWD"; exec $SHELL -l`
      : 'exec $SHELL -l'
    const decode = (e: string) => `printf %s ${e} | openssl base64 -d -A`
    const remoteCmd = workingDirectory
      ? `ASTRO_REMOTE_CWD="$(${decode(b64(workingDirectory))})" && sh -c "$(${decode(b64(remoteInner))})"`
      : `sh -c "$(${decode(b64(remoteInner))})"`
    return { cwd: '.', initialInput: `ssh -t ${machine.hostname} ${JSON.stringify(remoteCmd)}` }
  }, [isRemote, machine, workingDirectory])

  const handleSpawnError = useCallback(
    (err: Error) => { setSpawnError(err.message) },
    [],
  )

  const openInSystemTerminal = useCallback(async () => {
    if (!initialInput) return
    setOpeningExternal(true)
    try {
      await desktopBridge.shell.openTerminal(initialInput)
    } finally {
      setOpeningExternal(false)
    }
  }, [initialInput])

  if (spawnError && isRemote && initialInput) {
    return (
      <div ref={ref} className="h-full w-full flex items-center justify-center p-4">
        <div className="max-w-sm text-center space-y-3">
          <div className="text-xs font-medium text-foreground">Embedded terminal unavailable</div>
          <div className="text-[10px] font-mono text-muted-foreground break-words">{spawnError}</div>
          <button
            onClick={() => void openInSystemTerminal()}
            disabled={openingExternal}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {openingExternal ? 'Opening…' : 'Open in System Terminal'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <TerminalTab
        cwd={cwd}
        active
        initialInput={initialInput}
        onSpawnError={isRemote ? handleSpawnError : undefined}
      />
    </div>
  )
}
