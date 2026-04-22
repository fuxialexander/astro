/**
 * File browser pane — routes directory listings through the backend relay
 * (`/api/fs/directories?machineId=…`), the same path the inbox workdir
 * picker uses. Reading the local filesystem via Electron IPC would only
 * work when the project runs on the same machine as the Electron shell,
 * which is rarely true for users with remote agent runners.
 *
 * `projectId` lives on PaneState; we pull `defaultMachineId` and
 * `workingDirectory` off the project record to seed the browser.
 */
import { useRef } from 'react'

import { FileBrowser } from '@/components/file-browser'
import { useProjectStore } from '@/stores/project-store'
import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'
import { getProjectFileBrowserRoot } from '@/components/task-detail/file-path-utils'

interface Props {
  paneState: PaneState
}

export function FileBrowserPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)

  const project = useProjectStore((s) =>
    paneState.projectId ? s.projects.find((p) => p.id === paneState.projectId) : undefined,
  )

  const machineId = project?.defaultMachineId
  const workingDirectory = paneState.cwd ?? getProjectFileBrowserRoot(project) ?? ''

  if (!machineId) {
    return (
      <div
        ref={ref}
        className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-muted-foreground"
        data-density={size.density}
      >
        Select a machine for this project to browse its files.
      </div>
    )
  }

  return (
    <div ref={ref} className="h-full w-full overflow-hidden" data-density={size.density}>
      <FileBrowser
        machineId={machineId}
        workingDirectory={workingDirectory}
        fallbackDirectory={project?.workingDirectory}
        embedded
      />
    </div>
  )
}
