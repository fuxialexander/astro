import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { AlertCircle, ChevronDown, ChevronRight, ExternalLink, Github, Loader2, RefreshCw, Search, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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

function statusBadgeVariant(status: string): "default" | "outline" | "destructive" | "warning" | "success" {
  if (status === "failure" || status === "changes_requested" || status === "conflicting") return "destructive"
  if (status === "success" || status === "approved" || status === "mergeable") return "success"
  if (status === "pending" || status === "reviewed") return "warning"
  return "outline"
}

export function RepoExplorer({ project }: RepoExplorerProps) {
  const [snapshot, setSnapshot] = useState<RepoCacheResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [expandedPr, setExpandedPr] = useState<number | null>(null)
  const [workspaceConfigOpen, setWorkspaceConfigOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const nodes = usePlanStore((s) => s.nodes.filter(isLive))
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

  // Gate agent actions behind workspace config — if no workingDirectory, show config dialog
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
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Loading repo explorer...
      </div>
    )
  }

  if (error && !snapshot) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/[0.03] px-4 py-3 text-sm text-destructive/80">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  const hasWorkspace = !!project.workingDirectory

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4 md:p-6">
      {!hasWorkspace && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/[0.03] px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          <span>No working directory configured — browsing only. Set one to enable agent actions (Fix CI, Quick Fix).</span>
          <Button variant="outline" size="sm" className="h-6 text-[11px] shrink-0 ml-3" onClick={() => setWorkspaceConfigOpen(true)}>
            Configure
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/70 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{snapshot?.repo ?? `${project.githubOwner}/${project.githubRepo}`}</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {snapshot?.lastSyncedAt ? `Synced ${formatRelativeTime(new Date(snapshot.lastSyncedAt))}` : "Not synced yet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search issues and PRs" className="pl-9" />
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadSnapshot(true)} disabled={loading}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
              Sync
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/[0.03] px-3 py-2 text-xs text-destructive/80">
            {error}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1.2fr,1fr]">
        <div className="flex min-h-0 flex-col gap-4">
          <section className="flex min-h-0 flex-col rounded-2xl border border-border/60 bg-card/70">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <h3 className="text-sm font-semibold">Open Issues</h3>
              <span className="text-xs text-muted-foreground">{issues.filter((issue) => issue.state === "open").length}</span>
            </div>
            <div className="min-h-0 overflow-y-auto">
              {issues.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No cached issues match this filter.</div>
              ) : (
                issues.map((issue) => {
                  const linkedNodeId = snapshot?.linkedNodeIds.issueNodeIds[issue.issueNumber]
                  const actionKey = `issue-${issue.issueNumber}`
                  return (
                    <div key={issue.id} className="border-b border-border/40 px-4 py-3 last:border-b-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <a href={issue.url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:text-primary">
                              #{issue.issueNumber} {issue.title}
                            </a>
                            <ExternalLink className="h-3 w-3 text-muted-foreground/40" />
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <Badge variant="outline" className="text-[10px]">{issue.state}</Badge>
                            {issue.labels.slice(0, 3).map((label) => (
                              <Badge key={label.name} variant="outline" className="text-[10px]">{label.name}</Badge>
                            ))}
                            {issue.updatedAt && <span>Updated {formatRelativeTime(issue.updatedAt)}</span>}
                          </div>
                        </div>
                        {linkedNodeId ? (
                          <Button asChild variant="outline" size="sm" className="shrink-0">
                            <Link to={`/project/${project.id}/task/${linkedNodeId}`}>Open Task</Link>
                          </Button>
                        ) : (
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleIssueAction(actionKey, () => addIssueToPlan(project, issue), "Added issue to plan")}
                              disabled={runningAction === actionKey}
                            >
                              Add to Plan
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => requireWorkspace(() => void handleIssueAction(actionKey, () => quickFixIssue(project, issue), "Quick fix launched"))}
                              disabled={runningAction === actionKey}
                            >
                              {runningAction === actionKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Quick Fix"}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <section className="flex min-h-0 flex-col rounded-2xl border border-border/60 bg-card/70">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <h3 className="text-sm font-semibold">Pull Requests</h3>
              <span className="text-xs text-muted-foreground">{pullRequests.filter((pr) => pr.state === "open").length}</span>
            </div>
            <div className="min-h-0 overflow-y-auto">
              {pullRequests.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No cached pull requests match this filter.</div>
              ) : (
                pullRequests.map((pr) => {
                  const actionKey = `pr-${pr.prNumber}`
                  const isExpanded = expandedPr === pr.prNumber
                  return (
                    <div key={pr.id} className="border-b border-border/40 last:border-b-0">
                      <div className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpandedPr(isExpanded ? null : pr.prNumber)}
                                className="shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
                              >
                                {isExpanded
                                  ? <ChevronDown className="h-3.5 w-3.5" />
                                  : <ChevronRight className="h-3.5 w-3.5" />}
                              </button>
                              <a href={pr.url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:text-primary">
                                PR #{pr.prNumber} {pr.title}
                              </a>
                              <ExternalLink className="h-3 w-3 text-muted-foreground/40" />
                              {(pr.additions > 0 || pr.deletions > 0) && (
                                <span className="shrink-0 text-[10px] font-mono text-muted-foreground">
                                  <span className="text-emerald-500">+{pr.additions}</span>
                                  {" "}
                                  <span className="text-red-500">-{pr.deletions}</span>
                                  {pr.changedFiles > 0 && (
                                    <span className="ml-1 text-muted-foreground/60">({pr.changedFiles} files)</span>
                                  )}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground ml-5">
                              <Badge variant="outline" className="text-[10px]">{pr.state}</Badge>
                              <Badge variant={statusBadgeVariant(pr.ciStatus ?? "pending")} className="text-[10px]">CI {pr.ciStatus ?? "none"}</Badge>
                              <Badge variant={statusBadgeVariant(pr.reviewDecision ?? "pending")} className="text-[10px]">Review {pr.reviewDecision ?? "none"}</Badge>
                              {pr.mergeableState && <Badge variant={statusBadgeVariant(pr.mergeableState)} className="text-[10px]">{pr.mergeableState}</Badge>}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => requireWorkspace(() => void handleIssueAction(actionKey, () => launchPrAction(project, pr, "address_review"), "Review task launched"))}
                              disabled={runningAction === actionKey}
                            >
                              Address Review
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => requireWorkspace(() => void handleIssueAction(actionKey, () => launchPrAction(project, pr, "fix_ci"), "CI fix launched"))}
                              disabled={runningAction === actionKey}
                            >
                              {runningAction === actionKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Fix CI"}
                            </Button>
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-border/30 bg-muted/10 px-4 py-3">
                          <PrDiffViewer projectId={project.id} prNumber={pr.prNumber} />
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card/70">
            <div className="border-b border-border/60 px-4 py-3">
              <h3 className="text-sm font-semibold">Active Agents</h3>
            </div>
            <div>
              {activeAgents.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No active GitHub-linked agents in this project.</div>
              ) : (
                activeAgents.map((node) => (
                  <Link key={node.id} to={`/project/${project.id}/task/${node.id}`} className="flex items-center justify-between border-b border-border/40 px-4 py-3 text-sm last:border-b-0 hover:bg-muted/30">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{node.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{node.githubIssueNumber ? `Issue #${node.githubIssueNumber}` : `PR #${node.prNumber}`}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-info">
                      <Zap className="h-3.5 w-3.5" />
                      {executions.get(node.id)?.status ?? node.status}
                    </div>
                  </Link>
                ))
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
