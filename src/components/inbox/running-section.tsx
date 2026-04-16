import { useMemo, useState } from "react"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useExecutionStore } from "@/stores/execution-store"
import { MachineFleetPanel } from "@/components/dashboard/machine-fleet-panel"
import { TaskTimeline } from "@/components/dashboard/task-timeline"

type TaskCategory = "generation" | "playground" | "projects"

export function RunningSection() {
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const machines = useRealtimeStore((s) => s.machines)
  const taskStreams = useRealtimeStore((s) => s.taskStreams)
  const allExecutions = useExecutionStore((s) => s.executions)

  const machineFleetData = useMemo(
    () =>
      Array.from(machines.values()).map((m) => ({
        machineId: m.machineId,
        name: m.name || m.machineId,
        cpuPercent: m.load.cpuPercent,
        memoryPercent: m.load.memoryPercent,
        activeTasks: m.load.activeTasks,
        connected: m.connectionStatus === "connected",
      })),
    [machines],
  )

  // Stable fallback timestamp for tasks without startedAt (avoids impure Date.now in render)
  const [fallbackNow] = useState(() => Date.now())

  const activeTasksWithContext = useMemo(() => {
    const now = fallbackNow
    const executionTasks = nodes
      .filter((n) => n.status === "in_progress" || n.status === "dispatched")
      .map((node) => {
        const stream = node.executionId ? taskStreams.get(node.executionId) : undefined
        const project = projects.find((p) => p.id === node.projectId)
        const machine = machines.get(node.machineId || "")
        return {
          id: node.id,
          title: node.title,
          projectId: node.projectId,
          projectName: project?.name || "Unknown",
          projectColor: project?.color,
          machineName: machine?.name || machine?.machineId || "local",
          machineId: node.machineId || "local",
          startedAt: node.executionStartedAt ? new Date(node.executionStartedAt).getTime() : now - 60000,
          progress: stream?.progress ?? 0,
          progressMessage: stream?.progressMessage,
          costUsd: undefined as number | undefined,
          category: "projects" as TaskCategory,
        }
      })

    const planGenerationTasks = [...allExecutions.values()]
      .filter((e) => (e.status === "running" || e.status === "pending") && e.nodeId.startsWith("plan-"))
      .map((exec) => {
        const project = projects.find((p) => p.id === exec.projectId)
        return {
          id: exec.nodeId,
          title: project?.name || "Plan Generation",
          projectId: exec.projectId,
          projectName: project?.name || "Plan Generation",
          projectColor: project?.color,
          machineName: "planner",
          machineId: "planner",
          startedAt: exec.startedAt ? new Date(exec.startedAt).getTime() : now,
          progress: exec.status === "running" ? 50 : 10,
          progressMessage: exec.status === "running" ? "Generating plan..." : "Starting...",
          costUsd: undefined as number | undefined,
          category: "generation" as TaskCategory,
        }
      })

    const playgroundTasks = [...allExecutions.values()]
      .filter((e) => (e.status === "running" || e.status === "pending") && (e.nodeId.startsWith("playground-") || e.nodeId.startsWith("session-")))
      .map((exec) => {
        const project = projects.find((p) => p.id === exec.projectId)
        const machine = machines.get(project?.defaultMachineId || "")
        return {
          id: exec.nodeId,
          title: project?.name || "Playground",
          projectId: exec.projectId,
          projectName: project?.name || "Playground",
          projectColor: undefined as string | undefined,
          machineName: machine?.name || machine?.machineId || "local",
          machineId: project?.defaultMachineId || "local",
          startedAt: exec.startedAt ? new Date(exec.startedAt).getTime() : now,
          progress: 0,
          progressMessage: exec.status === "pending" ? "Starting..." : undefined,
          costUsd: undefined as number | undefined,
          category: "playground" as TaskCategory,
        }
      })

    return [...planGenerationTasks, ...playgroundTasks, ...executionTasks]
  }, [nodes, taskStreams, projects, machines, allExecutions, fallbackNow])

  const tasksByCategory = useMemo(() => {
    const grouped: Record<TaskCategory, typeof activeTasksWithContext> = {
      generation: [],
      playground: [],
      projects: [],
    }
    for (const task of activeTasksWithContext) {
      grouped[task.category].push(task)
    }
    return grouped
  }, [activeTasksWithContext])

  const categoryLabels: Record<TaskCategory, string> = {
    generation: "Plan Generation",
    playground: "Playground",
    projects: "Projects",
  }

  const timelineMachines = useMemo(() => [...new Set(activeTasksWithContext.map((t) => t.machineName))], [activeTasksWithContext])

  if (machineFleetData.length === 0 && activeTasksWithContext.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground/70 uppercase">Running</h2>
        {activeTasksWithContext.length > 0 && (
          <span className="relative flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info/60 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-info/80" />
            </span>
            <span className="text-[11px] text-info/70 font-medium tabular-nums">{activeTasksWithContext.length}</span>
          </span>
        )}
      </div>

      <div className="@container flex flex-col @lg:flex-row gap-6">
        {machineFleetData.length > 0 && (
          <div className="shrink-0 @lg:w-[120px]">
            <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground/40 uppercase mb-3">Fleet</h3>
            <MachineFleetPanel machines={machineFleetData} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground/40 uppercase mb-3">Tasks</h3>
          <div className="rounded-xl border border-border/50 p-3 max-h-[min(50vh,400px)] overflow-y-auto">
            {activeTasksWithContext.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground/30 text-[13px]">All quiet</div>
            ) : (
              <div className="flex flex-col gap-3">
                {(["generation", "playground", "projects"] as TaskCategory[]).map((cat) => {
                  const tasks = tasksByCategory[cat]
                  if (tasks.length === 0) return null
                  return (
                    <div key={cat}>
                      <div className="flex items-center gap-2 mb-1.5 px-1">
                        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/40 uppercase">
                          {categoryLabels[cat]}
                        </span>
                        <span className="text-[10px] text-muted-foreground/25 tabular-nums">{tasks.length}</span>
                      </div>
                      <TaskTimeline tasks={tasks} machines={timelineMachines} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
