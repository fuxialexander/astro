import { useState, useMemo, useCallback } from "react"
import { Github, Link2, Unlink, RefreshCw, Search, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { useGitHubStore } from "@/stores/github-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"
import { apiUrl } from "@/lib/api-url"
import type { Project, GitHubRepo } from "@/types"

export function GitHubProjectLinker() {
  const connected = useGitHubStore((s) => s.connected)
  const repos = useGitHubStore((s) => s.repos)
  const projects = useProjectStore((s) => s.projects)
  const allNodes = usePlanStore((s) => s.nodes)
  const addToast = useToastStore((s) => s.add)

  const [search, setSearch] = useState("")
  const [linking, setLinking] = useState<number | null>(null)
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null)

  const linkedProjects = useMemo(
    () =>
      projects.filter(
        (p): p is Project & { githubOwner: string; githubRepo: string } =>
          p.projectType === "github" && !!p.githubOwner && !!p.githubRepo
      ),
    [projects]
  )

  const linkedRepoKeys = useMemo(
    () => new Set(linkedProjects.map((p) => `${p.githubOwner}/${p.githubRepo}`)),
    [linkedProjects]
  )

  const filteredRepos = useMemo(() => {
    const available = repos.filter((r) => !linkedRepoKeys.has(r.fullName))
    if (!search) return available.slice(0, 20)
    const q = search.toLowerCase()
    return available.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    )
  }, [repos, linkedRepoKeys, search])

  // Count synced plan nodes per project
  const projectNodeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    const liveNodes = allNodes.filter(isLive)
    for (const p of linkedProjects) {
      counts[p.id] = liveNodes.filter(
        (n) => n.projectId === p.id && n.githubIssueNumber != null
      ).length
    }
    return counts
  }, [allNodes, linkedProjects])

  const handleLink = useCallback(
    async (repo: GitHubRepo) => {
      setLinking(repo.id)
      try {
        const res = await fetch(apiUrl("/api/github/projects"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoId: repo.id,
            owner: repo.owner.login,
            repo: repo.name,
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || "Failed to link repository")
        }
        const data = await res.json()
        // Reload projects and plan nodes to pick up server-created project + synced issues
        await useProjectStore.getState().load()
        await usePlanStore.getState().load()
        addToast({
          type: "success",
          title: "Repository linked",
          description: `${repo.fullName} synced ${data.sync?.total ?? 0} issues`,
        })
      } catch (err) {
        addToast({
          type: "error",
          title: "Failed to link repository",
          description:
            err instanceof Error ? err.message : "Unknown error",
        })
      } finally {
        setLinking(null)
      }
    },
    [addToast]
  )

  const handleUnlink = useCallback(
    async (projectId: string) => {
      setConfirmUnlink(null)
      setUnlinking(projectId)
      try {
        const res = await fetch(apiUrl(`/api/github/projects/${projectId}`), {
          method: "DELETE",
        })
        if (!res.ok) throw new Error("Failed to unlink")
        useProjectStore.getState().deleteProject(projectId)
        addToast({ type: "success", title: "Repository unlinked" })
      } catch (err) {
        addToast({
          type: "error",
          title: "Failed to unlink",
          description:
            err instanceof Error ? err.message : "Unknown error",
        })
      } finally {
        setUnlinking(null)
      }
    },
    [addToast]
  )

  const handleSync = useCallback(
    async (projectId: string) => {
      setSyncing(projectId)
      try {
        const res = await fetch(
          apiUrl(`/api/github/projects/${projectId}/sync-issues`),
          { method: "POST" }
        )
        if (!res.ok) throw new Error("Failed to sync")
        const data = await res.json()
        // Reload plan nodes so synced tasks appear immediately
        await usePlanStore.getState().load()
        addToast({
          type: "success",
          title: "Issues synced",
          description: `${data.created} new, ${data.updated} updated`,
        })
      } catch (err) {
        addToast({
          type: "error",
          title: "Sync failed",
          description:
            err instanceof Error ? err.message : "Unknown error",
        })
      } finally {
        setSyncing(null)
      }
    },
    [addToast]
  )

  if (!connected) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">GitHub Projects</h2>
      <p className="text-[13px] text-muted-foreground">
        Link repositories to automatically sync issues as plan tasks.
      </p>

      {/* Linked repos list */}
      {linkedProjects.length > 0 && (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {linkedProjects.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Github className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm font-medium">
                    {project.githubOwner}/{project.githubRepo}
                  </span>
                  <span className="text-[12px] text-muted-foreground ml-2">
                    ({projectNodeCounts[project.id] ?? 0} tasks synced)
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSync(project.id)}
                  disabled={syncing === project.id}
                >
                  {syncing === project.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmUnlink(project.id)}
                  disabled={unlinking === project.id}
                >
                  <Unlink className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Link new repo section */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search repositories to link..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 px-0 h-8 focus-visible:ring-0"
            />
          </div>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {filteredRepos.map((repo) => (
            <div
              key={repo.id}
              className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Github className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {repo.fullName}
                  </div>
                  {repo.description && (
                    <div className="text-[12px] text-muted-foreground truncate">
                      {repo.description}
                    </div>
                  )}
                </div>
                {repo.language && (
                  <Badge variant="secondary" className="text-[11px] shrink-0">
                    {repo.language}
                  </Badge>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleLink(repo)}
                disabled={linking === repo.id}
              >
                {linking === repo.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Link2 className="h-3.5 w-3.5 mr-1" />
                    Link
                  </>
                )}
              </Button>
            </div>
          ))}
          {filteredRepos.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {search
                ? "No matching repositories"
                : "All repositories are already linked"}
            </div>
          )}
        </div>
      </div>

      {/* Unlink confirmation dialog */}
      <Dialog
        open={!!confirmUnlink}
        onOpenChange={(open) => !open && setConfirmUnlink(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink repository?</DialogTitle>
            <DialogDescription>
              This will remove the GitHub link and delete the associated project
              and all synced tasks. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmUnlink(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmUnlink && handleUnlink(confirmUnlink)}
            >
              Unlink
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
