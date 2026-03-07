import { useState, useCallback, useEffect, useMemo } from "react"
import { FolderGit2, FolderOpen, Save, Github, Search, Loader2, AlertCircle, Laptop, CheckCircle2, GitBranch, X, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useProjectStore } from "@/stores/project-store"
import { useActivityStore } from "@/stores/activity-store"
import { useGitHubStore } from "@/stores/github-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useToastStore } from "@/stores/toast-store"
import { useRepoSetup } from "@/hooks/use-repo-setup"
import { useDirectoryDetection } from "@/hooks/use-directory-detection"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { BranchSelector } from "@/components/branch-selector"
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
  const { connected, repos, selectedRepoIds, fetchRepos, connect: connectGitHub } = useGitHubStore()
  const registeredMachines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)
  const relayMachines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const realtimeMachines = useRealtimeStore((s) => s.machines)
  const { setupRepo } = useRepoSetup()
  const addToast = useToastStore((s) => s.add)
  const isMultiTenant = isServerMode()

  const [repoUrl, setRepoUrl] = useState(project.repository ?? project.source?.remoteUrl ?? "")
  const [workDir, setWorkDir] = useState(project.workingDirectory ?? "")
  const [selectedMachineId, setSelectedMachineId] = useState(project.defaultMachineId ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)
  const [repoUrlError, setRepoUrlError] = useState<string | null>(null)
  const [showPathBrowser, setShowPathBrowser] = useState(false)
  const [showGitHubBrowser, setShowGitHubBrowser] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [repoAutoFilled, setRepoAutoFilled] = useState(false)
  const [baseBranch, setBaseBranch] = useState(project.source?.baseBranch ?? "")

  // Directory detection — auto-detects git info as user types
  const { detection, isDetecting } = useDirectoryDetection(workDir, selectedMachineId)

  // Auto-fill repo URL from detection
  useEffect(() => {
    if (detection?.remoteUrl && !repoUrl) {
      setRepoUrl(detection.remoteUrl)
      setRepoAutoFilled(true)
    }
  }, [detection?.remoteUrl, repoUrl])

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

  // Auto-select single machine
  const allMachines = useMemo(() => {
    if (isMultiTenant) {
      return registeredMachines.filter((m) => !m.isRevoked).map((m) => ({
        id: m.id,
        name: m.name,
        hostname: m.hostname,
        isConnected: m.isConnected,
      }))
    }
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

  // Auto-select a machine when none selected: prefer connected, fall back to first
  useEffect(() => {
    if (open && allMachines.length > 0 && !selectedMachineId) {
      const connected = allMachines.find((m) => m.isConnected)
      setSelectedMachineId((connected ?? allMachines[0]).id)
    }
  }, [open, allMachines, selectedMachineId])

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
    if (workDir.trim()) {
      const pathValidation = validateAbsolutePath(workDir)
      if (!pathValidation.isValid) {
        setPathError(pathValidation.error || 'Invalid path')
        return
      }
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
      const userWorkDir = workDir.trim() || undefined
      const userRepo = finalRepoUrl || undefined
      const effectiveBranch = baseBranch || detection?.baseBranch || undefined
      updateProject(project.id, {
        repository: userRepo,
        workingDirectory: userWorkDir,
        defaultMachineId: selectedMachineId || undefined,
        ...(effectiveBranch && project.source ? {
          source: { ...project.source, baseBranch: effectiveBranch },
        } : {}),
      })

      if (userWorkDir || userRepo) {
        try {
          const result = await setupRepo({
            projectId: project.id,
            projectName: project.name,
            projectDescription: project.description,
            workingDirectory: userWorkDir,
            repository: userRepo,
            baseBranch: effectiveBranch,
            targetMachineId: selectedMachineId || undefined,
          })
          if (result?.workingDirectory) {
            updateProject(project.id, {
              workingDirectory: result.workingDirectory,
            })
            setWorkDir(result.workingDirectory)
          }
        } catch (setupError) {
          console.warn('[repo-config] Repo setup failed (input saved):', setupError)
          addToast({
            type: 'warning',
            title: 'Repo setup incomplete',
            description: 'Directory saved, but automatic setup failed.',
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
      onOpenChange(false)
    } catch (error) {
      console.error('[repo-config] Save failed:', error)
      addToast({ type: 'error', title: 'Save failed', description: String(error) })
    } finally {
      setIsSaving(false)
    }
  }, [setupRepo, updateProject, addActivity, project.id, project.name, project.description, project.source, repoUrl, workDir, selectedMachineId, baseBranch, detection, onOpenChange, addToast])

  const handleWorkDirChange = (value: string) => {
    setWorkDir(value)
    setRepoAutoFilled(false)
    if (repoAutoFilled) {
      setRepoUrl("")
    }
    const validation = validateAbsolutePath(value)
    setPathError(validation.isValid ? null : validation.error || null)
  }

  const handleGitHubClick = () => {
    if (connected) {
      setShowGitHubBrowser(true)
    } else {
      connectGitHub()
    }
  }

  const hasChanges =
    repoUrl !== (project.repository ?? "") ||
    workDir !== (project.workingDirectory ?? "") ||
    selectedMachineId !== (project.defaultMachineId ?? "") ||
    (baseBranch && baseBranch !== (project.source?.baseBranch ?? ""))

  const selectedMachineName = allMachines.find((m) => m.id === selectedMachineId)?.name
  const showFields = allMachines.length === 0 || !!selectedMachineId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <FolderGit2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Configure workspace</span>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {/* ── Machine selector chips ─────────────────────────── */}
          {allMachines.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Machine</span>
              <div className="flex flex-wrap gap-1.5">
                {allMachines.map((m) => {
                  const isSelected = selectedMachineId === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMachineId(isSelected ? "" : m.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-all cursor-pointer",
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Laptop className="h-3 w-3" />
                      <span>{m.name}</span>
                      {m.isConnected && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                      {isSelected && <Check className="h-3 w-3" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Path + Git URL (shown after machine selected) ── */}
          {showFields && (
            <div className="flex flex-col gap-3">
              {/* Working directory */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Directory</span>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      className={cn(
                        "w-full h-8 rounded-md border bg-background px-2.5 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        pathError ? "border-destructive" : "border-input",
                      )}
                      placeholder="/path/to/project"
                      value={workDir}
                      onChange={(e) => handleWorkDirChange(e.target.value)}
                    />
                    {isDetecting && (
                      <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {selectedMachineId && (
                    <button
                      type="button"
                      onClick={() => setShowPathBrowser(true)}
                      title="Browse directories"
                      className="flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {pathError && (
                  <span className="text-[10px] text-destructive">{pathError}</span>
                )}
                {/* Detection feedback */}
                {detection && !pathError && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    {detection.isGit ? (
                      <>
                        <GitBranch className="h-3 w-3 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Git repo{detection.remoteUrl ? ' — remote detected' : ''}
                        </span>
                      </>
                    ) : detection.exists ? (
                      <>
                        <AlertCircle className="h-3 w-3 text-amber-500" />
                        <span className="text-amber-600 dark:text-amber-400">No git — init recommended</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Directory will be created</span>
                    )}
                  </div>
                )}

              {/* Target branch selector — shown when git is detected */}
              {detection?.isGit && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Target branch</span>
                  <BranchSelector
                    value={baseBranch || detection.baseBranch || 'main'}
                    onChange={setBaseBranch}
                    path={workDir.trim()}
                    machineId={selectedMachineId || undefined}
                  />
                </div>
              )}
              </div>

              {/* Repository URL */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Repository</span>
                {showGitHubBrowser && connected ? (
                  /* ── Inline GitHub repo browser ── */
                  <div className="flex flex-col rounded-md border border-input overflow-hidden">
                    <div className="flex items-center gap-2 px-2.5 h-8 border-b border-input bg-muted/30">
                      <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        className="flex-1 bg-transparent text-xs placeholder:text-muted-foreground focus:outline-none min-w-0"
                        placeholder="Search repos..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                      />
                      <button
                        onClick={() => { setShowGitHubBrowser(false); setSearchQuery("") }}
                        className="p-0.5 rounded hover:bg-muted cursor-pointer shrink-0"
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {filteredRepos.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          {searchQuery ? "No repos found" : "No repos available"}
                        </div>
                      ) : (
                        filteredRepos.map((repo) => (
                          <button
                            key={repo.id}
                            onClick={() => {
                              setRepoUrl(repo.sshUrl)
                              setRepoAutoFilled(false)
                              setRepoUrlError(null)
                              setShowGitHubBrowser(false)
                              setSearchQuery("")
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 text-left border-b border-input last:border-b-0 hover:bg-muted/50 transition-colors"
                          >
                            <Github className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="text-xs font-medium truncate">{repo.fullName}</div>
                              {repo.description && (
                                <div className="text-[10px] text-muted-foreground truncate">{repo.description}</div>
                              )}
                            </div>
                            {repo.private && (
                              <span className="text-[9px] bg-muted px-1 py-0.5 rounded shrink-0">Private</span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── Manual URL input with GitHub button ── */
                  <>
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1 min-w-0">
                        <input
                          type="text"
                          className={cn(
                            "w-full h-8 rounded-md border bg-background px-2.5 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                            repoUrlError ? "border-destructive" : "border-input",
                            repoAutoFilled && "text-emerald-600 dark:text-emerald-400",
                          )}
                          placeholder="git@github.com:user/repo.git"
                          value={repoUrl}
                          onChange={(e) => {
                            setRepoUrl(e.target.value)
                            setRepoAutoFilled(false)
                            setRepoUrlError(null)
                          }}
                        />
                        {repoAutoFilled && (
                          <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-emerald-500" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleGitHubClick}
                        title={connected ? "Browse GitHub repos" : "Connect GitHub"}
                        className={cn(
                          "flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-muted transition-colors cursor-pointer shrink-0",
                          connected ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/50 hover:text-foreground",
                        )}
                      >
                        <Github className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {repoUrlError && (
                      <span className="text-[10px] text-destructive">{repoUrlError}</span>
                    )}
                    {repoAutoFilled && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Auto-detected from directory</span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleSave}
            disabled={!hasChanges || isSaving || !!pathError || !!repoUrlError}
          >
            {isSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
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
              setRepoAutoFilled(false)
              if (repoAutoFilled) setRepoUrl("")
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
