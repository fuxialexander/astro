import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { Link, useNavigate } from "react-router"
import { Loader2, Play, Zap, Paperclip, X, FileText, Eye, Pencil, LayoutTemplate, Microscope, ListTree, GitBranch, Plus, FolderEdit, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { NotificationCards } from "@/components/dashboard/notification-card"
import { NeedsYouSection } from "@/components/inbox/needs-you-section"
import { RunningSection } from "@/components/inbox/running-section"
import { DoneTodaySection } from "@/components/inbox/done-today-section"
import { ImportFromHistoryDialog } from "@/components/inbox/import-from-history-dialog"
import { useFeatureFlag } from "@/hooks/use-feature-flag"
import type { ClientImportManifest } from "@/types/imports"
import { ProjectHealthCard } from "@/components/dashboard/project-health-card"
import { MachineWorkdirSelector } from "@/components/machine-workdir-selector"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { ExamplePickerDialog, type ExamplePrefillData } from "@/components/examples/example-picker-dialog"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useReferenceStore } from "@/stores/reference-store"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
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
import { WorktreeToggle } from "@/components/worktree-toggle"
import { AddedFolderRow } from "@/components/added-folder-row"
import { isServerMode } from "@/lib/app-mode"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import { dataClient } from "@/lib/data-client"
import { useDirectoryDetection } from "@/hooks/use-directory-detection"
import { useBranchList } from "@/hooks/use-branch-list"
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

  // Discovery mode state
  const [discoveryMode, setDiscoveryMode] = useState(false)

  // Plan mode state
  const [planMode, setPlanMode] = useState(false)

  // Git init state
  const [isInitingGit, setIsInitingGit] = useState(false)

  // Path browser state
  const [showPathBrowser, setShowPathBrowser] = useState(false)

  // Import-from-history state
  const importFromHistoryEnabled = useFeatureFlag('import-from-history')
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  // skill.md state
  const [visionDoc, setVisionDoc] = useState("")
  const [skillsOpen, setSkillsOpen] = useState(false)

  const globalReferences = useReferenceStore((s) => s.library)

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

  // Target branch state — defaults to detection but user can override
  const [targetBranch, setTargetBranch] = useState("")

  // Worktree + extra folder state
  // undefined = auto (follow branch-mismatch heuristic); true/false = user override
  const [forceWorktree, setForceWorktree] = useState<boolean | undefined>(undefined)
  const [additionalFolders, setAdditionalFolders] = useState<
    Array<{ machineId: string; path: string; mode: 'working' | 'reference' }>
  >([])
  const [addFolderOpen, setAddFolderOpen] = useState(false)

  const { checkoutBranch } = useBranchList()

  // Branch-mismatch detection drives the worktree default
  const branchMismatch = !!targetBranch && !!detection?.currentBranch && targetBranch !== detection.currentBranch
  const autoUseWorktree = branchMismatch
  const effectiveUseWorktree = forceWorktree ?? autoUseWorktree

  // Submit playground session
  const handleSubmit = useCallback(async () => {
    if (!planGoal.trim() || isSubmitting || !selectedMachine || pendingUploads > 0) return
    setIsSubmitting(true)
    try {
      const effectiveModel = selectedModel || getModelForProvider(selectedProvider || undefined)
      const trimmedWorkDir = workingDir.trim() || `~/.astro/workspace/${crypto.randomUUID()}`

      // Override path: user unticked worktree when branches differ → explicit checkout.
      // The `detection.isDirty` pre-check is a UX shortcut so the user gets a
      // clear blocking message instead of a cryptic git error. It is NOT a race-
      // free safety guarantee — the folder could become dirty between the check
      // and the actual checkout. The server-side `git checkout` is the
      // authoritative gate: if the folder dirties up mid-flight, git refuses
      // the checkout and the result.error branch below surfaces the failure.
      if (!discoveryMode && forceWorktree === false && branchMismatch && targetBranch && detection?.isGit) {
        if (detection.isDirty) {
          useToastStore.getState().add({
            type: 'error',
            title: 'Cannot switch branch',
            description: 'Folder has uncommitted changes. Commit or stash them first, or enable worktree.',
          })
          setIsSubmitting(false)
          return
        }
        const result = await checkoutBranch(trimmedWorkDir, selectedMachine.machineId, targetBranch)
        if (!result.success) {
          useToastStore.getState().add({
            type: 'error',
            title: 'Checkout failed',
            description: result.error || 'Could not switch branch',
          })
          setIsSubmitting(false)
          return
        }
        refreshDetection()
      }

      // Auto git-init for discovery mode on non-git directories
      let gitReady = detection?.isGit ?? false
      if (discoveryMode && !gitReady) {
        try {
          const token = await getAccessToken()
          const headers: HeadersInit = { "Content-Type": "application/json" }
          if (token) headers["Authorization"] = `Bearer ${token}`
          const res = await fetch(apiUrl("/api/repo/git-init"), {
            method: "POST",
            headers,
            body: JSON.stringify({
              workingDirectory: trimmedWorkDir,
              projectId: crypto.randomUUID(),
              projectName: planGoal.trim().split('\n')[0].slice(0, 60) || "New Project",
              targetMachineId: selectedMachine.machineId,
            }),
          })
          if (res.ok) {
            gitReady = true
            refreshDetection()
          } else {
            const err = await res.json().catch(() => ({}))
            useToastStore.getState().add({ type: "error", title: "Git init failed", description: err.error || "Cannot use discovery mode without git" })
            setIsSubmitting(false)
            return
          }
        } catch (err) {
          useToastStore.getState().add({ type: "error", title: "Git init failed", description: err instanceof Error ? err.message : "Unknown error" })
          setIsSubmitting(false)
          return
        }
      }

      // Extract GitHub context from detection
      const github = detection?.remoteType === 'github' ? extractGitHubOwnerRepo(detection.remoteUrl) : null
      const effectiveBaseBranch = targetBranch || detection?.baseBranch || 'main'
      const source: ProjectSource | undefined = gitReady ? {
        localPath: trimmedWorkDir,
        isGit: true,
        remoteType: detection?.remoteType ?? 'none',
        baseBranch: effectiveBaseBranch,
        remoteUrl: detection?.remoteUrl,
      } : undefined

      const attachmentSection = attachments.length > 0
        ? `\n\n## Attached Files\n${attachments.map((a) => `- [${a.name}](${a.url}) (${a.mimeType})`).join('\n')}`
        : ''
      const baseVisionDoc = [visionDoc.trim(), attachmentSection].filter(Boolean).join('\n\n') || undefined
      // Discovery mode instructions are injected by the dispatch route (single source of truth)
      // — do NOT append them to visionDoc to avoid duplication
      const combinedVisionDoc = baseVisionDoc

      const finalGoal = planMode
        ? `Please give me a structured plan.\n\n${planGoal.trim()}`
        : planGoal.trim()
      // Filter valid extra folders (must have path + machine)
      const extraFolders = additionalFolders
        .map((f) => ({ ...f, path: f.path.trim() }))
        .filter((f) => f.path && f.machineId)

      const { projectId } = await startSession(
        finalGoal,
        planGoal.trim().split('\n')[0].slice(0, 60) || "New Session",
        {
          targetMachineId: selectedMachine.machineId,
          workingDirectory: trimmedWorkDir,
          preferredProvider: selectedProvider || undefined,
          model: effectiveModel,
          visionDoc: combinedVisionDoc || undefined,
          ...(github?.owner && { githubOwner: github.owner }),
          ...(github?.repo && { githubRepo: github.repo }),
          ...(source && { source }),
          ...(detection?.suggestedDeliveryMode && !discoveryMode && { deliveryMode: detection.suggestedDeliveryMode }),
          ...(targetBranch && { baseBranch: targetBranch }),
          ...(extraFolders.length > 0 && { additionalFolders: extraFolders }),
          ...(!discoveryMode && { useWorktree: effectiveUseWorktree }),
          ...(discoveryMode && {
            deliveryMode: 'direct' as const,
            useWorktree: false,
            mergeQueueEnabled: false,
            discoveryMode: true,
          }),
        }
      )
      navigate(`/playground?projectId=${projectId}`)
    } catch (error) {
      console.error("[inbox] Failed to start session:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [planGoal, isSubmitting, selectedMachine, workingDir, selectedProvider, selectedModel, detection, getModelForProvider, startSession, navigate, pendingUploads, attachments, visionDoc, discoveryMode, planMode, targetBranch, refreshDetection, forceWorktree, branchMismatch, effectiveUseWorktree, additionalFolders, checkoutBranch])

  const handleImportFromHistory = useCallback(async (result: {
    machineId: string
    workingDirectory: string
    goal: string
    importManifest: ClientImportManifest
  }) => {
    // The dialog always returns a non-empty sessions array and a real cwd;
    // no further validation needed here.
    const machine = allMachines.find((m) => m.machineId === result.machineId)
    if (!machine) {
      useToastStore.getState().add({
        type: 'error',
        title: 'Machine not available',
        description: 'The selected machine is no longer connected.',
      })
      return
    }
    setIsSubmitting(true)
    try {
      const modePrefix = result.importManifest.mode === 'plan'
        ? 'Please give me a structured plan.\n\n'
        : ''
      const baseGoal = result.goal.trim()
        || `Continue the work from ${result.importManifest.sessions.length} prior agent session${result.importManifest.sessions.length === 1 ? '' : 's'}.`
      const finalGoal = modePrefix + baseGoal

      const { projectId } = await startSession(
        finalGoal,
        baseGoal.split('\n')[0].slice(0, 60) || 'Imported Session',
        {
          targetMachineId: result.machineId,
          workingDirectory: result.workingDirectory,
          preferredProvider: selectedProvider || undefined,
          model: selectedModel || undefined,
          visionDoc: visionDoc.trim() || undefined,
          deliveryMode: 'direct',
          useWorktree: false,
          importManifest: result.importManifest,
        },
      )
      navigate(`/playground?projectId=${projectId}`)
    } catch (err) {
      console.error('[inbox] Failed to start imported session:', err)
      // The error message from startSession includes per-session failure
      // details when the server's `failures[]` is populated, so it can be
      // longer than a typical toast — give it extra duration to read.
      const description = err instanceof Error ? err.message : 'Could not start the imported session.'
      useToastStore.getState().add({
        type: 'error',
        title: 'Import failed',
        description,
        duration: description.length > 120 ? 15_000 : undefined,
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [allMachines, startSession, navigate, selectedProvider, selectedModel, visionDoc])

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
    <div className="@container flex flex-col gap-8 p-6 @2xl:px-10 @2xl:py-8 max-w-[1100px] mx-auto w-full">
      {/* Greeting */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl @xl:text-[28px] font-secondary font-light tracking-wide leading-tight">
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
          {planMode && (
            <div className="px-4 pt-3 pb-0">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-400 text-xs font-medium select-none">
                <ListTree className="h-3 w-3" />
                Please give me a structured plan
              </span>
            </div>
          )}
          <FileCompletionTextarea
            projectId=""
            references={globalReferences}
            value={planGoal}
            onChange={setPlanGoal}
            onSubmit={() => handleSubmit()}
            onKeyDown={(e) => {
              if (e.key === "Tab" && e.shiftKey) {
                e.preventDefault()
                setPlanMode((v) => !v)
              }
            }}
            placeholder="Describe what you want to do, or say 'help me plan to ...' to generate a structured plan (@ for files · type [@ to cite a paper from your reference library)"
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
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center h-7 w-7 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Attach files (images, documents, code — max 5MB)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setSkillsOpen(true)}
                      className={cn(
                        "flex items-center justify-center h-7 w-7 rounded-md border transition-colors cursor-pointer",
                        visionDoc.trim()
                          ? "border-primary/30 bg-primary/5 text-primary"
                          : "border-border hover:bg-muted text-muted-foreground"
                      )}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Edit skill.md — context injected into every agent session</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {importFromHistoryEnabled && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setImportDialogOpen(true)}
                        disabled={isSubmitting || allMachines.length === 0}
                        className="flex items-center justify-center h-7 w-7 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Import prior Claude / Codex / Pi sessions into a new project</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {curatedExamples.length > 0 && (
                <Popover open={examplesOpen} onOpenChange={setExamplesOpen}>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="flex items-center justify-center h-7 w-7 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                          >
                            <LayoutTemplate className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent>Start from an example</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
                      data-tour-id="plan-mode"
                      onClick={() => setPlanMode(!planMode)}
                      className={cn(
                        "flex items-center justify-center h-7 w-7 rounded-md border transition-colors cursor-pointer",
                        planMode
                          ? "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                          : "border-border hover:bg-muted text-muted-foreground",
                      )}
                    >
                      <ListTree className={cn("h-3.5 w-3.5", planMode && "text-blue-600 dark:text-blue-400")} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {planMode
                      ? "Plan ON — will generate a structured plan (Shift+Tab)"
                      : "Plan OFF — direct execution (Shift+Tab)"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-tour-id="discovery-mode"
                      onClick={() => setDiscoveryMode(!discoveryMode)}
                      className={cn(
                        "flex items-center justify-center h-7 w-7 rounded-md border transition-colors cursor-pointer",
                        discoveryMode
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-border hover:bg-muted text-muted-foreground",
                      )}
                    >
                      <Microscope className={cn("h-3.5 w-3.5", discoveryMode && "text-emerald-600 dark:text-emerald-400")} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {discoveryMode
                      ? "Discovery ON — directory-scoped outputs in analysis/, parallel execution"
                      : "Discovery OFF — use standard git workflow"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-tour-id="yolo-mode"
                      onClick={() => useSettingsStore.getState().setPlaygroundYoloMode(!playgroundYolo)}
                      className={`flex items-center justify-center h-7 w-7 rounded-md border transition-colors cursor-pointer ${
                        playgroundYolo
                          ? "border-warning/50 bg-warning/10 text-warning"
                          : "border-border hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <Zap className={`h-3.5 w-3.5 ${playgroundYolo ? "fill-warning" : ""}`} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {playgroundYolo ? "YOLO ON — auto-approve all agent decisions" : "YOLO OFF — agent will ask before acting"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleSubmit}
                      disabled={!planGoal.trim() || !selectedMachine || isSubmitting || pendingUploads > 0}
                      className="h-7 w-7 p-0"
                      size="sm"
                    >
                      {isSubmitting || pendingUploads > 0 ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-current" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isSubmitting ? "Starting…" : pendingUploads > 0 ? "Uploading…" : "Start (↵)"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
            onBrowse={() => setShowPathBrowser(true)}
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
            renderBelow={additionalFolders.length > 0 ? (
              <div className="flex flex-col gap-1.5 mt-1.5">
                {additionalFolders.map((f, i) => (
                  <AddedFolderRow
                    key={i}
                    mode={f.mode}
                    machineId={f.machineId}
                    path={f.path}
                    machines={allMachines}
                    onMachineChange={(machineId) =>
                      setAdditionalFolders((prev) =>
                        prev.map((item, idx) => (idx === i ? { ...item, machineId } : item)),
                      )
                    }
                    onPathChange={(path) =>
                      setAdditionalFolders((prev) =>
                        prev.map((item, idx) => (idx === i ? { ...item, path } : item)),
                      )
                    }
                    onRemove={() => setAdditionalFolders((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            ) : undefined}
            renderAfterPath={
              detection?.isGit && selectedMachine ? (
                <>
                  <BranchSelector
                    value={targetBranch || detection.baseBranch || detection.currentBranch || 'main'}
                    onChange={setTargetBranch}
                    path={workingDir.trim()}
                    machineId={selectedMachine.machineId}
                    compact
                  />
                  {branchMismatch && detection.currentBranch && (
                    <span className="inline-flex items-center text-[10px] text-muted-foreground/70 shrink-0 whitespace-nowrap">
                      (on {detection.currentBranch})
                    </span>
                  )}
                  {!discoveryMode && (
                    <WorktreeToggle
                      value={forceWorktree}
                      autoOn={autoUseWorktree}
                      autoReason={branchMismatch ? `Target branch (${targetBranch}) differs from folder's current branch (${detection.currentBranch}) — auto-isolating in a worktree.` : undefined}
                      onChange={setForceWorktree}
                      warning={branchMismatch && targetBranch ? `Will check out ${targetBranch} in this folder. Uncommitted changes will be blocked.` : undefined}
                    />
                  )}
                  <Popover open={addFolderOpen} onOpenChange={setAddFolderOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 flex items-center gap-1 h-7 px-2 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] transition-colors cursor-pointer"
                        title="Mount an additional folder into this session"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add folder</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAdditionalFolders((prev) => [...prev, { machineId: selectedMachine.machineId, path: '', mode: 'working' }])
                          setAddFolderOpen(false)
                        }}
                        className="w-full flex items-start gap-2 px-2 py-2 rounded-md text-left hover:bg-muted transition-colors cursor-pointer"
                      >
                        <FolderEdit className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[12px] font-medium">Working folder</span>
                          <span className="text-[10px] text-muted-foreground">Agent can edit (isolated in a worktree)</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAdditionalFolders((prev) => [...prev, { machineId: selectedMachine.machineId, path: '', mode: 'reference' }])
                          setAddFolderOpen(false)
                        }}
                        className="w-full flex items-start gap-2 px-2 py-2 rounded-md text-left hover:bg-muted transition-colors cursor-pointer"
                      >
                        <BookOpen className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[12px] font-medium">Reference folder</span>
                          <span className="text-[10px] text-muted-foreground">Read-only context, no writes</span>
                        </div>
                      </button>
                    </PopoverContent>
                  </Popover>
                </>
              ) : detection && !detection.isGit && workingDir.trim() && selectedMachine ? (
                <button
                  type="button"
                  disabled={isInitingGit}
                  onClick={async () => {
                    setIsInitingGit(true)
                    try {
                      const token = await getAccessToken()
                      const headers: HeadersInit = { "Content-Type": "application/json" }
                      if (token) headers["Authorization"] = `Bearer ${token}`
                      const res = await fetch(apiUrl("/api/repo/git-init"), {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                          workingDirectory: workingDir.trim(),
                          projectId: crypto.randomUUID(),
                          projectName: planGoal.trim().split('\n')[0].slice(0, 60) || "New Project",
                          targetMachineId: selectedMachine.machineId,
                        }),
                      })
                      if (res.ok) {
                        useToastStore.getState().add({ type: "success", title: "Git initialized" })
                        refreshDetection()
                      } else {
                        const err = await res.json().catch(() => ({}))
                        useToastStore.getState().add({ type: "error", title: "Git init failed", description: err.error || "Unknown error" })
                      }
                    } catch (err) {
                      useToastStore.getState().add({ type: "error", title: "Git init failed", description: err instanceof Error ? err.message : "Unknown error" })
                    } finally {
                      setIsInitingGit(false)
                    }
                  }}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] font-medium transition-colors cursor-pointer hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {isInitingGit ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
                  {isInitingGit ? "Initializing..." : "Init Git"}
                </button>
              ) : undefined
            }
          />
        )}

        {/* Remote path browser dialog */}
        {selectedMachine?.machineId && (
          <RemotePathBrowser
            open={showPathBrowser}
            onOpenChange={setShowPathBrowser}
            machineId={selectedMachine.machineId}
            machineName={selectedMachine.name}
            currentPath={workingDir || undefined}
            onSelect={(path) => setWorkingDir(path)}
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
          <div className="grid grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3 gap-3">
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

      {/* skill.md Editor Dialog */}
      <SkillsEditorDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        value={visionDoc}
        onChange={setVisionDoc}
      />

      {/* Import from history Dialog */}
      {importFromHistoryEnabled && (
        <ImportFromHistoryDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          seedMachineId={selectedMachine?.machineId}
          seedWorkingDir={workingDir.trim() || undefined}
          seedGoal={planGoal}
          seedPlanMode={planMode}
          onConfirm={handleImportFromHistory}
        />
      )}
    </div>
  )
}

/** Inline skill.md editor dialog with edit/preview toggle (no project required) */
function SkillsEditorDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
}) {
  const [mode, setMode] = useState<"edit" | "preview">(value ? "preview" : "edit")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (mode === "edit" && open) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [mode, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            skill.md
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Define skill context for agents. This is injected into every agent session as persistent context.
          </p>
        </DialogHeader>
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          {/* Toolbar */}
          <div className="flex items-center">
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <button
                type="button"
                onClick={() => setMode("preview")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
                  mode === "preview"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Eye className="h-3 w-3" />
                Preview
              </button>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
                  mode === "edit"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            </div>
          </div>

          {/* Content */}
          {mode === "preview" ? (
            <div className="flex-1 min-h-[300px] overflow-auto rounded-md border border-input bg-background p-4">
              {value ? (
                <MarkdownRenderer content={value} className="text-sm" />
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No content yet. Click Edit to add skill context.
                </p>
              )}
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              className="flex-1 min-h-[300px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              placeholder="Define the skill context, product vision, research question, or project context here. This will be provided to all agents working on this session..."
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
