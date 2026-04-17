/**
 * Terminal pane — wraps the desktop TerminalTab in a single-active container.
 *
 * When the project's agent machine is a different host than the Electron
 * shell, the PTY still spawns locally but the shell is immediately fed
 * `ssh -t <hostname> 'cd <workdir>; exec $SHELL -l'`. That reuses the user's
 * local ~/.ssh/config (keys, ProxyJump, etc.) instead of building a full
 * PTY-over-relay stack. Local-host projects get the plain local shell.
 */
import { useMemo, useRef } from 'react'

import { TerminalTab } from '@/components/desktop/TerminalTab'
import { useProjectStore } from '@/stores/project-store'
import { useMachinesStore } from '@/stores/machines-store'
import { isLocalDesktopHost } from '@/lib/desktop-detect'
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
  // btoa only handles Latin-1, so round-trip through TextEncoder for safety.
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function TerminalPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)

  const project = useProjectStore((s) =>
    paneState.projectId ? s.projects.find((p) => p.id === paneState.projectId) : undefined,
  )
  const machine = useMachinesStore((s) =>
    project?.defaultMachineId
      ? s.machines.find((m) => m.id === project.defaultMachineId)
      : undefined,
  )

  const workingDirectory = paneState.cwd ?? project?.workingDirectory ?? ''
  const isRemote = machine ? !isLocalDesktopHost(machine.hostname) : false

  const { cwd, initialInput } = useMemo(() => {
    if (!isRemote || !machine) {
      return { cwd: workingDirectory || '.', initialInput: undefined as string | undefined }
    }
    if (!HOSTNAME_SAFE.test(machine.hostname)) {
      // Refuse rather than risk injecting a hostile hostname into a shell.
      return { cwd: '.', initialInput: undefined as string | undefined }
    }
    // Build the remote command as text, base64-encode it, then decode on the
    // far side. This avoids any quoting concerns with paths that contain
    // backticks, `$(...)`, or single-quote sequences.
    //
    // Decoder choice: `openssl base64 -d -A` is ubiquitous on both Linux and
    // macOS. Plain `base64 -d` works on GNU coreutils and macOS ≥ Monterey,
    // but older macOS wants `-D`, so we avoid it.
    const remoteInner = workingDirectory
      ? `cd -- "$ASTRO_REMOTE_CWD"; exec $SHELL -l`
      : 'exec $SHELL -l'
    const encoded = b64(remoteInner)
    const cwdEncoded = workingDirectory ? b64(workingDirectory) : ''
    const decode = (e: string) => `printf %s ${e} | openssl base64 -d -A`
    const remoteCmd = workingDirectory
      ? `ASTRO_REMOTE_CWD="$(${decode(cwdEncoded)})" && sh -c "$(${decode(encoded)})"`
      : `sh -c "$(${decode(encoded)})"`
    const cmd = `ssh -t ${machine.hostname} ${JSON.stringify(remoteCmd)}`
    return { cwd: '.', initialInput: cmd }
  }, [isRemote, machine, workingDirectory])

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <TerminalTab cwd={cwd} active initialInput={initialInput} />
    </div>
  )
}
