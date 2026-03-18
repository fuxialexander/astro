import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { ChevronDown, ChevronRight, Sparkles, Play, Clock, FileText, Cpu, AlertCircle, ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useSessionStore } from "@/stores/session-store"
import { useWorkspaceFilterStore } from "@/stores/workspace-filter-store"
import { statusBadgeVariants, TERMINAL_NODE_STATUSES } from "@/lib/status-config"

interface ActiveTask {
  nodeId: string
  projectId: string
  title: string
  status: "running" | "pending" | "generating"
  startedAt?: Date
  executionId?: string
  nodeType?: string
  nodeStatus?: string
  machineId?: string
  providerId?: string
}

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

function TaskRow({ task, projectId }: { task: ActiveTask; projectId: string }) {
  const execution = useExecutionStore((s) => s.executions.get(task.nodeId))
  const stream = task.executionId ? useRealtimeStore.getState().taskStreams.get(task.executionId) : undefined
  const progress = stream?.progress ?? 0
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)

  // Check if this task has pending approval requests
  const hasPendingApproval = useMemo(() => {
    if (!task.executionId) return false
    for (const approval of dynamicApprovals.values()) {
      if (approval.taskId === task.executionId) return true
    }
    return false
  }, [dynamicApprovals, task.executionId])

  const linkTo = task.nodeId.startsWith("plan-") || task.status === "generating"
    ? `/welcome?projectId=${projectId}`
    : task.nodeId.startsWith("playground-")
      ? `/playground?projectId=${projectId}`
      : `/project/${projectId}/task/${task.nodeId}`

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
  tasks: ActiveTask[]
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
  const projects = useProjectStore((s) => s.projects)
  const projectsLoaded = useProjectStore((s) => s.loaded)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodesLoaded = usePlanStore((s) => s.loaded)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const streamingSessions = useSessionStore((s) => s.streamingSessions)
  const allSessions = useSessionStore((s) => s.sessions)
  const workspaceFilter = useWorkspaceFilterStore((s) => s.workspaceFilter)

  // Build active task list from executions + streaming sessions
  const groupedTasks = useMemo(() => {
    const taskMap = new Map<string, ActiveTask[]>()
    // Track nodeIds already added from executions so we don't double-count
    const addedNodeIds = new Set<string>()

    // Active task executions
    for (const [nodeId, exec] of executions) {
      if (exec.status !== "pending" && exec.status !== "running") continue
      const isPlanSession = nodeId.startsWith("plan-")
      const isPlayground = nodeId.startsWith("playground-")
      // Use rawNodes for title resolution (not isLive-filtered) to find nodes that
      // might be soft-deleted but still have active executions
      const node = (isPlanSession || isPlayground) ? undefined : rawNodes.find((n) => n.id === nodeId)

      // Filter out stale executions: if the node has a terminal status
      // (completed, auto_verified, etc.), the execution is no longer active
      // even if the execution record still says "running" (e.g., after page refresh)
      if (node && TERMINAL_NODE_STATUSES.has(node.status)) continue

      // Don't filter out orphaned executions when stores haven't loaded yet —
      // the node may exist in the DB but not yet in the Zustand store
      if (!isPlanSession && !isPlayground && !node && nodesLoaded) continue

      const projectId = exec.projectId || node?.projectId
      if (!projectId) continue

      // Resolve a readable title for special session types
      const resolveTitle = () => {
        if (isPlanSession) return "Interactive Planning"
        if (isPlayground) {
          const proj = projects.find((p) => p.id === projectId)
          return proj?.name || "Playground Session"
        }
        return node?.title || (nodesLoaded ? `Task ${nodeId.slice(0, 8)}` : "Loading…")
      }

      const task: ActiveTask = {
        nodeId,
        projectId,
        title: resolveTitle(),
        status: isPlanSession ? "generating" : (exec.status === "running" ? "running" : "pending"),
        startedAt: exec.startedAt,
        executionId: exec.executionId,
        nodeType: node?.type,
        nodeStatus: node?.status,
        machineId: exec.machineId,
        providerId: exec.providerId,
      }
      const list = taskMap.get(projectId) || []
      list.push(task)
      taskMap.set(projectId, list)
      addedNodeIds.add(nodeId)
    }

    // Also check for nodes with in_progress/dispatched status that might not have execution entries
    for (const node of nodes) {
      if (node.status !== "in_progress" && node.status !== "dispatched") continue
      if (executions.has(node.id)) continue
      const list = taskMap.get(node.projectId) || []
      list.push({
        nodeId: node.id,
        projectId: node.projectId,
        title: node.title,
        status: node.status === "in_progress" ? "running" : "pending",
        startedAt: node.executionStartedAt ? new Date(node.executionStartedAt) : undefined,
        nodeType: node.type,
        nodeStatus: node.status,
      })
      taskMap.set(node.projectId, list)
    }

    // Include streaming chat/playground sessions that aren't already covered by executions.
    // The sidebar counts these in activeCount, so the active-tasks page must show them too.
    for (const sessionId of streamingSessions) {
      const session = allSessions.get(sessionId)
      if (!session?.projectId) continue

      // Only include playground (task-chat) and project-chat sessions;
      // other types (plan-generation, skill-create, steer, execution)
      // are already represented by execution entries or aren't user-facing chat.
      const isPlayground = session.type === 'task-chat'
      if (!isPlayground && session.type !== 'project-chat') continue

      // Determine a stable nodeId for dedup — playground sessions use
      // "playground-{projectId}" as their execution key
      const stableNodeId = isPlayground
        ? `playground-${session.projectId}`
        : `chat-${sessionId}`

      // Skip if already represented by an execution entry
      if (addedNodeIds.has(stableNodeId)) continue

      const proj = projects.find((p) => p.id === session.projectId)
      const firstUserMsg = session.titlePreview ?? session.messages.find((m) => m.role === 'user')?.content
      const title = session.title
        || (firstUserMsg ? firstUserMsg.slice(0, 50) + (firstUserMsg.length > 50 ? '...' : '') : undefined)
        || proj?.name
        || 'Chat Session'

      const list = taskMap.get(session.projectId) || []
      list.push({
        nodeId: stableNodeId,
        projectId: session.projectId,
        title: isPlayground ? title : `Chat: ${title}`,
        status: 'running',
        startedAt: session.updatedAt,
      })
      taskMap.set(session.projectId, list)
    }

    return taskMap
  }, [executions, rawNodes, nodes, projects, nodesLoaded, streamingSessions, allSessions])

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

  // Apply workspace filter: match projects by teamId
  const filteredProjects = useMemo(() => {
    if (workspaceFilter === 'all') return sortedProjects
    return sortedProjects.filter((group) => {
      const project = projects.find((p) => p.id === group.projectId)
      if (!project) return false
      if (workspaceFilter === 'personal') return !project.teamId
      return project.teamId === workspaceFilter
    })
  }, [sortedProjects, workspaceFilter, projects])

  const filteredCount = useMemo(
    () => filteredProjects.reduce((sum, g) => sum + g.tasks.length, 0),
    [filteredProjects],
  )

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
        {filteredCount === 0 ? (
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
            {filteredProjects.map((group) => (
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
