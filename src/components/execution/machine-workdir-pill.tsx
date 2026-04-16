/**
 * MachineWorkdirPill — compact pill showing the project's machine + working
 * directory, with a tooltip exposing git/branch/PR context. Shared between the
 * plan-view WorkdirBar and the task properties bar so both surfaces stay in
 * lock-step.
 */

import { useEffect } from "react"
import { Monitor, FolderGit2 } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { useMachinesStore } from "@/stores/machines-store"
import { remoteTypeLabel } from "@/lib/project-source"
import type { Project } from "@/types"

interface MachineWorkdirPillProps {
  project: Project
  onClick?: () => void
}

export function MachineWorkdirPill({ project, onClick }: MachineWorkdirPillProps) {
  const machines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)

  useEffect(() => {
    if (machines.length === 0) fetchMachines()
  }, [machines.length, fetchMachines])

  const defaultMachine = project.defaultMachineId
    ? machines.find((m) => m.id === project.defaultMachineId)
    : machines.length === 1
      ? machines[0]
      : undefined

  const workdirPath = project.workingDirectory || project.repository || ""
  const folderName = workdirPath.split("/").filter(Boolean).at(-1) ?? workdirPath
  const hasWorkdir = !!(project.workingDirectory || project.repository)

  const gitRepoLabel = project.source?.isGit
    ? project.githubOwner && project.githubRepo
      ? `${project.githubOwner}/${project.githubRepo}`
      : project.source.remoteType !== "none"
        ? remoteTypeLabel(project.source.remoteType)
        : "Local Git"
    : null

  const tooltip = [
    gitRepoLabel,
    project.source?.baseBranch ? `branch: ${project.source.baseBranch}` : null,
    project.projectBranch ? `worktree: ${project.projectBranch}` : null,
    project.projectPrUrl ? `PR #${project.projectPrNumber}` : null,
    workdirPath,
    defaultMachine ? `machine: ${defaultMachine.name || "unknown"}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  if (!hasWorkdir) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-xs"
      >
        <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
        <span>Set working directory</span>
      </button>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="flex h-6 items-center gap-1.5 px-2.5 rounded-full border border-border hover:bg-muted hover:text-foreground transition-colors cursor-pointer text-xs font-mono text-muted-foreground shrink-0"
        >
          {defaultMachine && (
            <>
              <Monitor className="h-3 w-3 shrink-0" />
              <span>{(defaultMachine.name || "unknown").slice(0, 3)}</span>
              <span className="opacity-30">·</span>
            </>
          )}
          <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
          <span>{folderName}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="whitespace-pre-line">{tooltip || "Edit working directory"}</TooltipContent>
    </Tooltip>
  )
}
