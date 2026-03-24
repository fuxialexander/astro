import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { AlertCircle, ChevronDown, ChevronRight, ExternalLink, Github, Loader2, RefreshCw, Search, Check, X, Clock, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import { formatRelativeTime } from "@/lib/date-utils"
import { addIssueToPlan, launchPrAction, quickFixIssue } from "@/lib/github-repo-actions"
import { cn, getShortId } from "@/lib/utils"
import { useProjectStore } from "@/stores/project-store"
import { useToastStore } from "@/stores/toast-store"
import { filterIssues, filterPullRequests, getUniqueFilterValues, type IssueStateFilter, type PrCiFilter, type PrReviewFilter, type PrStateFilter } from "./filter-utils"
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

const ALL_FILTER_VALUE = "__all__"

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
  const [issueStateFilter, setIssueStateFilter] = useState<IssueStateFilter>("open")
  const [issueLabelFilter, setIssueLabelFilter] = useState(ALL_FILTER_VALUE)
  const [issueAuthorFilter, setIssueAuthorFilter] = useState(ALL_FILTER_VALUE)
  const [issueAssigneeFilter, setIssueAssigneeFilter] = useState(ALL_FILTER_VALUE)
  const [prStateFilter, setPrStateFilter] = useState<PrStateFilter>("open")
  const [prReviewFilter, setPrReviewFilter] = useState<PrReviewFilter>("all")
  const [prCiFilter, setPrCiFilter] = useState<PrCiFilter>("all")
  const [prLabelFilter, setPrLabelFilter] = useState(ALL_FILTER_VALUE)
  const [prAuthorFilter, setPrAuthorFilter] = useState(ALL_FILTER_VALUE)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [expandedPr, setExpandedPr] = useState<number | null>(null)
  const [workspaceConfigOpen, setWorkspaceConfigOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [activeTab, setActiveTab] = useState<"issues" | "prs">("issues")
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
  const issueLabelOptions = useMemo(
    () => getUniqueFilterValues((snapshot?.issues ?? []).flatMap((issue) => issue.labels.map((label) => label.name))),
    [snapshot?.issues],
  )
  const issueAuthorOptions = useMemo(
    () => getUniqueFilterValues((snapshot?.issues ?? []).map((issue) => issue.authorLogin)),
    [snapshot?.issues],
  )
  const issueAssigneeOptions = useMemo(
    () => getUniqueFilterValues((snapshot?.issues ?? []).flatMap((issue) => issue.assignees.map((assignee) => assignee.login))),
    [snapshot?.issues],
  )
  const prLabelOptions = useMemo(
    () => getUniqueFilterValues((snapshot?.pullRequests ?? []).flatMap((pr) => pr.labels.map((label) => label.name))),
    [snapshot?.pullRequests],
  )
  const prAuthorOptions = useMemo(
    () => getUniqueFilterValues((snapshot?.pullRequests ?? []).map((pr) => pr.authorLogin)),
    [snapshot?.pullRequests],
  )
  const issues = useMemo(() => {
    return filterIssues(snapshot?.issues ?? [], {
      query: normalizedQuery,
      state: issueStateFilter,
      label: issueLabelFilter === ALL_FILTER_VALUE ? null : issueLabelFilter,
      author: issueAuthorFilter === ALL_FILTER_VALUE ? null : issueAuthorFilter,
      assignee: issueAssigneeFilter === ALL_FILTER_VALUE ? null : issueAssigneeFilter,
    })
  }, [issueAssigneeFilter, issueAuthorFilter, issueLabelFilter, issueStateFilter, normalizedQuery, snapshot?.issues])

  const pullRequests = useMemo(() => {
    return filterPullRequests(snapshot?.pullRequests ?? [], {
      query: normalizedQuery,
      state: prStateFilter,
      label: prLabelFilter === ALL_FILTER_VALUE ? null : prLabelFilter,
      author: prAuthorFilter === ALL_FILTER_VALUE ? null : prAuthorFilter,
      review: prReviewFilter,
      ci: prCiFilter,
    })
  }, [normalizedQuery, prAuthorFilter, prCiFilter, prLabelFilter, prReviewFilter, prStateFilter, snapshot?.pullRequests])

  const hasCustomIssueFilters = issueStateFilter !== "open"
    || issueLabelFilter !== ALL_FILTER_VALUE
    || issueAuthorFilter !== ALL_FILTER_VALUE
    || issueAssigneeFilter !== ALL_FILTER_VALUE

  const hasCustomPrFilters = prStateFilter !== "open"
    || prReviewFilter !== "all"
    || prCiFilter !== "all"
    || prLabelFilter !== ALL_FILTER_VALUE
    || prAuthorFilter !== ALL_FILTER_VALUE

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
      addToast({ type: "success", title: successTitle, description: `Created task ${getShortId(nodeId)}` })
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
  const panelClass = "rounded-2xl border border-border bg-card shadow-[0_2px_12px_-2px_rgba(0,0,0,0.12)]"

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
      <div className={cn("flex flex-col gap-3 p-4", panelClass)}>
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

      {/* ── Tab switcher ───────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-muted/20 p-1 w-fit">
        <button
          className={cn(
            "rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-colors",
            activeTab === "issues"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setActiveTab("issues")}
        >
          Issues
          <span className={cn("ml-1.5 tabular-nums text-[11px]", activeTab === "issues" ? "text-muted-foreground" : "text-muted-foreground/50")}>
            {issues.length}
          </span>
        </button>
        <button
          className={cn(
            "rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-colors",
            activeTab === "prs"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setActiveTab("prs")}
        >
          Pull Requests
          <span className={cn("ml-1.5 tabular-nums text-[11px]", activeTab === "prs" ? "text-muted-foreground" : "text-muted-foreground/50")}>
            {pullRequests.length}
          </span>
        </button>
      </div>

      {/* ── Full-width content panel ────────────────────────────────── */}
      <section className={cn("flex min-h-0 flex-1 flex-col", panelClass)}>

        {/* Issues tab */}
        {activeTab === "issues" && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/30 px-4 py-3">
              <Select value={issueStateFilter} onValueChange={(value) => setIssueStateFilter(value as IssueStateFilter)}>
                <SelectTrigger className="h-8 w-[120px] text-[11px]">
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="all">All states</SelectItem>
                </SelectContent>
              </Select>
              <Select value={issueLabelFilter} onValueChange={setIssueLabelFilter}>
                <SelectTrigger className="h-8 w-[150px] text-[11px]">
                  <SelectValue placeholder="Label" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All labels</SelectItem>
                  {issueLabelOptions.map((label) => (
                    <SelectItem key={label} value={label}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={issueAuthorFilter} onValueChange={setIssueAuthorFilter}>
                <SelectTrigger className="h-8 w-[150px] text-[11px]">
                  <SelectValue placeholder="Author" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All authors</SelectItem>
                  {issueAuthorOptions.map((author) => (
                    <SelectItem key={author} value={author}>{author}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={issueAssigneeFilter} onValueChange={setIssueAssigneeFilter}>
                <SelectTrigger className="h-8 w-[150px] text-[11px]">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All assignees</SelectItem>
                  {issueAssigneeOptions.map((assignee) => (
                    <SelectItem key={assignee} value={assignee}>{assignee}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasCustomIssueFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-[11px]"
                  onClick={() => {
                    setIssueStateFilter("open")
                    setIssueLabelFilter(ALL_FILTER_VALUE)
                    setIssueAuthorFilter(ALL_FILTER_VALUE)
                    setIssueAssigneeFilter(ALL_FILTER_VALUE)
                  }}
                >
                  Reset
                </Button>
              )}
            </div>
            <div className="overflow-y-auto">
              {issues.length === 0 ? (
                <div className="px-4 py-12 text-center text-[12px] text-muted-foreground/60">No cached issues match the current filters.</div>
              ) : (
                <div className="flex flex-col gap-1.5 p-3">
                  {issues.map((issue) => {
                    const linkedNodeId = snapshot?.linkedNodeIds.issueNodeIds[issue.issueNumber]
                    const actionKey = `issue-${issue.issueNumber}`
                    const issueActionsDisabled = issue.state !== "open"
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
                              {issue.state !== "open" && (
                                <span className="rounded-full bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {issue.state}
                                </span>
                              )}
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
                                disabled={runningAction === actionKey || issueActionsDisabled}
                              >
                                Add to Plan
                              </Button>
                              <button
                                className="gh-action-btn rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                                onClick={() => requireWorkspace(() => void handleIssueAction(actionKey, () => quickFixIssue(project, issue), "Quick fix launched"))}
                                disabled={runningAction === actionKey || issueActionsDisabled}
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
          </>
        )}

        {/* Pull Requests tab */}
        {activeTab === "prs" && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/30 px-4 py-3">
              <Select value={prStateFilter} onValueChange={(value) => setPrStateFilter(value as PrStateFilter)}>
                <SelectTrigger className="h-8 w-[130px] text-[11px]">
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="merged">Merged</SelectItem>
                  <SelectItem value="all">All states</SelectItem>
                </SelectContent>
              </Select>
              <Select value={prReviewFilter} onValueChange={(value) => setPrReviewFilter(value as PrReviewFilter)}>
                <SelectTrigger className="h-8 w-[150px] text-[11px]">
                  <SelectValue placeholder="Review" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reviews</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="changes_requested">Changes requested</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="pending">Needs review</SelectItem>
                  <SelectItem value="none">No review state</SelectItem>
                </SelectContent>
              </Select>
              <Select value={prCiFilter} onValueChange={(value) => setPrCiFilter(value as PrCiFilter)}>
                <SelectTrigger className="h-8 w-[130px] text-[11px]">
                  <SelectValue placeholder="CI" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All CI</SelectItem>
                  <SelectItem value="success">Passing</SelectItem>
                  <SelectItem value="failure">Failing</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="none">No checks</SelectItem>
                </SelectContent>
              </Select>
              <Select value={prLabelFilter} onValueChange={setPrLabelFilter}>
                <SelectTrigger className="h-8 w-[150px] text-[11px]">
                  <SelectValue placeholder="Label" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All labels</SelectItem>
                  {prLabelOptions.map((label) => (
                    <SelectItem key={label} value={label}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={prAuthorFilter} onValueChange={setPrAuthorFilter}>
                <SelectTrigger className="h-8 w-[150px] text-[11px]">
                  <SelectValue placeholder="Author" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All authors</SelectItem>
                  {prAuthorOptions.map((author) => (
                    <SelectItem key={author} value={author}>{author}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasCustomPrFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-[11px]"
                  onClick={() => {
                    setPrStateFilter("open")
                    setPrReviewFilter("all")
                    setPrCiFilter("all")
                    setPrLabelFilter(ALL_FILTER_VALUE)
                    setPrAuthorFilter(ALL_FILTER_VALUE)
                  }}
                >
                  Reset
                </Button>
              )}
            </div>
            <div className="overflow-y-auto">
              {pullRequests.length === 0 ? (
                <div className="px-4 py-12 text-center text-[12px] text-muted-foreground/60">No cached pull requests match the current filters.</div>
              ) : (
                <div className="flex flex-col gap-1.5 p-3">
                  {pullRequests.map((pr) => {
                    const actionKey = `pr-${pr.prNumber}`
                    const isExpanded = expandedPr === pr.prNumber
                    const mergeReady = isPrMergeReady(pr)
                    const prActionsDisabled = pr.state !== "open"
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
                              <div className="mt-1.5 ml-5 flex flex-wrap items-center gap-1.5">
                                {pr.state !== "open" && (
                                  <span className="rounded-full bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {pr.state}
                                  </span>
                                )}
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
                                disabled={runningAction === actionKey || prActionsDisabled}
                              >
                                Address Review
                              </Button>
                              <button
                                className="gh-action-btn rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                                onClick={() => requireWorkspace(() => void handleIssueAction(actionKey, () => launchPrAction(project, pr, "fix_ci"), "CI fix launched"))}
                                disabled={runningAction === actionKey || prActionsDisabled}
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
          </>
        )}

      </section>

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
