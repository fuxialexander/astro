import { useState, useEffect, useCallback } from "react"
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
import { TemplateGallery } from "./template-gallery"
import { TemplateParameterForm } from "./template-parameter-form"
import { TemplatePreview } from "./template-preview"
import { useTemplateStore } from "@/stores/template-store"
import { useToastStore } from "@/stores/toast-store"
import { cn } from "@/lib/utils"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Rocket,
  FolderOpen,
} from "lucide-react"
import type { UseCaseTemplateSummary } from "@astro/core/templates"
import type { LaunchTemplateResult } from "@/lib/api-client"

interface TemplatePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Optional callback when template launch succeeds.
   * If provided, navigation will not be performed automatically.
   * Use this when you want to handle the launch result (e.g., start SSE plan generation).
   */
  onLaunchSuccess?: (result: LaunchTemplateResult) => void
  /** When set, auto-selects this template and skips to the configure step on open */
  initialTemplateId?: string | null
}

type WizardStep = "browse" | "configure" | "preview" | "launch"

const STEP_ORDER: WizardStep[] = ["browse", "configure", "preview", "launch"]

const STEP_LABELS: Record<WizardStep, string> = {
  browse: "Browse Templates",
  configure: "Configure Parameters",
  preview: "Preview",
  launch: "Ready to Launch",
}

/**
 * TemplatePickerDialog - Multi-step wizard for template-based project creation
 *
 * Steps:
 * 1. Browse/search templates (TemplateGallery)
 * 2. Fill parameter form + project name + working directory (TemplateParameterForm)
 * 3. Optional preview (interpolated prompts from preview API)
 * 4. Launch button
 *
 * Features:
 * - Back/forward navigation
 * - Progress indicator
 * - Validation at each step
 * - Auto-preview when parameters change
 * - Launch → navigate to project plan view
 */
export function TemplatePickerDialog({ open, onOpenChange, onLaunchSuccess, initialTemplateId }: TemplatePickerDialogProps) {
  const navigate = useNavigate()

  // Template store state
  const templates = useTemplateStore((s) => s.templates)
  const categories = useTemplateStore((s) => s.categories)
  const selectedTemplate = useTemplateStore((s) => s.selectedTemplate)
  const parameterValues = useTemplateStore((s) => s.parameterValues)
  const validationErrors = useTemplateStore((s) => s.validationErrors)
  const previewResult = useTemplateStore((s) => s.previewResult)
  const isLoading = useTemplateStore((s) => s.isLoading)

  // Store actions
  const selectTemplate = useTemplateStore((s) => s.selectTemplate)
  const setParameterValue = useTemplateStore((s) => s.setParameterValue)
  const validateParameters = useTemplateStore((s) => s.validateParameters)
  const previewTemplate = useTemplateStore((s) => s.previewTemplate)
  const launchTemplate = useTemplateStore((s) => s.launchTemplate)
  const reset = useTemplateStore((s) => s.reset)

  // Local wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>("browse")
  const [projectName, setProjectName] = useState("")
  const [workingDirectory, setWorkingDirectory] = useState("")
  const [isLaunching, setIsLaunching] = useState(false)

  // Reset wizard state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      // Reset on close
      setCurrentStep("browse")
      setProjectName("")
      setWorkingDirectory("")
      setIsLaunching(false)
      reset()
    }
  }, [open, reset])

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

  // Validate and move to next step
  const handleNext = useCallback(async () => {
    const stepIndex = STEP_ORDER.indexOf(currentStep)
    const nextStep = STEP_ORDER[stepIndex + 1]

    // Validation before moving forward
    if (currentStep === "configure") {
      // Validate parameters
      const isValid = await validateParameters()
      if (!isValid) {
        useToastStore.getState().add({
          type: "error",
          title: "Validation failed",
          description: "Please fix the parameter errors before continuing",
        })
        return
      }

      // Validate project name
      if (!projectName.trim()) {
        useToastStore.getState().add({
          type: "error",
          title: "Project name required",
          description: "Please enter a name for your project",
        })
        return
      }

      // Fetch preview for next step
      await previewTemplate()
    }

    if (nextStep) {
      setCurrentStep(nextStep)
    }
  }, [currentStep, validateParameters, projectName, previewTemplate])

  // Handle back navigation
  const handleBack = useCallback(() => {
    const stepIndex = STEP_ORDER.indexOf(currentStep)
    const prevStep = STEP_ORDER[stepIndex - 1]
    if (prevStep) {
      setCurrentStep(prevStep)
    }
  }, [currentStep])

  // Handle launch
  const handleLaunch = useCallback(async () => {
    if (!selectedTemplate) return

    setIsLaunching(true)
    try {
      // Call the store's launch method which returns the result
      const result = await launchTemplate(projectName, workingDirectory || undefined)

      if (result) {
        // Close dialog
        onOpenChange(false)

        // If a callback is provided, call it instead of navigating
        if (onLaunchSuccess) {
          onLaunchSuccess(result)
        } else {
          // Default behavior: navigate to the project plan view
          navigate(`/projects/${result.project.id}/plan`)

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
    launchTemplate,
    onOpenChange,
    onLaunchSuccess,
    navigate,
  ])

  // Calculate progress
  const progressPercentage = ((STEP_ORDER.indexOf(currentStep) + 1) / STEP_ORDER.length) * 100

  // Check if can proceed to next step
  const canProceed = () => {
    switch (currentStep) {
      case "browse":
        return !!selectedTemplate
      case "configure":
        return !!projectName.trim() && validationErrors.length === 0
      case "preview":
        return !!previewResult
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
            <TemplateGallery
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

        // Combine required and optional parameters
        const allParameters = [
          ...(selectedTemplate.requiredParameters || []),
          ...(selectedTemplate.optionalParameters || []),
        ]

        return (
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
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
                <div className="space-y-2">
                  <Label htmlFor="working-directory" className="text-sm font-medium">
                    Working Directory (optional)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="working-directory"
                      type="text"
                      value={workingDirectory}
                      onChange={(e) => setWorkingDirectory(e.target.value)}
                      placeholder="/path/to/project"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // In a real implementation, this would open a directory picker
                        console.log("Directory picker not yet implemented")
                      }}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    If not specified, a default directory will be used
                  </p>
                </div>
              </div>
            </div>

            {/* Template Parameters */}
            {allParameters.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Template Parameters</h3>
                <TemplateParameterForm
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

      case "preview":
        if (!previewResult) {
          return (
            <div className="h-[500px] flex flex-col items-center justify-center gap-3">
              {isLoading ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Generating preview...</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Preview not available. Click back to configure parameters.
                </p>
              )}
            </div>
          )
        }
        return (
          <div className="max-h-[500px] overflow-y-auto pr-2">
            <TemplatePreview preview={previewResult} />
          </div>
        )

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
              {workingDirectory && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Directory:</span>
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
          <DialogTitle>Create Project from Template</DialogTitle>
          <DialogDescription>
            Choose a template and configure it to quickly start your project
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">{STEP_LABELS[currentStep]}</span>
            <span className="text-muted-foreground">
              Step {STEP_ORDER.indexOf(currentStep) + 1} of {STEP_ORDER.length}
            </span>
          </div>
          <Progress value={progressPercentage} className="h-1" />
        </div>

        {/* Step content */}
        <div className="flex-1 min-h-0">{renderStepContent()}</div>

        {/* Footer with navigation buttons */}
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div>
            {currentStep !== "browse" && (
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
            {currentStep === "launch" ? (
              <Button
                type="button"
                onClick={handleLaunch}
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
                    Launch Project
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
                  ) : currentStep === "preview" ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Continue
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
    </Dialog>
  )
}
