import { useState, useEffect } from "react"
import { useNavigate } from "react-router"
import {
  Compass,
  GitBranch,
  Loader2,
  ListTodo,
  Github,
  Search,
  X,
  Laptop,
  Globe,
  Server,
  Cloud,
  Plus,
  CheckCircle2,
  FolderGit2,
  Sun,
  Moon,
  Sparkles,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useGitHubStore } from "@/stores/github-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useRepoSetup } from "@/hooks/use-repo-setup"
import { GitInitDialog } from "@/components/git-init-dialog"
import { AddEnvironmentDialog } from "@/components/environments/add-environment-dialog"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { getRandomColor, getRandomProjectIcon } from "@/lib/color-icon-utils"

const environmentConfig = {
  local: { icon: Laptop, label: "Local", description: "Run on this machine" },
  remote: { icon: Globe, label: "Remote", description: "Run on remote machine" },
  hpc: { icon: Server, label: "HPC", description: "Run on HPC cluster" },
  cloud: { icon: Cloud, label: "Cloud", description: "Run on cloud instance" },
} as const

export function Welcome() {
  const [mode, setMode] = useState<"choose" | "repo">("choose")
  const [repoUrl, setRepoUrl] = useState("")
  const [firstTask, setFirstTask] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showGitHubRepos, setShowGitHubRepos] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddEnvironment, setShowAddEnvironment] = useState(false)
  const [isRefreshingMachines, setIsRefreshingMachines] = useState(false)

  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const addProject = useProjectStore((s) => s.addProject)
  const addNode = usePlanStore((s) => s.addNode)
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)

  // GitHub integration
  const { connected, repos, selectedRepoIds, fetchRepos } = useGitHubStore()

  // Machine/environment state
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const machines = useRealtimeStore((s) => s.machines)

  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  // Fetch repos when GitHub selector is opened
  useEffect(() => {
    if (connected && showGitHubRepos && repos.length === 0) {
      fetchRepos()
    }
  }, [connected, showGitHubRepos, repos.length, fetchRepos])

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

  // Shared repo setup hook
  const { setupRepo, gitInitPrompt, dismissGitInit, confirmGitInit } = useRepoSetup()

  // Create default empty project with git repo
  async function handleStartEmpty() {
    setIsSubmitting(true)
    const id = crypto.randomUUID()
    const projectName = "quick-start"
    const defaultWorkdir = `~/nexus-projects/${projectName}`

    addProject({
      id,
      name: "Quick Start",
      description: "Your first project - start adding tasks below",
      visionDoc: "",
      status: "active",
      workingDirectory: defaultWorkdir,
      color: getRandomColor(),
      icon: getRandomProjectIcon(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    navigate(`/project/${id}/plan?view=list`)

    // Set up git repo in background if backend is connected (silent, no UI feedback)
    if (connectionStatus === "connected") {
      try {
        await setupRepo({
          projectId: id,
          projectName,
          projectDescription: "Your first project - start adding tasks below",
          workingDirectory: defaultWorkdir,
        })
      } catch (error) {
        console.warn('[welcome] Failed to set up repo for empty project:', error)
      }
    }

    setIsSubmitting(false)
  }

  // Create project with repo and add first task manually (skip AI)
  async function handleStartWithFirstTask() {
    if (!repoUrl.trim() || !firstTask.trim() || isSubmitting) return
    setIsSubmitting(true)

    const id = crypto.randomUUID()
    const projectName = repoUrl.split("/").pop()?.replace(".git", "") || "New Project"
    const defaultWorkdir = `~/nexus-projects/${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`

    addProject({
      id,
      name: projectName,
      description: firstTask.trim(),
      visionDoc: "",
      status: "active",
      repository: repoUrl.trim(),
      workingDirectory: defaultWorkdir,
      color: getRandomColor(),
      icon: getRandomProjectIcon(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Add first task node with due date set to today
    const taskId = crypto.randomUUID()
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD format
    addNode({
      id: taskId,
      projectId: id,
      type: "task",
      title: firstTask.trim(),
      description: "",
      status: "planned",
      parentId: null,
      dependencies: [],
      verification: "auto",
      position: { x: 0, y: 0 },
      priority: "medium",
      dueDate: today,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    navigate(`/project/${id}/plan?view=list`)

    // Set up repo in background (clone/init, silent, no UI feedback)
    if (connectionStatus === "connected") {
      try {
        await setupRepo({
          projectId: id,
          projectName,
          projectDescription: firstTask.trim(),
          repository: repoUrl.trim(),
          workingDirectory: defaultWorkdir,
        })
      } catch (error) {
        console.warn('[welcome] Failed to set up repo:', error)
      }
    }

    setIsSubmitting(false)
  }

  // Create project with repo and navigate to plan view (optionally use AI)
  async function handleStartWithAI() {
    if (!repoUrl.trim() || isSubmitting) return
    setIsSubmitting(true)

    const id = crypto.randomUUID()
    const projectName = repoUrl.split("/").pop()?.replace(".git", "") || "New Project"
    const defaultWorkdir = `~/nexus-projects/${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`

    addProject({
      id,
      name: projectName,
      description: firstTask.trim() || `Work on ${projectName}`,
      visionDoc: "",
      status: "active",
      repository: repoUrl.trim(),
      workingDirectory: defaultWorkdir,
      color: getRandomColor(),
      icon: getRandomProjectIcon(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    navigate(`/project/${id}/plan?view=list`)

    // Set up repo in background (clone/init, silent) - user can trigger AI from plan view
    if (connectionStatus === "connected") {
      try {
        await setupRepo({
          projectId: id,
          projectName,
          projectDescription: firstTask.trim() || `Work on ${projectName}`,
          repository: repoUrl.trim(),
          workingDirectory: defaultWorkdir,
        })
      } catch (error) {
        console.warn('[welcome] Failed to set up repo:', error)
      }
    }

    setIsSubmitting(false)
  }

  // Refresh machines list
  async function handleRefreshMachines() {
    setIsRefreshingMachines(true)
    try {
      await loadMachines()
    } catch (error) {
      console.error('[welcome] Failed to refresh machines:', error)
    }
    setIsRefreshingMachines(false)
  }

  // Group machines by environment type
  const machinesByEnv = Array.from(machines.values()).reduce((acc, m) => {
    const env = m.environmentType as keyof typeof environmentConfig
    if (!acc[env]) acc[env] = []
    acc[env].push(m)
    return acc
  }, {} as Record<string, typeof machines extends Map<string, infer M> ? M[] : never>)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Theme toggle - top right */}
      <div className="absolute top-4 right-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="h-10 w-10 rounded-full"
        >
          {theme === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="flex w-full max-w-[900px] flex-col items-center gap-10">
          {/* Brand */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <Compass className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold tracking-[4px] text-foreground">NEXUS</span>
          </div>

          {/* Heading */}
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-center text-3xl font-semibold text-foreground">
              Welcome to Nexus
            </h1>
            <p className="max-w-[560px] text-center text-[15px] leading-relaxed text-muted-foreground">
              AI-powered task planning and execution. Start simple, scale gradually.
            </p>
          </div>

          {mode === "choose" ? (
            <>
              {/* Two main options - side by side on desktop */}
              <div className="flex w-full flex-col gap-4 md:flex-row md:gap-6">
                <OptionCard
                  icon={ListTodo}
                  title="Start with empty project"
                  description="Creates a new git repository and working directory. Start adding tasks immediately."
                  workdir="~/nexus-projects/quick-start"
                  onClick={handleStartEmpty}
                  disabled={isSubmitting}
                  primary
                  className="flex-1"
                />
                <OptionCard
                  icon={GitBranch}
                  title="Start with a repo"
                  description="Clone or link an existing repository. Manually add tasks or optionally use AI to generate a plan."
                  workdir="You'll specify the repo URL"
                  onClick={() => setMode("repo")}
                  disabled={isSubmitting}
                  className="flex-1"
                />
              </div>

              {/* Available Environments */}
              <div className="w-full flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">Available execution environments</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshMachines}
                    disabled={isRefreshingMachines}
                    className="h-8 gap-2"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isRefreshingMachines && "animate-spin")} />
                    Refresh
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {/* Local environment */}
                  <EnvironmentCard
                    env="local"
                    machineCount={1}
                    isLocal
                  />

                  {/* Other environments */}
                  {(['remote', 'hpc', 'cloud'] as const).map((env) => {
                    const count = machinesByEnv[env]?.length || 0
                    return count > 0 ? (
                      <EnvironmentCard
                        key={env}
                        env={env}
                        machineCount={count}
                      />
                    ) : null
                  })}

                  {/* Add new device placeholder */}
                  <button
                    onClick={() => setShowAddEnvironment(true)}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 p-6 text-center transition-colors hover:border-foreground/20 hover:bg-muted/40 cursor-pointer"
                  >
                    <Plus className="h-6 w-6 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium text-foreground">Add environment</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Connect remote machines, HPC clusters, or cloud instances</div>
                    </div>
                  </button>
                </div>
              </div>

              {isSubmitting && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating your project...
                </div>
              )}
            </>
          ) : (
            <>
              {/* Repo input mode */}
              <div className="flex w-full flex-col gap-4">
                {/* Repo URL */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-foreground">Repository URL</label>

                  {showGitHubRepos ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search repositories..."
                            className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        <button
                          onClick={() => {
                            setShowGitHubRepos(false)
                            setSearchQuery("")
                          }}
                          className="p-2 rounded-md hover:bg-muted transition-colors"
                        >
                          <X className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background">
                        {filteredRepos.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            {searchQuery ? "No repositories found" : "No repositories available"}
                          </div>
                        ) : (
                          filteredRepos.map((repo) => (
                            <button
                              key={repo.id}
                              onClick={() => {
                                setRepoUrl(repo.htmlUrl)
                                setShowGitHubRepos(false)
                                setSearchQuery("")
                                setShowManualInput(true)
                              }}
                              className="w-full p-3 text-left hover:bg-muted/50 border-b last:border-b-0 transition-colors"
                            >
                              <div className="flex items-start gap-2">
                                <Github className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">
                                    {repo.fullName}
                                  </div>
                                  {repo.description && (
                                    <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                      {repo.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ) : showManualInput ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="https://github.com/user/repo"
                        className="flex-1 h-10 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          setRepoUrl("")
                          setShowManualInput(false)
                        }}
                        className="p-2 rounded-md hover:bg-muted transition-colors"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {connected && (
                        <button
                          onClick={() => setShowGitHubRepos(true)}
                          className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:border-foreground/20 transition-colors"
                        >
                          <Github className="h-4 w-4" />
                          Browse GitHub repos
                        </button>
                      )}
                      <button
                        onClick={() => setShowManualInput(true)}
                        className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:border-foreground/20 transition-colors"
                      >
                        <GitBranch className="h-4 w-4" />
                        {connected ? "Manual URL" : "Enter URL"}
                      </button>
                    </div>
                  )}
                </div>

                {/* First Task */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-foreground">
                    What do you want to do as a first task?
                  </label>
                  <input
                    type="text"
                    value={firstTask}
                    onChange={(e) => setFirstTask(e.target.value)}
                    placeholder="e.g., Add user authentication, refactor API endpoints, set up CI/CD..."
                    className="h-10 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required if you want to skip AI and add the first task manually
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex w-full flex-col gap-3">
                <Button
                  onClick={handleStartWithFirstTask}
                  disabled={!repoUrl.trim() || !firstTask.trim() || isSubmitting}
                  className="h-12 w-full rounded-xl text-base font-semibold"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-[18px] w-[18px] animate-spin" />
                  ) : (
                    <ListTodo className="h-[18px] w-[18px]" />
                  )}
                  {isSubmitting ? "Creating..." : "Create Project & Add First Task"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleStartWithAI}
                  disabled={!repoUrl.trim() || isSubmitting}
                  className="h-12 w-full rounded-xl text-base font-semibold"
                >
                  <Sparkles className="h-[18px] w-[18px]" />
                  Or Use AI to Generate Plan
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setMode("choose")}
                  disabled={isSubmitting}
                  className="h-10 w-full rounded-xl"
                >
                  Back
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Git init confirmation dialog */}
      <GitInitDialog
        prompt={gitInitPrompt}
        onConfirm={confirmGitInit}
        onDismiss={dismissGitInit}
      />

      {/* Add environment dialog */}
      <AddEnvironmentDialog
        open={showAddEnvironment}
        onOpenChange={setShowAddEnvironment}
      />
    </div>
  )
}

function OptionCard({
  icon: Icon,
  title,
  description,
  workdir,
  onClick,
  disabled,
  primary,
  className,
}: {
  icon: typeof ListTodo
  title: string
  description: string
  workdir?: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-6 text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        primary
          ? "border-primary bg-primary/[0.03] hover:bg-primary/[0.05] shadow-[0_2px_8px_rgba(87,73,244,0.12)]"
          : "border-border bg-card hover:border-foreground/20",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl",
            primary ? "bg-primary/10" : "bg-muted"
          )}
        >
          <Icon className={cn("h-5 w-5", primary ? "text-primary" : "text-muted-foreground")} />
        </div>
        <span className="text-base font-semibold text-foreground">{title}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground mb-2">{description}</p>
      {workdir && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate">{workdir}</span>
        </div>
      )}
    </button>
  )
}

function EnvironmentCard({
  env,
  machineCount,
  isLocal,
}: {
  env: keyof typeof environmentConfig
  machineCount: number
  isLocal?: boolean
}) {
  const config = environmentConfig[env]
  const Icon = config.icon

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-foreground">{config.label}</div>
        </div>
        {machineCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            <span>{isLocal ? "Ready" : `${machineCount} connected`}</span>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{config.description}</p>
    </div>
  )
}
