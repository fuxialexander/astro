import { useState, useCallback, useEffect } from "react"
import { FolderGit2, Save, Github, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useProjectStore } from "@/stores/project-store"
import { useActivityStore } from "@/stores/activity-store"
import { useGitHubStore } from "@/stores/github-store"
import { GitHubConnectButton, GitHubSyncButton } from "@/components/github-connect-button"
import type { Project } from "@/types"

export function RepoConfigDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
}) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const addActivity = useActivityStore((s) => s.addActivity)
  const { connected, repos, selectedRepoIds, fetchRepos } = useGitHubStore()

  const [repoUrl, setRepoUrl] = useState(project.repository ?? "")
  const [workDir, setWorkDir] = useState(project.workingDirectory ?? "")
  const [saved, setSaved] = useState(false)
  const [useGitHub, setUseGitHub] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Fetch GitHub repos when connected
  useEffect(() => {
    if (connected && open && repos.length === 0) {
      fetchRepos()
    }
  }, [connected, open, repos.length, fetchRepos])

  // Filter repos by search query
  const filteredRepos = repos.filter((repo) => {
    if (!searchQuery) return selectedRepoIds.length === 0 || selectedRepoIds.includes(repo.id)
    const query = searchQuery.toLowerCase()
    return (
      repo.name.toLowerCase().includes(query) ||
      repo.fullName.toLowerCase().includes(query) ||
      repo.description?.toLowerCase().includes(query)
    )
  })

  const handleSave = useCallback(() => {
    updateProject(project.id, {
      repository: repoUrl.trim() || undefined,
      workingDirectory: workDir.trim() || undefined,
    })
    addActivity({
      projectId: project.id,
      type: "repo.configured",
      title: "Configured repository and working directory",
      description: workDir.trim() || repoUrl.trim() || undefined,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }, [updateProject, addActivity, project.id, repoUrl, workDir])

  const hasChanges =
    repoUrl !== (project.repository ?? "") ||
    workDir !== (project.workingDirectory ?? "")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4" />
            Repository & Directory
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            At least one is required for task execution. Local directory takes priority over repository URL.
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {/* GitHub Integration Section */}
          {connected ? (
            <div className="flex flex-col gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Github className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">GitHub Connected</span>
                </div>
                <GitHubSyncButton />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant={useGitHub ? "default" : "outline"}
                  size="sm"
                  onClick={() => setUseGitHub(true)}
                >
                  Browse Repos
                </Button>
                <Button
                  variant={!useGitHub ? "default" : "outline"}
                  size="sm"
                  onClick={() => setUseGitHub(false)}
                >
                  Manual URL
                </Button>
              </div>

              {useGitHub && (
                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder="Search repositories..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="max-h-48 overflow-y-auto rounded-md border">
                    {filteredRepos.length === 0 ? (
                      <div className="p-3 text-center text-sm text-muted-foreground">
                        {searchQuery ? "No repositories found" : "No repositories available"}
                      </div>
                    ) : (
                      filteredRepos.map((repo) => (
                        <button
                          key={repo.id}
                          onClick={() => {
                            setRepoUrl(repo.htmlUrl)
                            setSaved(false)
                            setUseGitHub(false)
                          }}
                          className="w-full p-3 text-left hover:bg-muted/50 border-b last:border-b-0 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">
                                {repo.fullName}
                              </div>
                              {repo.description && (
                                <div className="text-xs text-muted-foreground line-clamp-1">
                                  {repo.description}
                                </div>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                {repo.language && (
                                  <span className="text-xs text-muted-foreground">
                                    {repo.language}
                                  </span>
                                )}
                                {repo.private && (
                                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                    Private
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Github className="h-4 w-4" />
                <span>Connect GitHub to browse your repositories</span>
              </div>
              <GitHubConnectButton onConnected={() => setUseGitHub(true)} />
            </div>
          )}

          {/* Manual Repository URL Input */}
          {!useGitHub && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Repository URL</label>
              <input
                type="text"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="https://github.com/user/repo.git"
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value)
                  setSaved(false)
                }}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Local Working Directory</label>
            <input
              type="text"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="/path/to/project"
              value={workDir}
              onChange={(e) => {
                setWorkDir(e.target.value)
                setSaved(false)
              }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {saved ? "Saved" : hasChanges ? "Unsaved changes" : ""}
          </span>
          <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
