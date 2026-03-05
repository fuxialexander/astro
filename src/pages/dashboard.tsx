import { useEffect, useMemo, useState } from "react"
import { stripHtml } from "@/lib/html-utils"
import { Link, useNavigate } from "react-router"
import {
  Plus,
  Eye,
  Activity,
  CircleCheck,
  Check,
  FileText,
  Monitor,
  CheckCircle2,
  XCircle,
  Folder,
  Zap,
  AlertCircle,
  RotateCcw,
  Scissors,
  Loader2,
  ClipboardCheck,
  Sparkles,
  Globe,
  ArrowRight,
  LayoutTemplate,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useRealtimeStore, type ActivityEvent } from "@/stores/realtime-store"
import { useUsageStore } from "@/stores/usage-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useTemplateStore } from "@/stores/template-store"
import { useStatsStore } from "@/stores/stats-store"
import type { UseCaseTemplateSummary } from "@astro/core/templates"
import { ApprovalCard } from "@/components/approval-card"
import { InlineApprovalCard } from "@/components/plan-session/inline-approval-card"
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap"
import { BragStats } from "@/components/dashboard/brag-stats"
import { AchievementsPanel } from "@/components/dashboard/achievements-panel"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/date-utils"

const activityIcons: Record<string, { icon: typeof Activity; bg: string; color: string }> = {
  success: { icon: CheckCircle2, bg: "bg-success/10", color: "text-success" },
  failure: { icon: XCircle, bg: "bg-error/10", color: "text-error" },
  progress: { icon: Activity, bg: "bg-info/10", color: "text-info" },
  machine: { icon: Monitor, bg: "bg-primary/10", color: "text-primary" },
  file_change: { icon: FileText, bg: "bg-warning/10", color: "text-warning" },
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  const config = activityIcons[event.type] || activityIcons.progress
  const Icon = config.icon

  return (
    <div className="flex items-center gap-3 py-2">
      <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", config.bg)}>
        <Icon className={cn("h-3.5 w-3.5", config.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate">{event.text}</p>
      </div>
      <span className="text-[11px] text-muted-foreground shrink-0">{formatRelativeTime(event.timestamp)}</span>
    </div>
  )
}

export function Dashboard() {
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const machines = useRealtimeStore((s) => s.machines)
  const activityFeed = useRealtimeStore((s) => s.activityFeed)
  const connected = useRealtimeStore((s) => s.connected)
  const sessionMetrics = useUsageStore((s) => s.sessionMetrics)
  const profile = useUserProfileStore((s) => s.profile)
  const pendingApprovals = useExecutionStore((s) => s.pendingApprovals)
  const respondToApproval = useExecutionStore((s) => s.respondToApproval)
  const getExecution = useExecutionStore((s) => s.getExecution)
  const executionsLoaded = useExecutionStore((s) => s.loaded)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const [resettingId, setResettingId] = useState<string | null>(null)
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const templates = useTemplateStore((s) => s.templates)
  const templateStoreLoaded = useTemplateStore((s) => s.loaded)
  const heatmapData = useStatsStore((s) => s.heatmapData)
  const stats = useStatsStore((s) => s.stats)
  const achievements = useStatsStore((s) => s.achievements)
  const levelInfo = useStatsStore((s) => s.levelInfo)
  const statsLoaded = useStatsStore((s) => s.statsLoaded)
  const loadAll = useStatsStore((s) => s.loadAll)
  const navigate = useNavigate()

  // Load stats on mount
  useEffect(() => {
    loadAll()
  }, [loadAll])


  const activeTasks = nodes.filter(
    (n) => n.status === "in_progress" || n.status === "dispatched"
  ).length
  const completedToday = nodes.filter(
    (n) => n.status === "completed" || n.status === "auto_verified"
  ).length
  const pendingDecisions = nodes.filter(
    (n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval"
  ).length + dynamicApprovals.size

  const pendingNodes = nodes.filter((n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval")
  const activeProjects = projects.filter((p) => p.status === "active")
  const showGetStarted = projects.length <= 2

  // Featured templates for Get Started section
  const featuredTemplates = useMemo(() => {
    if (!templateStoreLoaded || !showGetStarted) return []
    const stable = templates.filter(
      (t) => t.maturity === 'stable' && t.source === 'builtin'
    )
    // Pick diverse categories
    const seen = new Set<string>()
    const diverse: UseCaseTemplateSummary[] = []
    for (const t of stable) {
      if (!seen.has(t.category)) {
        seen.add(t.category)
        diverse.push(t)
      }
    }
    return diverse.slice(0, 5)
  }, [templates, templateStoreLoaded, showGetStarted])

  return (
    <div className="flex flex-col gap-4 p-4 md:gap-6 md:p-8">
      {/* Header Row */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-primary font-semibold">
            Good morning{profile.name && !profile.name.includes("@") ? `, ${profile.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            You have {pendingDecisions} pending decision{pendingDecisions !== 1 ? "s" : ""} and{" "}
            {activeTasks} active task{activeTasks !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <Button asChild className="min-h-11">
            <Link to="/projects">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
          <Button variant="outline" asChild className="min-h-11">
            <Link to="/settings">Settings</Link>
          </Button>
        </div>
      </div>

      {/* Stats Row - 3 compact widgets */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        {/* Needs Attention */}
        <Card className="w-full rounded-2xl shadow cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=awaiting_judgment")}>
          <CardContent className="flex items-center gap-2 p-2.5 md:justify-between md:p-6">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning shrink-0 md:order-2 md:h-12 md:w-12 md:rounded-xl">
              <Eye className="h-4 w-4 text-warning-foreground md:h-6 md:w-6" />
            </div>
            <div className="flex flex-col min-w-0">
              <p className="text-[11px] text-muted-foreground truncate md:text-sm">Attention</p>
              <p className="text-lg font-bold md:text-[32px]">{pendingDecisions}</p>
            </div>
          </CardContent>
        </Card>

        {/* Active Tasks */}
        <Card className="w-full rounded-2xl shadow cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=in_progress")}>
          <CardContent className="flex items-center gap-2 p-2.5 md:justify-between md:p-6">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info shrink-0 md:order-2 md:h-12 md:w-12 md:rounded-xl">
              <Activity className="h-4 w-4 text-info-foreground md:h-6 md:w-6" />
            </div>
            <div className="flex flex-col min-w-0">
              <p className="text-[11px] text-muted-foreground truncate md:text-sm">Active</p>
              <p className="text-lg font-bold md:text-[32px]">{activeTasks}</p>
            </div>
          </CardContent>
        </Card>

        {/* Completed Today */}
        <Card className="w-full rounded-2xl shadow cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=completed")}>
          <CardContent className="flex items-center gap-2 p-2.5 md:justify-between md:p-6">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success shrink-0 md:order-2 md:h-12 md:w-12 md:rounded-xl">
              <CircleCheck className="h-4 w-4 text-success-foreground md:h-6 md:w-6" />
            </div>
            <div className="flex flex-col min-w-0">
              <p className="text-[11px] text-muted-foreground truncate md:text-sm">Done</p>
              <p className="text-lg font-bold md:text-[32px]">{completedToday}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity Heatmap */}
      <Card className="rounded-2xl shadow">
        <CardContent className="p-4 md:p-5">
          <ActivityHeatmap data={heatmapData} />
        </CardContent>
      </Card>

      {/* Brag Stats + Level */}
      {stats && statsLoaded && (
        <BragStats stats={stats} levelInfo={levelInfo} />
      )}

      {/* Get Started Section — shown for new users with 0-2 projects */}
      {showGetStarted && (
        <Card className="rounded-2xl shadow border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="p-5 md:p-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="text-base font-semibold">Get Started with Astro</h2>
              </div>

              {featuredTemplates.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {featuredTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => navigate('/plan', { state: { initialTemplateId: t.id } })}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer text-xs"
                    >
                      {t.icon ? (
                        <span className="text-sm">{t.icon}</span>
                      ) : (
                        <LayoutTemplate className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span className="font-medium">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <Button size="sm" asChild className="min-h-9">
                  <Link to="/plan">
                    <Sparkles className="h-3.5 w-3.5" />
                    Start Planning
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button variant="outline" size="sm" asChild className="min-h-9">
                  <Link to="/community">
                    <Globe className="h-3.5 w-3.5" />
                    Browse Community Plans
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content Columns */}
      <div className="flex flex-col gap-4 md:flex-row md:gap-6 flex-1">
        {/* Left Column: My Attention */}
        <div className="flex flex-1 flex-col gap-3 md:gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold md:text-lg">My Attention</h2>
            <Button variant="outline" size="sm" asChild className="min-h-9">
              <Link to="/tasks">View All</Link>
            </Button>
          </div>
          <div className="flex flex-col gap-3">
            {/* Dynamic approvals from running agents (AskUserQuestion) */}
            {Array.from(dynamicApprovals.values()).map((approval) => (
              <Card key={approval.requestId} className="rounded-2xl shadow-lg">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="h-4 w-4 text-info" />
                    <span className="text-xs font-semibold text-info">Agent Question</span>
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

            {pendingNodes.length > 0 || dynamicApprovals.size > 0 ? (
              pendingNodes.map((node) => {
                const project = projects.find((p) => p.id === node.projectId)
                // Check if this node has a pending approval request
                const approval = Array.from(pendingApprovals.values()).find(
                  (a) => a.nodeId === node.id
                )

                // If awaiting approval, show ApprovalCard
                if (node.status === "awaiting_approval" && approval) {
                  return (
                    <ApprovalCard
                      key={node.id}
                      approval={approval}
                      onRespond={respondToApproval}
                    />
                  )
                }

                // Otherwise, show judgment card
                const execution = getExecution(node.id)
                const summary = execution?.summary
                const error = node.executionError || execution?.error

                // Check if we're still loading executions data
                const isLoadingExecution = !executionsLoaded && !execution

                return (
                  <Card key={node.id} className="rounded-2xl shadow-lg">
                    <CardContent className="flex flex-col gap-0 p-0">
                      {/* Card Header */}
                      <div className="flex flex-col gap-3 p-5">
                        <div className="flex items-center justify-between">
                          <StatusBadge status="awaiting" />
                          <span className="text-xs text-muted-foreground">
                            {project?.name}
                          </span>
                        </div>
                        <Link to={`/project/${node.projectId}/task/${node.id}`} className="text-base font-semibold text-foreground hover:underline">
                          {node.title}
                        </Link>
                        <p className="text-sm text-muted-foreground line-clamp-2">{node.content ? stripHtml(node.content) : node.description}</p>

                        {/* Summary or Error or Loading */}
                        {isLoadingExecution ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Loading execution data...</span>
                          </div>
                        ) : summary ? (
                          <div className={cn(
                            "rounded-lg border p-3.5",
                            summary.status === 'success' ? "border-success/30 bg-success/5" :
                            summary.status === 'partial' ? "border-warning/30 bg-warning/5" :
                            "border-error/30 bg-error/5"
                          )}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <Badge variant={summary.status === 'success' ? 'success' : summary.status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                                {summary.status}
                              </Badge>
                              {summary.filesChanged.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {summary.filesChanged.length} file{summary.filesChanged.length !== 1 ? 's' : ''} changed
                                </span>
                              )}
                            </div>
                            {summary.keyFindings && summary.keyFindings.length > 0 ? (
                              <ul className="space-y-1">
                                {summary.keyFindings.map((finding, i) => (
                                  <li key={i} className="flex items-start gap-1.5 text-sm text-foreground">
                                    <span className="text-muted-foreground mt-0.5 shrink-0">•</span>
                                    <span>{finding}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-foreground">{summary.workCompleted}</p>
                            )}
                            {summary.followUps.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-border/50">
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Follow-ups</span>
                                <ul className="mt-1 space-y-0.5">
                                  {summary.followUps.map((f, i) => (
                                    <li key={i} className="text-xs text-muted-foreground">• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ) : error ? (
                          <div className="rounded-lg border border-error/30 bg-error/5 p-3.5">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 text-error mt-0.5 shrink-0" />
                              <p className="text-sm text-error line-clamp-3">{error}</p>
                            </div>
                          </div>
                        ) : executionsLoaded && execution && (execution.status === 'pending' || execution.status === 'running') ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Generating summary...</span>
                          </div>
                        ) : executionsLoaded && execution ? (
                          <div className="rounded-lg border p-3.5">
                            <p className="text-xs text-muted-foreground line-clamp-4">{node.executionOutput || execution.streamText || 'No output captured.'}</p>
                          </div>
                        ) : executionsLoaded && !execution ? (
                          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3.5">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                              <p className="text-sm text-warning">Execution data not found. The task may have completed before execution tracking was enabled.</p>
                            </div>
                          </div>
                        ) : null}

                        {/* Plan Mode Data: Todos */}
                        {execution?.planTodos && execution.planTodos.length > 0 && (
                          <div className="rounded-lg border border-info/30 bg-info/5 p-3.5">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="h-4 w-4 text-info" />
                              <span className="text-xs font-semibold text-info">Plan Todos</span>
                            </div>
                            <ul className="space-y-1.5">
                              {execution.planTodos.map((todo, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs">
                                  {todo.status === 'completed' ? (
                                    <Check className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                                  ) : todo.status === 'in_progress' ? (
                                    <Loader2 className="h-3.5 w-3.5 text-info mt-0.5 shrink-0 animate-spin" />
                                  ) : (
                                    <div className="h-3.5 w-3.5 mt-0.5 shrink-0 rounded-full border border-muted-foreground" />
                                  )}
                                  <span className={cn(
                                    todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'
                                  )}>{todo.content}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Plan Mode Data: Questions */}
                        {execution?.planQuestions && execution.planQuestions.length > 0 && (
                          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5">
                            <div className="flex items-center gap-2 mb-2">
                              <AlertCircle className="h-4 w-4 text-primary" />
                              <span className="text-xs font-semibold text-primary">Plan Questions</span>
                            </div>
                            <ul className="space-y-2">
                              {execution.planQuestions.map((q, i) => (
                                <li key={i} className="text-xs">
                                  <p className="font-medium text-foreground mb-1">{q.question}</p>
                                  <ul className="ml-3 space-y-0.5">
                                    {q.options.map((opt, j) => (
                                      <li key={j} className="text-muted-foreground">• {opt}</li>
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

                        {/* Acceptance Criteria Checklist */}
                        {node.acceptanceCriteria && node.acceptanceCriteria.length > 0 && (
                          <div className="rounded-lg border p-3.5">
                            <div className="flex items-center gap-2 mb-2">
                              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                              <span className="text-xs font-semibold">Acceptance Criteria</span>
                            </div>
                            <ul className="space-y-1.5">
                              {node.acceptanceCriteria.map((c) => (
                                <li key={c.id} className="flex items-start gap-2 text-xs">
                                  <div className="h-3.5 w-3.5 mt-0.5 shrink-0 rounded-full border" />
                                  <span>{c.description}</span>
                                  {c.command && (
                                    <code className="text-[10px] text-muted-foreground ml-auto shrink-0">{c.command}</code>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Card Actions */}
                      <div className="border-t px-4 py-3 md:px-5 md:py-4">
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => updateNode(node.id, { status: "completed" })} className="min-h-9">
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Approve
                          </Button>
                          <Button variant="outline" size="sm" disabled={resettingId === node.id} onClick={async () => {
                            setResettingId(node.id)
                            try { await resetExecution(node.id) } finally { setResettingId(null) }
                          }} className="min-h-9">
                            <RotateCcw className={cn("h-3.5 w-3.5 mr-1", resettingId === node.id && "animate-spin")} />
                            {resettingId === node.id ? "Resetting..." : "Reset"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => updateNode(node.id, { status: "pruned" })} className="min-h-9 text-muted-foreground">
                            <Scissors className="h-3.5 w-3.5 mr-1" />
                            Prune
                          </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1.5">Pruning also prunes all downstream tasks that depend on this one.</p>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            ) : (
              <Card className="rounded-2xl">
                <CardContent className="p-0">
                  <EmptyState
                    icon={CheckCircle2}
                    title="All caught up!"
                    description={activeTasks > 0
                      ? `Your agents are working on ${activeTasks} task${activeTasks !== 1 ? 's' : ''}. You'll be notified when decisions need your input.`
                      : "No active tasks running. Start executing your plan to see progress here."
                    }
                    action={activeTasks === 0 && projects.length > 0 ? {
                      label: "View Projects",
                      onClick: () => navigate("/projects"),
                    } : undefined}
                    variant="success"
                    className="py-6"
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="flex w-full shrink-0 flex-col gap-4 md:w-[400px] md:gap-6">
          {/* Active Projects */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold md:text-lg">Active Projects</h2>
              <Button variant="outline" size="sm" asChild className="min-h-9">
                <Link to="/projects?status=active">View All</Link>
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {activeProjects.length > 0 ? (
                activeProjects.slice(0, 4).map((project) => {
                  const projectTasks = nodes.filter(
                    (n) =>
                      n.projectId === project.id &&
                      (n.status === "in_progress" || n.status === "dispatched")
                  )
                  return (
                    <Link key={project.id} to={`/project/${project.id}/graph`}>
                      <Card className="rounded-2xl hover:border-primary/40 transition-colors">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="flex flex-col gap-0.5">
                            <p className="text-sm font-semibold text-foreground">{project.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {projectTasks.length} task{projectTasks.length !== 1 ? "s" : ""} in
                              progress
                            </p>
                          </div>
                          <Badge variant="success">Active</Badge>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })
              ) : (
                <Card className="rounded-2xl">
                  <CardContent className="p-0">
                    <EmptyState
                      icon={Folder}
                      title="No active projects"
                      description="Create a project to get started with AI-assisted planning and execution."
                      action={{
                        label: "Create Project",
                        onClick: () => navigate("/projects"),
                      }}
                      className="py-6"
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* System Health */}
          <Card className="flex-1 rounded-2xl shadow">
            <CardContent className="flex flex-col p-0">
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-base font-semibold text-foreground">System Health</h2>
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      connected ? "bg-success" : "bg-muted-foreground"
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      connected ? "text-success" : "text-muted-foreground"
                    )}
                  >
                    {connected ? "Live" : "Offline"}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="flex flex-col gap-4 p-5">
                {/* Metrics Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Token Spend</p>
                    <p className="text-lg font-semibold">${sessionMetrics.totalCostUsd.toFixed(2)}</p>
                    <p className="text-[11px] text-muted-foreground">session</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Throughput</p>
                    <p className="text-lg font-semibold">{sessionMetrics.tasksCompleted}/{sessionMetrics.tasksCompleted + sessionMetrics.tasksFailed}</p>
                    <p className="text-[11px] text-muted-foreground">tasks</p>
                  </div>
                </div>

                {/* Active Agents */}
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Active Agents
                  </p>
                  {machines.size > 0 ? (
                    Array.from(machines.values()).map((machine) => (
                      <div key={machine.machineId} className="flex items-center gap-2 py-1">
                        <div
                          className={cn(
                            "h-2 w-2 rounded-full",
                            machine.connectionStatus === "connected"
                              ? "bg-success"
                              : "bg-muted-foreground"
                          )}
                        />
                        <span className="text-sm flex-1 truncate">
                          {machine.name || machine.machineId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {machine.load.activeTasks > 0
                            ? `${machine.load.activeTasks} task${machine.load.activeTasks !== 1 ? "s" : ""}`
                            : "Idle"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground py-1">
                      No machines connected. Add one in Environments.
                    </p>
                  )}
                </div>

                {/* Recent Events */}
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Recent Events
                  </p>
                  {activityFeed.length > 0 ? (
                    activityFeed.slice(0, 5).map((event) => (
                      <ActivityItem key={event.id} event={event} />
                    ))
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-4 text-center">
                      <Zap className="h-5 w-5 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">
                        {connected
                          ? "No agents running. Start executing your plan to see activity."
                          : "Connect to see real-time agent activity."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Achievements Panel */}
      {statsLoaded && (
        <Card className="rounded-2xl shadow">
          <CardContent className="px-4 py-2 md:px-5">
            <AchievementsPanel achievements={achievements} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
