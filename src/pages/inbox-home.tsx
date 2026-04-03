import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { Link, useNavigate } from "react-router"
import { Loader2, Play, Zap, Sparkles, Paperclip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { NotificationCards } from "@/components/dashboard/notification-card"
import { NeedsYouSection } from "@/components/inbox/needs-you-section"
import { RunningSection } from "@/components/inbox/running-section"
import { DoneTodaySection } from "@/components/inbox/done-today-section"
import { ProjectHealthCard } from "@/components/dashboard/project-health-card"
import { MachineWorkdirSelector } from "@/components/machine-workdir-selector"
import { ExamplePickerDialog, type ExamplePrefillData } from "@/components/examples/example-picker-dialog"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useMachineInstructionStore } from "@/stores/machine-instruction-store"
import { useExampleStore } from "@/stores/example-store"
import { useToastStore } from "@/stores/toast-store"
import { deriveAvailableProviders } from "@/components/execution/provider-utils"
import { ProviderDropdown } from "@/components/execution/provider-dropdown"
import { InstructionPicker } from "@/components/execution/instruction-picker"
import { BranchSelector } from "@/components/branch-selector"
import { isServerMode } from "@/lib/app-mode"
import { dataClient } from "@/lib/data-client"
import { useDirectoryDetection } from "@/hooks/use-directory-detection"
import { extractGitHubOwnerRepo } from "@/lib/project-source"
import { cn } from "@/lib/utils"
import type { ProjectSource } from "@/types"
import type { UseCaseTemplateSummary } from "@astro/core/templates"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export function InboxHome() {
  const navigate = useNavigate()
  const [planGoal, setPlanGoal] = useState("")
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const profile = useUserProfileStore((s) => s.profile)

  // Playground landing state
  const [workingDir, setWorkingDir] = useState("")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [exampleDialogOpen, setExampleDialogOpen] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  // Attachment state
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; url: string; mimeType: string; size: number }>>([])
  const [pendingUploads, setPendingUploads] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const uploadFiles = useCallback((fileList: File[]) => {
    if (fileList.length === 0) return
    for (const file of fileList) {
      if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
        useToastStore.getState().add({ type: 'error', title: 'File too large', description: `${file.name} is ${sizeMB}MB (max 5MB)` })
        continue
      }
      setPendingUploads((prev) => prev + 1)
      const reader = new FileReader()
      const filename = file.name || `attachment-${crypto.randomUUID()}`
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1]
          const blobId = await dataClient.uploadBlob(base64, file.type, file.size, filename)
          const url = dataClient.getBlobUrl(blobId)
          setAttachments((prev) => [...prev, { id: blobId, name: filename, url, mimeType: file.type, size: file.size }])
        } catch {
          useToastStore.getState().add({ type: 'error', title: 'Upload failed', description: `Could not upload ${filename}.` })
        } finally {
          setPendingUploads((prev) => Math.max(0, prev - 1))
        }
      }
      reader.onerror = () => {
        setPendingUploads((prev) => Math.max(0, prev - 1))
      }
      reader.readAsDataURL(file)
    }
  }, [])

  // Stores for session
  const startSession = useExecutionStore((s) => s.startSession)
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const realtimeMachines = useRealtimeStore((s) => s.machines)
  const registeredMachines = useMachinesStore((s) => s.machines)
  const globalProviders = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const getModelForProvider = useSettingsStore((s) => s.getModelForProvider)
  const playgroundYolo = useSettingsStore((s) => s.playgroundYoloMode)
  const miLoaded = useMachineInstructionStore((s) => s.loaded)
  const miLoad = useMachineInstructionStore((s) => s.load)
  const miAssign = useMachineInstructionStore((s) => s.assignToMachine)
  const exampleTemplates = useExampleStore((s) => s.templates)
  const examplesLoaded = useExampleStore((s) => s.loaded)
  const loadExamples = useExampleStore((s) => s.load)

  // Load machines/providers/examples on mount
  useEffect(() => { if (!machinesLoaded) loadMachines() }, [machinesLoaded, loadMachines])
  useEffect(() => { if (!providersLoaded) loadProviders() }, [providersLoaded, loadProviders])
  useEffect(() => { if (!miLoaded) miLoad() }, [miLoaded, miLoad])
  useEffect(() => { if (!examplesLoaded) loadExamples() }, [examplesLoaded, loadExamples])

  // All machines (relay + realtime deduplicated)
  const allMachines = useMemo<MachineInfo[]>(() => [
    ...machines,
    ...Array.from(realtimeMachines.values()).map((m) => ({
      machineId: m.machineId,
      name: m.name,
      status: 'online' as const,
      providers: m.providers.map((p) => ({ type: p.type, status: p.status })),
    })),
  ].filter((m, i, arr) => arr.findIndex((a) => a.machineId === m.machineId) === i), [machines, realtimeMachines])

  // Providers
  const availableProviders = useMemo(
    () => deriveAvailableProviders(selectedMachine?.providers, globalProviders),
    [selectedMachine?.providers, globalProviders]
  )
  // Auto-select first available machine when machines load
  useEffect(() => {
    if (!selectedMachine && allMachines.length > 0) {
      setSelectedMachine(allMachines[0])
    }
  }, [selectedMachine, allMachines])

  useEffect(() => {
    if (!selectedProvider && availableProviders.length > 0) {
      setSelectedProvider(availableProviders[0].id)
    }
  }, [selectedProvider, availableProviders])

  // Git repo detection for the selected working directory
  const { detection, refresh: refreshDetection } = useDirectoryDetection(workingDir, selectedMachine?.machineId)

  // Submit playground session
  const handleSubmit = useCallback(async () => {
    if (!planGoal.trim() || isSubmitting || !selectedMachine || pendingUploads > 0) return
    setIsSubmitting(true)
    try {
      const effectiveModel = selectedModel || getModelForProvider(selectedProvider || undefined)

      // Extract GitHub context from detection
      const github = detection?.remoteType === 'github' ? extractGitHubOwnerRepo(detection.remoteUrl) : null
      const source: ProjectSource | undefined = detection?.isGit ? {
        localPath: workingDir.trim(),
        isGit: detection.isGit,
        remoteType: detection.remoteType,
        baseBranch: detection.baseBranch || 'main',
        remoteUrl: detection.remoteUrl,
      } : undefined

      const attachmentSection = attachments.length > 0
        ? `\n\n## Attached Files\n${attachments.map((a) => `- [${a.name}](${a.url}) (${a.mimeType})`).join('\n')}`
        : ''

      const { projectId } = await startSession(
        planGoal.trim() + attachmentSection,
        planGoal.trim().split('\n')[0].slice(0, 60) || "New Session",
        {
          targetMachineId: selectedMachine.machineId,
          workingDirectory: workingDir.trim() || `~/.astro/workspace/${crypto.randomUUID()}`,
          preferredProvider: selectedProvider || undefined,
          model: effectiveModel,
          ...(github?.owner && { githubOwner: github.owner }),
          ...(github?.repo && { githubRepo: github.repo }),
          ...(source && { source }),
          ...(detection?.suggestedDeliveryMode && { deliveryMode: detection.suggestedDeliveryMode }),
        }
      )
      navigate(`/playground?projectId=${projectId}`)
    } catch (error) {
      console.error("[inbox] Failed to start session:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [planGoal, isSubmitting, selectedMachine, workingDir, selectedProvider, selectedModel, detection, getModelForProvider, startSession, navigate, pendingUploads, attachments])

  const activeProjects = useMemo(() => {
    const idsWithNodes = new Set(nodes.map((n) => n.projectId))
    return projects.filter((p) => p.status === "active" && idsWithNodes.has(p.id))
  }, [projects, nodes])

  const recentProjects = useMemo(() => {
    return [...activeProjects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6)
  }, [activeProjects])

  const [projectCosts, setProjectCosts] = useState<Record<string, number>>({})
  useEffect(() => {
    const ids = activeProjects.map((p) => p.id)
    if (ids.length === 0) return
    dataClient.getProjectCosts(ids).then(setProjectCosts).catch(() => {})
  }, [activeProjects])

  const projectHealth = useMemo(() => {
    return recentProjects.map((project) => {
      const pNodes = nodes.filter((n) => n.projectId === project.id)
      const completed = pNodes.filter((n) => ["completed", "auto_verified"].includes(n.status)).length
      const inProgress = pNodes.filter((n) => ["in_progress", "dispatched"].includes(n.status)).length
      const planned = pNodes.filter((n) => n.status === "planned").length
      const awaiting = pNodes.filter((n) => ["awaiting_judgment", "awaiting_approval"].includes(n.status)).length
      const pruned = pNodes.filter((n) => n.status === "pruned").length
      const now = new Date()
      const dayBuckets = new Array(30).fill(0)
      for (const n of pNodes) {
        const completedAt = n.executionCompletedAt ?? (["completed", "auto_verified"].includes(n.status) ? n.updatedAt : null)
        if (!completedAt) continue
        const d = new Date(completedAt)
        const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
        if (daysAgo >= 0 && daysAgo < 30) {
          dayBuckets[29 - daysAgo]++
        }
      }
      return {
        project,
        completed,
        inProgress,
        planned,
        awaiting,
        pruned,
        total: pNodes.length,
        costUsd: projectCosts[project.id] ?? 0,
        velocityData: dayBuckets,
      }
    })
  }, [recentProjects, nodes, projectCosts])

  // Curated examples for the quick picker (up to 8, spread across categories)
  const curatedExamples = useMemo(() => {
    if (exampleTemplates.length === 0) return []
    // Pick stable ones first, spread across categories
    const byCategory = new Map<string, UseCaseTemplateSummary[]>()
    for (const t of exampleTemplates) {
      const list = byCategory.get(t.category) || []
      list.push(t)
      byCategory.set(t.category, list)
    }
    const result: UseCaseTemplateSummary[] = []
    const cats = [...byCategory.keys()]
    let idx = 0
    while (result.length < 8 && idx < 20) {
      const cat = cats[idx % cats.length]
      const list = byCategory.get(cat)!
      const pick = list[Math.floor(idx / cats.length)]
      if (pick && !result.find((r) => r.id === pick.id)) result.push(pick)
      idx++
    }
    return result
  }, [exampleTemplates])

  const handleExamplePrefill = useCallback((data: ExamplePrefillData) => {
    setPlanGoal(data.description)
    if (data.workingDirectory) setWorkingDir(data.workingDirectory)
    setExampleDialogOpen(false)
    setSelectedTemplateId(null)
  }, [])

  const handleQuickExample = useCallback((template: UseCaseTemplateSummary) => {
    setExamplesOpen(false)
    if (template.parameterCount > 0) {
      // Has parameters — open full dialog for configuration
      setSelectedTemplateId(template.id)
      setExampleDialogOpen(true)
    } else {
      // No parameters — just fill the textarea
      setPlanGoal(template.description)
    }
  }, [])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return "Good morning"
    if (h < 17) return "Good afternoon"
    return "Good evening"
  }, [])

  const dateString = useMemo(() => {
    const now = new Date()
    return `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()}`
  }, [])

  return (
    <div className="flex flex-col gap-8 p-6 md:px-10 md:py-8 max-w-[1100px] mx-auto w-full animate-stagger">
      {/* Greeting */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-[28px] font-secondary font-light tracking-wide leading-tight">
          {greeting}{profile.name && !profile.name.includes("@") ? `, ${profile.name}` : ""}
        </h1>
        <p className="text-[13px] text-muted-foreground/40 tracking-wide">{dateString}</p>
      </div>

      {/* Playground Landing */}
      <div className="flex flex-col gap-3">
        <div
          className={cn(
            "flex flex-col rounded-lg border bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring/50 transition-all duration-200",
            isDragOver ? "border-primary ring-1 ring-primary/50" : "border-border"
          )}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false) }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); uploadFiles(Array.from(e.dataTransfer?.files || [])) }}
        >
          <textarea
            value={planGoal}
            onChange={(e) => setPlanGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            onPaste={(e) => {
              const files = e.clipboardData?.files
              if (!files || files.length === 0) return
              e.preventDefault()
              uploadFiles(Array.from(files))
            }}
            placeholder="Describe what you want to do, or say 'help me plan to ...' to generate a structured plan"
            rows={3}
            className="w-full px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none resize-none bg-transparent"
          />
          {/* Attachment thumbnails */}
          {(attachments.length > 0 || pendingUploads > 0) && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {attachments.map((a) => (
                <div key={a.id} className="group relative h-12 w-12 rounded-md border border-border overflow-hidden bg-muted shrink-0">
                  {a.mimeType.startsWith('image/') ? (
                    <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex flex-col items-center justify-center gap-0.5">
                      <span className="text-[9px] text-muted-foreground font-medium uppercase">{a.name.split('.').pop()}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((att) => att.id !== a.id))}
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
              {pendingUploads > 0 && (
                <div className="h-12 w-12 rounded-md border border-dashed border-border flex items-center justify-center bg-muted shrink-0">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.html,.css,.csv,.py,.r,.R,.java,.c,.cpp,.js,.ts,.yaml,.yml,.toml,.json,.xml"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              if (files.length) uploadFiles(files)
              e.target.value = ''
            }}
          />
          <div className="flex items-center justify-between px-4 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border hover:bg-muted text-muted-foreground text-[11px] transition-colors cursor-pointer"
                title="Attach files (images, documents, code — max 5MB)"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Attach
              </button>
              {curatedExamples.length > 0 && (
                <Popover open={examplesOpen} onOpenChange={setExamplesOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border hover:bg-muted text-muted-foreground text-[11px] transition-colors cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Examples
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="bottom"
                    align="start"
                    className="w-[420px] p-0 overflow-hidden"
                  >
                    <div className="px-4 pt-3 pb-2 border-b border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold">Start from an example</span>
                        <button
                          type="button"
                          onClick={() => { setExamplesOpen(false); setExampleDialogOpen(true); setSelectedTemplateId(null) }}
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Browse all
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto p-2">
                      <div className="flex flex-col gap-0.5">
                        {curatedExamples.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => handleQuickExample(t)}
                            className="flex items-start gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-muted/60 transition-colors group"
                          >
                            <span className="text-lg leading-none mt-0.5 shrink-0">{t.icon || "📋"}</span>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[13px] font-medium truncate">{t.name}</span>
                              <span className="text-[11px] text-muted-foreground/60 line-clamp-1">{t.description}</span>
                            </div>
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded-full shrink-0 mt-0.5",
                              t.parameterCount > 0
                                ? "bg-muted text-muted-foreground"
                                : "bg-primary/10 text-primary"
                            )}>
                              {t.parameterCount > 0 ? `${t.parameterCount} params` : "Ready"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="flex items-center gap-2">
              {availableProviders.length > 1 && (
                <ProviderDropdown
                  providers={availableProviders}
                  selectedProvider={selectedProvider}
                  onSelect={(id) => { setSelectedProvider(id); setSelectedModel("") }}
                  compact
                />
              )}
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => useSettingsStore.getState().setPlaygroundYoloMode(!playgroundYolo)}
                      className={`flex items-center gap-1.5 h-7 px-2 rounded-md border text-[11px] transition-colors cursor-pointer ${
                        playgroundYolo
                          ? "border-warning/50 bg-warning/10 text-warning"
                          : "border-border hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <Zap className={`h-3.5 w-3.5 ${playgroundYolo ? "fill-warning" : ""}`} />
                      YOLO
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {playgroundYolo ? "YOLO ON — auto-approve all agent decisions" : "YOLO OFF — agent will ask before acting"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                onClick={handleSubmit}
                disabled={!planGoal.trim() || !selectedMachine || isSubmitting || pendingUploads > 0}
                className="gap-2"
                size="sm"
              >
                {isSubmitting || pendingUploads > 0 ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
                {isSubmitting ? "Starting..." : pendingUploads > 0 ? "Uploading..." : "Start"}
                {!isSubmitting && pendingUploads === 0 && <kbd className="ml-1 text-[10px] opacity-50 font-sans">↵</kbd>}
              </Button>
            </div>
          </div>
        </div>

        {/* Machine + Working directory selector */}
        {(isServerMode() || allMachines.length > 0) && (
          <MachineWorkdirSelector
            machines={allMachines}
            selectedMachine={selectedMachine}
            onMachineChange={setSelectedMachine}
            workingDir={workingDir}
            onWorkingDirChange={setWorkingDir}
            renderMachineExtra={(m) => {
              const reg = registeredMachines.find((r) => r.id === m.machineId)
              return (
                <div className="relative">
                  <InstructionPicker
                    currentInstructionId={reg?.defaultInstructionId}
                    onSelect={(id) => miAssign(m.machineId, id)}
                  />
                </div>
              )
            }}
            renderAfterPath={
              detection?.isGit && detection.currentBranch && selectedMachine ? (
                <BranchSelector
                  value={detection.currentBranch}
                  onChange={() => {}}
                  path={workingDir.trim()}
                  machineId={selectedMachine.machineId}
                  checkoutOnSelect
                  onCheckout={() => refreshDetection()}
                  compact
                />
              ) : undefined
            }
          />
        )}
      </div>

      {/* Notifications */}
      <NotificationCards />

      {/* Needs You */}
      <NeedsYouSection />

      {/* Running */}
      <RunningSection />

      {/* Done Today */}
      <DoneTodaySection />

      {/* Project Health Cards (compact grid, max 6) */}
      {recentProjects.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground/70 uppercase">Projects</h2>
            {activeProjects.length > 6 && (
              <Button variant="ghost" size="sm" asChild className="h-6 text-[11px] text-muted-foreground/50 px-2">
                <Link to="/projects">All {activeProjects.length}</Link>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projectHealth.map(({ project, completed, inProgress, planned, awaiting, pruned, total, costUsd, velocityData }) => (
              <ProjectHealthCard
                key={project.id}
                projectId={project.id}
                name={project.name}
                icon={project.icon}
                color={project.color}
                completed={completed}
                inProgress={inProgress}
                planned={planned}
                awaiting={awaiting}
                pruned={pruned}
                total={total}
                costUsd={costUsd}
                velocityData={velocityData}
              />
            ))}
          </div>
        </div>
      )}

      {/* Example Picker Dialog (full wizard) */}
      <ExamplePickerDialog
        open={exampleDialogOpen}
        onOpenChange={setExampleDialogOpen}
        onPrefillPlan={handleExamplePrefill}
        initialTemplateId={selectedTemplateId}
        skipBrowse={!!selectedTemplateId}
      />
    </div>
  )
}
