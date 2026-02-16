import { useState, useCallback, useEffect } from "react"
import { useNavigate } from "react-router"
import {
  Compass,
  Type,
  FileText,
  Download,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Server,
  Globe,
  Code2,
  FlaskConical,
  Zap,
  Loader2,
  GitBranch,
  FolderGit2,
  Check,
  Laptop,
  Cloud,
  ChevronDown,
  CheckCircle2,
  Bot,
  RefreshCw,
  Github,
  Search,
  X,
} from "lucide-react"
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
import { useRealtimeStore, type MachineEntry } from "@/stores/realtime-store"
import { useGitHubStore } from "@/stores/github-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
import { useRepoSetup } from "@/hooks/use-repo-setup"
import { useWelcomeFormPersistence } from "@/hooks/use-welcome-form-persistence"
import { GitInitDialog } from "@/components/git-init-dialog"
import { MobileStatusBar } from "@/components/mobile/status-bar"
import { cn } from "@/lib/utils"

type UserType = "builder" | "scientist" | null
type InputMode = "type" | "paste" | "import" | "repo"

const TOTAL_STEPS = 3

// Convert realtime machine to MachineInfo format
function convertRealtimeMachine(machine: MachineEntry): MachineInfo {
  return {
    machineId: machine.machineId,
    name: machine.name,
    environmentType: machine.environmentType as 'local' | 'remote' | 'hpc' | 'cloud',
    hostname: machine.machineId, // Use machineId as fallback
    status: (machine.connectionStatus === 'connected' ? 'online' : 'offline') as 'online' | 'offline' | 'busy',
    providers: machine.providers.map((p) => ({
      type: p.type,
      status: p.status,
    })),
  }
}

const environmentConfig = {
  local: { icon: Laptop, label: "Local", description: "Run on this machine" },
  remote: { icon: Globe, label: "Remote", description: "Run on remote machine" },
  hpc: { icon: Server, label: "HPC", description: "Run on HPC cluster" },
  cloud: { icon: Cloud, label: "Cloud", description: "Run on cloud instance" },
}

type EnvironmentType = keyof typeof environmentConfig

const BUILDER_DOMAINS = [
  "Web Development",
  "Mobile Development",
  "Backend / API",
  "Data Engineering",
  "DevOps / Infrastructure",
  "Machine Learning / AI",
]

const SCIENTIST_DOMAINS = [
  "Computational Biology",
  "Genomics / Bioinformatics",
  "Data Science",
  "Physics / Chemistry",
  "Neuroscience",
  "Climate / Environmental",
]

// --- Step Indicator ---

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 w-2 rounded-full transition-colors",
            i + 1 <= current ? "bg-primary" : "bg-border"
          )}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">
        Step {current} of {TOTAL_STEPS}
      </span>
    </div>
  )
}

// --- Main Component ---

export function Welcome() {
  // Form persistence hook
  const { state: formState, updateField, clearState } = useWelcomeFormPersistence()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const navigate = useNavigate()
  const addProject = useProjectStore((s) => s.addProject)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const setGenerationPhase = useAgentStore((s) => s.setGenerationPhase)
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)

  // Shared repo setup hook
  const { setupRepo, gitInitPrompt, dismissGitInit, confirmGitInit } = useRepoSetup()

  // Machine state from execution store (legacy, for getMachinesForEnvironment)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const getMachinesForEnvironment = useExecutionStore((s) => s.getMachinesForEnvironment)

  // Real-time machine updates
  const realtimeMachines = useRealtimeStore((s) => s.machines)

  // Provider state
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)
  const setDefaultProvider = useSettingsStore((s) => s.setDefaultProvider)

  useEffect(() => {
    if (!machinesLoaded) loadMachines()
    if (!providersLoaded) loadProviders()
  }, [machinesLoaded, loadMachines, providersLoaded, loadProviders])

  // Derive machine list: combine execution store + realtime store
  const availableMachines = getMachinesForEnvironment(formState.selectedEnvironment)
  const realtimeMachinesList = Array.from(realtimeMachines.values()).filter(
    (m) => m.environmentType === formState.selectedEnvironment
  )

  const isRemoteEnv = formState.selectedEnvironment !== "local"
  const EnvironmentIcon = environmentConfig[formState.selectedEnvironment].icon

  // Extract persisted state for easier access
  const step = formState.currentStep
  const userType = formState.userType
  const inputMode = formState.inputMode
  const description = formState.description
  const pastedDoc = formState.pastedDoc
  const repoUrl = formState.repoUrl
  const repoPath = formState.repoPath
  const domain = formState.domain
  const startDate = formState.startDate
  const targetDate = formState.targetDate
  const techStack = formState.techStack
  const selectedEnvironment = formState.selectedEnvironment
  const selectedMachineId = formState.selectedMachineId

  // Find selected machine from either store
  const selectedMachine = selectedMachineId
    ? availableMachines.find((m) => m.machineId === selectedMachineId) ||
      (realtimeMachinesList.find((m) => m.machineId === selectedMachineId)
        ? convertRealtimeMachine(realtimeMachinesList.find((m) => m.machineId === selectedMachineId)!)
        : null)
    : null

  // Wrapper functions to update persisted state
  const setStep = (val: number) => updateField('currentStep', val)
  const setUserType = (val: UserType) => updateField('userType', val)
  const setInputMode = (val: InputMode) => updateField('inputMode', val)
  const setDescription = (val: string) => updateField('description', val)
  const setPastedDoc = (val: string) => updateField('pastedDoc', val)
  const setRepoUrl = (val: string) => updateField('repoUrl', val)
  const setRepoPath = (val: string) => updateField('repoPath', val)
  const setDomain = (val: string) => updateField('domain', val)
  const setStartDate = (val: string) => updateField('startDate', val)
  const setTargetDate = (val: string) => updateField('targetDate', val)
  const setTechStack = (val: string) => updateField('techStack', val)
  const setSelectedEnvironment = (val: EnvironmentType) => updateField('selectedEnvironment', val)
  const setSelectedMachineId = (val: string | null) => updateField('selectedMachineId', val)

  // GitHub integration
  const { connected, repos, selectedRepoIds, error: githubError, fetchRepos, connect } = useGitHubStore()
  const [showGitHubRepos, setShowGitHubRepos] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

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

  // Voice transcription
  const handleTranscript = useCallback((text: string) => {
    const prev = description
    if (prev.trim()) {
      setDescription(prev.trim() + " " + text)
    } else {
      setDescription(text)
    }
  }, [description, setDescription])

  const {
    isRecording,
    isTranscribing,
    isAvailable: voiceAvailable,
    duration: voiceDuration,
    toggleRecording,
  } = useVoiceTranscription({
    onTranscript: handleTranscript,
  })

  // Research-language detection
  const isResearchLike = useCallback((text: string) => {
    const terms = [
      "hypothesis", "hypotheses", "experiment", "analysis", "dataset",
      "pipeline", "genome", "protein", "sequencing", "statistical",
      "p-value", "regression", "clustering", "rnaseq", "rna-seq",
      "variant", "mutation", "phenotype", "genotype", "compute",
      "hpc", "slurm", "cluster", "simulation", "model training",
    ]
    const lower = text.toLowerCase()
    return terms.some((t) => lower.includes(t))
  }, [])

  const detectedResearch = description.length > 30 && isResearchLike(description)
  const effectiveUserType = userType ?? (detectedResearch ? "scientist" : null)

  const primaryInput = inputMode === "paste" ? pastedDoc : description
  const hasRepo = !!(repoUrl.trim() || repoPath.trim())
  const domains = effectiveUserType === "scientist" ? SCIENTIST_DOMAINS : BUILDER_DOMAINS

  // Step validation
  const canAdvanceFromStep1 = primaryInput.trim().length > 0 || (inputMode === "repo" && hasRepo)
  const canAdvanceFromStep2 = true // Context is always optional

  function buildDescription(): string {
    let desc = primaryInput.trim()
    if (repoUrl) desc += `\n\nRepository: ${repoUrl}`
    if (repoPath) desc += `\n\nLocal repo: ${repoPath}`
    if (domain) desc += `\nDomain: ${domain}`
    if (techStack) desc += `\nTech stack / environment: ${techStack}`
    if (effectiveUserType) desc += `\nUser type: ${effectiveUserType}`
    if (startDate || targetDate) {
      desc += `\nTimeline: ${startDate ? `starts ${startDate}` : ""}${startDate && targetDate ? ", " : ""}${targetDate ? `target ${targetDate}` : ""}`
    }
    return desc
  }

  async function handleStructurePlan() {
    const input = primaryInput.trim()
    if ((!input && !hasRepo) || isSubmitting) return
    setIsSubmitting(true)

    const id = crypto.randomUUID()  // Use proper UUID format for PostgreSQL
    const fullDescription = buildDescription()
    const repoUrlVal = repoUrl.trim()
    const repoPathVal = repoPath.trim()
    const projectName = input.slice(0, 50).trim() || repoUrlVal.split("/").pop() || "New Project"

    addProject({
      id,
      name: projectName,
      description: fullDescription,
      visionDoc: inputMode === "paste" ? pastedDoc : "",
      status: "active",
      startDate: startDate || undefined,
      targetDate: targetDate || undefined,
      repository: repoUrlVal || undefined,
      workingDirectory: repoPathVal || undefined,
      defaultEnvironment: isRemoteEnv ? selectedEnvironment : undefined,
      defaultMachineId: selectedMachine?.machineId || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Clear persisted form state after successful submission
    clearState()

    navigate(`/project/${id}/plan`)

    if (connectionStatus !== "connected") return

    // Always use repo setup — handles creating dir, git init, clone, file tree
    setGenerationPhase(id, 'repo_setup')
    const repoResult = await setupRepo({
      projectId: id,
      projectName,
      projectDescription: fullDescription,
      workingDirectory: repoPathVal || undefined,
      repository: repoUrlVal || undefined,
      targetMachineId: selectedMachine?.machineId || undefined,
    })

    if (repoResult?.workingDirectory) {
      startGeneration(id, projectName, fullDescription, undefined, {
        workingDirectory: repoResult.workingDirectory,
        fileTree: repoResult.fileTree,
        keyFiles: repoResult.keyFiles,
        targetMachineId: selectedMachine?.machineId,
      })
    } else {
      // Repo setup returned null (needsGitInit or error) — generate without context
      startGeneration(id, projectName, fullDescription)
    }
  }

  const placeholderByType: Record<string, string> = {
    builder:
      "I'm building a personal finance app with AI-powered budgeting, transaction categorization, and savings goals. The backend needs to handle real-time bank sync via Plaid...",
    scientist:
      "I want to analyze single-cell RNA-seq data from developing lobster neural tissue to identify conserved developmental gene regulatory networks across arthropods...",
    default:
      "Describe your goal conversationally. What are you trying to build or explore? What's the bigger picture?",
  }

  const placeholder = effectiveUserType
    ? placeholderByType[effectiveUserType]
    : placeholderByType.default

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Mobile Status Bar */}
      <MobileStatusBar />

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="flex w-full max-w-[600px] flex-col items-center gap-10">
        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Brand */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Compass className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-sm font-bold tracking-[4px] text-foreground">NEXUS</span>
        </div>

        {/* ========== STEP 1: What are you working on? ========== */}
        {step === 1 && (
          <>
            {/* Heading */}
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-center text-3xl font-semibold text-foreground">
                What are you working on?
              </h1>
              <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
                Describe your goal and Nexus will structure it into an actionable plan with tasks, dependencies, and milestones.
              </p>
            </div>

            {/* User type cards */}
            <div className="flex w-full gap-3">
              <UserTypeCard
                type="builder"
                selected={userType === "builder"}
                onSelect={() => setUserType(userType === "builder" ? null : "builder")}
              />
              <UserTypeCard
                type="scientist"
                selected={userType === "scientist"}
                onSelect={() => setUserType(userType === "scientist" ? null : "scientist")}
              />
            </div>

            {/* Input mode tabs */}
            <div className="flex w-full flex-col gap-4">
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                {([
                  { key: "type" as const, label: "Type directly", icon: Type },
                  { key: "paste" as const, label: "Paste a doc", icon: FileText },
                  { key: "repo" as const, label: "Point to repo", icon: GitBranch },
                  { key: "import" as const, label: "Import", icon: Download },
                ] as const).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setInputMode(key)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[13px] font-medium transition-colors cursor-pointer",
                      inputMode === key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Type directly */}
              {inputMode === "type" && (
                <div className="relative">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={placeholder}
                    className="h-[160px] w-full resize-none rounded-xl border border-border bg-card p-4 pr-12 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                  />
                  <div className="absolute right-3 top-3">
                    <VoiceInputButton
                      isRecording={isRecording}
                      isTranscribing={isTranscribing}
                      isAvailable={voiceAvailable}
                      duration={voiceDuration}
                      onClick={toggleRecording}
                      disabled={isSubmitting}
                    />
                  </div>
                  {isRecording && (
                    <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-red-500">
                      <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      Recording... {Math.floor(voiceDuration / 60)}:{(voiceDuration % 60).toString().padStart(2, '0')}
                    </div>
                  )}
                  {isTranscribing && (
                    <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Transcribing...
                    </div>
                  )}
                </div>
              )}

              {/* Paste a document */}
              {inputMode === "paste" && (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] text-muted-foreground">
                    Paste a PRD, research proposal, project notes, or any document describing what you're working on.
                  </p>
                  <textarea
                    value={pastedDoc}
                    onChange={(e) => setPastedDoc(e.target.value)}
                    placeholder="Paste your document here..."
                    className="h-[200px] w-full resize-none rounded-xl border border-border bg-card p-4 font-mono text-[13px] leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                  />
                </div>
              )}

              {/* Point to repo */}
              {inputMode === "repo" && (
                <div className="flex flex-col gap-4">
                  <p className="text-[13px] text-muted-foreground">
                    Point to an existing repository and describe what you want to do with it.
                  </p>

                  {/* GitHub URL */}
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      GitHub URL
                    </label>
                    <input
                      type="text"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/user/repo"
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                  </div>

                  {/* Local path */}
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                      <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                      Or local path
                    </label>
                    <input
                      type="text"
                      value={repoPath}
                      onChange={(e) => setRepoPath(e.target.value)}
                      placeholder="/Users/you/projects/my-repo"
                      className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>

                  {/* What do you want to do with it? */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[13px] font-medium text-foreground">
                      What do you want to do with this repo?
                    </label>
                    <div className="relative">
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="e.g., Add user authentication with OAuth, refactor the database layer to use Prisma, set up CI/CD pipeline..."
                        className="h-[100px] w-full resize-none rounded-xl border border-border bg-card p-4 pr-12 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="absolute right-3 top-3">
                        <VoiceInputButton
                          isRecording={isRecording}
                          isTranscribing={isTranscribing}
                          isAvailable={voiceAvailable}
                          duration={voiceDuration}
                          onClick={toggleRecording}
                          disabled={isSubmitting}
                        />
                      </div>
                      {isRecording && (
                        <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-red-500">
                          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                          Recording... {Math.floor(voiceDuration / 60)}:{(voiceDuration % 60).toString().padStart(2, '0')}
                        </div>
                      )}
                      {isTranscribing && (
                        <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Transcribing...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Import */}
              {inputMode === "import" && (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    Import from an existing tool to bring in your project context.
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { name: "Linear", desc: "Issues & projects" },
                      { name: "Notion", desc: "Pages & databases" },
                      { name: "Google Docs", desc: "Documents" },
                    ].map((tool) => (
                      <button
                        key={tool.name}
                        className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm transition-colors hover:border-foreground/20 cursor-pointer"
                      >
                        <span className="font-medium text-foreground">{tool.name}</span>
                        <span className="text-xs text-muted-foreground">{tool.desc}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-center text-xs text-muted-foreground/60">
                    Import integrations coming soon. Use another input method for now.
                  </p>
                </div>
              )}

              {/* Domain detection nudge */}
              {detectedResearch && !userType && (
                <div className="flex items-center gap-2 rounded-lg bg-[#FEF3C7]/30 px-3 py-2 text-[13px] text-[#D97706]">
                  <FlaskConical className="h-4 w-4 shrink-0" />
                  This sounds like research. We'll tailor prompts for scientific workflows.
                </div>
              )}
            </div>

            {/* Step 1 CTA */}
            <div className="flex w-full flex-col items-center gap-3">
              <Button
                onClick={() => setStep(2)}
                disabled={!canAdvanceFromStep1}
                className="h-12 w-full rounded-xl text-base font-semibold"
              >
                Continue
                <ChevronRight className="h-[18px] w-[18px]" />
              </Button>
            </div>
          </>
        )}

        {/* ========== STEP 2: Add context ========== */}
        {step === 2 && (
          <>
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-center text-3xl font-semibold text-foreground">
                {effectiveUserType === "scientist"
                  ? "Tell us about your research"
                  : "Tell us about your project"}
              </h1>
              <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
                Optional context to help the AI generate a better plan. Skip anything you don't know yet.
              </p>
            </div>

            <div className="flex w-full flex-col gap-5">
              {/* Domain */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  {effectiveUserType === "scientist"
                    ? "What's your research domain?"
                    : "What domain are you working in?"}
                </label>
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer"
                >
                  <option value="">Select a domain...</option>
                  {domains.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Timeline */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Do you have a deadline?
                </label>
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Start</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Target</span>
                    <input
                      type="date"
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                      className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              {/* Environment */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  Execution environment
                </label>
                <div className="flex items-center gap-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                        <EnvironmentIcon className="h-4 w-4 text-muted-foreground" />
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
                              setSelectedMachineId(null)
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
                  {isRemoteEnv && (
                    <>
                      {(availableMachines.length > 0 || realtimeMachinesList.length > 0) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                              <Server className="h-4 w-4 text-muted-foreground" />
                              <span className="max-w-[140px] truncate">
                                {selectedMachine?.name || "Select machine"}
                              </span>
                              <ChevronDown className="h-3 w-3 opacity-50" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuLabel>Select Machine</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {/* Show machines from both stores */}
                            {availableMachines.map((machine) => (
                              <DropdownMenuItem
                                key={machine.machineId}
                                onClick={() => setSelectedMachineId(machine.machineId)}
                                className="gap-2"
                              >
                                <Server className="h-4 w-4" />
                                <div className="flex flex-col">
                                  <span>{machine.name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {machine.hostname || machine.machineId}
                                  </span>
                                </div>
                                {selectedMachineId === machine.machineId && (
                                  <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                                )}
                              </DropdownMenuItem>
                            ))}
                            {/* Add realtime machines not in execution store */}
                            {realtimeMachinesList
                              .filter((rtm) => !availableMachines.some((m) => m.machineId === rtm.machineId))
                              .map((machine) => (
                                <DropdownMenuItem
                                  key={machine.machineId}
                                  onClick={() => setSelectedMachineId(machine.machineId)}
                                  className="gap-2"
                                >
                                  <Server className="h-4 w-4" />
                                  <div className="flex flex-col">
                                    <span>{machine.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {machine.machineId}
                                    </span>
                                  </div>
                                  {selectedMachineId === machine.machineId && (
                                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                                  )}
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-sm border border-amber-200 dark:border-amber-900">
                          <RefreshCw className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-spin" />
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-amber-900 dark:text-amber-100">
                              Waiting for agent...
                            </span>
                            <span className="text-xs text-amber-700 dark:text-amber-300">
                              Complete the agent setup in your terminal. This page will update automatically.
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* AI Provider */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  Preferred AI agent
                </label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground hover:border-foreground/20 transition-colors cursor-pointer w-fit">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      {defaultProvider
                        ? providers.find((p) => p.id === defaultProvider)?.name ?? defaultProvider
                        : "Auto (first available)"}
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>Select AI Agent</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDefaultProvider("")}
                      className="gap-2"
                    >
                      <Zap className="h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Auto</span>
                        <span className="text-xs text-muted-foreground">Use first available provider</span>
                      </div>
                      {!defaultProvider && (
                        <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                    {providers.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => setDefaultProvider(p.id)}
                        disabled={!p.available}
                        className="gap-2"
                      >
                        <Bot className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span>{p.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.available ? "Ready" : p.installed ? "Not authenticated" : "Not installed"}
                          </span>
                        </div>
                        {defaultProvider === p.id && (
                          <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                    {providers.length === 0 && providersLoaded && (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        No providers detected. Install Claude Code or Codex CLI.
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Tech stack / compute */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <Code2 className="h-4 w-4 text-muted-foreground" />
                  {effectiveUserType === "scientist"
                    ? "What tools / frameworks do you use?"
                    : "What's your tech stack?"}
                </label>
                <input
                  type="text"
                  value={techStack}
                  onChange={(e) => setTechStack(e.target.value)}
                  placeholder={
                    effectiveUserType === "scientist"
                      ? "e.g., Python, Nextflow, R, Jupyter..."
                      : "e.g., React, Node.js, PostgreSQL, Vercel..."
                  }
                  className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Repo (if not already specified in step 1) */}
              {inputMode !== "repo" && (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    Link a repository (optional)
                  </label>

                  {/* GitHub Repo Selector */}
                  {showGitHubRepos ? (
                    <div className="flex flex-col gap-2 p-3 rounded-xl border border-border bg-card">
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
                  ) : repoUrl ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="https://github.com/user/repo or /path/to/local/repo"
                        className="flex-1 h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        onClick={() => setRepoUrl("")}
                        className="p-2 rounded-md hover:bg-muted transition-colors"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {connected ? (
                        <>
                          <button
                            onClick={() => setShowGitHubRepos(true)}
                            className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-foreground hover:border-foreground/20 transition-colors"
                          >
                            <Github className="h-4 w-4" />
                            Browse GitHub repos
                          </button>
                          <button
                            onClick={() => setRepoUrl("/")}
                            className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground hover:border-foreground/20 transition-colors"
                          >
                            <GitBranch className="h-4 w-4" />
                            Enter manually
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={connect}
                              className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 text-sm text-primary hover:bg-primary/20 transition-colors"
                            >
                              <Github className="h-4 w-4" />
                              Connect GitHub
                            </button>
                            <button
                              onClick={() => setRepoUrl("/")}
                              className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground hover:border-foreground/20 transition-colors"
                            >
                              <GitBranch className="h-4 w-4" />
                              Enter manually
                            </button>
                          </div>
                          {githubError && (
                            <p className="text-sm text-destructive">{githubError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2 Navigation */}
            <div className="flex w-full gap-3">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="h-12 rounded-xl px-6 text-base"
              >
                <ChevronLeft className="h-[18px] w-[18px]" />
                Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!canAdvanceFromStep2}
                className="h-12 flex-1 rounded-xl text-base font-semibold"
              >
                Continue
                <ChevronRight className="h-[18px] w-[18px]" />
              </Button>
            </div>
          </>
        )}

        {/* ========== STEP 3: Review & Generate ========== */}
        {step === 3 && (
          <>
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-center text-3xl font-semibold text-foreground">
                Ready to structure your plan
              </h1>
              <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
                Review what you've shared. The AI will organize your intent into a structured graph of tasks and dependencies.
              </p>
            </div>

            {/* Summary card */}
            <div className="flex w-full flex-col gap-0.5 rounded-xl border border-border overflow-hidden">
              {/* Description */}
              <SummaryRow
                label={inputMode === "repo" ? "Goal" : "Description"}
                value={primaryInput.trim() || "—"}
                truncate
              />

              {/* User type */}
              {effectiveUserType && (
                <SummaryRow
                  label="Role"
                  value={effectiveUserType === "builder" ? "Builder" : "Scientist"}
                />
              )}

              {/* Repository */}
              {(repoUrl || repoPath) && (
                <SummaryRow
                  label="Repository"
                  value={repoUrl || repoPath}
                  mono
                />
              )}

              {/* Domain */}
              {domain && <SummaryRow label="Domain" value={domain} />}

              {/* Timeline */}
              {(startDate || targetDate) && (
                <SummaryRow
                  label="Timeline"
                  value={`${startDate || "No start"} → ${targetDate || "No target"}`}
                />
              )}

              {/* Tech stack */}
              {techStack && (
                <SummaryRow
                  label={effectiveUserType === "scientist" ? "Tools" : "Tech Stack"}
                  value={techStack}
                />
              )}

              {/* Environment */}
              <SummaryRow
                label="Environment"
                value={
                  selectedMachine
                    ? `${environmentConfig[selectedEnvironment].label} — ${selectedMachine.name}`
                    : environmentConfig[selectedEnvironment].label
                }
              />

              {/* AI Provider */}
              <SummaryRow
                label="AI Agent"
                value={
                  defaultProvider
                    ? providers.find((p) => p.id === defaultProvider)?.name ?? defaultProvider
                    : "Auto (first available)"
                }
              />
            </div>

            {/* Environment ready note */}
            <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-4 py-3 text-[13px] text-foreground">
              <Check className="h-4 w-4 text-primary shrink-0" />
              <span>
                {selectedEnvironment === "local" ? (
                  <>Environment set to <strong>local</strong> — no setup required to start.</>
                ) : selectedMachine ? (
                  <>Tasks will run on <strong>{selectedMachine.name}</strong> ({environmentConfig[selectedEnvironment].label}).</>
                ) : (
                  <>Environment set to <strong>{environmentConfig[selectedEnvironment].label.toLowerCase()}</strong> — select a machine in Environments after plan generation.</>
                )}
                {connectionStatus === "connected" && " Backend connected."}
              </span>
            </div>

            {/* Step 3 Navigation */}
            <div className="flex w-full flex-col items-center gap-3">
              <div className="flex w-full gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  className="h-12 rounded-xl px-6 text-base"
                >
                  <ChevronLeft className="h-[18px] w-[18px]" />
                  Back
                </Button>
                <Button
                  onClick={handleStructurePlan}
                  disabled={(!primaryInput.trim() && !hasRepo) || isSubmitting}
                  className="h-12 flex-1 rounded-xl text-base font-semibold"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-[18px] w-[18px] animate-spin" />
                  ) : (
                    <Zap className="h-[18px] w-[18px]" />
                  )}
                  {isSubmitting ? "Structuring..." : "Structure Plan"}
                </Button>
              </div>
              <p className="text-[13px] text-muted-foreground">
                You can always refine the plan after it's generated
              </p>
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
    </div>
  )
}

// --- User type selection card ---

function UserTypeCard({
  type,
  selected,
  onSelect,
}: {
  type: "builder" | "scientist"
  selected: boolean
  onSelect: () => void
}) {
  const isBuilder = type === "builder"
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex flex-1 flex-col gap-2 rounded-2xl border p-5 text-left transition-all cursor-pointer",
        selected
          ? "border-primary bg-primary/[0.03] shadow-[0_2px_8px_rgba(87,73,244,0.12)]"
          : "border-border bg-card hover:border-foreground/20"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-[10px]",
              isBuilder ? "bg-[#EDE9FE]" : "bg-[#FEF3C7]"
            )}
          >
            {isBuilder ? (
              <Code2 className="h-5 w-5 text-primary" />
            ) : (
              <FlaskConical className="h-5 w-5 text-[#D97706]" />
            )}
          </div>
          <span className="text-base font-semibold text-foreground">
            {isBuilder ? "Builder" : "Scientist"}
          </span>
        </div>
        <div
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-primary bg-primary" : "border-border"
          )}
        >
          {selected && <div className="h-2 w-2 rounded-full bg-white" />}
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {isBuilder
          ? "Software developer shipping features with AI coding agents. Plan products, manage dependencies, dispatch work."
          : "Researcher exploring hypotheses across environments. Branch analyses, manage compute, track exploration trees."}
      </p>
    </button>
  )
}

// --- Summary row ---

function SummaryRow({
  label,
  value,
  truncate,
  mono,
}: {
  label: string
  value: string
  truncate?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-4 bg-card px-5 py-3">
      <span className="w-24 shrink-0 text-[13px] font-medium text-muted-foreground pt-0.5">
        {label}
      </span>
      <span
        className={cn(
          "text-sm text-foreground",
          truncate && "line-clamp-3",
          mono && "font-mono text-[13px]"
        )}
      >
        {value}
      </span>
    </div>
  )
}
