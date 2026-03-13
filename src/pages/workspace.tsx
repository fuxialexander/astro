import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { AlertCircle, ArrowUpRight, Github, Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import { formatRelativeTime } from "@/lib/date-utils"
import type { GitHubWorkspaceSummary } from "@/types"

const ATTENTION_LABELS: Record<string, string> = {
  ci_failing: "CI failing",
  changes_requested: "Changes requested",
  ready_to_merge: "Ready to merge",
  new_issue: "New issue",
}

export function Workspace() {
  const [summary, setSummary] = useState<GitHubWorkspaceSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 p-6 md:px-10 md:py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">Repo-level GitHub activity across linked projects.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/[0.03] px-4 py-3 text-sm text-destructive/80">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!summary && loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border/60 bg-card/70 p-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading workspace...
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-border/60 bg-card/70">
            <div className="border-b border-border/60 px-5 py-4">
              <h2 className="text-sm font-semibold">Needs Attention</h2>
            </div>
            <div>
              {summary?.attention.length ? summary.attention.map((item) => (
                <Link
                  key={`${item.projectId}-${item.number}-${item.type}`}
                  to={`/project/${item.projectId}/repo`}
                  className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-4 last:border-b-0 hover:bg-muted/30"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={item.type === "ready_to_merge" ? "success" : item.type === "changes_requested" ? "warning" : "destructive"} className="text-[10px]">
                        {ATTENTION_LABELS[item.type] || item.type}
                      </Badge>
                      <span className="truncate text-sm font-medium">
                        {item.repo} #{item.number} {item.title}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.updatedAt ? `Updated ${formatRelativeTime(new Date(item.updatedAt))}` : item.projectName}
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                </Link>
              )) : (
                <div className="px-5 py-6 text-sm text-muted-foreground">No GitHub items currently need attention.</div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card/70">
            <div className="border-b border-border/60 px-5 py-4">
              <h2 className="text-sm font-semibold">Projects</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              {summary?.projects.length ? summary.projects.map((project) => (
                <Link
                  key={project.projectId}
                  to={`/project/${project.projectId}/repo`}
                  className="rounded-xl border border-border/60 bg-background/60 p-4 hover:border-primary/30 hover:bg-muted/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Github className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{project.projectName}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{project.repo}</p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                    <Badge variant="outline">{project.openIssues} issues</Badge>
                    <Badge variant="outline">{project.openPullRequests} PRs</Badge>
                    {project.failingPrs > 0 && <Badge variant="destructive">{project.failingPrs} failing</Badge>}
                    {project.changesRequestedPrs > 0 && <Badge variant="warning">{project.changesRequestedPrs} review</Badge>}
                    {project.readyToMergePrs > 0 && <Badge variant="success">{project.readyToMergePrs} ready</Badge>}
                  </div>

                  {project.lastSyncedAt && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Synced {formatRelativeTime(new Date(project.lastSyncedAt))}
                    </p>
                  )}
                </Link>
              )) : (
                <div className="text-sm text-muted-foreground">No GitHub-linked projects found.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
