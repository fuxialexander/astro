import { useState, useCallback } from "react"
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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
import { useSettingsStore } from "@/stores/settings-store"
import { cn } from "@/lib/utils"

type UserType = "builder" | "scientist" | null
type InputMode = "type" | "paste" | "import" | "repo"

const TOTAL_STEPS = 3

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
  const [step, setStep] = useState(1)
  const [userType, setUserType] = useState<UserType>(null)
  const [inputMode, setInputMode] = useState<InputMode>("type")
  const [description, setDescription] = useState("")
  const [pastedDoc, setPastedDoc] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [repoPath, setRepoPath] = useState("")
  const [domain, setDomain] = useState("")
  const [startDate, setStartDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [techStack, setTechStack] = useState("")

  const navigate = useNavigate()
  const addProject = useProjectStore((s) => s.addProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const updateFileTree = useProjectStore((s) => s.updateFileTree)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const setGenerationPhase = useAgentStore((s) => s.setGenerationPhase)
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)

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
    if (!input && !hasRepo) return

    const id = `proj-${Date.now()}`
    const fullDescription = buildDescription()
    const repoUrlVal = repoUrl.trim()
    const repoPathVal = repoPath.trim()
    const hasRepoContext = !!(repoUrlVal || repoPathVal)

    addProject({
      id,
      name: input.slice(0, 50).trim() || repoUrlVal.split("/").pop() || "New Project",
      description: fullDescription,
      visionDoc: inputMode === "paste" ? pastedDoc : "",
      status: "active",
      startDate: startDate || undefined,
      targetDate: targetDate || undefined,
      repository: repoUrlVal || undefined,
      workingDirectory: repoPathVal || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    navigate(`/project/${id}`)

    if (connectionStatus !== "connected") return

    if (hasRepoContext) {
      // Repo-aware flow: setup repo first, then generate with context
      setGenerationPhase('repo_setup')
      try {
        const res = await fetch("/api/repo/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: id,
            projectName: input.slice(0, 50).trim() || "New Project",
            projectDescription: fullDescription,
            workingDirectory: repoPathVal || undefined,
            repository: repoUrlVal || undefined,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.workingDirectory) {
            updateProject(id, { workingDirectory: data.workingDirectory })
          }
          if (data.fileTree) {
            updateFileTree(id, data.fileTree)
          }
          if (data.workingDirectory && !data.needsGitInit) {
            startGeneration(id, fullDescription, undefined, {
              workingDirectory: data.workingDirectory,
              fileTree: data.fileTree,
            })
            return
          }
        }
      } catch (error) {
        console.error("[welcome] Repo setup failed:", error)
      }
      // Fallback: generate without repo context
      startGeneration(id, fullDescription)
    } else {
      // Fast path: no repo
      startGeneration(id, fullDescription)
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
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
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={placeholder}
                  className="h-[160px] w-full resize-none rounded-xl border border-border bg-card p-4 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
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
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="e.g., Add user authentication with OAuth, refactor the database layer to use Prisma, set up CI/CD pipeline..."
                      className="h-[100px] w-full resize-none rounded-xl border border-border bg-card p-4 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
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
              <button
                onClick={() => {
                  if (canAdvanceFromStep1) {
                    setStep(3)
                  }
                }}
                disabled={!canAdvanceFromStep1}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Skip to plan generation
              </button>
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

              {/* Tech stack / compute */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  {effectiveUserType === "scientist"
                    ? "What compute environments do you have?"
                    : "What's your tech stack?"}
                </label>
                <input
                  type="text"
                  value={techStack}
                  onChange={(e) => setTechStack(e.target.value)}
                  placeholder={
                    effectiveUserType === "scientist"
                      ? "e.g., Local laptop, HPC cluster (Slurm), AWS..."
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
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/user/repo or /path/to/local/repo"
                    className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
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
                  label={effectiveUserType === "scientist" ? "Compute" : "Tech Stack"}
                  value={techStack}
                />
              )}
            </div>

            {/* Environment ready note */}
            <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-4 py-3 text-[13px] text-foreground">
              <Check className="h-4 w-4 text-primary shrink-0" />
              <span>
                Environment defaults to <strong>local</strong> — no setup required to start.
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
                  disabled={(!primaryInput.trim() && !hasRepo) || isGenerating}
                  className="h-12 flex-1 rounded-xl text-base font-semibold"
                >
                  {isGenerating ? (
                    <Loader2 className="h-[18px] w-[18px] animate-spin" />
                  ) : (
                    <Zap className="h-[18px] w-[18px]" />
                  )}
                  {isGenerating ? "Structuring..." : "Structure Plan"}
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
