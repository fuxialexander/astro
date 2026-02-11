import { useState, useCallback } from "react"
import { useNavigate } from "react-router"
import { Sparkles, Zap, Upload, Link as LinkIcon, Loader2, X, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"

export function ProjectNew() {
  const [description, setDescription] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [showRepoInput, setShowRepoInput] = useState(false)
  const [showDirInput, setShowDirInput] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [gitInitPrompt, setGitInitPrompt] = useState<{ projectId: string; dir: string; name: string } | null>(null)
  const navigate = useNavigate()
  const addProject = useProjectStore((s) => s.addProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const updateFileTree = useProjectStore((s) => s.updateFileTree)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)

  // Voice transcription for project description
  const handleTranscript = useCallback((text: string) => {
    setDescription((prev) => {
      // Add a space separator if there's existing text
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

  async function handleGenerate() {
    if (!description.trim()) return
    const id = `proj-${crypto.randomUUID().slice(0, 8)}`
    const projectName = description.slice(0, 50).trim() || "New Project"
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
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    navigate(`/project/${id}`)
    // Trigger plan generation after navigation
    if (connectionStatus === "connected") {
      startGeneration(id, description.trim())
    }
    // Repo setup runs in parallel with plan generation (non-blocking)
    setupRepo(id, projectName, description.trim())
  }

  async function setupRepo(projectId: string, projectName: string, projectDescription: string) {
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
        }),
      })
      if (!res.ok) return
      const data = await res.json()

      if (data.needsGitInit) {
        // Prompt user to confirm git init
        setGitInitPrompt({ projectId, dir: data.workingDirectory, name: projectName })
        return
      }

      // Update project with resolved working directory and file tree
      if (data.workingDirectory) {
        updateProject(projectId, { workingDirectory: data.workingDirectory })
      }
      if (data.fileTree) {
        updateFileTree(projectId, data.fileTree)
      }
    } catch (error) {
      console.error("[project-new] Repo setup failed:", error)
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
                      placeholder="/path/to/project"
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
                    Local dir
                  </button>
                )}
              </div>
              {showDirInput && (
                <p className="text-[11px] text-muted-foreground pl-1">
                  Leave empty to create a new project directory automatically
                </p>
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
