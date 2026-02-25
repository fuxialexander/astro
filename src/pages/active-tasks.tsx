import { useMemo, useState } from "react"
import { Link } from "react-router"
import { ChevronDown, ChevronRight, Sparkles, Play, Clock, FileText } from "lucide-react"
import { useExecutionStore } from "@/stores/execution-store"
import { useAgentStore } from "@/stores/agent-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"

interface ActiveTask {
  nodeId: string
  projectId: string
  title: string
  status: "running" | "pending" | "generating"
  startedAt?: Date
  executionId?: string
}

function formatElapsed(startedAt?: Date): string {
  if (!startedAt) return ""
  const seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function ElapsedTimer({ startedAt }: { startedAt?: Date }) {
  const [, setTick] = useState(0)

  // Update every second
  useMemo(() => {
    if (!startedAt) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  if (!startedAt) return null
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {formatElapsed(startedAt)}
    </span>
  )
}

function ProjectGroup({
  projectName,
  projectColor,
  tasks,
  defaultExpanded,
}: {
  projectId: string
  projectName: string
  projectColor?: string
  tasks: ActiveTask[]
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Project header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <div
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: projectColor || "#3B82F6" }}
        />
        <span className="text-sm font-semibold text-foreground flex-1 truncate">
          {projectName}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {tasks.length} active
        </span>
      </button>

      {/* Task list */}
      {expanded && (
        <div className="border-t border-border">
          {tasks.map((task) => (
            <Link
              key={task.nodeId}
              to={
                task.status === "generating"
                  ? `/project/${task.projectId}/graph`
                  : `/project/${task.projectId}/task/${task.nodeId}`
              }
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors border-b border-border last:border-b-0"
            >
              {/* Status indicator */}
              {task.status === "generating" ? (
                <Sparkles className="h-3.5 w-3.5 text-info animate-pulse shrink-0" />
              ) : task.status === "running" ? (
                <div className="relative h-3.5 w-3.5 shrink-0">
                  <div className="absolute inset-0 rounded-full border-2 border-info border-t-transparent animate-spin" />
                </div>
              ) : (
                <Clock className="h-3.5 w-3.5 text-warning shrink-0" />
              )}

              {/* Task info */}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-foreground truncate block">
                  {task.title}
                </span>
              </div>

              {/* Elapsed time */}
              <ElapsedTimer startedAt={task.startedAt} />

              {/* Link indicator */}
              <FileText className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function ActiveTasks() {
  const executions = useExecutionStore((s) => s.executions)
  const sessions = useAgentStore((s) => s.sessions)
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])

  // Build active task list from executions + generation sessions
  const { groupedTasks, totalCount } = useMemo(() => {
    const taskMap = new Map<string, ActiveTask[]>()

    // Active task executions
    for (const [nodeId, exec] of executions) {
      if (exec.status !== "pending" && exec.status !== "running") continue
      const node = nodes.find((n) => n.id === nodeId)
      const projectId = exec.projectId || node?.projectId
      if (!projectId) continue

      const task: ActiveTask = {
        nodeId,
        projectId,
        title: node?.title || `Task ${nodeId.slice(0, 8)}`,
        status: exec.status === "running" ? "running" : "pending",
        startedAt: exec.startedAt,
        executionId: exec.executionId,
      }
      const list = taskMap.get(projectId) || []
      list.push(task)
      taskMap.set(projectId, list)
    }

    // Active plan generation sessions
    for (const [projectId, session] of sessions) {
      if (session.status !== "active") continue
      const task: ActiveTask = {
        nodeId: `gen-${projectId}`,
        projectId,
        title: session.phase === "repo_setup" ? "Setting up repository..." : "Generating plan...",
        status: "generating",
        startedAt: new Date(session.startedAt),
      }
      const list = taskMap.get(projectId) || []
      list.push(task)
      taskMap.set(projectId, list)
    }

    // Also check for nodes with in_progress/dispatched status that might not have execution entries
    for (const node of nodes) {
      if (node.status !== "in_progress" && node.status !== "dispatched") continue
      // Skip if already tracked via execution
      if (executions.has(node.id)) continue
      const list = taskMap.get(node.projectId) || []
      list.push({
        nodeId: node.id,
        projectId: node.projectId,
        title: node.title,
        status: node.status === "in_progress" ? "running" : "pending",
        startedAt: node.executionStartedAt ?? undefined,
      })
      taskMap.set(node.projectId, list)
    }

    let count = 0
    for (const tasks of taskMap.values()) count += tasks.length

    return { groupedTasks: taskMap, totalCount: count }
  }, [executions, sessions, nodes])

  // Sort projects: those with more active tasks first
  const sortedProjects = useMemo(() => {
    return Array.from(groupedTasks.entries())
      .map(([projectId, tasks]) => {
        const project = projects.find((p) => p.id === projectId)
        return {
          projectId,
          projectName: project?.name || `Project ${projectId.slice(0, 8)}`,
          projectColor: project?.color,
          tasks,
        }
      })
      .sort((a, b) => b.tasks.length - a.tasks.length)
  }, [groupedTasks, projects])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-primary font-semibold text-foreground">Active</h1>
          {totalCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-0.5 text-xs font-medium text-info">
              <div className="relative h-2 w-2">
                <div className="absolute inset-0 rounded-full border-[1.5px] border-info border-t-transparent animate-spin" />
              </div>
              {totalCount}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Play className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No active tasks</p>
              <p className="text-xs text-muted-foreground mt-1">
                Running tasks and plan generations will appear here
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-w-2xl">
            {sortedProjects.map((group) => (
              <ProjectGroup
                key={group.projectId}
                projectId={group.projectId}
                projectName={group.projectName}
                projectColor={group.projectColor}
                tasks={group.tasks}
                defaultExpanded={true}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
