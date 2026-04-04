import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  Play,
  Clock,
  Cpu,
  AlertCircle,
  ArrowRight,
  Terminal,
  Send,
  Maximize2,
  User,
  Wrench,
  ListFilter,
  CheckCircle2,
  Square,
} from "lucide-react"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useSessionStore } from "@/stores/session-store"
import { useWorkspaceFilterStore } from "@/stores/workspace-filter-store"
import { deriveActiveTasks, deriveCompletedTasks, getActiveTasksContentState, type ActiveTaskEntry } from "@/lib/active-tasks"
import { useStreamEvents } from "@/hooks/use-stream-events"
import type { TaskActivityEvent } from "@/types"
import { parseYamlSpecFromText } from "@/lib/json-render/parse-yaml-spec"
import { JsonRenderView } from "@/components/ui/json-render-view"
import { StreamingMarkdown } from "@/components/ui/streaming-markdown"
import type { Spec } from "@json-render/core"

// ─── Elapsed Timer ─────────────────────────────────────────────────

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

// ─── LLM Preview ───────────────────────────────────────────────────

function useLlmPreview(executionId?: string): string {
  const stream = useRealtimeStore(
    useCallback(
      (s) => (executionId ? s.taskStreams.get(executionId) : undefined),
      [executionId],
    ),
  )
  const activityEvents = stream?.activityEvents
  return useMemo(() => {
    if (!activityEvents) return ""
    const lastText = activityEvents
      .filter(
        (e: TaskActivityEvent) =>
          e.type === "text" || e.type === "chat_assistant",
      )
      .at(-1)
    if (!lastText) return ""
    const raw = (lastText as { content: string }).content
    return raw ? raw.replace(/\n/g, " ").slice(0, 100) : ""
  }, [activityEvents])
}

// ─── Job Row (left panel) ──────────────────────────────────────────

function JobRow({
  task,
  isSelected,
  onSelect,
}: {
  task: ActiveTaskEntry
  isSelected: boolean
  onSelect: () => void
}) {
  const execution = useExecutionStore((s) => s.executions.get(task.nodeId))
  const progress = useRealtimeStore(
    useCallback(
      (s) => (task.executionId ? s.taskStreams.get(task.executionId)?.progress ?? 0 : 0),
      [task.executionId],
    ),
  )
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const preview = useLlmPreview(task.executionId)

  const hasPendingApproval = useMemo(() => {
    if (!task.executionId) return false
    for (const approval of dynamicApprovals.values()) {
      if (approval.taskId === task.executionId) return true
    }
    return false
  }, [dynamicApprovals, task.executionId])

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-1.5 px-4 py-3 w-full text-left transition-colors border-b border-border last:border-b-0 ${
        isSelected
          ? "bg-info/10"
          : hasPendingApproval
            ? "bg-warning/5 hover:bg-warning/10"
            : "hover:bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Status indicator */}
        {hasPendingApproval ? (
          <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
        ) : task.status === "completed" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
        ) : task.status === "generating" ? (
          <Sparkles className="h-3.5 w-3.5 text-info animate-pulse shrink-0" />
        ) : task.status === "running" ? (
          <div className="relative h-3.5 w-3.5 shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-info border-t-transparent animate-spin" />
          </div>
        ) : task.status === "idle" ? (
          <div className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30 shrink-0" />
        ) : (
          <Clock className="h-3.5 w-3.5 text-warning shrink-0" />
        )}

        {/* Title */}
        <span className="text-sm text-foreground truncate flex-1 min-w-0">
          {task.title}
        </span>

        {/* Elapsed time */}
        <ElapsedTimer startedAt={task.startedAt} />
      </div>

      {/* LLM preview line */}
      {preview && (
        <p className="text-xs text-muted-foreground truncate ml-6">
          {preview}
        </p>
      )}

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

      {/* Execution metadata — only show provider, not machine UUID */}
      {execution?.providerId && (
          <div className="flex items-center gap-3 ml-6 text-[10px] text-muted-foreground">
            {execution.providerId && (
              <div className="flex items-center gap-1">
                <Cpu className="h-2.5 w-2.5" />
                <span className="capitalize">{execution.providerId}</span>
              </div>
            )}
          </div>
        )}
    </button>
  )
}

// ─── Project Group (left panel) ────────────────────────────────────

function ProjectGroup({
  projectName,
  projectColor,
  tasks,
  defaultExpanded,
  selectedJobId,
  onSelectJob,
  isPlaygroundGroup,
}: {
  projectName: string
  projectColor?: string
  tasks: ActiveTaskEntry[]
  defaultExpanded: boolean
  selectedJobId: string | null
  onSelectJob: (taskNodeId: string) => void
  isPlaygroundGroup?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const borderColor = isPlaygroundGroup ? "#A855F7" : (projectColor || "#3B82F6")

  return (
    <div>
      {/* Group header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}
        className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-muted/30 transition-colors text-left cursor-pointer border-b border-border/40"
      >
        <div className="shrink-0 p-0.5 -m-0.5">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        {isPlaygroundGroup ? (
          <Terminal className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        ) : (
          <div
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: projectColor || "#3B82F6" }}
          />
        )}
        <span className="text-xs font-semibold text-foreground flex-1 truncate uppercase tracking-wide">
          {projectName}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {tasks.length}
        </span>
      </div>

      {/* Task list with colored left border */}
      {expanded && (
        <div
          className="border-l-[3px]"
          style={{ borderColor }}
        >
          {tasks.map((task) => (
            <JobRow
              key={task.nodeId}
              task={task}
              isSelected={selectedJobId === task.nodeId}
              onSelect={() => onSelectJob(task.nodeId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Chat Message Rendering ────────────────────────────────────────

function ChatMessages({ events, isRunning }: { events: TaskActivityEvent[]; isRunning: boolean }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events.length])

  // Group consecutive tool events into collapsed pills
  const rendered: React.ReactNode[] = []
  let i = 0
  while (i < events.length) {
    const event = events[i]

    if (event.type === "operational") {
      rendered.push(
        <div
          key={`op-${i}`}
          className="flex items-center gap-2 py-1.5 text-xs text-info"
        >
          <div className="flex-1 h-px bg-info/20" />
          <span className="shrink-0 font-medium">
            [Astro] {event.message}
          </span>
          <div className="flex-1 h-px bg-info/20" />
        </div>,
      )
      i++
      continue
    }

    if (event.type === "tool_use" || event.type === "tool_result") {
      // Count consecutive tool events
      let toolCount = 0
      let j = i
      while (
        j < events.length &&
        (events[j].type === "tool_use" || events[j].type === "tool_result")
      ) {
        if (events[j].type === "tool_use") toolCount++
        j++
      }
      rendered.push(
        <div
          key={`tools-${i}`}
          className="flex items-center gap-2 py-1"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            <Wrench className="h-3 w-3" />
            {toolCount} tool{toolCount !== 1 ? "s" : ""}
          </span>
        </div>,
      )
      i = j
      continue
    }

    if (event.type === "chat_user") {
      rendered.push(
        <div key={`user-${i}`} className="flex gap-3 py-2">
          <div className="shrink-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground whitespace-pre-wrap break-words">
              {event.message}
            </p>
          </div>
        </div>,
      )
      i++
      continue
    }

    if (event.type === "chat_assistant" || event.type === "text") {
      // Collect consecutive text/chat_assistant events
      let content = ""
      let j = i
      while (
        j < events.length &&
        (events[j].type === "text" || events[j].type === "chat_assistant")
      ) {
        const e = events[j]
        if (e.type === "text") content += (e as { content: string }).content
        else if (e.type === "chat_assistant")
          content += (e as { content: string }).content
        j++
      }
      if (content.trim()) {
        const hasSpec = content.includes('```yaml-spec') || content.includes('```component')
        rendered.push(
          <div key={`assistant-${i}`} className="flex gap-3 py-2">
            <div className="shrink-0 h-6 w-6 rounded-full bg-info/10 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-info" />
            </div>
            <div className="flex-1 min-w-0">
              {hasSpec ? (
                parseYamlSpecFromText(content).map((seg, si) =>
                  seg.type === 'text' ? (
                    <StreamingMarkdown key={si} content={seg.content} />
                  ) : (
                    <JsonRenderView key={si} spec={seg.spec as unknown as Spec} componentDefs={seg.componentDefs} />
                  )
                )
              ) : (
                <StreamingMarkdown content={content} />
              )}
            </div>
          </div>,
        )
      }
      i = j
      continue
    }

    if (event.type === "error") {
      rendered.push(
        <div key={`error-${i}`} className="py-1.5 text-xs text-destructive">
          Error: {(event as { error: string }).error}
        </div>,
      )
      i++
      continue
    }

    // Skip other event types (file_change, steer, approval, etc.)
    i++
  }

  return (
    <div className="flex flex-col px-4 py-3">
      {rendered}
      {isRunning && (
        <div className="flex gap-3 py-2">
          <div className="shrink-0 h-6 w-6 rounded-full bg-info/10 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-info" />
          </div>
          <div className="flex items-center gap-1 pt-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-info animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="h-1.5 w-1.5 rounded-full bg-info animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="h-1.5 w-1.5 rounded-full bg-info animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}

// ─── Chat Panel (right panel) ──────────────────────────────────────

function ChatPanel({
  task,
  projectId,
}: {
  task: ActiveTaskEntry
  projectId: string
}) {
  const navigate = useNavigate()
  const [inputText, setInputText] = useState("")
  // For chat sessions, stream events are keyed by session ID; for executions, by execution ID
  const streamId = task.sessionId ?? task.executionId
  const { activityEvents, isHydrating } = useStreamEvents(streamId)
  const events = activityEvents
  const isRunning = task.status === "running" || task.status === "generating"

  // Ensure full session messages are loaded for resume/history context
  const ensureFullSession = useSessionStore((s) => s.ensureFullSession)
  const ensuredRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (task.sessionId && task.sessionId !== ensuredRef.current) {
      ensuredRef.current = task.sessionId
      ensureFullSession(task.sessionId)
    }
  }, [task.sessionId, ensureFullSession])

  // Determine expand navigation target
  const expandTo = useMemo(() => {
    if (task.nodeId.startsWith("plan-") || task.status === "generating")
      return `/project/${projectId}`
    if (task.nodeId.startsWith("session-"))
      return `/playground?projectId=${projectId}`
    if (
      task.nodeId.startsWith("playground-") ||
      task.nodeId.startsWith("followup-playground-")
    )
      return `/project/${projectId}`
    if (task.nodeId.startsWith("followup-"))
      return `/project/${projectId}/task/${task.nodeId.replace("followup-", "")}`
    if (task.nodeId.startsWith("task-chat-"))
      return `/project/${projectId}`
    return `/project/${projectId}/task/${task.nodeId}`
  }, [task.nodeId, task.status, projectId])

  // Determine if this is a playground/session
  const isPlayground =
    task.nodeId.startsWith("playground-") ||
    task.nodeId.startsWith("followup-playground-") ||
    task.nodeId.startsWith("session-")

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text) return
    setInputText("")

    const store = useSessionStore.getState()

    // Use the task's session ID if available, otherwise find/create a session
    const session = task.sessionId
      ? store.getSession(task.sessionId) ?? store.getOrCreateSession({ type: "project-chat", projectId })
      : store.getOrCreateSession({ type: "project-chat", projectId })

    if (isPlayground) {
      const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
      store.addMessage(session.id, { role: "user", content: text })
      store.addMessage(session.id, { role: "assistant", content: "" })

      store.sendPlaygroundChat({
        sessionId: session.id,
        projectId,
        nodeId: task.nodeId.replace("followup-playground-", "playground-").replace("playground-", "").replace("session-", ""),
        message: text,
        taskTitle: project?.name || "Playground",
        taskDescription: project?.description || "",
        taskOutput: events
          .filter((e): e is Extract<TaskActivityEvent, { type: 'text' | 'tool_use' | 'tool_result' }> =>
            e.type === 'text' || e.type === 'tool_use' || e.type === 'tool_result')
          .map((e) => {
            if (e.type === 'text') return e.content
            if (e.type === 'tool_use') return `[Tool: ${e.toolName}]`
            if (e.type === 'tool_result') return `[Result: ${e.toolName} — ${e.success ? 'success' : 'failed'}]`
            return ''
          })
          .join('\n'),
      })
    } else {
      store.addMessage(session.id, { role: "user", content: text })
      store.addMessage(session.id, { role: "assistant", content: "" })

      // Build conversation history for context (exclude just-added placeholder)
      const freshSession = useSessionStore.getState().sessions.get(session.id)
      const freshMessages = freshSession?.messages || []
      const historyMessages = freshMessages
        .slice(0, -2)
        .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

      store.sendChatMessage({
        sessionId: session.id,
        projectId,
        message: text,
        messages: historyMessages,
      })
    }
  }, [inputText, isPlayground, projectId, task.nodeId, task.sessionId, events])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {isRunning ? (
            <div className="relative h-3.5 w-3.5 shrink-0">
              <div className="absolute inset-0 rounded-full border-2 border-info border-t-transparent animate-spin" />
            </div>
          ) : (
            <div className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30 shrink-0" />
          )}
          <span className="text-sm font-semibold text-foreground truncate">
            {task.title}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate(expandTo)}
          className="shrink-0 p-1.5 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
          title="Open full page"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Chat content */}
      <div className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <p className="text-sm text-muted-foreground">
              {isHydrating
                ? "Loading activity..."
                : isRunning
                  ? "Waiting for agent output..."
                  : "No activity yet for this job."}
            </p>
          </div>
        ) : (
          <ChatMessages events={events} isRunning={isRunning} />
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-info/30"
          />
          {isRunning && (
            <button
              type="button"
              onClick={() => useExecutionStore.getState().cancelExecution(task.nodeId)}
              className="shrink-0 p-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              title="Stop execution"
            >
              <Square className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="shrink-0 p-2 rounded-lg bg-info text-info-foreground hover:bg-info/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────

export function ActiveTasks() {
  const { t } = useTranslation("tasks")
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

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const { groupedTasks, activeCount: filteredCount } = useMemo(
    () =>
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
      }),
    [
      executions,
      rawNodes,
      nodes,
      nodesLoaded,
      projects,
      projectsLoaded,
      streamingSessions,
      allSessions,
      workspaceFilter,
    ],
  )

  // Completed/auto_verified tasks (shown when filter is on)
  const completedGrouped = useMemo(
    () =>
      showCompleted
        ? deriveCompletedTasks({
            rawNodes,
            projects,
            workspaceFilter,
          })
        : new Map<string, ActiveTaskEntry[]>(),
    [showCompleted, rawNodes, projects, projectsLoaded, workspaceFilter],
  )

  // Merge active + completed tasks
  const mergedGroupedTasks = useMemo(() => {
    if (!showCompleted) return groupedTasks
    const merged = new Map(groupedTasks)
    for (const [projectId, tasks] of completedGrouped) {
      const existing = merged.get(projectId) || []
      // Add completed tasks that aren't already in active list
      const activeIds = new Set(existing.map((t) => t.nodeId))
      const newTasks = tasks.filter((t) => !activeIds.has(t.nodeId))
      if (newTasks.length > 0) {
        merged.set(projectId, [...existing, ...newTasks])
      }
    }
    return merged
  }, [groupedTasks, completedGrouped, showCompleted])

  // Separate playground and project groups
  const { playgroundTasks, projectGroups } = useMemo(() => {
    const playground: ActiveTaskEntry[] = []
    const projectMap: Array<{
      projectId: string
      projectName: string
      projectColor?: string
      tasks: ActiveTaskEntry[]
    }> = []

    for (const [projectId, tasks] of mergedGroupedTasks.entries()) {
      const project = projects.find((p) => p.id === projectId)
      // Projects without plan nodes are grouped as "session" tasks (formerly "playground")
      const hasPlanNodes = nodes.some((n) => n.projectId === projectId)

      if (!hasPlanNodes) {
        // Group all playground tasks into a single block
        for (const task of tasks) {
          playground.push(task)
        }
      } else {
        projectMap.push({
          projectId,
          projectName:
            project?.name ||
            (projectsLoaded
              ? `Project ${projectId.slice(0, 8)}`
              : "Loading..."),
          projectColor: project?.color,
          tasks,
        })
      }
    }

    // Sort project groups: more active tasks first
    projectMap.sort((a, b) => b.tasks.length - a.tasks.length)

    return { playgroundTasks: playground, projectGroups: projectMap }
  }, [mergedGroupedTasks, projects, projectsLoaded, nodes])

  // Flatten all tasks for selection tracking
  const allTasks = useMemo(() => {
    const tasks: Array<{ task: ActiveTaskEntry; projectId: string }> = []
    for (const task of playgroundTasks) {
      tasks.push({ task, projectId: task.projectId })
    }
    for (const group of projectGroups) {
      for (const task of group.tasks) {
        tasks.push({ task, projectId: group.projectId })
      }
    }
    return tasks
  }, [playgroundTasks, projectGroups])

  const handleSelectJob = useCallback(
    (taskNodeId: string) => {
      setSelectedJobId(taskNodeId)
    },
    [],
  )

  // Derive effective selection: use explicit selection if still valid, otherwise first task
  const selectedTask = useMemo(() => {
    if (allTasks.length === 0) return null
    if (selectedJobId) {
      const found = allTasks.find((t) => t.task.nodeId === selectedJobId)
      if (found) return found
    }
    return allTasks[0]
  }, [allTasks, selectedJobId])

  const effectiveSelectedId = selectedTask?.task.nodeId ?? null

  const contentState = getActiveTasksContentState(filteredCount, {
    executionsLoaded,
    sessionsLoaded,
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-8 h-14 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-primary font-semibold text-foreground">
            {t("active", "Active Jobs")}
          </h1>
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

      {/* Content: split panel */}
      <div className="flex-1 overflow-hidden flex">
        {contentState === "loading" ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
              <div className="absolute inset-3 rounded-full border-2 border-info border-t-transparent animate-spin" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Loading active tasks
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Restoring running tasks, playground sessions, and plan
                generations
              </p>
            </div>
          </div>
        ) : contentState === "empty" ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
              <Play className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                No active tasks
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Running tasks, playground sessions, and plan generations will
                appear here
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Left panel: job list */}
            <div className="w-[420px] min-w-[320px] shrink-0 border-r border-border/60 overflow-y-auto overflow-x-hidden">
              {/* Filter row */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/20">
                <span className="text-xs text-muted-foreground">{filteredCount} active</span>
                <button
                  type="button"
                  onClick={() => setShowCompleted(!showCompleted)}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors ${
                    showCompleted
                      ? "bg-info/10 text-info"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <ListFilter className="h-3 w-3" />
                  {showCompleted ? "Showing completed" : "Show completed"}
                </button>
              </div>

              {/* Playground sessions group */}
              {playgroundTasks.length > 0 && (
                <ProjectGroup
                  projectName="Playground Sessions"
                  tasks={playgroundTasks}
                  defaultExpanded={true}
                  selectedJobId={effectiveSelectedId}
                  onSelectJob={handleSelectJob}
                  isPlaygroundGroup
                />
              )}

              {/* Project groups */}
              {projectGroups.map((group) => (
                <ProjectGroup
                  key={group.projectId}
                  projectName={group.projectName}
                  projectColor={group.projectColor}
                  tasks={group.tasks}
                  defaultExpanded={true}
                  selectedJobId={effectiveSelectedId}
                  onSelectJob={handleSelectJob}
                />
              ))}
            </div>

            {/* Right panel: chat */}
            <div className="flex-1 min-w-0 bg-background">
              {selectedTask ? (
                <ChatPanel
                  key={selectedTask.task.nodeId}
                  task={selectedTask.task}
                  projectId={selectedTask.projectId}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Select a job to view its chat
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
