import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { stripHtml } from "@/lib/html-utils"
import { Link, useNavigate } from "react-router"
import {
  Plus,
  Activity,
  Check,
  FileText,
  Monitor,
  CheckCircle2,
  XCircle,
  Zap,
  AlertCircle,
  RotateCcw,
  Scissors,
  Loader2,
  ClipboardCheck,
  MessageSquare,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useRealtimeStore, type ActivityEvent } from "@/stores/realtime-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useStatsStore } from "@/stores/stats-store"
import { useSettingsStore } from "@/stores/settings-store"
import { ApprovalCard } from "@/components/approval-card"
import { InlineApprovalCard } from "@/components/plan-generation/inline-approval-card"
import { NotificationCards } from "@/components/dashboard/notification-card"
import { ActivityOverview } from "@/components/dashboard/activity-overview"
import { BragStats } from "@/components/dashboard/brag-stats"
import { AchievementsPanel } from "@/components/dashboard/achievements-panel"
import { CommandStrip } from "@/components/dashboard/command-strip"
import { MachineFleetPanel } from "@/components/dashboard/machine-fleet-panel"
import { TaskTimeline } from "@/components/dashboard/task-timeline"
import { ProjectHealthCard } from "@/components/dashboard/project-health-card"
import { WhatsNewSection } from "@/components/dashboard/whats-new-section"
import { UpcomingScheduledRuns } from "@/components/dashboard/upcoming-scheduled-runs"
import { useSessionStore } from "@/stores/session-store"
import { useFeatureFlag } from "@/hooks/use-feature-flag"
import { formatCompactNumber } from "@astro/core/achievements"
import { dataClient } from "@/lib/data-client"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/date-utils"

const activityIcons: Record<string, { icon: typeof Activity; color: string }> = {
  success: { icon: CheckCircle2, color: "text-success" },
  failure: { icon: XCircle, color: "text-error" },
  progress: { icon: Activity, color: "text-info" },
  machine: { icon: Monitor, color: "text-primary" },
  file_change: { icon: FileText, color: "text-warning" },
  chat: { icon: MessageSquare, color: "text-info" },
  dispatch: { icon: Zap, color: "text-warning" },
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  const config = activityIcons[event.type] || activityIcons.progress
  const Icon = config.icon
  return (
    <div className="flex items-center gap-2.5 py-1.5 group">
      <Icon className={cn("h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity", config.color)} />
      <p className="text-[11px] truncate flex-1 min-w-0 text-muted-foreground group-hover:text-foreground transition-colors">{event.text}</p>
      <span className="text-[10px] text-muted-foreground/40 shrink-0">{formatRelativeTime(event.timestamp)}</span>
    </div>
  )
}

export function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tc } = useTranslation('common')
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const machines = useRealtimeStore((s) => s.machines)
  const activityFeed = useRealtimeStore((s) => s.activityFeed)
  const taskStreams = useRealtimeStore((s) => s.taskStreams)
  const connected = useRealtimeStore((s) => s.connected)
  const profile = useUserProfileStore((s) => s.profile)
  const pendingApprovals = useExecutionStore((s) => s.pendingApprovals)
  const respondToApproval = useExecutionStore((s) => s.respondToApproval)
  const getExecution = useExecutionStore((s) => s.getExecution)
  const executionsLoaded = useExecutionStore((s) => s.loaded)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const allExecutions = useExecutionStore((s) => s.executions)
  const [resettingId, setResettingId] = useState<string | null>(null)
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const yoloMode = useSettingsStore((s) => s.yoloMode)
  const gitHubEnabled = useFeatureFlag('github-integration')

  // Auto-dismiss any approval cards that leaked through in YOLO mode
  useEffect(() => {
    if (!yoloMode || dynamicApprovals.size === 0) return
    for (const approval of dynamicApprovals.values()) {
      respondToDynamicApproval(approval.taskId, approval.requestId, approval.options[0])
    }
  }, [yoloMode, dynamicApprovals, respondToDynamicApproval])
  const heatmapData = useStatsStore((s) => s.heatmapData)
  const hourlyData = useStatsStore((s) => s.hourlyData)
  const stats = useStatsStore((s) => s.stats)
  const achievements = useStatsStore((s) => s.achievements)
  const levelInfo = useStatsStore((s) => s.levelInfo)
  const statsLoaded = useStatsStore((s) => s.statsLoaded)
  const loadAll = useStatsStore((s) => s.loadAll)
  const navigate = useNavigate()
  const attentionRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadAll() }, [loadAll])

  const streamingSessions = useSessionStore((s) => s.streamingSessions)
  const activeNodeTasks = nodes.filter(
    (n) => n.status === "in_progress" || n.status === "dispatched"
  ).length
  const activePlaygroundTasks = [...allExecutions.values()].filter(
    (e) => (e.status === "running" || e.status === "pending") && e.nodeId.startsWith("playground-")
  ).length
  const activePlanSessions = [...allExecutions.values()].filter(
    (e) => (e.status === "running" || e.status === "pending") && e.nodeId.startsWith("plan-")
  ).length
  const activeChatSessions = streamingSessions.size
  const activeTasks = activeNodeTasks + activePlaygroundTasks + activePlanSessions + activeChatSessions
  const pendingDecisions = nodes.filter(
    (n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval"
  ).length + dynamicApprovals.size

  const pendingNodes = nodes.filter((n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval")
  const activeProjects = useMemo(() => projects.filter((p) => p.status === "active"), [projects])
  const regularProjects = useMemo(() => activeProjects.filter((p) => p.projectType !== "playground"), [activeProjects])
  const playgroundProjects = useMemo(() => activeProjects.filter((p) => p.projectType === "playground"), [activeProjects])

  const [projectCosts, setProjectCosts] = useState<Record<string, number>>({})
  useEffect(() => {
    const ids = activeProjects.map((p) => p.id)
    if (ids.length === 0) return
    dataClient.getProjectCosts(ids).then(setProjectCosts).catch(() => {})
  }, [activeProjects])

  const recentProjects = useMemo(() => {
    return [...regularProjects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6)
  }, [regularProjects])

  const recentPlaygrounds = useMemo(() => {
    return [...playgroundProjects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3)
  }, [playgroundProjects])
  const hasAttention = pendingNodes.length > 0 || dynamicApprovals.size > 0

  const machineList = useMemo(() => Array.from(machines.values()), [machines])

  // ── Data transformations for new components ──

  const machineFleetData = useMemo(() =>
    machineList.map((m) => ({
      machineId: m.machineId,
      name: m.name || m.machineId,
      cpuPercent: m.load.cpuPercent,
      memoryPercent: m.load.memoryPercent,
      activeTasks: m.load.activeTasks,
      connected: m.connectionStatus === "connected",
    })),
  [machineList])

  const machinesById = useMemo(
    () => new Map(machineFleetData.map((machine) => [
      machine.machineId,
      { name: machine.name, connected: machine.connected },
    ])),
    [machineFleetData],
  )

  type TaskCategory = "generation" | "playground" | "projects"

  const activeTasksWithContext = useMemo(() => {
    // Running execution tasks (project tasks)
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
          startedAt: node.executionStartedAt
            ? new Date(node.executionStartedAt).getTime()
            : Date.now() - 60000,
          progress: stream?.progress ?? 0,
          progressMessage: stream?.progressMessage,
          costUsd: undefined as number | undefined,
          category: "projects" as TaskCategory,
        }
      })

    // Active plan generation sessions (from execution store, nodeId starts with "plan-")
    const planGenerationTasks = [...allExecutions.values()]
      .filter((e) => (e.status === "running" || e.status === "pending") && e.nodeId.startsWith("plan-"))
      .map((exec) => {
        const project = projects.find((p) => p.id === exec.projectId)
        return {
          id: exec.nodeId,
          title: project?.name || t("planGeneration"),
          projectId: exec.projectId,
          projectName: project?.name || t("planGeneration"),
          projectColor: project?.color,
          machineName: "planner",
          machineId: "planner",
          startedAt: exec.startedAt ? new Date(exec.startedAt).getTime() : Date.now(),
          progress: exec.status === "running" ? 50 : 10,
          progressMessage: exec.status === "running" ? t("generatingPlan") : t("starting"),
          costUsd: undefined as number | undefined,
          category: "generation" as TaskCategory,
        }
      })

    // Active playground sessions
    const playgroundTasks = [...allExecutions.values()]
      .filter((e) => (e.status === "running" || e.status === "pending") && e.nodeId.startsWith("playground-"))
      .map((exec) => {
        const project = projects.find((p) => p.id === exec.projectId)
        const machine = machines.get(project?.defaultMachineId || "")
        return {
          id: exec.nodeId,
          title: project?.name || t("playground"),
          projectId: exec.projectId,
          projectName: project?.name || t("playground"),
          projectColor: undefined as string | undefined,
          machineName: machine?.name || machine?.machineId || "local",
          machineId: project?.defaultMachineId || "local",
          startedAt: exec.startedAt ? new Date(exec.startedAt).getTime() : Date.now(),
          progress: 0,
          progressMessage: exec.status === "pending" ? t("starting") : undefined,
          costUsd: undefined as number | undefined,
          category: "playground" as TaskCategory,
        }
      })

    return [...planGenerationTasks, ...playgroundTasks, ...executionTasks]
  }, [nodes, taskStreams, projects, machines, allExecutions, t])

  const tasksByCategory = useMemo(() => {
    const grouped: Record<TaskCategory, typeof activeTasksWithContext> = {
      generation: [], playground: [], projects: [],
    }
    for (const task of activeTasksWithContext) {
      grouped[task.category].push(task)
    }
    return grouped
  }, [activeTasksWithContext])

  const categoryLabels: Record<TaskCategory, string> = {
    generation: t("planGeneration"),
    playground: t("playground"),
    projects: t("projects"),
  }

  const timelineMachines = useMemo(
    () => [...new Set(activeTasksWithContext.map((t) => t.machineName))],
    [activeTasksWithContext],
  )

  function computeHealth(projectList: typeof projects) {
    return projectList.map((project) => {
      const pNodes = nodes.filter((n) => n.projectId === project.id)
      const completed = pNodes.filter((n) => ["completed", "auto_verified"].includes(n.status)).length
      const inProgress = pNodes.filter((n) => ["in_progress", "dispatched"].includes(n.status)).length
      const planned = pNodes.filter((n) => n.status === "planned").length
      const awaiting = pNodes.filter((n) => ["awaiting_judgment", "awaiting_approval"].includes(n.status)).length
      const pruned = pNodes.filter((n) => n.status === "pruned").length
      const velocityData = heatmapData.slice(-30).map((d) => d.tasksCompleted)

      return {
        project,
        completed,
        inProgress,
        planned,
        awaiting,
        pruned,
        total: pNodes.length,
        costUsd: projectCosts[project.id] ?? 0,
        velocityData,
      }
    })
  }

  const projectHealth = useMemo(() => computeHealth(recentProjects),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [recentProjects, nodes, heatmapData, projectCosts])

  const playgroundHealth = useMemo(() => computeHealth(recentPlaygrounds),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [recentPlaygrounds, nodes, heatmapData, projectCosts])

  const hourlyPulse = useMemo(() => {
    const now = Date.now()
    return Array.from({ length: 24 }, (_, i) => {
      const hourStart = now - (23 - i) * 3600000
      const hourEnd = hourStart + 3600000
      return activityFeed.filter((e) => {
        const t = e.timestamp.getTime()
        return t >= hourStart && t < hourEnd
      }).length
    })
  }, [activityFeed])

  const todayCost = useMemo(() => {
    if (heatmapData.length === 0) return 0
    const today = new Date().toISOString().slice(0, 10)
    return heatmapData.find((d) => d.date === today)?.totalCostUsd ?? 0
  }, [heatmapData])

  // Time-aware greeting
  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return t("greeting.morning")
    if (h < 17) return t("greeting.afternoon")
    return t("greeting.evening")
  }, [t])

  return (
    <div className="flex flex-col gap-6 p-6 md:px-10 md:py-8 max-w-[1100px] mx-auto w-full animate-stagger">

      {/* ── TIER 0: Greeting ── */}
      <div className="flex flex-col gap-0.5">
        <h1 className="text-2xl md:text-[28px] font-secondary font-light tracking-wide leading-tight">
          {greeting}{profile.name && !profile.name.includes("@") ? `, ${profile.name}` : ""}
        </h1>
      </div>

      {/* ── TIER 1: Command Strip (sticky) ── */}
      <CommandStrip
        approvalCount={pendingDecisions}
        hourlyPulse={hourlyPulse}
        todayCost={todayCost}
        connected={connected}
        onApprovalClick={() => {
          if (hasAttention) {
            attentionRef.current?.scrollIntoView({ behavior: "smooth" })
          } else {
            navigate("/tasks?status=awaiting_judgment")
          }
        }}
      />

      {/* ── TIER 1.5: Persistent Notifications ── */}
      <NotificationCards />

      {/* ── TIER 1.6: What's New ── */}
      <WhatsNewSection />

      {/* ── TIER 2: Attention cards ── */}
      <div ref={attentionRef}>
        {hasAttention ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold tracking-wide">{t("needsAttention")}</h2>
              <Button variant="ghost" size="sm" asChild className="h-6 text-[11px] text-muted-foreground/60 px-2">
                <Link to="/tasks">{t("viewAll")}</Link>
              </Button>
            </div>

            {Array.from(dynamicApprovals.values()).map((approval) => (
              <Card key={approval.requestId} className="rounded-xl border-border/60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="h-3.5 w-3.5 text-info" />
                    <span className="text-[11px] font-semibold text-info">{t("agentQuestion")}</span>
                  </div>
                  <InlineApprovalCard
                    requestId={approval.requestId}
                    question={approval.question}
                    options={approval.options}
                    answered={false}
                    onRespond={async (_requestId, answer) => {
                      await respondToDynamicApproval(approval.taskId, approval.requestId, answer)
                    }}
                  />
                </CardContent>
              </Card>
            ))}

            {pendingNodes.map((node) => {
              const project = projects.find((p) => p.id === node.projectId)
              const approval = Array.from(pendingApprovals.values()).find((a) => a.nodeId === node.id)

              if (node.status === "awaiting_approval" && approval) {
                return <ApprovalCard key={node.id} approval={approval} onRespond={respondToApproval} />
              }

              const execution = getExecution(node.id)
              const summary = execution?.summary
              const error = node.executionError || execution?.error
              const isLoadingExecution = !executionsLoaded && !execution

              return (
                <Card key={node.id} className="rounded-xl border-border/60">
                  <CardContent className="flex flex-col gap-0 p-0">
                    <div className="flex flex-col gap-2.5 p-4">
                      <div className="flex items-center justify-between">
                        <StatusBadge status="awaiting" />
                        <span className="text-[11px] text-muted-foreground/60">{project?.name}</span>
                      </div>
                      <Link to={`/project/${node.projectId}/task/${node.id}`} className="text-sm font-semibold text-foreground hover:text-primary transition-colors">
                        {node.title}
                      </Link>
                      <p className="text-xs text-muted-foreground/70 line-clamp-2">{node.content ? stripHtml(node.content) : node.description}</p>

                      {isLoadingExecution ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>{tc('loading')}</span>
                        </div>
                      ) : summary ? (
                        <div className={cn(
                          "rounded-lg border p-3",
                          summary.status === 'success' ? "border-success/20 bg-success/[0.03]" :
                          summary.status === 'partial' ? "border-warning/20 bg-warning/[0.03]" :
                          "border-error/20 bg-error/[0.03]"
                        )}>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={summary.status === 'success' ? 'success' : summary.status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                              {summary.status}
                            </Badge>
                            {summary.filesChanged.length > 0 && (
                              <span className="text-[10px] text-muted-foreground/50">
                                {summary.filesChanged.length} file{summary.filesChanged.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          {summary.keyFindings && summary.keyFindings.length > 0 ? (
                            <ul className="space-y-0.5">
                              {summary.keyFindings.map((finding, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                                  <span className="text-muted-foreground/40 mt-0.5 shrink-0">-</span>
                                  <span>{finding}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-foreground/80">{summary.workCompleted}</p>
                          )}
                          {summary.followUps.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-border/30">
                              <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide">Follow-ups</span>
                              <ul className="mt-1 space-y-0.5">
                                {summary.followUps.map((f, i) => (
                                  <li key={i} className="text-[11px] text-muted-foreground/60">- {f}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : error ? (
                        <div className="rounded-lg border border-error/20 bg-error/[0.03] p-3">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-3.5 w-3.5 text-error/70 mt-0.5 shrink-0" />
                            <p className="text-xs text-error/80 line-clamp-3">{error}</p>
                          </div>
                        </div>
                      ) : executionsLoaded && execution && (execution.status === 'pending' || execution.status === 'running') ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>{t("loadingSummary")}</span>
                        </div>
                      ) : executionsLoaded && execution ? (
                        <div className="rounded-lg border border-border/30 p-3">
                          <p className="text-[11px] text-muted-foreground/60 line-clamp-3">{node.executionOutput || execution?.streamText || execution?.summary?.workCompleted || 'No output captured.'}</p>
                        </div>
                      ) : executionsLoaded && !execution ? (
                        <div className="rounded-lg border border-warning/20 bg-warning/[0.03] p-3">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-3.5 w-3.5 text-warning/70 mt-0.5 shrink-0" />
                            <p className="text-xs text-warning/80">Execution data not found.</p>
                          </div>
                        </div>
                      ) : null}

                      {execution?.planTodos && execution.planTodos.length > 0 && (
                        <div className="rounded-lg border border-info/20 bg-info/[0.03] p-3">
                          <div className="flex items-center gap-2 mb-1.5">
                            <FileText className="h-3.5 w-3.5 text-info/70" />
                            <span className="text-[11px] font-semibold text-info">Plan Todos</span>
                          </div>
                          <ul className="space-y-1">
                            {execution.planTodos.map((todo, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs">
                                {todo.status === 'completed' ? (
                                  <Check className="h-3 w-3 text-success mt-0.5 shrink-0" />
                                ) : todo.status === 'in_progress' ? (
                                  <Loader2 className="h-3 w-3 text-info mt-0.5 shrink-0 animate-spin" />
                                ) : (
                                  <div className="h-3 w-3 mt-0.5 shrink-0 rounded-full border border-muted-foreground/30" />
                                )}
                                <span className={cn(
                                  todo.status === 'completed' ? 'text-muted-foreground/50 line-through' : 'text-foreground/80'
                                )}>{todo.content}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {execution?.planQuestions && execution.planQuestions.length > 0 && (
                        <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
                          <div className="flex items-center gap-2 mb-1.5">
                            <AlertCircle className="h-3.5 w-3.5 text-primary/70" />
                            <span className="text-[11px] font-semibold text-primary">Questions</span>
                          </div>
                          <ul className="space-y-1.5">
                            {execution.planQuestions.map((q, i) => (
                              <li key={i} className="text-xs">
                                <p className="font-medium text-foreground/80 mb-0.5">{q.question}</p>
                                <ul className="ml-3 space-y-0.5">
                                  {q.options.map((opt, j) => (
                                    <li key={j} className="text-muted-foreground/60">- {opt}</li>
                                  ))}
                                </ul>
                                {q.answer && (
                                  <p className="mt-1 text-primary font-medium">Answer: {q.answer}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {node.acceptanceCriteria && node.acceptanceCriteria.length > 0 && (
                        <div className="rounded-lg border border-border/30 p-3">
                          <div className="flex items-center gap-2 mb-1.5">
                            <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground/50" />
                            <span className="text-[11px] font-semibold">Acceptance Criteria</span>
                          </div>
                          <ul className="space-y-1">
                            {node.acceptanceCriteria.map((c) => (
                              <li key={c.id} className="flex items-start gap-2 text-xs">
                                <div className="h-3 w-3 mt-0.5 shrink-0 rounded-full border border-muted-foreground/30" />
                                <span>{c.description}</span>
                                {c.command && (
                                  <code className="text-[10px] text-muted-foreground/40 ml-auto shrink-0">{c.command}</code>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-border/30 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => updateNode(node.id, { status: "completed" })} className="h-8 text-xs">
                          <Check className="h-3 w-3 mr-1" /> {t("approve")}
                        </Button>
                        <Button variant="outline" size="sm" disabled={resettingId === node.id} onClick={async () => {
                          setResettingId(node.id)
                          try { await resetExecution(node.id) } finally { setResettingId(null) }
                        }} className="h-8 text-xs border-border/60">
                          <RotateCcw className={cn("h-3 w-3 mr-1", resettingId === node.id && "animate-spin")} />
                          {resettingId === node.id ? t("resetting") : t("reset")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => updateNode(node.id, { status: "pruned" })} className="h-8 text-xs text-muted-foreground/50">
                          <Scissors className="h-3 w-3 mr-1" /> {t("prune")}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-4 rounded-xl border border-success/15 bg-success/[0.02] px-5 py-4 backdrop-blur-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/10 shrink-0">
              <CheckCircle2 className="h-4 w-4 text-success/80" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium">{t("allCaughtUp")}</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                {activeTasks > 0
                  ? t(activeTasks !== 1 ? "tasksRunning_plural" : "tasksRunning", { count: activeTasks })
                  : t("noActiveTasks")
                }
              </p>
            </div>
            {activeTasks === 0 && projects.length > 0 && (
              <Button size="sm" variant="outline" className="h-8 text-xs border-border/60 shrink-0" onClick={() => navigate("/projects")}>
                {t("viewProjects")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── TIER 3: Machine Fleet + Running Tasks ── */}
      {(machineFleetData.length > 0 || activeTasksWithContext.length > 0) && (
        <div className="flex flex-col md:flex-row gap-6">
          {/* Machine fleet (left column) */}
          <div className="shrink-0 md:w-[120px]">
            <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground/60 uppercase mb-3">{t("fleet")}</h2>
            <MachineFleetPanel machines={machineFleetData} />
          </div>

          {/* Running tasks grouped by category */}
          <div className="flex-1 min-w-0">
            <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground/60 uppercase mb-3">{t("runningTasks")}</h2>
            <div className="rounded-xl glass-panel p-3 max-h-[min(50vh,400px)] overflow-y-auto">
              {activeTasksWithContext.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground/40 text-sm">
                  {t("allQuiet")}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {(["generation", "playground", "projects"] as TaskCategory[]).map((cat) => {
                    const tasks = tasksByCategory[cat]
                    if (tasks.length === 0) return null
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-2 mb-1.5 px-1">
                          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/50 uppercase">{categoryLabels[cat]}</span>
                          <span className="text-[10px] text-muted-foreground/30">{tasks.length}</span>
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
      )}

      {gitHubEnabled && (
        <UpcomingScheduledRuns
          projects={regularProjects}
          nodes={nodes}
          machinesById={machinesById}
        />
      )}

      {/* ── TIER 4: Project Health — Projects ── */}
      {recentProjects.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-wide">{t("projects")}</h2>
            {regularProjects.length > 6 && (
              <Button variant="ghost" size="sm" asChild className="h-6 text-[11px] text-muted-foreground/50 px-2">
                <Link to="/projects">All {regularProjects.length}</Link>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projectHealth.map(({ project, completed, inProgress, planned, awaiting, pruned, total, costUsd, velocityData }) => (
              <ProjectHealthCard
                key={project.id}
                projectId={project.id}
                name={project.name}
                icon={project.icon}
                color={project.color}
                completed={completed}
                inProgress={inProgress}
                planned={planned}
                awaiting={awaiting}
                pruned={pruned}
                total={total}
                costUsd={costUsd}
                velocityData={velocityData}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── TIER 4b: Project Health — Playground ── */}
      {recentPlaygrounds.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-wide">{t("playground")}</h2>
            {playgroundProjects.length > 3 && (
              <Button variant="ghost" size="sm" asChild className="h-6 text-[11px] text-muted-foreground/50 px-2">
                <Link to="/playground">All {playgroundProjects.length}</Link>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {playgroundHealth.map(({ project, completed, inProgress, planned, awaiting, pruned, total, costUsd, velocityData }) => (
              <ProjectHealthCard
                key={project.id}
                projectId={project.id}
                name={project.name}
                icon={project.icon}
                color={project.color}
                completed={completed}
                inProgress={inProgress}
                planned={planned}
                awaiting={awaiting}
                pruned={pruned}
                total={total}
                costUsd={costUsd}
                velocityData={velocityData}
              />
            ))}
          </div>
        </div>
      )}

      {recentProjects.length === 0 && recentPlaygrounds.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/40 p-5 text-center">
          <p className="text-xs text-muted-foreground/50 mb-2">{t("noActiveProjects")}</p>
          <Button size="sm" variant="outline" className="h-7 text-xs border-border/60" onClick={() => navigate("/plan")}>
            <Plus className="h-3 w-3" /> {t("createProject")}
          </Button>
        </div>
      )}

      {/* ── TIER 5: Activity Overview + Live Feed ── */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr,260px] gap-6">
        <div className="rounded-xl glass-panel p-5">
          <ActivityOverview data={heatmapData} hourlyData={hourlyData} />
          {stats && statsLoaded && (
            <div className="flex items-center gap-5 mt-4 pt-3.5 border-t border-border text-[11px] text-muted-foreground">
              <span><strong className="text-foreground font-semibold">{stats.currentStreak}d</strong> streak</span>
              <span><strong className="text-foreground font-semibold">{formatCompactNumber(stats.totalTasksCompleted)}</strong> tasks</span>
              <span><strong className="text-foreground font-semibold">{formatCompactNumber(stats.totalLinesAdded)}</strong> lines</span>
              {levelInfo && (
                <>
                  <div className="flex-1" />
                  <span className="font-medium text-muted-foreground">{levelInfo.title}</span>
                  <div className="w-14 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-warning transition-all duration-500"
                      style={{ width: `${Math.round(levelInfo.progress * 100)}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Live feed */}
        {activityFeed.length > 0 && (
          <div className="flex flex-col gap-1">
            <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground/60 uppercase mb-1">{t("liveFeed")}</h2>
            <div className="flex flex-col gap-0.5">
              {activityFeed.slice(0, 8).map((event) => (
                <ActivityItem key={event.id} event={event} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── TIER 6: Brag Stats ── */}
      {stats && levelInfo && statsLoaded && (
        <BragStats stats={stats} levelInfo={levelInfo} />
      )}

      {/* ── TIER 7: Achievements (collapsed) ── */}
      {statsLoaded && (
        <div className="rounded-xl glass-panel-subtle px-5 py-1.5">
          <AchievementsPanel achievements={achievements} />
        </div>
      )}
    </div>
  )
}
