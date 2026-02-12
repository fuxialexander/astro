import { useState, useCallback, useEffect } from "react"
import { useNavigate } from "react-router"
import { Sparkles, Zap, Upload, Link as LinkIcon, Loader2, X, FolderOpen, Laptop, Globe, Server, Cloud, ChevronDown, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"

const environmentConfig = {
  local: { icon: Laptop, label: "Local", description: "Run on this machine" },
  remote: { icon: Globe, label: "Remote", description: "Run on remote machine" },
  hpc: { icon: Server, label: "HPC", description: "Run on HPC cluster" },
  cloud: { icon: Cloud, label: "Cloud", description: "Run on cloud instance" },
}

type EnvironmentType = keyof typeof environmentConfig

export function ProjectNew() {
  const [description, setDescription] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [showRepoInput, setShowRepoInput] = useState(false)
  const [showDirInput, setShowDirInput] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [selectedEnvironment, setSelectedEnvironment] = useState<EnvironmentType>("local")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [gitInitPrompt, setGitInitPrompt] = useState<{ projectId: string; dir: string; name: string } | null>(null)
  const navigate = useNavigate()
  const addProject = useProjectStore((s) => s.addProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const updateFileTree = useProjectStore((s) => s.updateFileTree)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)

  // Machine state from execution store
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const getMachinesForEnvironment = useExecutionStore((s) => s.getMachinesForEnvironment)

  useEffect(() => {
    if (!machinesLoaded) {
      loadMachines()
    }
  }, [machinesLoaded, loadMachines])

  const availableMachines = getMachinesForEnvironment(selectedEnvironment)
  const isRemote = selectedEnvironment !== "local"

  // Voice transcription for project description
  const handleTranscript = useCallback((text: string) => {
    setDescription((prev) => {
      if (prev.trim()) {
        return prev.trim() + " " + text
      }
      return text
    })
  }, [])

  const {
    isRecording,
    isTranscribing,
    isAvailable,
    duration,
    toggleRecording,
  } = useVoiceTranscription({
    onTranscript: handleTranscript,
  })

  const setGenerationPhase = useAgentStore((s) => s.setGenerationPhase)

  async function handleGenerate() {
    if (!description.trim()) return
    const id = `proj-${crypto.randomUUID().slice(0, 8)}`
    const projectName = description.slice(0, 50).trim() || "New Project"
    const hasRepo = !!(repoUrl.trim() || workingDir.trim())

    addProject({
      id,
      name: projectName,
      description: description.trim(),
      visionDoc: "",
      status: "active",
      startDate: startDate || undefined,
      targetDate: targetDate || undefined,
      workingDirectory: workingDir.trim() || undefined,
      repository: repoUrl.trim() || undefined,
      defaultEnvironment: isRemote ? selectedEnvironment : undefined,
      defaultMachineId: selectedMachine?.machineId || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    navigate(`/project/${id}/plan`)

    if (connectionStatus !== "connected") return

    if (hasRepo) {
      // Repo-aware flow: clone/setup first, then generate with context
      setGenerationPhase('repo_setup')
      const repoResult = await setupRepo(id, projectName, description.trim())
      if (repoResult?.workingDirectory) {
        startGeneration(id, description.trim(), undefined, {
          workingDirectory: repoResult.workingDirectory,
          fileTree: repoResult.fileTree,
        })
      } else {
        // Repo setup failed or needs git init — generate without repo context
        startGeneration(id, description.trim())
      }
    } else {
      // Fast path: no repo, generate immediately
      startGeneration(id, description.trim())
    }
  }

  async function setupRepo(projectId: string, projectName: string, projectDescription: string): Promise<{ workingDirectory?: string; fileTree?: string[] } | null> {
    try {
      const res = await fetch("/api/repo/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName,
          projectDescription,
          workingDirectory: workingDir.trim() || undefined,
          repository: repoUrl.trim() || undefined,
          targetMachineId: selectedMachine?.machineId || undefined,
        }),
      })
      if (!res.ok) return null
      const data = await res.json()

      if (data.needsGitInit) {
        // Prompt user to confirm git init
        setGitInitPrompt({ projectId, dir: data.workingDirectory, name: projectName })
        return null
      }

      // Update project with resolved working directory, file tree, and auto-detected repository
      if (data.workingDirectory || data.repository) {
        updateProject(projectId, {
          ...(data.workingDirectory ? { workingDirectory: data.workingDirectory } : {}),
          ...(data.repository ? { repository: data.repository } : {}),
        })
      }
      if (data.fileTree) {
        updateFileTree(projectId, data.fileTree)
      }

      return { workingDirectory: data.workingDirectory, fileTree: data.fileTree }
    } catch (error) {
      console.error("[project-new] Repo setup failed:", error)
      return null
    }
  }

  async function handleConfirmGitInit() {
    if (!gitInitPrompt) return
    const { projectId, dir, name } = gitInitPrompt
    setGitInitPrompt(null)
    try {
      const res = await fetch("/api/repo/git-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingDirectory: dir,
          projectId,
          projectName: name,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.workingDirectory) {
        updateProject(projectId, { workingDirectory: data.workingDirectory })
      }
      if (data.fileTree) {
        updateFileTree(projectId, data.fileTree)
      }
    } catch (error) {
      console.error("[project-new] Git init failed:", error)
    }
  }

  const EnvironmentIcon = environmentConfig[selectedEnvironment].icon

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex w-[640px] flex-col items-center gap-8">
        {/* Icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
          <Sparkles className="h-7 w-7 text-primary-foreground" />
        </div>

        {/* Heading */}
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-3xl font-bold">What are you building?</h1>
          <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
            Describe your goal and we'll generate an intelligent plan with tasks, dependencies, and milestones.
          </p>
        </div>

        {/* Input area */}
        <div className="flex w-full flex-col gap-4">
          <div className="relative">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="I'm building a personal finance app with AI-powered budgeting, transaction categorization, and savings goals tracking..."
              className="h-[140px] w-full resize-none rounded-xl border border-border bg-card p-4 pr-12 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {/* Voice input button */}
            <div className="absolute right-3 top-3">
              <VoiceInputButton
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                isAvailable={isAvailable}
                duration={duration}
                onClick={toggleRecording}
                disabled={isGenerating}
              />
            </div>
            {/* Recording indicator */}
            {isRecording && (
              <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-red-500">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Recording... {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}
              </div>
            )}
            {isTranscribing && (
              <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Transcribing...
              </div>
            )}
          </div>

          {/* Optional context */}
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-medium text-muted-foreground">Optional context</span>
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-2.5">
                <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                  <Upload className="h-4 w-4" />
                  Upload docs
                </button>
                {showRepoInput ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/user/repo.git"
                      className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                    <button
                      onClick={() => { setShowRepoInput(false); setRepoUrl("") }}
                      className="p-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowRepoInput(true)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer"
                  >
                    <LinkIcon className="h-4 w-4" />
                    Link repo
                  </button>
                )}
                {showDirInput ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={workingDir}
                      onChange={(e) => setWorkingDir(e.target.value)}
                      placeholder={isRemote ? "/remote/path/to/project" : "/path/to/project"}
                      className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                    <button
                      onClick={() => { setShowDirInput(false); setWorkingDir("") }}
                      className="p-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDirInput(true)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer"
                  >
                    <FolderOpen className="h-4 w-4" />
                    {isRemote ? "Remote path" : "Local dir"}
                  </button>
                )}
              </div>
              {showDirInput && !isRemote && (
                <p className="text-[11px] text-muted-foreground pl-1">
                  Leave empty to create a new project directory automatically
                </p>
              )}
              {showDirInput && isRemote && (
                <p className="text-[11px] text-muted-foreground pl-1">
                  Path on the remote machine's filesystem
                </p>
              )}
            </div>
          </div>

          {/* Environment */}
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-medium text-muted-foreground">Environment</span>
            <div className="flex items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                    <EnvironmentIcon className="h-4 w-4" />
                    {environmentConfig[selectedEnvironment].label}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Select Environment</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(Object.keys(environmentConfig) as EnvironmentType[]).map((env) => {
                    const config = environmentConfig[env]
                    const Icon = config.icon
                    const machineCount = getMachinesForEnvironment(env).length
                    return (
                      <DropdownMenuItem
                        key={env}
                        onClick={() => {
                          setSelectedEnvironment(env)
                          setSelectedMachine(null)
                        }}
                        className="gap-2"
                      >
                        <Icon className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span>{config.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {env === "local" ? config.description : `${machineCount} available`}
                          </span>
                        </div>
                        {selectedEnvironment === env && (
                          <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                        )}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Machine selector for non-local environments */}
              {isRemote && availableMachines.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                      <Server className="h-4 w-4" />
                      <span className="max-w-[140px] truncate">
                        {selectedMachine?.name || "Select machine"}
                      </span>
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>Select Machine</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {availableMachines.map((machine) => (
                      <DropdownMenuItem
                        key={machine.machineId}
                        onClick={() => setSelectedMachine(machine)}
                        className="gap-2"
                      >
                        <Server className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span>{machine.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {machine.hostname || machine.machineId}
                          </span>
                        </div>
                        {selectedMachine?.machineId === machine.machineId && (
                          <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {isRemote && availableMachines.length === 0 && machinesLoaded && (
                <span className="text-xs text-muted-foreground">
                  No {environmentConfig[selectedEnvironment].label.toLowerCase()} machines connected
                </span>
              )}
            </div>
          </div>

          {/* Timeline & Constraints */}
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-medium text-muted-foreground">Timeline & Constraints</span>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[11px] text-muted-foreground">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[11px] text-muted-foreground">Target Date</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Generate button */}
        <Button
          onClick={handleGenerate}
          className="h-12 rounded-xl px-8 text-base font-semibold"
          disabled={!description.trim() || isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <Zap className="h-[18px] w-[18px]" />
          )}
          {isGenerating ? "Generating..." : "Generate Plan"}
        </Button>

        {/* Git init confirmation dialog */}
        {gitInitPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-lg max-w-md">
              <h3 className="text-sm font-semibold">Initialize Git Repository?</h3>
              <p className="text-sm text-muted-foreground">
                The directory <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{gitInitPrompt.dir}</code> is not a git repository. Initialize one?
              </p>
              <p className="text-xs text-muted-foreground">
                This will create a .gitignore, CLAUDE.md, and make an initial commit.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setGitInitPrompt(null)}>
                  Skip
                </Button>
                <Button size="sm" onClick={handleConfirmGitInit}>
                  Initialize
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
