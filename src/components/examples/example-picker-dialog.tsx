import { useState, useEffect, useCallback, useMemo } from "react"
import { useNavigate } from "react-router"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ExampleGallery } from "./example-gallery"
import { ExampleParameterForm } from "./example-parameter-form"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { useExampleStore } from "@/stores/example-store"
import { useToastStore } from "@/stores/toast-store"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useSettingsStore, resolveModel, type ModelTier } from "@/stores/settings-store"
import { deriveAvailableProviders, isProviderAvailable, PROVIDER_NAMES } from "@/components/execution/provider-utils"
import { apiUrl } from "@/lib/api-url"
import { useMachinesStore } from "@/stores/machines-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Laptop,
  Loader2,
  Rocket,
  Sparkles,
} from "lucide-react"
import { deriveEffectiveSkills } from "@astro/core/templates"
import type { UseCaseTemplateSummary } from "@astro/core/templates"
import { previewExample as previewExampleApi } from "@/lib/api-client"
import type { LaunchExampleResult } from "@/lib/api-client"

/** Data passed to the Plan page to pre-fill form fields from a template */
export interface ExamplePrefillData {
  description: string
  projectName: string
  visionDoc?: string
  machineId?: string
  workingDirectory?: string
  preferredProvider?: string
  model?: string
}

interface ExamplePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Optional callback when template launch succeeds.
   * If provided, navigation will not be performed automatically.
   * Use this when you want to handle the launch result (e.g., start SSE plan generation).
   */
  onLaunchSuccess?: (result: LaunchExampleResult) => void
  /**
   * Optional callback to pre-fill the Plan page form instead of launching.
   * When provided (typically with skipBrowse), the dialog resolves template
   * parameters and passes the prefill data without creating a project.
   */
  onPrefillPlan?: (data: ExamplePrefillData) => void
  /** When set, auto-selects this template and skips to the configure step on open */
  initialTemplateId?: string | null
  /** When true, start directly at Configure step (skip Browse) */
  skipBrowse?: boolean
}

type WizardStep = "browse" | "configure" | "launch"

const FULL_STEP_ORDER: WizardStep[] = ["browse", "configure", "launch"]
const SKIP_BROWSE_STEP_ORDER: WizardStep[] = ["configure", "launch"]

const STEP_LABELS: Record<WizardStep, string> = {
  browse: "Browse Examples",
  configure: "Configure Parameters",
  launch: "Ready to Launch",
}

/**
 * ExamplePickerDialog - Multi-step wizard for template-based project creation
 *
 * Steps (full flow):
 * 1. Browse/search templates (ExampleGallery)
 * 2. Configure parameters + project name + working directory
 * 3. Launch — create project and navigate to plan view
 *
 * When `skipBrowse` is true, starts directly at Configure (step 2).
 */
export function ExamplePickerDialog({ open, onOpenChange, onLaunchSuccess, onPrefillPlan, initialTemplateId, skipBrowse }: ExamplePickerDialogProps) {
  const navigate = useNavigate()

  // Example store state
  const templates = useExampleStore((s) => s.templates)
  const categories = useExampleStore((s) => s.categories)
  const selectedTemplate = useExampleStore((s) => s.selectedTemplate)
  const parameterValues = useExampleStore((s) => s.parameterValues)
  const validationErrors = useExampleStore((s) => s.validationErrors)
  const isLoading = useExampleStore((s) => s.isLoading)

  // Store actions
  const selectTemplate = useExampleStore((s) => s.selectTemplate)
  const setParameterValue = useExampleStore((s) => s.setParameterValue)
  const validateParameters = useExampleStore((s) => s.validateParameters)
  const launchExample = useExampleStore((s) => s.launchExample)
  const reset = useExampleStore((s) => s.reset)

  // Machine state
  const machines = useExecutionStore((s) => s.machines)
  const registeredMachines = useMachinesStore((s) => s.machines)
  const realtimeMachines = useRealtimeStore((s) => s.machines)
  const allMachines = useMemo<MachineInfo[]>(() => [
    ...machines,
    ...Array.from(realtimeMachines.values()).map((m) => ({
      machineId: m.machineId,
      name: m.name,
      status: 'online' as const,
      providers: m.providers.map((p) => ({ type: p.type, status: p.status })),
    })),
    ...registeredMachines
      .filter((rm) => !machines.some((m) => m.machineId === rm.id))
      .map((rm) => ({
        machineId: rm.id,
        name: rm.name,
        status: 'offline' as const,
        providers: [],
      })),
  ].filter((m, i, arr) => arr.findIndex((a) => a.machineId === m.machineId) === i), [machines, realtimeMachines, registeredMachines])

  // Determine step order based on skipBrowse prop
  const stepOrder = skipBrowse ? SKIP_BROWSE_STEP_ORDER : FULL_STEP_ORDER
  const firstStep = stepOrder[0]

  // Provider state
  const globalProviders = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const customModelMap = useSettingsStore((s) => s.customModelMap)
  const modelTier: ModelTier = "large"

  // Local wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(firstStep)
  const [projectName, setProjectName] = useState("")
  const [workingDirectory, setWorkingDirectory] = useState("")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [showPathBrowser, setShowPathBrowser] = useState(false)
  const [isLaunching, setIsLaunching] = useState(false)

  const availableProviders = useMemo(
    () => deriveAvailableProviders(selectedMachine?.providers, globalProviders),
    [selectedMachine?.providers, globalProviders]
  )

  // Load providers on mount
  useEffect(() => {
    if (!providersLoaded) loadProviders()
  }, [providersLoaded, loadProviders])

  // Reset provider/model when machine changes and current provider isn't available
  useEffect(() => {
    if (selectedProvider && availableProviders.length > 0) {
      if (!isProviderAvailable(selectedProvider, availableProviders)) {
        setSelectedProvider("")
        setSelectedModel("")
      }
    }
  }, [selectedMachine?.machineId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Skill state — fetched from recommended + conditional skills, editable by user
  const [skillInstructions, setSkillInstructions] = useState<Record<string, string>>({})
  const [skillsExpanded, setSkillsExpanded] = useState<string | null>(null)
  const [skillsLoading, setSkillsLoading] = useState(false)

  // Derive the full skill list: recommendedSkills + conditionalSkills based on parameter values
  const effectiveSkillNames = useMemo(
    () => deriveEffectiveSkills(selectedTemplate, parameterValues as Record<string, unknown>),
    [selectedTemplate, parameterValues],
  )

  // Stable key for the skill list — prevents re-fetch when array reference changes but contents don't
  const skillNamesKey = effectiveSkillNames.join(',')

  // Fetch SKILL.md files when effective skill list changes
  useEffect(() => {
    const names = skillNamesKey ? skillNamesKey.split(',') : []
    if (!names.length) {
      setSkillInstructions({})
      return
    }
    let cancelled = false
    setSkillsLoading(true)
    Promise.all(
      names.map(async (name) => {
        try {
          const res = await fetch(apiUrl(`/api/skills/files/${encodeURIComponent(name)}/SKILL.md`))
          if (!res.ok) return [name, ''] as const
          const text = await res.text()
          // Guard against SPA fallback returning HTML instead of markdown
          if (text.trimStart().startsWith('<!')) return [name, ''] as const
          return [name, text] as const
        } catch {
          return [name, ''] as const
        }
      })
    ).then((results) => {
      if (cancelled) return
      const map: Record<string, string> = {}
      for (const [name, content] of results) {
        map[name] = content
      }
      setSkillInstructions(map)
      setSkillsLoading(false)
    })
    return () => { cancelled = true }
  }, [skillNamesKey])

  // Reset wizard state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      // Reset on close
      setCurrentStep(firstStep)
      setProjectName("")
      setWorkingDirectory("")
      setSelectedMachine(null)
      setSelectedProvider("")
      setSelectedModel("")
      setShowPathBrowser(false)
      setIsLaunching(false)
      reset()
    }
  }, [open, reset, firstStep])

  // Auto-select initial template when dialog opens with one specified
  useEffect(() => {
    if (open && initialTemplateId) {
      selectTemplate(initialTemplateId)
        .then(() => setCurrentStep("configure"))
        .catch(() => { /* template store shows toast on failure */ })
    }
  }, [open, initialTemplateId, selectTemplate])

  // Auto-generate project name from template when template is selected
  useEffect(() => {
    if (selectedTemplate && !projectName) {
      // Auto-suggest project name based on template name
      const baseName = selectedTemplate.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()
      setProjectName(`${baseName}-project`)
    }
  }, [selectedTemplate, projectName])

  // Keep the template's workingDirectory parameter in sync with the project-level field.
  // The template parameter is hidden from the form (filtered out) to avoid duplication,
  // but it still needs to be set so prompt interpolation works.
  useEffect(() => {
    if (selectedTemplate) {
      const hasWorkDir = selectedTemplate.requiredParameters?.some(
        (p) => p.id === "workingDirectory"
      )
      if (hasWorkDir) {
        setParameterValue("workingDirectory", workingDirectory)
      }
    }
  }, [workingDirectory, selectedTemplate, setParameterValue])

  // Handle template selection
  const handleTemplateSelect = useCallback(
    async (template: UseCaseTemplateSummary) => {
      await selectTemplate(template.id)
      setCurrentStep("configure")
    },
    [selectTemplate]
  )

  // Handle parameter change
  const handleParameterChange = useCallback(
    (parameterId: string, value: unknown) => {
      setParameterValue(parameterId, value)
    },
    [setParameterValue]
  )

  // Shared validation for the configure step
  const validateConfigStep = useCallback(async (): Promise<boolean> => {
    const isValid = await validateParameters()
    if (!isValid) {
      useToastStore.getState().add({
        type: "error",
        title: "Validation failed",
        description: "Please fix the parameter errors before continuing",
      })
      return false
    }
    if (!projectName.trim()) {
      useToastStore.getState().add({
        type: "error",
        title: "Project name required",
        description: "Please enter a name for your project",
      })
      return false
    }
    const templateNeedsWorkDir = selectedTemplate?.requiredParameters?.some((p) => p.id === 'workingDirectory')
    if ((selectedMachine || templateNeedsWorkDir) && !workingDirectory.trim()) {
      useToastStore.getState().add({
        type: "error",
        title: "Working directory required",
        description: "Please specify a working directory where results will be saved",
      })
      return false
    }
    return true
  }, [validateParameters, projectName, workingDirectory, selectedMachine, selectedTemplate])

  // Validate and move to next step
  const handleNext = useCallback(async () => {
    const stepIndex = stepOrder.indexOf(currentStep)
    const nextStep = stepOrder[stepIndex + 1]

    if (currentStep === "configure") {
      const valid = await validateConfigStep()
      if (!valid) return
    }

    if (nextStep) {
      setCurrentStep(nextStep)
    }
  }, [currentStep, stepOrder, validateConfigStep])

  // Handle back navigation
  const handleBack = useCallback(() => {
    const stepIndex = stepOrder.indexOf(currentStep)
    const prevStep = stepOrder[stepIndex - 1]
    if (prevStep) {
      setCurrentStep(prevStep)
    } else if (skipBrowse) {
      // When browse is skipped, going back from first step closes the dialog
      onOpenChange(false)
    }
  }, [currentStep, stepOrder, skipBrowse, onOpenChange])

  // Build combined vision doc from skill instructions
  const buildVisionDoc = useCallback((): string | undefined => {
    const entries = Object.entries(skillInstructions).filter(([, v]) => v.trim())
    if (entries.length === 0) return undefined
    if (entries.length === 1) return entries[0][1]
    return entries.map(([name, content]) => `# Skill: ${name}\n\n${content}`).join('\n\n---\n\n')
  }, [skillInstructions])

  // Handle launch
  const handleLaunch = useCallback(async () => {
    if (!selectedTemplate) return

    setIsLaunching(true)
    try {
      const visionDoc = buildVisionDoc()
      const effectiveModel = selectedModel || resolveModel(modelTier, selectedProvider || undefined, customModelMap)
      // Call the store's launch method which returns the result
      const result = await launchExample(projectName, workingDirectory || undefined, selectedMachine?.machineId, visionDoc, selectedProvider || undefined, effectiveModel)

      if (result) {
        // Examples always run in YOLO mode — enable it automatically
        const settingsStore = useSettingsStore.getState()
        if (!settingsStore.yoloMode) {
          settingsStore.setYoloMode(true)
        }

        // Close dialog
        onOpenChange(false)

        // If a callback is provided, call it instead of navigating
        if (onLaunchSuccess) {
          onLaunchSuccess(result)
        } else {
          // Default behavior: navigate to Plan page with launch result for auto-start
          navigate("/plan", { state: { templateLaunchResult: result } })

          // Show success toast
          useToastStore.getState().add({
            type: "success",
            title: "Project created",
            description: `Navigating to "${result.project.name}" plan...`,
          })
        }
      }
    } catch (error) {
      // Error is already handled in the store
      console.error("Launch failed:", error)
    } finally {
      setIsLaunching(false)
    }
  }, [
    selectedTemplate,
    projectName,
    workingDirectory,
    selectedMachine?.machineId,
    selectedProvider,
    selectedModel,
    customModelMap,
    launchExample,
    onOpenChange,
    onLaunchSuccess,
    navigate,
    buildVisionDoc,
  ])

  // Direct launch from configure step (skipBrowse mode — validates then launches)
  const handleDirectLaunch = useCallback(async () => {
    const valid = await validateConfigStep()
    if (!valid) return
    await handleLaunch()
  }, [validateConfigStep, handleLaunch])

  // Prefill plan: preview template to resolve description, then pass to Plan page
  const handlePrefillPlan = useCallback(async () => {
    if (!selectedTemplate || !onPrefillPlan) return
    const valid = await validateConfigStep()
    if (!valid) return

    setIsLaunching(true)
    try {
      const preview = await previewExampleApi(selectedTemplate.id, parameterValues)
      const visionDoc = buildVisionDoc()
      const effectiveModel = selectedModel || resolveModel(modelTier, selectedProvider || undefined, customModelMap)

      onPrefillPlan({
        description: preview.interpolatedPrompts.planGeneration,
        projectName,
        visionDoc: visionDoc || preview.interpolatedPrompts.sharedContext || undefined,
        machineId: selectedMachine?.machineId,
        workingDirectory: workingDirectory || undefined,
        preferredProvider: selectedProvider || undefined,
        model: effectiveModel,
      })
      onOpenChange(false)
    } catch (error) {
      console.error("Preview failed:", error)
      useToastStore.getState().add({
        type: "error",
        title: "Preview failed",
        description: error instanceof Error ? error.message : "Failed to resolve template",
      })
    } finally {
      setIsLaunching(false)
    }
  }, [selectedTemplate, parameterValues, onPrefillPlan, validateConfigStep, buildVisionDoc, projectName, workingDirectory, selectedMachine?.machineId, selectedProvider, selectedModel, customModelMap, onOpenChange])

  // Calculate progress
  const progressPercentage = ((stepOrder.indexOf(currentStep) + 1) / stepOrder.length) * 100

  // Check if can proceed to next step
  const canProceed = () => {
    switch (currentStep) {
      case "browse":
        return !!selectedTemplate
      case "configure": {
        const needsWorkDir = !!selectedMachine || selectedTemplate?.requiredParameters?.some((p) => p.id === 'workingDirectory')
        return !!projectName.trim() && (!needsWorkDir || !!workingDirectory.trim()) && validationErrors.length === 0
      }
      case "launch":
        return true
      default:
        return false
    }
  }

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case "browse":
        return (
          <div className="h-[500px]">
            <ExampleGallery
              templates={templates}
              categories={categories.map(cat => ({
                name: cat.category,
                count: cat.count
              }))}
              isLoading={isLoading}
              onTemplateSelect={handleTemplateSelect}
            />
          </div>
        )

      case "configure": {
        if (!selectedTemplate) {
          return (
            <div className="h-[500px] flex items-center justify-center text-muted-foreground">
              No template selected
            </div>
          )
        }

        // Combine required and optional parameters.
        // Filter out workingDirectory — it's already handled by the project-level
        // Working Directory field above (with the folder browse button).
        const allParameters = [
          ...(selectedTemplate.requiredParameters || []),
          ...(selectedTemplate.optionalParameters || []),
        ].filter((p) => p.id !== 'workingDirectory')

        return (
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
            {/* Template Description */}
            {selectedTemplate.description && (
              <div className="px-4 py-3 rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground leading-relaxed">
                {selectedTemplate.description}
              </div>
            )}

            {/* Recommended Skills (becomes Vision Doc on launch) */}
            {selectedTemplate.recommendedSkills && selectedTemplate.recommendedSkills.length > 0 && (
              <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/30">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Skills
                  <span className="text-xs font-normal text-muted-foreground">(becomes project vision doc)</span>
                </h3>
                {skillsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading skills...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedTemplate.recommendedSkills.map((name) => (
                      <div key={name} className="rounded-md border border-border overflow-hidden">
                        <button
                          type="button"
                          className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => setSkillsExpanded(skillsExpanded === name ? null : name)}
                        >
                          {skillsExpanded === name ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="font-medium">{name}</span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {skillInstructions[name] ? `${Math.round(skillInstructions[name].length / 1024)}KB` : 'empty'}
                          </span>
                        </button>
                        {skillsExpanded === name && (
                          <div className="border-t border-border">
                            <textarea
                              value={skillInstructions[name] || ''}
                              onChange={(e) => setSkillInstructions((prev) => ({ ...prev, [name]: e.target.value }))}
                              className="w-full min-h-[200px] max-h-[400px] p-3 text-xs font-mono bg-background resize-y focus:outline-none"
                              placeholder={`Skill instructions for ${name}...`}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Project Configuration */}
            <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Rocket className="h-4 w-4" />
                Project Configuration
              </h3>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="project-name" className="text-sm font-medium">
                    Project Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="project-name"
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="my-awesome-project"
                    className={cn(!projectName.trim() && "border-red-500")}
                  />
                </div>
                {/* Machine selector */}
                {(isServerMode() || allMachines.length > 0) && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Machine</Label>
                    <div className="flex flex-wrap gap-2">
                      {allMachines.map((m) => (
                        <button
                          key={m.machineId}
                          type="button"
                          onClick={() => setSelectedMachine(
                            selectedMachine?.machineId === m.machineId ? null : m
                          )}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                            selectedMachine?.machineId === m.machineId
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          <Laptop className="h-3 w-3" />
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Provider selector — shown when providers are available */}
                {availableProviders.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">AI Provider</Label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { setSelectedProvider(""); setSelectedModel("") }}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                          !selectedProvider
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-muted"
                        )}
                      >
                        <Bot className="h-3 w-3" />
                        Auto
                      </button>
                      {availableProviders.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSelectedProvider(selectedProvider === p.id ? "" : p.id)
                            setSelectedModel("")
                          }}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                            selectedProvider === p.id
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          <Bot className="h-3 w-3" />
                          {PROVIDER_NAMES[p.id] || p.name || p.id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Working directory — shown when a machine is selected OR when the template requires it */}
                {(selectedMachine || selectedTemplate?.requiredParameters?.some((p) => p.id === 'workingDirectory')) && (
                <div className="space-y-2">
                  <Label htmlFor="working-directory" className="text-sm font-medium">
                    Working Directory <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPathBrowser(true)}
                      title="Browse directories"
                      className="shrink-0 rounded-md border border-border p-1.5 hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </button>
                    <Input
                      id="working-directory"
                      type="text"
                      value={workingDirectory}
                      onChange={(e) => setWorkingDirectory(e.target.value)}
                      placeholder="/path/to/project"
                      className={cn("flex-1 font-mono text-xs", !workingDirectory.trim() && "border-red-500")}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Results will be saved inside this directory (e.g. <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{workingDirectory || '/path/to/project'}/output/</code>)
                  </p>
                </div>
                )}
              </div>
            </div>

            {/* Template Parameters */}
            {allParameters.length > 0 && (
              <div className="space-y-4">
                <ExampleParameterForm
                  parameters={allParameters}
                  values={parameterValues}
                  errors={validationErrors}
                  onChange={handleParameterChange}
                  defaultExpandAdvanced={false}
                />
              </div>
            )}
          </div>
        )
      }

      case "launch":
        return (
          <div className="h-[500px] flex flex-col items-center justify-center gap-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Rocket className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Ready to Launch</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Your project <span className="font-medium text-foreground">{projectName}</span>{" "}
                is configured and ready to launch. Click the button below to create the project
                and start planning.
              </p>
            </div>
            <div className="space-y-2 text-left w-full max-w-md">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Template:</span>
                <span className="font-medium">{selectedTemplate?.name}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Parameters:</span>
                <span className="font-medium">
                  {Object.keys(parameterValues).length} configured
                </span>
              </div>
              {selectedMachine && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Machine:</span>
                  <span className="font-medium">{selectedMachine.name}</span>
                </div>
              )}
              {selectedProvider && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">AI Agent:</span>
                  <span className="font-medium">{PROVIDER_NAMES[selectedProvider] || selectedProvider}</span>
                </div>
              )}
              {workingDirectory && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Working Directory:</span>
                  <span className="font-medium font-mono text-[10px]">
                    {workingDirectory}
                  </span>
                </div>
              )}
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{skipBrowse ? "Configure Example" : "Create Project from Template"}</DialogTitle>
          <DialogDescription>
            {skipBrowse
              ? "Set your machine and working directory, then enter Plan Mode"
              : "Choose a template and configure it to quickly start your project"}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator — only show for multi-step flow */}
        {!skipBrowse && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">{STEP_LABELS[currentStep]}</span>
              <span className="text-muted-foreground">
                Step {stepOrder.indexOf(currentStep) + 1} of {stepOrder.length}
              </span>
            </div>
            <Progress value={progressPercentage} className="h-1" />
          </div>
        )}

        {/* Step content */}
        <div className="flex-1 min-h-0">{renderStepContent()}</div>

        {/* Footer with navigation buttons */}
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div>
            {(currentStep !== firstStep || skipBrowse) && (
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isLoading || isLaunching}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {currentStep === "launch" || (skipBrowse && currentStep === "configure") ? (
              <Button
                type="button"
                onClick={skipBrowse && currentStep === "configure"
                  ? (onPrefillPlan ? handlePrefillPlan : handleDirectLaunch)
                  : handleLaunch}
                disabled={isLaunching || !canProceed()}
              >
                {isLaunching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Launching...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    {skipBrowse ? "Enter Plan Mode" : "Launch Project"}
                  </>
                )}
              </Button>
            ) : (
              <>
                {currentStep === "browse" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleNext}
                  disabled={!canProceed() || isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Remote path browser dialog */}
      {selectedMachine && (
        <RemotePathBrowser
          open={showPathBrowser}
          onOpenChange={setShowPathBrowser}
          machineId={selectedMachine.machineId}
          machineName={selectedMachine.name}
          currentPath={workingDirectory || undefined}
          onSelect={(path) => setWorkingDirectory(path)}
        />
      )}
    </Dialog>
  )
}
