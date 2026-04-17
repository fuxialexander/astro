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

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./@:-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
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
    const remoteCmd = workingDirectory
      ? `cd ${shellQuote(workingDirectory)}; exec $SHELL -l`
      : 'exec $SHELL -l'
    const cmd = `ssh -t ${shellQuote(machine.hostname)} ${shellQuote(remoteCmd)}`
    return { cwd: '.', initialInput: cmd }
  }, [isRemote, machine, workingDirectory])

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <TerminalTab cwd={cwd} active initialInput={initialInput} />
    </div>
  )
}
