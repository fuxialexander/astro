import { useMemo } from "react"
import { Activity, Loader2, Sparkles, Terminal, Coffee } from "lucide-react"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useSessionStore } from "@/stores/session-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskCategory = "generation" | "playground" | "projects"

interface RunningTask {
  id: string
  title: string
  projectId: string
  projectColor?: string
  startedAt: number
  progress: number
  progressMessage?: string
  category: TaskCategory
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: TaskCategory[] = ["generation", "playground", "projects"]

const CATEGORY_META: Record<TaskCategory, { label: string; icon: typeof Activity }> = {
  generation: { label: "Plan Generation", icon: Sparkles },
  playground: { label: "Playground", icon: Terminal },
  projects: { label: "Projects", icon: Activity },
}

/** Approximate human-friendly elapsed time: "4 min", "~10-20 min", "1 hr" */
function formatLiveDuration(startedAt: number): string {
  const elapsed = Math.max(0, Date.now() - startedAt)
  const seconds = Math.floor(elapsed / 1000)
  if (seconds < 60) return "<1 min"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 5) return `${minutes} min`
  if (minutes < 15) return "~5-15 min"
  if (minutes < 30) return "~15-30 min"
  const hours = Math.floor(minutes / 60)
  if (hours < 1) return "~30+ min"
  if (hours === 1) return "~1 hr"
  return `~${hours} hrs`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RunningRow({ task }: { task: RunningTask }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 px-1 group">
      {/* Project color dot */}
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: task.projectColor || "var(--color-muted-foreground)" }}
      />

      {/* Title */}
      <span className="text-[12px] truncate flex-1 min-w-0 text-muted-foreground group-hover:text-foreground transition-colors">
        {task.title}
      </span>

      {/* Progress indicator */}
      {task.progress > 0 && (
        <div className="w-12 h-1 rounded-full bg-muted overflow-hidden shrink-0">
          <div
            className="h-full rounded-full bg-primary/40 transition-all duration-700"
            style={{ width: `${Math.min(100, task.progress)}%` }}
          />
        </div>
      )}
      {task.progress === 0 && (
        <Loader2 className="h-3 w-3 shrink-0 text-muted-foreground/50 animate-spin" />
      )}

      {/* Duration */}
      <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
        {formatLiveDuration(task.startedAt)}
      </span>
    </div>
  )
}

function CategoryGroup({ category, tasks }: { category: TaskCategory; tasks: RunningTask[] }) {
  if (tasks.length === 0) return null
  const meta = CATEGORY_META[category]
  const Icon = meta.icon

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 px-1 pb-0.5">
        <Icon className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {meta.label}
        </span>
        <span className="text-[10px] text-muted-foreground/40">{tasks.length}</span>
      </div>
      {tasks.map((task) => (
        <RunningRow key={task.id} task={task} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RunningSection({ className }: { className?: string }) {
  const nodes = usePlanStore((s) => s.nodes).filter(isLive)
  const projects = useProjectStore((s) => s.projects)
  const allExecutions = useExecutionStore((s) => s.executions)
  const streamingSessions = useSessionStore((s) => s.streamingSessions)
  const taskStreams = useRealtimeStore((s) => s.taskStreams)

  // ---- Build unified task list (mirrors dashboard.tsx pattern) ----
  const activeTasksWithContext = useMemo(() => {
    // 1. Running project tasks
    const executionTasks: RunningTask[] = nodes
      .filter((n) => n.status === "in_progress" || n.status === "dispatched")
      .map((node) => {
        const stream = node.executionId ? taskStreams.get(node.executionId) : undefined
        const project = projects.find((p) => p.id === node.projectId)
        return {
          id: node.id,
          title: node.title,
          projectId: node.projectId,
          projectColor: project?.color,
          startedAt: node.executionStartedAt
            ? new Date(node.executionStartedAt).getTime()
            : Date.now() - 60000,
          progress: stream?.progress ?? 0,
          progressMessage: stream?.progressMessage,
          category: "projects" as TaskCategory,
        }
      })

    // 2. Active plan generation sessions
    const planGenerationTasks: RunningTask[] = [...allExecutions.values()]
      .filter(
        (e) =>
          (e.status === "running" || e.status === "pending") &&
          e.nodeId.startsWith("plan-"),
      )
      .map((exec) => {
        const project = projects.find((p) => p.id === exec.projectId)
        return {
          id: exec.nodeId,
          title: project?.name ? `${project.name} — plan` : "Plan Generation",
          projectId: exec.projectId,
          projectColor: project?.color,
          startedAt: exec.startedAt ? new Date(exec.startedAt).getTime() : Date.now(),
          progress: exec.status === "running" ? 50 : 10,
          progressMessage: exec.status === "running" ? "Generating plan..." : "Starting...",
          category: "generation" as TaskCategory,
        }
      })

    // 3. Active playground sessions
    const playgroundTasks: RunningTask[] = [...allExecutions.values()]
      .filter(
        (e) =>
          (e.status === "running" || e.status === "pending") &&
          e.nodeId.startsWith("playground-"),
      )
      .map((exec) => {
        const project = projects.find((p) => p.id === exec.projectId)
        return {
          id: exec.nodeId,
          title: project?.name ? `${project.name} — playground` : "Playground",
          projectId: exec.projectId,
          projectColor: project?.color,
          startedAt: exec.startedAt ? new Date(exec.startedAt).getTime() : Date.now(),
          progress: 0,
          progressMessage: exec.status === "pending" ? "Starting..." : undefined,
          category: "playground" as TaskCategory,
        }
      })

    // 4. Active chat sessions (streaming)
    const chatTasks: RunningTask[] = [...streamingSessions].map((sessionId) => {
      return {
        id: `chat-${sessionId}`,
        title: "Chat session",
        projectId: "",
        projectColor: undefined,
        startedAt: Date.now() - 30000, // approximate
        progress: 0,
        progressMessage: "Streaming...",
        category: "playground" as TaskCategory,
      }
    })

    return [...planGenerationTasks, ...playgroundTasks, ...chatTasks, ...executionTasks]
  }, [nodes, taskStreams, projects, allExecutions, streamingSessions])

  // ---- Group by category ----
  const tasksByCategory = useMemo(() => {
    const grouped: Record<TaskCategory, RunningTask[]> = {
      generation: [],
      playground: [],
      projects: [],
    }
    for (const task of activeTasksWithContext) {
      grouped[task.category].push(task)
    }
    return grouped
  }, [activeTasksWithContext])

  const totalRunning = activeTasksWithContext.length

  // ---- Render ----
  return (
    <div className={cn("space-y-2", className)}>
      {totalRunning === 0 ? (
        <div className="flex items-center gap-2 px-1 py-3">
          <Coffee className="h-3.5 w-3.5 text-muted-foreground/40" />
          <span className="text-[12px] text-muted-foreground/50">All quiet</span>
        </div>
      ) : (
        CATEGORY_ORDER.map((cat) => (
          <CategoryGroup
            key={cat}
            category={cat}
            tasks={tasksByCategory[cat]}
          />
        ))
      )}
    </div>
  )
}
