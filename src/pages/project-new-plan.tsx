/**
 * Interactive Plan Mode Page
 *
 * Two-phase component:
 * 1. Input Phase: Goal description textarea + optional advanced settings
 * 2. Chat Phase: Full-height streaming activity with inline approvals
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams, useLocation, useNavigate } from "react-router"
import { Sparkles, Loader2, GitBranch, Info, Monitor, Clock, X, FileCode2, Layers, ChevronDown, ChevronRight, FileText, Paperclip, LayoutTemplate, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSettingsStore, resolveModel, type ModelTier } from "@/stores/settings-store"
import { useClaudeSessionsStore } from "@/stores/claude-sessions-store"
import { useExampleStore } from "@/stores/example-store"
import { PlanGeneration } from "@/components/plan-generation/plan-generation"
import { SessionPickerDialog } from "@/components/playground/session-picker-dialog"
import { ExamplePickerDialog } from "@/components/examples/example-picker-dialog"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { MachineWorkdirSelector } from "@/components/machine-workdir-selector"
import { BranchSelector } from "@/components/branch-selector"
import { AttachmentList } from "@/components/task-detail/attachment-list"
import { useDirectoryDetection } from "@/hooks/use-directory-detection"
import { getColorForName, getProjectIconForName } from "@/lib/color-icon-utils"
import { extractGitHubOwnerRepo } from "@/lib/project-source"
import { dataClient } from "@/lib/data-client"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import { requestNotificationPermission } from "@/lib/notifications"
import { useToastStore } from "@/stores/toast-store"
import { OnboardingHint } from "@/components/onboarding-hint"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
import { deriveAvailableProviders, isProviderAvailable } from "@/components/execution/provider-utils"
import { ProviderDropdown } from "@/components/execution/provider-dropdown"
import { InstructionPicker } from "@/components/execution/instruction-picker"
import { useMachineInstructionStore } from "@/stores/machine-instruction-store"
import type { TaskAttachment, ProjectSource } from "@/types"
import type { LaunchExampleResult } from "@/lib/api-client"
import type { ExamplePrefillData } from "@/components/examples/example-picker-dialog"

export function ProjectNewPlan() {
  const { t } = useTranslation('plan')
  const [searchParams, setSearchParams] = useSearchParams()
  const projectIdParam = searchParams.get("projectId")
  const location = useLocation()
  const navigate = useNavigate()

  // Location state context
  const locationState = location.state as { fromPlaygroundId?: string; initialTemplateId?: string; templateLaunchResult?: LaunchExampleResult; templatePrefill?: ExamplePrefillData } | null
  const fromPlaygroundId = locationState?.fromPlaygroundId
  const locationTemplateId = locationState?.initialTemplateId
  const templateLaunchFromExamples = locationState?.templateLaunchResult
  const templatePrefill = locationState?.templatePrefill

  // Input phase state
  const [description, setDescription] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPathBrowser, setShowPathBrowser] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [initialTemplateId, setInitialTemplateId] = useState<string | null>(null)
  const [templateLaunching, setTemplateLaunching] = useState(false)
  const [examplesAutoLaunching, setExamplesAutoLaunching] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [visionDoc, setVisionDoc] = useState("")
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [pendingUploads, setPendingUploads] = useState(0)
  const [directMode, setDirectMode] = useState(false)
  const [directConfirmed, setDirectConfirmed] = useState(false)
  const autoExecute = useSettingsStore((s) => s.yoloMode)
  const [showYoloWarning, setShowYoloWarning] = useState(false)
  const modelTier: ModelTier = "large"

  // Reset all form fields to initial state
  const resetForm = useCallback(() => {
    setDescription("")
    setWorkingDir("")
    setSelectedMachine(null)
    setSelectedBranch("")
    setSelectedProvider("")
    setSelectedModel("")
    setVisionDoc("")
    setAttachments([])
    setPendingUploads(0)
    setContextOpen(false)
    setDirectMode(false)
    setDirectConfirmed(false)
  }, [])

  // Git detection (debounced)
  const { detection, isDetecting } = useDirectoryDetection(workingDir, selectedMachine?.machineId)
  const effectiveBranch = selectedBranch || (detection?.isGit ? detection.baseBranch : null)

  // Reset direct mode when working directory changes (avoids stale state from previous path)
  useEffect(() => { setDirectMode(false); setDirectConfirmed(false) }, [workingDir])

  // Git init handler for non-git directories
  const toastAdd = useToastStore((s) => s.add)
  const handleInitGit = useCallback(async () => {
    if (!workingDir.trim() || !selectedMachine?.machineId) return
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      const token = await getAccessToken()
      if (token) headers["Authorization"] = `Bearer ${token}`
      const res = await fetch(apiUrl("/api/repo/git-init"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          workingDirectory: workingDir.trim(),
          projectId: "pre-project",
          projectName: "Initializing",
          targetMachineId: selectedMachine.machineId,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toastAdd({ title: "Git init failed", description: data.error || "Unknown error", type: "error" })
        return
      }
      toastAdd({ title: "Git initialized", description: `Initialized git repository in ${workingDir}`, type: "success" })
      // Force re-detection by toggling path
      const saved = workingDir
      setWorkingDir("")
      requestAnimationFrame(() => setWorkingDir(saved))
    } catch (err) {
      toastAdd({ title: "Git init failed", description: err instanceof Error ? err.message : "Unknown error", type: "error" })
    }
  }, [workingDir, selectedMachine?.machineId, toastAdd])

  // Chat phase state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectIdParam)



  // Stores
  const startPlanGeneration = useExecutionStore((s) => s.startPlanGeneration)
  const startPlanGenerationForProject = useExecutionStore((s) => s.startPlanGenerationForProject)
  const setStoreAutoExecute = useExecutionStore((s) => s.setAutoExecute)
  const allExecutions = useExecutionStore((s) => s.executions)
  const execution = useExecutionStore((s) =>
    activeProjectId ? s.executions.get(`plan-${activeProjectId}`) : undefined
  )
  const allProjects = useProjectStore((s) => s.projects)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const project = useProjectStore((s) =>
    activeProjectId ? s.projects.find((p) => p.id === activeProjectId) : undefined
  )

  // Detect existing project with zero plan nodes (for re-generation pre-fill)
  const planNodes = usePlanStore((s) => s.nodes)
  const existingProject = useProjectStore((s) =>
    projectIdParam ? s.projects.find((p) => p.id === projectIdParam) : undefined
  )
  const existingProjectHasNoNodes = useMemo(() => {
    if (!existingProject) return false
    // Use .some() for early exit instead of .filter().length for O(1) best-case
    return !planNodes.some((n) => n.projectId === existingProject.id && isLive(n))
  }, [existingProject, planNodes])

  // Playground context: read project and execution data
  const playgroundProject = useProjectStore((s) =>
    fromPlaygroundId ? s.projects.find((p) => p.id === fromPlaygroundId) : undefined
  )
  const playgroundExecution = useExecutionStore((s) =>
    fromPlaygroundId ? s.executions.get(`playground-${fromPlaygroundId}`) : undefined
  )

  // Recent project chat sessions (projectType === 'plan')
  const planHistory = useMemo(() => {
    return allProjects
      .filter((p) => p.projectType === 'plan')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20)
  }, [allProjects])

  // Playground sessions (for the session picker)
  const playgroundHistory = useMemo(() => {
    return allProjects
      .filter((p) => p.projectType === 'playground')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20)
  }, [allProjects])

  // Sessions store (Claude Code sessions from connected machines)
  const loadSessions = useClaudeSessionsStore((s) => s.loadSessions)

  // Template store
  const templatesLoaded = useExampleStore((s) => s.loaded)
  const loadTemplates = useExampleStore((s) => s.load)

  // View a past plan session — always open in chat phase
  const viewSession = useCallback((projectId: string) => {
    setActiveProjectId(projectId)
    setSearchParams({ projectId })
  }, [setSearchParams])

  // Machines
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const realtimeMachines = useRealtimeStore((s) => s.machines)
  const registeredMachines = useMachinesStore((s) => s.machines)

  // Providers
  const globalProviders = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const availableProviders = useMemo(
    () => deriveAvailableProviders(selectedMachine?.providers, globalProviders),
    [selectedMachine?.providers, globalProviders]
  )

  // Machine instructions
  const miLoaded = useMachineInstructionStore((s) => s.loaded)
  const miLoad = useMachineInstructionStore((s) => s.load)
  const miAssign = useMachineInstructionStore((s) => s.assignToMachine)

  // Load machines and providers on mount
  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  useEffect(() => {
    if (!providersLoaded) loadProviders()
  }, [providersLoaded, loadProviders])

  useEffect(() => {
    if (!miLoaded) miLoad()
  }, [miLoaded, miLoad])

  // Request notification permission and load sessions on mount
  useEffect(() => {
    requestNotificationPermission()
    loadSessions()
  }, [loadSessions])

  // Load templates for template picker
  useEffect(() => {
    if (!templatesLoaded) loadTemplates()
  }, [templatesLoaded, loadTemplates])

  // Auto-open template picker when navigating from dashboard with a template
  useEffect(() => {
    if (locationTemplateId && templatesLoaded) {
      setInitialTemplateId(locationTemplateId)
      setTemplatePickerOpen(true)
      // Clear location state to avoid re-triggering on re-render
      window.history.replaceState({}, '')
    }
  }, [locationTemplateId, templatesLoaded])

  // Reset provider/model when machine changes and current provider isn't available
  useEffect(() => {
    if (selectedProvider && availableProviders.length > 0) {
      if (!isProviderAvailable(selectedProvider, availableProviders)) {
        setSelectedProvider("")
        setSelectedModel("")
      }
    }
  }, [selectedMachine?.machineId]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only on machine change

  // Sync URL → state: if URL gains a projectId we don't have, adopt it.
  // But ignore when URL still has the stale param during back navigation.
  const backingRef = useRef(false)
  useEffect(() => {
    if (backingRef.current) {
      backingRef.current = false
      return
    }
    if (projectIdParam && !activeProjectId) {
      setActiveProjectId(projectIdParam)
    }
  }, [projectIdParam, activeProjectId])

  // When projectId param is removed from URL (e.g., sidebar Plan click), reset to input phase
  useEffect(() => {
    if (!projectIdParam && activeProjectId) {
      setActiveProjectId(null)
      resetForm()
    }
  }, [projectIdParam, activeProjectId, resetForm])

  // Detect sidebar reset signal via location.state (when already on /plan without query params)
  const resetSignal = (location.state as { resetForm?: number } | null)?.resetForm
  useEffect(() => {
    if (resetSignal) {
      setActiveProjectId(null)
      resetForm()
      // Clear the state so repeat clicks still trigger
      window.history.replaceState({}, '', location.pathname + location.search)
    }
  }, [resetSignal, resetForm, location.pathname, location.search])

  // Determine machine name for display
  const machineName = (() => {
    if (!execution?.machineId) return undefined
    const realtimeM = realtimeMachines.get(execution.machineId)
    if (realtimeM) return realtimeM.name
    const registeredM = registeredMachines.find((m) => m.id === execution.machineId)
    if (registeredM) return registeredM.name
    return execution.machineId
  })()

  // Available machines from relay + local (memoized to avoid re-render cascades)
  const allMachines = useMemo<MachineInfo[]>(() => [
    ...machines,
    ...Array.from(realtimeMachines.values()).map((m) => ({
      machineId: m.machineId,
      name: m.name,
      status: 'online' as const,
      providers: m.providers.map((p) => ({ type: p.type, status: p.status })),
    })),
  ].filter((m, i, arr) => arr.findIndex((a) => a.machineId === m.machineId) === i), [machines, realtimeMachines])

  // Pre-fill description + working directory from playground context (once)
  const playgroundPrefilled = useRef(false)
  useEffect(() => {
    if (!fromPlaygroundId || !playgroundProject || playgroundPrefilled.current) return
    playgroundPrefilled.current = true

    // Seed description from follow-ups or original playground description
    const summary = playgroundExecution?.summary
    if (summary?.followUps?.length) {
      setDescription(summary.followUps.join('\n'))
    } else if (playgroundProject.description) {
      setDescription(playgroundProject.description)
    }

    // Pre-fill working directory
    if (playgroundProject.workingDirectory) {
      setWorkingDir(playgroundProject.workingDirectory)
    }
  }, [fromPlaygroundId, playgroundProject, playgroundExecution])

  // Pre-fill machine separately — machines load async and may arrive after the first effect
  const machinePrefilled = useRef(false)
  useEffect(() => {
    if (!fromPlaygroundId || !playgroundProject?.defaultMachineId || machinePrefilled.current || allMachines.length === 0) return
    const match = allMachines.find((m) => m.machineId === playgroundProject.defaultMachineId)
    if (match) {
      machinePrefilled.current = true
      setSelectedMachine(match)
    }
  }, [fromPlaygroundId, playgroundProject?.defaultMachineId, allMachines])

  // Pre-fill from existing project (re-generation flow: project exists with zero nodes)
  const existingPrefilled = useRef<string | null>(null)
  useEffect(() => {
    if (!existingProject || !existingProjectHasNoNodes || fromPlaygroundId) return
    // Skip if we already pre-filled for this specific project
    if (existingPrefilled.current === existingProject.id) return
    existingPrefilled.current = existingProject.id

    // Pre-fill description from project name/description
    if (existingProject.description) {
      setDescription(existingProject.description)
    } else if (existingProject.name) {
      setDescription(existingProject.name)
    }

    // Pre-fill working directory
    if (existingProject.workingDirectory) {
      setWorkingDir(existingProject.workingDirectory)
    }

    // Pre-fill vision doc and auto-expand context section
    if (existingProject.visionDoc) {
      setVisionDoc(existingProject.visionDoc)
      setContextOpen(true)
    }
  }, [existingProject, existingProjectHasNoNodes, fromPlaygroundId])

  // Pre-fill machine for existing project (async — machines load after mount)
  const existingMachinePrefilled = useRef<string | null>(null)
  useEffect(() => {
    if (!existingProject?.defaultMachineId || !existingProjectHasNoNodes || allMachines.length === 0 || fromPlaygroundId) return
    if (existingMachinePrefilled.current === existingProject.id) return
    const match = allMachines.find((m) => m.machineId === existingProject.defaultMachineId)
    if (match) {
      existingMachinePrefilled.current = existingProject.id
      setSelectedMachine(match)
    }
  }, [existingProject?.id, existingProject?.defaultMachineId, existingProjectHasNoNodes, allMachines, fromPlaygroundId])

  // Pre-fill form from template (Examples page → Plan page handoff)
  const templatePrefilled = useRef(false)
  useEffect(() => {
    if (!templatePrefill || templatePrefilled.current) return
    templatePrefilled.current = true

    setDescription(templatePrefill.description)
    if (templatePrefill.workingDirectory) setWorkingDir(templatePrefill.workingDirectory)
    if (templatePrefill.preferredProvider) setSelectedProvider(templatePrefill.preferredProvider)
    if (templatePrefill.model) setSelectedModel(templatePrefill.model)
    if (templatePrefill.visionDoc) {
      setVisionDoc(templatePrefill.visionDoc)
      setContextOpen(true)
    }

    // Clear location state so refreshing doesn't re-trigger
    window.history.replaceState({}, '')
  }, [templatePrefill])

  // Pre-fill machine from template (async — machines load after mount)
  const templateMachinePrefilled = useRef(false)
  useEffect(() => {
    if (!templatePrefill?.machineId || templateMachinePrefilled.current || allMachines.length === 0) return
    const match = allMachines.find((m) => m.machineId === templatePrefill.machineId)
    if (match) {
      templateMachinePrefilled.current = true
      setSelectedMachine(match)
    }
  }, [templatePrefill?.machineId, allMachines])

  // Build visionDoc from playground execution summary
  const playgroundVisionDoc = useMemo(() => {
    if (!fromPlaygroundId || !playgroundProject) return undefined
    const summary = playgroundExecution?.summary

    const sections: string[] = ['## Context from Prior Playground Session\n']

    if (summary) {
      if (summary.workCompleted) {
        sections.push(`### Work Completed\n${summary.workCompleted}\n`)
      }
      if (summary.keyFindings?.length) {
        sections.push(`### Key Findings\n${summary.keyFindings.map((f) => `- ${f}`).join('\n')}\n`)
      }
      if (summary.filesChanged?.length) {
        const files = summary.filesChanged.slice(0, 50)
        sections.push(`### Files Changed\n${files.map((f) => `- \`${f}\``).join('\n')}\n`)
      }
      if (summary.followUps?.length) {
        sections.push(`### Suggested Follow-ups\n${summary.followUps.map((f) => `- ${f}`).join('\n')}\n`)
      }
    } else if (playgroundExecution?.streamText) {
      sections.push(`### Session Output (truncated)\n${playgroundExecution.streamText.slice(0, 2000)}\n`)
    }

    if (playgroundProject.description) {
      sections.push(`### Original Goal\n${playgroundProject.description}\n`)
    }

    // Always return the visionDoc when from playground (even if minimal) so the
    // "From Playground" badge detection in PlanGeneration works reliably
    return sections.join('\n')
  }, [fromPlaygroundId, playgroundProject, playgroundExecution])

  // Attachment handlers
  const handleAddAttachment = useCallback((attachment: TaskAttachment) => {
    setAttachments((prev) => [...prev, attachment])
  }, [])

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
  }, [])

  // Handle paste in goal textarea (image paste support)
  // Uploads pasted images to persistent blob storage so URLs survive page refresh.
  const handleGoalPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files
    if (!files || files.length === 0) return

    // Check if any pasted items are files (images)
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    e.preventDefault() // Prevent pasting file name as text

    // Auto-expand context section to show pasted images
    setContextOpen(true)

    // Client-side size limit: 10MB per file to prevent slow uploads and backend quota issues
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

    // Upload each image to persistent blob storage, tracking pending count
    for (const file of imageFiles) {
      // Check file size before attempting upload
      if (file.size > MAX_IMAGE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
        useToastStore.getState().add({
          type: 'error',
          title: 'Image too large',
          description: `${file.name || 'Image'} is ${sizeMB}MB (max 10MB)`,
        })
        continue // Skip this file but process others
      }

      setPendingUploads((prev) => prev + 1)
      const reader = new FileReader()
      const filename = file.name || `pasted-image-${crypto.randomUUID()}.png`
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1]
          const blobId = await dataClient.uploadBlob(
            base64,
            file.type || 'image/png',
            file.size,
            filename,
          )
          const persistentUrl = dataClient.getBlobUrl(blobId)
          const attachment: TaskAttachment = {
            id: blobId,
            name: filename,
            url: persistentUrl,
            mimeType: file.type || 'image/png',
            size: file.size,
            uploadedAt: new Date(),
            thumbnailUrl: persistentUrl,
          }
          setAttachments((prev) => [...prev, attachment])
        } catch (err) {
          console.error('[plan-generation] Failed to upload pasted image:', err)
          useToastStore.getState().add({
            type: 'error',
            title: 'Upload failed',
            description: 'Could not upload pasted image. Check your connection.',
          })
        } finally {
          setPendingUploads((prev) => Math.max(0, prev - 1))
        }
      }
      // Handle FileReader errors (e.g., file access denied, read failure)
      reader.onerror = () => {
        console.error('[plan-generation] FileReader error for:', filename)
        setPendingUploads((prev) => Math.max(0, prev - 1))
        useToastStore.getState().add({
          type: 'error',
          title: 'Read failed',
          description: `Could not read file: ${filename}`,
        })
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const customModelMap = useSettingsStore((s) => s.customModelMap)

  // Whether we're re-generating for an existing project (pre-fill mode)
  const isRegeneration = !!(existingProject && existingProjectHasNoNodes && !fromPlaygroundId)

  // Handle template launch - starts plan generation SSE for the created project
  const handleTemplateLaunch = useCallback(async (result: LaunchExampleResult) => {
    setTemplateLaunching(true)
    setTemplatePickerOpen(false)

    try {
      const { project, planGenerationRequest } = result

      // Add the created project to the store (it's already in DB, but not in local state)
      useProjectStore.getState().addProject({
        id: project.id,
        name: project.name,
        description: project.description as string || "",
        visionDoc: planGenerationRequest.visionDoc || "",
        status: "active",
        projectType: "plan",
        color: getColorForName(project.name),
        icon: getProjectIconForName(project.name),
        workingDirectory: planGenerationRequest.workingDirectory || undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Start plan generation SSE using the existing project
      await startPlanGenerationForProject(
        project.id,
        planGenerationRequest.description,
        {
          targetMachineId: planGenerationRequest.targetMachineId,
          workingDirectory: planGenerationRequest.workingDirectory,
          preferredProvider: planGenerationRequest.preferredProvider,
          model: planGenerationRequest.model,
          visionDoc: planGenerationRequest.visionDoc,
        }
      )

      // Register auto-execute for templates/examples (YOLO mode on by default)
      // Skip if no working directory — can't execute without one
      if (autoExecute && planGenerationRequest.workingDirectory) {
        setStoreAutoExecute(project.id, true)
      }

      // Navigate to the chat phase
      setActiveProjectId(project.id)
      setSearchParams({ projectId: project.id })

      useToastStore.getState().add({
        type: "success",
        title: "Project created from template",
        description: `Starting plan generation for "${project.name}"...`,
      })
    } catch (error) {
      console.error("[plan-generation] Failed to start plan from template:", error)
      useToastStore.getState().add({
        type: "error",
        title: "Template launch failed",
        description: error instanceof Error ? error.message : "Failed to start plan generation",
      })
    } finally {
      setTemplateLaunching(false)
    }
  }, [startPlanGenerationForProject, setSearchParams, autoExecute, setStoreAutoExecute])

  // Auto-launch from Examples page (templateLaunchResult passed via location state)
  const templateLaunchHandled = useRef(false)
  useEffect(() => {
    if (!templateLaunchFromExamples || templateLaunchHandled.current) return
    templateLaunchHandled.current = true
    setExamplesAutoLaunching(true)
    handleTemplateLaunch(templateLaunchFromExamples).finally(() => {
      setExamplesAutoLaunching(false)
      // Clear location state so refreshing doesn't re-trigger
      window.history.replaceState({}, '')
    })
  }, [templateLaunchFromExamples, handleTemplateLaunch])

  async function handleSubmit(skipAutoExecute = false) {
    if (!description.trim() || isSubmitting || pendingUploads > 0 || (directMode && !directConfirmed)) return

    // Warn if YOLO mode is on but no working directory — auto-execute will silently fail
    if (autoExecute && !workingDir.trim() && !skipAutoExecute) {
      setShowYoloWarning(true)
      return
    }

    setIsSubmitting(true)

    try {
      const effectiveModel = selectedModel || resolveModel(modelTier, selectedProvider || undefined, customModelMap)
      // Use first line of description as project name (truncated)
      const firstLine = description.trim().split('\n')[0].slice(0, 80)

      // Combine user-provided vision doc with playground context and attachment refs
      const attachmentSection = attachments.length > 0
        ? `## Attached Files\n${attachments.map((a) => `- [${a.name}](${a.url}) (${a.mimeType})`).join('\n')}`
        : ''
      const combinedVisionDoc = [playgroundVisionDoc, visionDoc.trim(), attachmentSection]
        .filter(Boolean)
        .join('\n\n') || undefined

      let projectId: string

      if (isRegeneration && existingProject) {
        // Re-generation flow: use existing project, don't create a duplicate
        // Await backend update before starting session to avoid stale context
        const github = detection?.remoteType === 'github' ? extractGitHubOwnerRepo(detection.remoteUrl) : null
        // If the existing project lacks a source, populate from detection
        const regenSource: ProjectSource | undefined = !existingProject.source && detection?.exists
          ? {
              localPath: workingDir.trim(),
              isGit: detection.isGit,
              remoteType: detection.remoteType,
              baseBranch: effectiveBranch || detection.baseBranch || (detection.isGit ? 'main' : undefined),
              ...(detection.remoteUrl ? { remoteUrl: detection.remoteUrl } : {}),
            }
          : undefined
        const regenUpdates = {
          description: description.trim(),
          name: firstLine,
          repository: detection?.remoteUrl || existingProject.repository || undefined,
          ...(github && !existingProject.githubOwner ? { githubOwner: github.owner, githubRepo: github.repo } : {}),
          ...(regenSource ? { source: regenSource } : {}),
          deliveryMode: directMode && directConfirmed ? 'direct' as const : detection?.suggestedDeliveryMode || undefined,
        }
        updateProject(existingProject.id, regenUpdates) // optimistic local
        await dataClient.updateProject(existingProject.id, regenUpdates) // await backend

        const result = await startPlanGenerationForProject(
          existingProject.id,
          description.trim(),
          {
            targetMachineId: selectedMachine?.machineId,
            workingDirectory: workingDir || undefined,
            preferredProvider: selectedProvider || undefined,
            model: effectiveModel,
            visionDoc: combinedVisionDoc,
            baseBranch: effectiveBranch || undefined,
          }
        )
        projectId = result.projectId
      } else {
        // Normal flow: create a new project + plan session
        const github = detection?.remoteType === 'github' ? extractGitHubOwnerRepo(detection.remoteUrl) : null
        // Build ProjectSource from detection so the project is created with correct
        // isGit / remoteType / baseBranch — this drives delivery mode and worktree isolation.
        const detectedSource: ProjectSource | undefined = detection?.exists
          ? {
              localPath: workingDir.trim(),
              isGit: detection.isGit,
              remoteType: detection.remoteType,
              baseBranch: effectiveBranch || detection.baseBranch || (detection.isGit ? 'main' : undefined),
              ...(detection.remoteUrl ? { remoteUrl: detection.remoteUrl } : {}),
            }
          : undefined
        const result = await startPlanGeneration(
          description.trim(),
          firstLine,
          {
            targetMachineId: selectedMachine?.machineId,
            workingDirectory: workingDir || undefined,
            preferredProvider: selectedProvider || undefined,
            model: effectiveModel,
            visionDoc: combinedVisionDoc,
            baseBranch: effectiveBranch || undefined,
            repository: detection?.remoteUrl || undefined,
            ...(github ? { githubOwner: github.owner, githubRepo: github.repo } : {}),
            ...(detectedSource ? { source: detectedSource } : {}),
            deliveryMode: directMode && directConfirmed ? 'direct' as const : detection?.suggestedDeliveryMode || undefined,
          }
        )
        projectId = result.projectId
      }

      // Register auto-execute if YOLO mode is on (unless user chose plan-only or no workDir)
      // Pass the selected provider so subsequent task executions use the same provider
      if (autoExecute && !skipAutoExecute && workingDir.trim()) {
        setStoreAutoExecute(projectId, true, {
          preferredProvider: selectedProvider || undefined,
          targetMachineId: selectedMachine?.machineId,
          model: effectiveModel,
        })
      }

      setActiveProjectId(projectId)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[plan-generation] Failed to start:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Chat Phase ─────────────────────────────────────────────────
  // Skip chat phase for existing projects with no plan nodes and no active execution (re-generation pre-fill).
  // A terminal execution (cancelled/failure/success) with zero nodes means the previous attempt
  // produced nothing — show the input form so the user can re-generate.
  // Once the user submits, execution status resets to "pending" and we enter chat phase normally.
  const executionIsTerminal = execution?.status === 'cancelled' || execution?.status === 'failure' || execution?.status === 'success'
  // Show input form for re-generation only when: project has no nodes AND there's no
  // execution or the execution ended cleanly (no error). When the execution has an error,
  // stay in chat phase so PlanGeneration can display the error UI (e.g., "No machine available").
  const showInputForRegeneration = existingProjectHasNoNodes && (!execution || (executionIsTerminal && !execution.error)) && !fromPlaygroundId
  if (activeProjectId && (execution || project) && !showInputForRegeneration) {
    return (
      <div className="h-full">
        <PlanGeneration
          projectId={activeProjectId}
          projectName={project?.name || "New Project"}
          machineName={machineName}
          workingDirectory={project?.workingDirectory || workingDir || undefined}
          onBack={() => {
            backingRef.current = true
            setActiveProjectId(null)
            setSearchParams({})
            resetForm()
          }}
          onNewPlan={() => {
            backingRef.current = true
            setActiveProjectId(null)
            setSearchParams({})
            resetForm()
          }}
        />
      </div>
    )
  }

  // ─── Auto-launching from Examples ───────────────────────────────
  if (examplesAutoLaunching) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Starting plan from example...</p>
      </div>
    )
  }

  // ─── Input Phase ────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-start min-h-dvh md:min-h-full p-4 pt-5 md:p-6 overflow-auto">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8 mt-4 md:mt-8">
          <h1 className="text-xl md:text-2xl font-bold font-sans mb-2">
            {isRegeneration ? t('regenerate') : t('generatePlan', { defaultValue: 'Plan' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isRegeneration
              ? t('replanDesc', { defaultValue: 'Review and update your goal, then generate a fresh plan.' })
              : t('planDesc', { defaultValue: 'Describe your goal in detail. Agent will build a plan with you collaboratively.' })}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Onboarding hint about machine setup */}
          {allMachines.length > 0 && !selectedMachine && (
            <OnboardingHint hintId="plan-machine-setup" icon={Monitor}>
              Select a <strong>machine</strong> and <strong>working directory</strong> below so the plan can be executed on your environment.
            </OnboardingHint>
          )}

          {/* Playground context card */}
          {fromPlaygroundId && playgroundProject && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-primary">Building on playground session</p>
                {playgroundExecution?.summary?.workCompleted && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {playgroundExecution.summary.workCompleted}
                  </p>
                )}
                {playgroundExecution?.summary?.filesChanged && playgroundExecution.summary.filesChanged.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <FileCode2 className="h-3 w-3" />
                    {playgroundExecution.summary.filesChanged.length} files changed
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Goal textarea + session resume */}
          <div className="flex flex-col rounded-lg border border-border bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring/50 transition-all duration-200">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              onPaste={handleGoalPaste}
              placeholder={t('goalPlaceholder', { defaultValue: "What do you want to build or accomplish?" })}
              rows={5}
              autoFocus
              className="w-full px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none resize-none bg-transparent"
            />
            <div className="flex justify-end px-4 pb-1">
              <span className="text-[10px] text-muted-foreground/40">{t('cmdEnterPlan', { defaultValue: '⌘+Enter to start planning' })}</span>
            </div>

            {/* OR divider + options */}
            <div className="px-4 pb-3">
              <div className="flex items-center gap-3 mb-2.5">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/examples")}
                  disabled={templateLaunching}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {templateLaunching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LayoutTemplate className="h-3.5 w-3.5" />
                  )}
                  {templateLaunching ? t('starting', { defaultValue: 'Starting...' }) : t('startFromExample', { defaultValue: 'Start from an Example' })}
                </button>
                <button
                  type="button"
                  onClick={() => setSessionPickerOpen(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5" />
                  {t('resumeSession', { defaultValue: 'Resume a Session' })}
                </button>
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
              onWorkingDirChange={(path) => {
                setWorkingDir(path)
                setSelectedBranch(null)
              }}
              onBrowse={() => setShowPathBrowser(true)}
              machineLabel="Machine"
              dirLabel="Working directory"
              dirPlaceholder="/path/to/project (optional)"
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
            />
          )}

          {/* Detection feedback + Branch selector — shown when machine is selected */}
          {selectedMachine && workingDir.trim() && (
            <div className="animate-reveal flex flex-col gap-2">
              <DetectionFeedback detection={detection} isDetecting={isDetecting} onInitGit={detection?.exists && !detection.isGit ? handleInitGit : undefined} />

              {/* Git workflow controls: branch selector + execution mode toggle */}
              {detection?.isGit && (
                <div className="flex flex-col gap-1.5">
                  {/* Branch selector — hidden when direct mode is confirmed (branch is irrelevant) */}
                  {!(directMode && directConfirmed) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Target branch:</span>
                      <BranchSelector
                        value={effectiveBranch || 'main'}
                        onChange={setSelectedBranch}
                        path={workingDir.trim()}
                        machineId={selectedMachine.machineId}
                      />
                    </div>
                  )}

                  {/* Execution mode selector */}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setDirectMode(false); setDirectConfirmed(false) }}
                      className={cn(
                        "flex-1 px-2 py-1 rounded-md border text-xs transition-colors cursor-pointer",
                        !directMode
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-input bg-background text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      {detection.remoteUrl ? 'Git workflow (PR)' : 'Git workflow (branch)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirectMode(true)}
                      className={cn(
                        "flex-1 px-2 py-1 rounded-md border text-xs transition-colors cursor-pointer",
                        directMode
                          ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                          : "border-input bg-background text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      Direct (in-place)
                    </button>
                  </div>
                  {directMode && !directConfirmed && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-px" />
                      <div className="flex-1 text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                        <span className="font-medium">
                          {detection.remoteUrl ? 'No worktrees · No branches · No PRs' : 'No worktrees · No branches'}
                        </span>
                        <br />
                        <span className="text-muted-foreground">One task at a time, working directly inside the working directory.</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-5 text-[10px] shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                        onClick={() => setDirectConfirmed(true)}
                      >
                        OK
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Add Context — collapsible section */}
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setContextOpen(!contextOpen)}
              className="flex items-center gap-1.5 text-left py-1.5 rounded transition-colors cursor-pointer group hover:bg-muted/30 -mx-1 px-1"
            >
              {contextOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-xs text-muted-foreground font-medium">
                Add Context
              </span>
              {(visionDoc.trim() || attachments.length > 0) && (
                <span className="flex items-center gap-1 text-[10px] text-primary">
                  {visionDoc.trim() && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                      <FileText className="h-2.5 w-2.5 mr-0.5" />
                      Vision
                    </Badge>
                  )}
                  {attachments.length > 0 && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                      <Paperclip className="h-2.5 w-2.5 mr-0.5" />
                      {attachments.length}
                    </Badge>
                  )}
                </span>
              )}
            </button>

            {contextOpen && (
              <div className="flex flex-col gap-4 mt-2 animate-reveal">
                {/* Vision / Design Document */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3 w-3" />
                    Vision / Design Document
                  </label>
                  <textarea
                    value={visionDoc}
                    onChange={(e) => setVisionDoc(e.target.value)}
                    placeholder={t('visionDocPlaceholder', { defaultValue: 'Define the product vision, research question, or project context here. This will be provided to all agents working on this project as persistent context (skill.md)...' })}
                    rows={6}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[100px]"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Markdown supported. Injected into every agent session as context.
                  </p>
                </div>

                {/* Attachments */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Paperclip className="h-3 w-3" />
                    Attachments
                  </label>
                  <AttachmentList
                    attachments={attachments}
                    onAdd={handleAddAttachment}
                    onRemove={handleRemoveAttachment}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Submit row */}
          <div className="flex items-center justify-end gap-2">
            {availableProviders.length > 1 && (
              <ProviderDropdown
                providers={availableProviders}
                selectedProvider={selectedProvider}
                onSelect={(id) => { setSelectedProvider(id); setSelectedModel("") }}
                compact
              />
            )}
            <Button
              onClick={() => handleSubmit()}
              disabled={!description.trim() || isSubmitting || pendingUploads > 0 || (directMode && !directConfirmed)}
              className="gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : pendingUploads > 0 ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {isSubmitting ? "Starting..." : pendingUploads > 0 ? "Uploading images..." : isRegeneration ? "Regenerate Plan" : "Start Planning"}
            </Button>
          </div>
        </div>

        {/* Recent Plan Sessions */}
        {planHistory.length > 0 && (
          <div id="plan-history" className="mt-10">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Recent Sessions
            </h2>
            <div className="flex flex-col gap-1">
              {planHistory.map((p) => {
                const exec = allExecutions.get(`plan-${p.id}`)
                const statusLabel = exec?.status === 'running' ? 'Running'
                  : exec?.status === 'success' ? 'Completed'
                  : exec?.status === 'failure' ? 'Failed'
                  : exec?.status === 'cancelled' ? 'Stopped'
                  : 'Pending'
                const statusColor = exec?.status === 'running' ? 'bg-primary'
                  : exec?.status === 'success' ? 'bg-success'
                  : exec?.status === 'failure' ? 'bg-destructive'
                  : 'bg-muted-foreground'

                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => viewSession(p.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') viewSession(p.id) }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left group cursor-pointer"
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", statusColor)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">
                        {p.workingDirectory || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusLabel && (
                        <Badge variant="outline" className="text-[10px] hidden md:inline-flex">
                          {statusLabel}
                        </Badge>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (activeProjectId === p.id) {
                            setActiveProjectId(null)
                            setSearchParams({})
                          }
                          allExecutions.delete(`plan-${p.id}`)
                          deleteProject(p.id)
                        }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 [@media(hover:none)]:opacity-60 hover:bg-destructive/10 transition-all text-destructive"
                        title="Delete session"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* YOLO + no working directory warning dialog */}
        <Dialog open={showYoloWarning} onOpenChange={setShowYoloWarning}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-warning" />
                YOLO Mode — No Working Directory
              </DialogTitle>
              <DialogDescription>
                YOLO mode auto-executes tasks after planning, but execution requires a working directory. Without one, tasks will silently fail to dispatch.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              You can go back to set a working directory, or proceed with planning only (auto-execution will be skipped).
            </p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowYoloWarning(false)}>
                Cancel
              </Button>
              <Button onClick={() => {
                setShowYoloWarning(false)
                handleSubmit(true)
              }}>
                Proceed (Plan Only)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remote path browser dialog */}
        {selectedMachine && (
          <RemotePathBrowser
            open={showPathBrowser}
            onOpenChange={setShowPathBrowser}
            machineId={selectedMachine.machineId}
            machineName={selectedMachine.name}
            currentPath={workingDir || undefined}
            onSelect={(path) => setWorkingDir(path)}
          />
        )}

        {/* Session picker dialog */}
        <SessionPickerDialog
          open={sessionPickerOpen}
          onOpenChange={setSessionPickerOpen}
          onSelectSession={(session) => {
            // Pre-fill form from Claude Code session
            const title = session.customTitle || session.summary || session.firstPrompt || ""
            if (title) setDescription(title)
            if (session.cwd) setWorkingDir(session.cwd)
            const machine = allMachines.find((m) => m.machineId === session.machineId)
            if (machine) setSelectedMachine(machine)
          }}
          playgroundSessions={playgroundHistory}
          onSelectPlaygroundSession={(projectId) => {
            // Navigate to plan with playground context
            const pg = allProjects.find((p) => p.id === projectId)
            if (pg) {
              if (pg.description) setDescription(pg.description)
              if (pg.workingDirectory) setWorkingDir(pg.workingDirectory)
              if (pg.defaultMachineId) {
                const machine = allMachines.find((m) => m.machineId === pg.defaultMachineId)
                if (machine) setSelectedMachine(machine)
              }
            }
          }}
          planSessions={planHistory}
          onSelectPlanSession={viewSession}
        />

        {/* Template picker dialog */}
        <ExamplePickerDialog
          open={templatePickerOpen}
          onOpenChange={(open) => {
            setTemplatePickerOpen(open)
            if (!open) setInitialTemplateId(null)
          }}
          initialTemplateId={initialTemplateId}
          onLaunchSuccess={handleTemplateLaunch}
        />
      </div>
    </div>
  )
}

/** Compact detection feedback for advanced settings */
function DetectionFeedback({
  detection,
  isDetecting,
  onInitGit,
}: {
  detection: ReturnType<typeof useDirectoryDetection>["detection"]
  isDetecting: boolean
  onInitGit?: () => void
}) {
  if (!detection && !isDetecting) return null

  if (isDetecting) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking directory...
      </div>
    )
  }

  if (!detection) return null

  if (!detection.exists) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3 w-3" />
        Directory will be created with git initialized.
      </div>
    )
  }

  if (detection.isGit) {
    const branchInfo = detection.currentBranch ? ` on ${detection.currentBranch}` : ""
    const dirtyInfo = detection.isDirty ? " (dirty)" : ""
    const remoteLabel = detection.remoteType !== "none" ? ` · ${detection.remoteType}` : " · local only"
    return (
      <div className="flex items-center gap-2 text-xs text-info">
        <GitBranch className="h-3 w-3" />
        Git repo{branchInfo}{dirtyInfo}{remoteLabel}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Info className="h-3 w-3" />
      No git repo detected. Git is recommended for code projects.
      {onInitGit && (
        <button
          type="button"
          onClick={onInitGit}
          className="text-xs text-primary hover:underline cursor-pointer ml-1"
        >
          Initialize Git
        </button>
      )}
    </div>
  )
}
