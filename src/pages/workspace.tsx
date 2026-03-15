import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"
import { AlertCircle, ArrowUpRight, Github, Loader2, Plus, RefreshCw, XCircle, MessageSquareWarning, GitMerge } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import { formatRelativeTime } from "@/lib/date-utils"
import { useGitHubStore } from "@/stores/github-store"
import { useProjectStore } from "@/stores/project-store"
import { GitHubRepoPickerDialog } from "@/components/github-repo-picker-dialog"
import type { GitHubWorkspaceSummary, GitHubWorkspaceAttentionItem } from "@/types"

const ATTENTION_LABELS: Record<string, string> = {
  ci_failing: "CI failing",
  changes_requested: "Changes requested",
  ready_to_merge: "Ready to merge",
  new_issue: "New issue",
}

function AttentionIcon({ type }: { type: string }) {
  if (type === "ci_failing") return <XCircle className="h-3.5 w-3.5 text-destructive" />
  if (type === "changes_requested") return <MessageSquareWarning className="h-3.5 w-3.5 text-warning" />
  if (type === "ready_to_merge") return <GitMerge className="h-3.5 w-3.5 text-success" />
  return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
}

function attentionBadgeVariant(type: string): "destructive" | "warning" | "success" | "outline" {
  if (type === "ci_failing") return "destructive"
  if (type === "changes_requested") return "warning"
  if (type === "ready_to_merge") return "success"
  return "outline"
}

function AttentionRow({ item }: { item: GitHubWorkspaceAttentionItem }) {
  return (
    <Link
      to={`/project/${item.projectId}/repo`}
      className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-3.5 last:border-b-0 hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <AttentionIcon type={item.type} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={attentionBadgeVariant(item.type)} className="text-[10px] shrink-0">
              {ATTENTION_LABELS[item.type] || item.type}
            </Badge>
            <span className="truncate text-sm font-medium">
              #{item.number} {item.title}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{item.repo}</span>
            {item.updatedAt && (
              <>
                <span className="text-border">·</span>
                <span>{formatRelativeTime(new Date(item.updatedAt))}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
    </Link>
  )
}

export function Workspace() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<GitHubWorkspaceSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const connected = useGitHubStore((s) => s.connected)
  const projects = useProjectStore((s) => s.projects)
  const githubProjects = projects.filter((p) => p.projectType === "github")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = await authHeaders()
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
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Group attention items by priority
  const attentionByType = {
    ci_failing: summary?.attention.filter((a) => a.type === "ci_failing") ?? [],
    changes_requested: summary?.attention.filter((a) => a.type === "changes_requested") ?? [],
    ready_to_merge: summary?.attention.filter((a) => a.type === "ready_to_merge") ?? [],
  }
  const totalAttention = (summary?.attention.length ?? 0)

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 p-6 md:px-10 md:py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Github className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">GitHub</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {githubProjects.length} {githubProjects.length === 1 ? "repo" : "repos"} imported
              {totalAttention > 0 && ` · ${totalAttention} ${totalAttention === 1 ? "item" : "items"} need attention`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {connected && (
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Import Repo
            </Button>
          )}
        </div>
      </div>

      {/* Not connected banner */}
      {!connected && (
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <Github className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Connect your GitHub account</p>
              <p className="text-xs text-muted-foreground">Link repos to import issues, PRs, and enable agent automation.</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate("/settings")}>
            Connect
          </Button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/[0.03] px-4 py-3 text-sm text-destructive/80">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!summary && loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border/60 bg-card/70 p-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading...
        </div>
      ) : (
        <>
          {/* Attention panel */}
          <section className="rounded-2xl border border-border/60 bg-card/70">
            <div className="border-b border-border/60 px-5 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Needs Attention</h2>
                {totalAttention > 0 && (
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
                )}
              </div>
            </div>
            <div>
              {summary?.attention.length ? summary.attention.map((item) => (
                <AttentionRow key={`${item.projectId}-${item.number}-${item.type}`} item={item} />
              )) : (
                <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No items currently need attention.
                </div>
              )}
            </div>
          </section>

          {/* Project cards */}
          <section className="rounded-2xl border border-border/60 bg-card/70">
            <div className="border-b border-border/60 px-5 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Repos</h2>
                {connected && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setImportOpen(true)}>
                    <Plus className="mr-1 h-3 w-3" />
                    Import
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              {summary?.projects.length ? summary.projects.map((project) => (
                <Link
                  key={project.projectId}
                  to={`/project/${project.projectId}/repo`}
                  className="rounded-xl border border-border/60 bg-background/60 p-4 hover:border-primary/30 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Github className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{project.repo}</span>
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <Badge variant="outline">{project.openIssues} issues</Badge>
                    <Badge variant="outline">{project.openPullRequests} PRs</Badge>
                    {project.failingPrs > 0 && <Badge variant="destructive">{project.failingPrs} failing</Badge>}
                    {project.changesRequestedPrs > 0 && <Badge variant="warning">{project.changesRequestedPrs} review</Badge>}
                    {project.readyToMergePrs > 0 && <Badge variant="success">{project.readyToMergePrs} ready</Badge>}
                  </div>

                  {project.lastSyncedAt && (
                    <p className="mt-2.5 text-xs text-muted-foreground">
                      Synced {formatRelativeTime(new Date(project.lastSyncedAt))}
                    </p>
                  )}
                </Link>
              )) : (
                <div className="col-span-full py-6 text-center text-sm text-muted-foreground">
                  {connected
                    ? "No repos imported yet. Click Import Repo to get started."
                    : "Connect your GitHub account to import repos."}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <GitHubRepoPickerDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
