import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { AlertCircle, ChevronDown, ChevronRight, ExternalLink, Github, Loader2, RefreshCw, Search, Zap, Check, X, Clock, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import { formatRelativeTime } from "@/lib/date-utils"
import { addIssueToPlan, launchPrAction, quickFixIssue } from "@/lib/github-repo-actions"
import { cn } from "@/lib/utils"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"
import { PrDiffViewer } from "./pr-diff-viewer"
import { WorkspaceConfigDialog } from "./workspace-config-dialog"
import type { GitHubRepoCacheSnapshot, Project } from "@/types"

interface RepoExplorerProps {
  project: Project
}

interface RepoCacheResponse extends GitHubRepoCacheSnapshot {
  repo: string
  linkedNodeIds: {
    issueNodeIds: Record<number, string>
    prNodeIds: Record<number, string>
  }
}

// ── CI status badge (inline, compact) ────────────────────────────────────

function CIStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === "none") return <span className="text-[10px] text-muted-foreground/50">--</span>
  const config: Record<string, { icon: React.ReactNode; class: string; label: string }> = {
    success: { icon: <Check className="h-2.5 w-2.5" />, class: "bg-success/10 text-success", label: "passing" },
    failure: { icon: <X className="h-2.5 w-2.5" />, class: "bg-destructive/10 text-destructive", label: "failing" },
    pending: { icon: <Clock className="h-2.5 w-2.5" />, class: "bg-warning/10 text-warning", label: "pending" },
  }
  const c = config[status] ?? { icon: <Minus className="h-2.5 w-2.5" />, class: "bg-muted/30 text-muted-foreground", label: status }
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide", c.class)}>
      {c.icon}
      {c.label}
    </span>
  )
}

function ReviewBadge({ decision }: { decision: string | null | undefined }) {
  if (!decision || decision === "none") return null
  const config: Record<string, { class: string; label: string }> = {
    approved:          { class: "bg-success/10 text-success", label: "approved" },
    changes_requested: { class: "bg-destructive/10 text-destructive", label: "changes requested" },
    reviewed:          { class: "bg-warning/10 text-warning", label: "reviewed" },
    pending:           { class: "bg-muted/20 text-muted-foreground", label: "needs review" },
  }
  const c = config[decision] ?? { class: "bg-muted/20 text-muted-foreground", label: decision }
  return (
    <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold", c.class)}>
      {c.label}
    </span>
  )
}

// ── PR attention level (determines left border color) ────────────────────

function getPrBorderClass(pr: { ciStatus?: string | null; reviewDecision?: string | null; mergeableState?: string | null; state: string }): string {
  if (pr.state !== "open") return "border-l-border/40"
  if (pr.ciStatus === "failure") return "border-l-destructive"
  if (pr.reviewDecision === "changes_requested") return "border-l-warning"
  if (pr.reviewDecision === "approved" && pr.ciStatus === "success") return "border-l-success"
  if (pr.ciStatus === "pending") return "border-l-warning/60"
  return "border-l-info/40"
}

function isPrMergeReady(pr: { ciStatus?: string | null; reviewDecision?: string | null; mergeableState?: string | null; state: string }): boolean {
  return pr.state === "open" && pr.ciStatus === "success" && pr.reviewDecision === "approved" && pr.mergeableState === "mergeable"
}

// ── Main component ───────────────────────────────────────────────────────

export function RepoExplorer({ project }: RepoExplorerProps) {
  const [snapshot, setSnapshot] = useState<RepoCacheResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [expandedPr, setExpandedPr] = useState<number | null>(null)
  const [workspaceConfigOpen, setWorkspaceConfigOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const executions = useExecutionStore((s) => s.executions)
  const addToast = useToastStore((s) => s.add)

  const loadSnapshot = useCallback(async (sync = false) => {
    setLoading(true)
    setError(null)

    try {
      const headers = await authHeaders()
      if (sync) {
        const syncRes = await fetch(apiUrl(`/api/github/projects/${project.id}/repo-cache/sync`), {
          method: "POST",
          headers,
        })
        if (!syncRes.ok) {
          const body = await syncRes.json().catch(() => ({ error: "Failed to sync repo cache" }))
          throw new Error(body.error || "Failed to sync repo cache")
        }
      }

      const response = await fetch(apiUrl(`/api/github/projects/${project.id}/repo-cache`), { headers })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Failed to load repo explorer" }))
        throw new Error(body.error || "Failed to load repo explorer")
      }

      setSnapshot(await response.json() as RepoCacheResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load repo explorer")
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  const normalizedQuery = query.trim().toLowerCase()
  const issues = useMemo(() => {
    const all = snapshot?.issues ?? []
    return all.filter((issue) => {
      if (!normalizedQuery) return true
      return issue.title.toLowerCase().includes(normalizedQuery)
        || String(issue.issueNumber).includes(normalizedQuery)
        || (issue.body ?? "").toLowerCase().includes(normalizedQuery)
    })
  }, [normalizedQuery, snapshot?.issues])

  const pullRequests = useMemo(() => {
    const all = snapshot?.pullRequests ?? []
    return all.filter((pr) => {
      if (!normalizedQuery) return true
      return pr.title.toLowerCase().includes(normalizedQuery)
        || String(pr.prNumber).includes(normalizedQuery)
        || (pr.body ?? "").toLowerCase().includes(normalizedQuery)
    })
  }, [normalizedQuery, snapshot?.pullRequests])

  const activeAgents = useMemo(() => {
    return nodes
      .filter((node) => node.projectId === project.id && (node.githubIssueNumber || node.prNumber))
      .filter((node) => node.status === "in_progress" || node.status === "dispatched" || executions.get(node.id)?.status === "running")
      .slice(0, 6)
  }, [executions, nodes, project.id])

  const requireWorkspace = useCallback((action: () => void) => {
    const currentProject = useProjectStore.getState().projects.find((p) => p.id === project.id)
    if (currentProject?.workingDirectory) {
      action()
    } else {
      setPendingAction(() => action)
      setWorkspaceConfigOpen(true)
    }
  }, [project.id])

  const handleIssueAction = useCallback(async (key: string, run: () => Promise<string> | string, successTitle: string) => {
    setRunningAction(key)
    try {
      const nodeId = await run()
      addToast({ type: "success", title: successTitle, description: `Created task ${nodeId.slice(0, 8)}` })
      void loadSnapshot()
    } catch (err) {
      addToast({ type: "error", title: "Action failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setRunningAction(null)
    }
  }, [addToast, loadSnapshot])

  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Loading repo explorer...
      </div>
    )
  }

  if (error && !snapshot) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-4 py-3 text-[12px] text-destructive">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  const hasWorkspace = !!project.workingDirectory

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4 md:p-6">
      {/* ── Workspace warning ──────────────────────────────────────── */}
      {!hasWorkspace && (
        <div className="flex items-center justify-between rounded-lg border border-warning/20 bg-warning/[0.04] px-4 py-2.5 text-[12px] text-warning">
          <span>No working directory configured -- browsing only. Set one to enable agent actions.</span>
          <button
            className="gh-action-btn ml-3 shrink-0 rounded-md px-3 py-1 text-[11px] font-semibold"
            onClick={() => setWorkspaceConfigOpen(true)}
          >
            Configure
          </button>
        </div>
      )}

      {/* ── Repo header ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/40 bg-card/50 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 ring-1 ring-primary/15">
              <Github className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{snapshot?.repo ?? `${project.githubOwner}/${project.githubRepo}`}</h2>
              <p className="text-[11px] text-muted-foreground">
                {snapshot?.lastSyncedAt ? `Synced ${formatRelativeTime(new Date(snapshot.lastSyncedAt))}` : "Not synced yet"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search issues and PRs" className="pl-9 text-[13px]" />
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadSnapshot(true)} disabled={loading}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
              Sync
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/20 bg-destructive/[0.04] px-3 py-2 text-[11px] text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* ── Two-column layout ──────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1.2fr,1fr]">

        {/* ── Issues column ────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col">
          <section className="flex min-h-0 flex-col rounded-xl border border-border/40 bg-card/30">
            <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-foreground">Open Issues</h3>
              <span className="tabular-nums text-[11px] text-muted-foreground">{issues.filter((issue) => issue.state === "open").length}</span>
            </div>
            <div className="min-h-0 overflow-y-auto">
              {issues.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-muted-foreground/60">No cached issues match this filter.</div>
              ) : (
                <div className="flex flex-col gap-1.5 p-2">
                  {issues.map((issue) => {
                    const linkedNodeId = snapshot?.linkedNodeIds.issueNodeIds[issue.issueNumber]
                    const actionKey = `issue-${issue.issueNumber}`
                    return (
                      <div
                        key={issue.id}
                        className={cn(
                          "gh-card rounded-lg border border-l-[3px] border-border/30 px-3.5 py-3",
                          issue.state === "open" ? "border-l-info/40" : "border-l-border/30",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <a href={issue.url} target="_blank" rel="noreferrer" className="truncate text-[13px] font-medium text-foreground hover:text-primary transition-colors">
                                #{issue.issueNumber} {issue.title}
                              </a>
                              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/30" />
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {issue.labels.slice(0, 3).map((label) => {
                                const hex = /^[0-9a-fA-F]{6}$/.test(label.color ?? '') ? label.color : undefined
                                return (
                                <span
                                  key={label.name}
                                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                  style={hex ? {
                                    background: `#${hex}18`,
                                    color: `#${hex}`,
                                    border: `1px solid #${hex}30`,
                                  } : undefined}
                                >
                                  {label.name}
                                </span>
                                )
                              })}
                              {issue.updatedAt && (
                                <span className="text-[10px] text-muted-foreground/50">{formatRelativeTime(issue.updatedAt)}</span>
                              )}
                            </div>
                          </div>
                          {linkedNodeId ? (
                            <Link
                              to={`/project/${project.id}/task/${linkedNodeId}`}
                              className="gh-action-btn shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-semibold no-underline"
                            >
                              Open Task
                            </Link>
                          ) : (
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={() => void handleIssueAction(actionKey, () => addIssueToPlan(project, issue), "Added issue to plan")}
                                disabled={runningAction === actionKey}
                              >
                                Add to Plan
                              </Button>
                              <button
                                className="gh-action-btn rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                                onClick={() => requireWorkspace(() => void handleIssueAction(actionKey, () => quickFixIssue(project, issue), "Quick fix launched"))}
                                disabled={runningAction === actionKey}
                              >
                                {runningAction === actionKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Quick Fix"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── PRs + Agents column ──────────────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-4">
          <section className="flex min-h-0 flex-col rounded-xl border border-border/40 bg-card/30">
            <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-foreground">Pull Requests</h3>
              <span className="tabular-nums text-[11px] text-muted-foreground">{pullRequests.filter((pr) => pr.state === "open").length}</span>
            </div>
            <div className="min-h-0 overflow-y-auto">
              {pullRequests.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-muted-foreground/60">No cached pull requests match this filter.</div>
              ) : (
                <div className="flex flex-col gap-1.5 p-2">
                  {pullRequests.map((pr) => {
                    const actionKey = `pr-${pr.prNumber}`
                    const isExpanded = expandedPr === pr.prNumber
                    const mergeReady = isPrMergeReady(pr)
                    return (
                      <div
                        key={pr.id}
                        className={cn(
                          "rounded-lg border border-l-[3px] border-border/30 overflow-hidden",
                          mergeReady ? "gh-card-merge" : "gh-card",
                          getPrBorderClass(pr),
                        )}
                      >
                        <div className="px-3.5 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setExpandedPr(isExpanded ? null : pr.prNumber)}
                                  className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
                                >
                                  {isExpanded
                                    ? <ChevronDown className="h-3.5 w-3.5" />
                                    : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                                <a href={pr.url} target="_blank" rel="noreferrer" className="truncate text-[13px] font-medium text-foreground hover:text-primary transition-colors">
                                  #{pr.prNumber} {pr.title}
                                </a>
                                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/30" />
                              </div>

                              {/* Status row */}
                              <div className="mt-1.5 ml-5 flex flex-wrap items-center gap-1.5">
                                <CIStatusBadge status={pr.ciStatus} />
                                <ReviewBadge decision={pr.reviewDecision} />
                                {(pr.additions > 0 || pr.deletions > 0) && (
                                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                                    <span className="text-success">+{pr.additions}</span>
                                    {" "}
                                    <span className="text-destructive">-{pr.deletions}</span>
                                    {pr.changedFiles > 0 && (
                                      <span className="ml-1 opacity-50">({pr.changedFiles})</span>
                                    )}
                                  </span>
                                )}
                                {pr.draft && (
                                  <span className="rounded-full bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">draft</span>
                                )}
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={() => requireWorkspace(() => void handleIssueAction(actionKey, () => launchPrAction(project, pr, "address_review"), "Review task launched"))}
                                disabled={runningAction === actionKey}
                              >
                                Address Review
                              </Button>
                              <button
                                className="gh-action-btn rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                                onClick={() => requireWorkspace(() => void handleIssueAction(actionKey, () => launchPrAction(project, pr, "fix_ci"), "CI fix launched"))}
                                disabled={runningAction === actionKey}
                              >
                                {runningAction === actionKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Fix CI"}
                              </button>
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-border/20 bg-background/30 px-4 py-3">
                            <PrDiffViewer projectId={project.id} prNumber={pr.prNumber} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ── Active agents ───────────────────────────────────────── */}
          <section className="rounded-xl border border-border/40 bg-card/30">
            <div className="border-b border-border/30 px-4 py-3">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-foreground">Active Agents</h3>
            </div>
            <div>
              {activeAgents.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-muted-foreground/60">No active GitHub-linked agents.</div>
              ) : (
                <div className="flex flex-col gap-1.5 p-2">
                  {activeAgents.map((node) => {
                    const execStatus = executions.get(node.id)?.status ?? node.status
                    const isRunning = execStatus === "running" || node.status === "in_progress"
                    return (
                      <Link
                        key={node.id}
                        to={`/project/${project.id}/task/${node.id}`}
                        className="gh-card flex items-center justify-between rounded-lg border border-border/30 px-3.5 py-3 text-[13px] no-underline"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full bg-info",
                              isRunning && "animate-[agent-pulse_2s_ease-in-out_infinite]",
                            )}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{node.title}</div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {node.githubIssueNumber ? `Issue #${node.githubIssueNumber}` : `PR #${node.prNumber}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-info font-medium">
                          <Zap className="h-3 w-3" />
                          {execStatus}
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <WorkspaceConfigDialog
        open={workspaceConfigOpen}
        onOpenChange={(open) => {
          setWorkspaceConfigOpen(open)
          if (!open) setPendingAction(null)
        }}
        project={project}
        onConfigured={() => {
          if (pendingAction) {
            pendingAction()
            setPendingAction(null)
          }
        }}
      />
    </div>
  )
}
