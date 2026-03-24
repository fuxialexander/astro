import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { AlertCircle, ArrowUpRight, ChevronDown, Github, Loader2, Plus, RefreshCw, XCircle, MessageSquareWarning, GitMerge, GitPullRequest, CircleDot } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import { formatRelativeTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import { useGitHubAppStore } from "@/stores/github-app-store"
import { useProjectStore } from "@/stores/project-store"
import { useToastStore } from "@/stores/toast-store"
import { GitHubRepoPickerDialog } from "@/components/github-repo-picker-dialog"
import type { GitHubWorkspaceSummary, GitHubWorkspaceAttentionItem, GitHubWorkspaceProjectSummary } from "@/types"

// ── Attention zone config ────────────────────────────────────────────────

type AttentionType = "ci_failing" | "changes_requested" | "ready_to_merge" | "new_issue"

const ZONE_CONFIG: Record<AttentionType, { label: string; dot: string; borderClass: string }> = {
  ci_failing:         { label: "CI Failing",         dot: "bg-destructive",  borderClass: "border-l-destructive" },
  changes_requested:  { label: "Changes Requested",  dot: "bg-warning",      borderClass: "border-l-warning" },
  ready_to_merge:     { label: "Ready to Merge",     dot: "bg-success",      borderClass: "border-l-success" },
  new_issue:          { label: "New Issue",           dot: "bg-info",         borderClass: "border-l-info" },
}

function AttentionIcon({ type }: { type: string }) {
  if (type === "ci_failing") return <XCircle className="h-3.5 w-3.5 text-destructive" />
  if (type === "changes_requested") return <MessageSquareWarning className="h-3.5 w-3.5 text-warning" />
  if (type === "ready_to_merge") return <GitMerge className="h-3.5 w-3.5 text-success" />
  return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
}

// ── Metric pill ──────────────────────────────────────────────────────────

function MetricPill({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="text-[22px] font-bold tabular-nums tracking-tight"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

// ── Attention item row ───────────────────────────────────────────────────

function AttentionRow({ item }: { item: GitHubWorkspaceAttentionItem }) {
  const zone = ZONE_CONFIG[item.type as AttentionType] ?? ZONE_CONFIG.new_issue

  return (
    <Link
      to={`/project/${item.projectId}/repo`}
      className={cn(
        "gh-card flex items-center gap-3 rounded-lg border border-l-[3px] border-border/40 px-4 py-3 no-underline",
        zone.borderClass,
      )}
    >
      <AttentionIcon type={item.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            #{item.number} {item.title}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium">{item.repo}</span>
          {item.updatedAt && (
            <>
              <span className="opacity-40">*</span>
              <span>{formatRelativeTime(new Date(item.updatedAt))}</span>
            </>
          )}
        </div>
      </div>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
    </Link>
  )
}

// ── Attention zone (collapsible group) ───────────────────────────────────

function AttentionZone({ type, items }: { type: AttentionType; items: GitHubWorkspaceAttentionItem[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const zone = ZONE_CONFIG[type]
  if (items.length === 0) return null

  return (
    <div>
      <button
        className="mb-2.5 flex w-full items-center gap-2.5 py-0.5 text-left"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className={cn("h-1.5 w-1.5 shrink-0 rounded-full", zone.dot)} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {zone.label}
        </span>
        <div className="h-px flex-1 bg-border/40" />
        <span className="tabular-nums text-[11px] text-muted-foreground">
          {items.length}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <AttentionRow key={`${item.projectId}-${item.number}-${item.type}`} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Repo project card ────────────────────────────────────────────────────

function RepoCard({ project }: { project: GitHubWorkspaceProjectSummary }) {
  const isMergeReady = project.readyToMergePrs > 0

  return (
    <Link
      to={`/project/${project.projectId}/repo`}
      className={cn(
        "rounded-[10px] border border-border/50 p-4 no-underline",
        isMergeReady ? "gh-card-merge" : "gh-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 shrink-0 text-muted-foreground/70" />
            <span className="truncate text-[14px] font-semibold text-foreground">{project.repo}</span>
          </div>
          {project.lastSyncedAt && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Synced {formatRelativeTime(new Date(project.lastSyncedAt))}
            </p>
          )}
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <MiniMetric label="Issues" value={project.openIssues} icon={<CircleDot className="h-3 w-3" />} />
        <MiniMetric label="PRs" value={project.openPullRequests} icon={<GitPullRequest className="h-3 w-3" />} />
        {project.failingPrs > 0 && (
          <MiniMetric label="Failing" value={project.failingPrs} tone="destructive" />
        )}
        {project.changesRequestedPrs > 0 && (
          <MiniMetric label="Review" value={project.changesRequestedPrs} tone="warning" />
        )}
        {project.readyToMergePrs > 0 && (
          <MiniMetric label="Merge" value={project.readyToMergePrs} tone="success" />
        )}
      </div>
    </Link>
  )
}

function MiniMetric({ label, value, tone, icon }: { label: string; value: number; tone?: string; icon?: React.ReactNode }) {
  const toneClass = tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-foreground"
  return (
    <div className="flex min-w-[60px] items-center gap-1.5 rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
      {icon && <span className="text-muted-foreground/60">{icon}</span>}
      <span className={cn("text-[15px] font-bold tabular-nums", toneClass)}>{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────

export function Workspace() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<GitHubWorkspaceSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const installations = useGitHubAppStore((s) => s.installations)
  const fetchInstallations = useGitHubAppStore((s) => s.fetchInstallations)
  const connected = installations.length > 0
  const projects = useProjectStore((s) => s.projects)
  const githubProjects = projects.filter((p) => p.projectType === "github")
  const addToast = useToastStore((s) => s.add)

  const load = useCallback(async (sync = false) => {
    setLoading(true)
    setError(null)
    try {
      const headers = await authHeaders()

      if (sync && githubProjects.length > 0) {
        // Sync all github projects from the GitHub API in parallel
        const results = await Promise.allSettled(
          githubProjects.map((p) =>
            fetch(apiUrl(`/api/github/projects/${p.id}/repo-cache/sync`), { method: "POST", headers }),
          ),
        )
        const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok))
        if (failed.length > 0) {
          addToast({ title: `Synced ${githubProjects.length - failed.length}/${githubProjects.length} repos`, description: "Some repos failed to sync.", type: "warning" })
        } else {
          addToast({ title: `Synced ${githubProjects.length} repo${githubProjects.length !== 1 ? "s" : ""} from GitHub`, type: "success" })
        }
      }

      const response = await fetch(apiUrl("/api/github/workspace/summary"), { headers })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Failed to load workspace" }))
        throw new Error(body.error || "Failed to load workspace")
      }
      setSummary(await response.json() as GitHubWorkspaceSummary)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace")
    } finally {
      setLoading(false)
    }
  }, [githubProjects, addToast])

  useEffect(() => {
    void fetchInstallations()
  }, [fetchInstallations])

  useEffect(() => {
    if (connected) void load()
  }, [connected, load])

  const attentionByType = useMemo(() => ({
    ci_failing: summary?.attention.filter((a) => a.type === "ci_failing") ?? [],
    changes_requested: summary?.attention.filter((a) => a.type === "changes_requested") ?? [],
    ready_to_merge: summary?.attention.filter((a) => a.type === "ready_to_merge") ?? [],
  }), [summary?.attention])

  const totalAttention = summary?.attention.length ?? 0
  const totalWorking = summary?.projects.reduce((sum, p) => sum + p.openPullRequests, 0) ?? 0
  const sectionClass = "rounded-2xl border border-border bg-card p-5 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.12)]"

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 p-6 md:px-10 md:py-8">
      {/* ── Header with metric pills ─────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8 ring-1 ring-primary/15">
              <Github className="h-5 w-5 text-primary" />
            </div>
            <div className="flex items-baseline gap-5">
              <h1 className="text-[17px] font-semibold tracking-[-0.02em]">GitHub</h1>
              <div className="flex flex-wrap items-baseline gap-y-1">
                {[
                  { value: githubProjects.length, label: "repos" },
                  ...(totalWorking > 0 ? [{ value: totalWorking, label: "open PRs", color: "var(--info)" }] : []),
                  ...(totalAttention > 0 ? [{ value: totalAttention, label: "need attention", color: "var(--warning)" }] : []),
                ].map((m, i) => (
                  <span key={m.label} className="flex items-baseline">
                    {i > 0 && <span className="mx-3 text-[11px] text-border">*</span>}
                    <MetricPill value={m.value} label={m.label} color={m.color} />
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading || !connected}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
              Sync
            </Button>
            {connected && (
              <button
                className="gh-action-btn flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-semibold"
                onClick={() => setImportOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Import Repo
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Connect banner ────────────────────────────────────────── */}
      {!connected && (
        <div
          className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.12)]"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/40">
              <Github className="h-4.5 w-4.5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold">Install the GitHub App</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Install the Astro GitHub App to import repos, sync issues, and enable agent automation.</p>
            </div>
          </div>
          <button
            className="gh-action-btn rounded-lg px-4 py-2 text-[12px] font-semibold"
            onClick={() => navigate("/settings?tab=connected-accounts")}
          >
            Install
          </button>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-4 py-3 text-[12px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {!summary && loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading...
        </div>
      ) : (
        <div className="animate-stagger flex flex-col gap-7">
          {/* ── Attention zones ───────────────────────────────────── */}
          {totalAttention > 0 && (
            <section className={sectionClass}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-foreground">
                  Needs Attention
                </h2>
                <div className="flex items-center gap-2">
                  {attentionByType.ci_failing.length > 0 && (
                    <Badge variant="destructive" className="text-[10px]">{attentionByType.ci_failing.length} CI</Badge>
                  )}
                  {attentionByType.changes_requested.length > 0 && (
                    <Badge variant="warning" className="text-[10px]">{attentionByType.changes_requested.length} review</Badge>
                  )}
                  {attentionByType.ready_to_merge.length > 0 && (
                    <Badge variant="success" className="text-[10px]">{attentionByType.ready_to_merge.length} merge</Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-5">
                <AttentionZone type="ci_failing" items={attentionByType.ci_failing} />
                <AttentionZone type="changes_requested" items={attentionByType.changes_requested} />
                <AttentionZone type="ready_to_merge" items={attentionByType.ready_to_merge} />
              </div>
            </section>
          )}

          {totalAttention === 0 && summary && (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-card py-8 text-sm text-muted-foreground shadow-[0_2px_12px_-2px_rgba(0,0,0,0.12)]">
              No items currently need attention.
            </div>
          )}

          {/* ── Repo grid ─────────────────────────────────────────── */}
          <section className={sectionClass}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-foreground">
                Repositories
              </h2>
              {connected && (
                <button
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setImportOpen(true)}
                >
                  <Plus className="h-3 w-3" />
                  Import
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {summary?.projects.length ? summary.projects.map((project) => (
                <RepoCard key={project.projectId} project={project} />
              )) : (
                <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                  {connected
                    ? "No repos imported yet. Click Import Repo to get started."
                    : "Install the GitHub App to import repos."}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <GitHubRepoPickerDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
