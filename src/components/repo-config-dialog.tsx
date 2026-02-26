import { useState, useCallback, useEffect, useMemo } from "react"
import { FolderGit2, FolderOpen, Save, Github, Search, Loader2, AlertCircle, Laptop, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useProjectStore } from "@/stores/project-store"
import { useActivityStore } from "@/stores/activity-store"
import { useGitHubStore } from "@/stores/github-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useToastStore } from "@/stores/toast-store"
import { useRepoSetup } from "@/hooks/use-repo-setup"
import { GitHubConnectButton, GitHubSyncButton } from "@/components/github-connect-button"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { validateAbsolutePath } from "@/lib/path-utils"
import { validateGitUrl } from "@/lib/git-url-utils"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
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
  const registeredMachines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)
  const relayMachines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const realtimeMachines = useRealtimeStore((s) => s.machines)
  const { setupRepo } = useRepoSetup()
  const addToast = useToastStore((s) => s.add)
  const isMultiTenant = isServerMode()

  // Auto-populate repo URL from project.source.remoteUrl if repository isn't set
  const [repoUrl, setRepoUrl] = useState(project.repository ?? project.source?.remoteUrl ?? "")
  const [workDir, setWorkDir] = useState(project.workingDirectory ?? "")
  const [selectedMachineId, setSelectedMachineId] = useState(project.defaultMachineId ?? "")
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [useGitHub, setUseGitHub] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [pathError, setPathError] = useState<string | null>(null)
  const [repoUrlError, setRepoUrlError] = useState<string | null>(null)
  const [showPathBrowser, setShowPathBrowser] = useState(false)

  // Load machines on open
  useEffect(() => {
    if (open) {
      if (isMultiTenant) fetchMachines()
      if (!machinesLoaded) loadMachines()
    }
  }, [open, isMultiTenant, fetchMachines, machinesLoaded, loadMachines])

  // Fetch GitHub repos when connected
  useEffect(() => {
    if (connected && open && repos.length === 0) {
      fetchRepos()
    }
  }, [connected, open, repos.length, fetchRepos])

  // Build unified machine list
  const allMachines = useMemo(() => {
    if (isMultiTenant) {
      return registeredMachines.filter((m) => !m.isRevoked).map((m) => ({
        id: m.id,
        name: m.name,
        hostname: m.hostname,
        isConnected: m.isConnected,
      }))
    }
    // Local mode: merge relay + realtime machines
    const seen = new Set<string>()
    const result: Array<{ id: string; name: string; hostname?: string; isConnected: boolean }> = []
    for (const m of relayMachines) {
      if (!seen.has(m.machineId)) {
        seen.add(m.machineId)
        result.push({ id: m.machineId, name: m.name, hostname: m.hostname, isConnected: m.status !== 'offline' })
      }
    }
    for (const [, m] of realtimeMachines) {
      if (!seen.has(m.machineId)) {
        seen.add(m.machineId)
        result.push({ id: m.machineId, name: m.name, isConnected: true })
      }
    }
    return result
  }, [isMultiTenant, registeredMachines, relayMachines, realtimeMachines])

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

  const handleSave = useCallback(async () => {
    // Validate working directory path
    const pathValidation = validateAbsolutePath(workDir)
    if (!pathValidation.isValid) {
      setPathError(pathValidation.error || 'Invalid path')
      return
    }
    setPathError(null)

    // Validate and convert repository URL to SSH format
    let finalRepoUrl = repoUrl.trim()
    if (finalRepoUrl) {
      const urlValidation = validateGitUrl(finalRepoUrl)
      if (!urlValidation.isValid) {
        setRepoUrlError(urlValidation.error || 'Invalid Git URL')
        return
      }
      finalRepoUrl = urlValidation.sshUrl || finalRepoUrl
    }
    setRepoUrlError(null)

    setIsSaving(true)
    try {
      // Always persist user input immediately
      const userWorkDir = workDir.trim() || undefined
      const userRepo = finalRepoUrl || undefined
      updateProject(project.id, {
        repository: userRepo,
        workingDirectory: userWorkDir,
        sourceDirectory: userWorkDir,
        defaultMachineId: selectedMachineId || undefined,
      })

      // Try setupRepo as enhancement (detects git, file tree, etc.)
      if (userWorkDir || userRepo) {
        try {
          const result = await setupRepo({
            projectId: project.id,
            projectName: project.name,
            projectDescription: project.description,
            workingDirectory: userWorkDir,
            repository: userRepo,
            targetMachineId: selectedMachineId || undefined,
          })

          // Merge resolved directory from setupRepo (may be more accurate)
          if (result?.workingDirectory) {
            updateProject(project.id, {
              workingDirectory: result.workingDirectory,
              sourceDirectory: result.workingDirectory,
            })
            setWorkDir(result.workingDirectory)
          }
        } catch (setupError) {
          // setupRepo failure is non-fatal — user input is already saved
          console.warn('[repo-config] Repo setup failed (input saved):', setupError)
          addToast({
            type: 'warning',
            title: 'Repo setup incomplete',
            description: 'Directory saved, but automatic setup failed. File tree and git detection may be unavailable.',
          })
        }
      }

      setRepoUrl(finalRepoUrl)
      addActivity({
        projectId: project.id,
        type: "repo.configured",
        title: "Configured repository and working directory",
        description: userWorkDir || userRepo || undefined,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (error) {
      console.error('[repo-config] Save failed:', error)
      addToast({ type: 'error', title: 'Save failed', description: String(error) })
    } finally {
      setIsSaving(false)
    }
  }, [setupRepo, updateProject, addActivity, project.id, project.name, project.description, repoUrl, workDir, selectedMachineId])

  // Validate path on change
  const handleWorkDirChange = (value: string) => {
    setWorkDir(value)
    setSaved(false)
    const validation = validateAbsolutePath(value)
    setPathError(validation.isValid ? null : validation.error || null)
  }

  const hasChanges =
    repoUrl !== (project.repository ?? "") ||
    workDir !== (project.workingDirectory ?? "") ||
    selectedMachineId !== (project.defaultMachineId ?? "")

  const selectedMachineName = allMachines.find((m) => m.id === selectedMachineId)?.name

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4" />
            Repository & Directory
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Configure where agents work. Select a machine, then point to a directory or repository.
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-4">

          {/* ── 1. Machine Selector ─────────────────────────────────── */}
          {allMachines.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Target Machine</label>
              <div className="flex flex-wrap gap-2">
                {allMachines.map((m) => {
                  const isSelected = selectedMachineId === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setSelectedMachineId(isSelected ? "" : m.id)
                        setSaved(false)
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      <Laptop className="h-3 w-3" />
                      {m.name}
                      {m.isConnected && (
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      )}
                      {isSelected && <CheckCircle2 className="h-3 w-3" />}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Choose which machine will execute tasks for this project
              </p>
            </div>
          )}

          {/* ── 2. Working Directory ────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Working Directory</label>
            <div className="relative">
              {selectedMachineId && (
                <button
                  type="button"
                  onClick={() => setShowPathBrowser(true)}
                  title="Browse directories"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              )}
              <input
                type="text"
                className={cn(
                  "w-full rounded-md border border-input bg-background py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  selectedMachineId ? "pl-8 pr-3" : "px-3",
                  pathError && "border-destructive",
                )}
                placeholder={selectedMachineId ? "/remote/path/to/project" : "/absolute/path/to/project"}
                value={workDir}
                onChange={(e) => handleWorkDirChange(e.target.value)}
              />
            </div>
            {pathError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{pathError}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Absolute path (e.g., /Users/you/projects/my-app). Local directory takes priority over repository URL.
            </p>
          </div>

          {/* ── 3. GitHub / Repository URL ──────────────────────────── */}
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
                            setRepoUrl(repo.sshUrl)
                            setSaved(false)
                            setUseGitHub(false)
                            setRepoUrlError(null)
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
              <label className="text-sm font-medium">Repository URL (SSH format)</label>
              <input
                type="text"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="git@github.com:user/repo.git"
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value)
                  setSaved(false)
                  setRepoUrlError(null)
                }}
              />
              {repoUrlError && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{repoUrlError}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                SSH format required (e.g., git@github.com:user/repo.git). HTTPS URLs will be automatically converted.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {saved ? "Saved" : hasChanges ? "Unsaved changes" : ""}
          </span>
          <Button size="sm" onClick={handleSave} disabled={!hasChanges || isSaving || !!pathError || !!repoUrlError}>
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>

        {/* Remote path browser dialog */}
        {selectedMachineId && (
          <RemotePathBrowser
            open={showPathBrowser}
            onOpenChange={setShowPathBrowser}
            machineId={selectedMachineId}
            machineName={selectedMachineName}
            currentPath={workDir || undefined}
            onSelect={(path) => {
              setWorkDir(path)
              setPathError(null)
              setSaved(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
