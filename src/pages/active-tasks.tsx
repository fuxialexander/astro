import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"
import { ChevronDown, ChevronRight, Sparkles, Play, Clock, FileText, Cpu, AlertCircle, ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useSessionStore } from "@/stores/session-store"
import { useUIStore } from "@/stores/ui-store"
import { useWorkspaceFilterStore } from "@/stores/workspace-filter-store"
import { statusBadgeVariants } from "@/lib/status-config"
import { deriveActiveTasks, getActiveTasksContentState, type ActiveTaskEntry } from "@/lib/active-tasks"

function ElapsedTimer({ startedAt }: { startedAt?: Date }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  if (!startedAt || isNaN(startedAt.getTime())) {
    return <span className="text-xs text-muted-foreground">-</span>
  }
  const seconds = Math.floor((now - startedAt.getTime()) / 1000)
  if (seconds < 0) return <span className="text-xs text-muted-foreground">-</span>
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {m}:{s.toString().padStart(2, "0")}
    </span>
  )
}

function TaskRow({ task, projectId }: { task: ActiveTaskEntry; projectId: string }) {
  const execution = useExecutionStore((s) => s.executions.get(task.nodeId))
  const stream = task.executionId ? useRealtimeStore.getState().taskStreams.get(task.executionId) : undefined
  const progress = stream?.progress ?? 0
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId)
  const setChatPanelVisible = useUIStore((s) => s.setChatPanelVisible)
  const navigate = useNavigate()

  // Check if this task has pending approval requests
  const hasPendingApproval = useMemo(() => {
    if (!task.executionId) return false
    for (const approval of dynamicApprovals.values()) {
      if (approval.taskId === task.executionId) return true
    }
    return false
  }, [dynamicApprovals, task.executionId])

  const isChatSession = task.nodeId.startsWith("chat-")
  const chatSessionId = isChatSession ? task.nodeId.slice(5) : undefined

  const linkTo = task.nodeId.startsWith("plan-") || task.status === "generating"
    ? `/welcome?projectId=${projectId}`
    : task.nodeId.startsWith("playground-")
      ? `/playground?projectId=${projectId}`
      : isChatSession
        ? `/project/${projectId}`
        : `/project/${projectId}/task/${task.nodeId}`

  const handleChatClick = (e: React.MouseEvent) => {
    if (!isChatSession || !chatSessionId) return
    e.preventDefault()
    setActiveSessionId(projectId, "project-chat", chatSessionId)
    setChatPanelVisible(true)
    navigate(`/project/${projectId}`)
  }

  // For tasks with pending approvals, show a warning card
  if (hasPendingApproval) {
    const approvalLink = task.nodeId.startsWith("plan-") || task.status === "generating"
      ? `/plan?projectId=${projectId}`
      : task.nodeId.startsWith("playground-")
        ? `/playground?projectId=${projectId}`
        : `/project/${projectId}/task/${task.nodeId}`

    return (
      <Link
        to={approvalLink}
        className="flex flex-col gap-2 px-4 py-3 hover:bg-warning/10 transition-colors border-b border-border last:border-b-0 bg-warning/5"
      >
        <div className="flex items-center gap-3">
          <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground truncate">{task.title}</span>
              <Badge variant="outline" className="text-[10px] shrink-0 border-warning/50 text-warning">
                Awaiting your input
              </Badge>
            </div>
          </div>
          <ElapsedTimer startedAt={task.startedAt} />
          <ArrowRight className="h-3.5 w-3.5 text-warning shrink-0" />
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={linkTo}
      onClick={handleChatClick}
      className="flex flex-col gap-2 px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border last:border-b-0"
    >
      <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground truncate">{task.title}</span>
            {task.nodeStatus && (
              <Badge variant={statusBadgeVariants[task.nodeStatus]} className="text-[10px] shrink-0">
                {task.nodeStatus.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
        </div>

        {/* Elapsed time */}
        <ElapsedTimer startedAt={task.startedAt} />

        {/* Link indicator */}
        <FileText className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      </div>

      {/* Progress bar */}
      {task.status === "running" && progress > 0 && (
        <div className="flex items-center gap-3 ml-6">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-info transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] font-medium text-info shrink-0 w-8 text-right tabular-nums">
            {progress}%
          </span>
        </div>
      )}

      {/* Execution metadata */}
      {execution && (execution.machineId || execution.providerId) && (
        <div className="flex items-center gap-3 ml-6 text-[10px] text-muted-foreground">
          {execution.machineId && (
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-success" />
              <span className="font-mono">{execution.machineId.slice(0, 16)}</span>
            </div>
          )}
          {execution.providerId && (
            <div className="flex items-center gap-1">
              <Cpu className="h-2.5 w-2.5" />
              <span className="capitalize">{execution.providerId}</span>
            </div>
          )}
        </div>
      )}
    </Link>
  )
}

function ProjectGroup({
  projectId,
  projectName,
  projectColor,
  tasks,
  defaultExpanded,
}: {
  projectId: string
  projectName: string
  projectColor?: string
  tasks: ActiveTaskEntry[]
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-[0_1px_8px_-2px_rgba(0,0,0,0.08)] hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.1)] transition-shadow duration-200">
      {/* Project header — clicking navigates to project; chevron toggles expand */}
      <Link
        to={`/project/${projectId}`}
        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(!expanded) }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setExpanded(!expanded) } }}
          className="shrink-0 p-0.5 -m-0.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
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
      </Link>

      {/* Task list */}
      {expanded && (
        <div className="border-t border-border">
          {tasks.map((task) => (
            <TaskRow key={task.nodeId} task={task} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ActiveTasks() {
  const { t } = useTranslation('tasks')
  const executions = useExecutionStore((s) => s.executions)
  const executionsLoaded = useExecutionStore((s) => s.loaded)
  const projects = useProjectStore((s) => s.projects)
  const projectsLoaded = useProjectStore((s) => s.loaded)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodesLoaded = usePlanStore((s) => s.loaded)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const streamingSessions = useSessionStore((s) => s.streamingSessions)
  const allSessions = useSessionStore((s) => s.sessions)
  const sessionsLoaded = useSessionStore((s) => s.loaded)
  const workspaceFilter = useWorkspaceFilterStore((s) => s.workspaceFilter)

  const { groupedTasks, activeCount: filteredCount } = useMemo(() => (
    deriveActiveTasks({
      executions,
      rawNodes,
      liveNodes: nodes,
      nodesLoaded,
      projects,
      projectsLoaded,
      streamingSessions,
      allSessions,
      workspaceFilter,
    })
  ), [executions, rawNodes, nodes, nodesLoaded, projects, projectsLoaded, streamingSessions, allSessions, workspaceFilter])

  // Sort projects: those with more active tasks first
  const sortedProjects = useMemo(() => {
    return Array.from(groupedTasks.entries())
      .map(([projectId, tasks]) => {
        const project = projects.find((p) => p.id === projectId)
        return {
          projectId,
          projectName: project?.name || (projectsLoaded ? `Project ${projectId.slice(0, 8)}` : "Loading…"),
          projectColor: project?.color,
          tasks,
        }
      })
      .sort((a, b) => b.tasks.length - a.tasks.length)
  }, [groupedTasks, projects, projectsLoaded])

  const contentState = getActiveTasksContentState(filteredCount, { executionsLoaded, sessionsLoaded })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-primary font-semibold text-foreground">{t('active', 'Active')}</h1>
          {filteredCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-0.5 text-xs font-medium text-info">
              <div className="relative h-2 w-2">
                <div className="absolute inset-0 rounded-full border-[1.5px] border-info border-t-transparent animate-spin" />
              </div>
              {filteredCount}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 md:px-8 py-6">
        {contentState === "loading" ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
              <div className="absolute inset-3 rounded-full border-2 border-info border-t-transparent animate-spin" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Loading active tasks</p>
              <p className="text-xs text-muted-foreground mt-1">
                Restoring running tasks, playground sessions, and plan generations
              </p>
            </div>
          </div>
        ) : contentState === "empty" ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
              <Play className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No active tasks</p>
              <p className="text-xs text-muted-foreground mt-1">
                Running tasks, playground sessions, and plan generations will appear here
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
