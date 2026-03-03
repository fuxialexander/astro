import { useState, useCallback, useMemo } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { TemplateGallery } from "./template-gallery"
import { TemplateParameterForm } from "./template-parameter-form"
import { TemplatePreview } from "./template-preview"
import { useTemplateStore } from "@/stores/template-store"
import { applyTemplate, generatePlan, type ApplyTemplateResult } from "@/lib/api-client"
import { usePlanStore } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"
import { ArrowLeft, Loader2 } from "lucide-react"
import type { UseCaseTemplateSummary } from "@astro/core/templates"
import type { Priority, Estimate } from "@/types"

interface UseTemplateSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

type Step = "gallery" | "parameters" | "preview"

/**
 * UseTemplateSheet - Multi-step slide-over panel for applying templates to existing plans
 *
 * Flow:
 * 1. Gallery: Browse and select template
 * 2. Parameters: Fill in required/optional parameters
 * 3. Preview: Review interpolated prompts
 * 4. Apply: Generate nodes and add to existing plan
 */
export function UseTemplateSheet({ open, onOpenChange, projectId }: UseTemplateSheetProps) {
  const [step, setStep] = useState<Step>("gallery")
  const [isApplying, setIsApplying] = useState(false)

  const templates = useTemplateStore((s) => s.templates)
  const rawCategories = useTemplateStore((s) => s.categories)
  const selectedTemplate = useTemplateStore((s) => s.selectedTemplate)
  const parameterValues = useTemplateStore((s) => s.parameterValues)
  const validationErrors = useTemplateStore((s) => s.validationErrors)
  const previewResult = useTemplateStore((s) => s.previewResult)
  const isLoading = useTemplateStore((s) => s.isLoading)

  // Transform categories to match TemplateGallery's expected format
  const categories = useMemo(() => {
    return rawCategories.map((cat) => ({
      name: cat.category,
      count: cat.count,
    }))
  }, [rawCategories])

  const selectTemplate = useTemplateStore((s) => s.selectTemplate)
  const setParameterValue = useTemplateStore((s) => s.setParameterValue)
  const validateParameters = useTemplateStore((s) => s.validateParameters)
  const previewTemplate = useTemplateStore((s) => s.previewTemplate)
  const reset = useTemplateStore((s) => s.reset)

  // Handle open change with state reset when closing
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        // Reset state when closing (use setTimeout to avoid cascading renders)
        setTimeout(() => {
          reset()
          setStep("gallery")
          setIsApplying(false)
        }, 0)
      }
      onOpenChange(newOpen)
    },
    [onOpenChange, reset]
  )

  // Handle template selection
  const handleTemplateSelect = useCallback(
    async (template: UseCaseTemplateSummary) => {
      await selectTemplate(template.id)
      setStep("parameters")
    },
    [selectTemplate]
  )

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (step === "parameters") {
      setStep("gallery")
    } else if (step === "preview") {
      setStep("parameters")
    }
  }, [step])

  // Handle parameter submission → preview
  const handleParametersNext = useCallback(async () => {
    const isValid = await validateParameters()
    if (!isValid) {
      useToastStore.getState().add({
        type: "error",
        title: "Validation failed",
        description: "Please fix the errors in the form",
      })
      return
    }

    // Generate preview
    await previewTemplate()
    setStep("preview")
  }, [validateParameters, previewTemplate])

  // Handle apply → generate nodes and add to plan
  const handleApply = useCallback(async () => {
    if (!selectedTemplate) return

    setIsApplying(true)

    try {
      // Call the apply endpoint to get the plan generation request
      const applyResult: ApplyTemplateResult = await applyTemplate(
        selectedTemplate.id,
        projectId,
        parameterValues
      )

      useToastStore.getState().add({
        type: "info",
        title: "Generating plan from template",
        description: `Using template: ${applyResult.templateUsed.name}`,
      })

      // Call generate-plan with the interpolated prompt
      // The AI will generate new nodes that we'll add to the existing plan
      await generatePlan(
        {
          projectId: applyResult.projectId,
          description: applyResult.description,
          visionDoc: applyResult.visionDoc,
        },
        {
          onText: (text) => {
            console.log("[apply-template] AI text:", text)
          },
          onPlanResult: (result) => {
            console.log("[apply-template] Plan result:", result)

            // Get existing nodes to calculate Y offset
            const existingNodes = usePlanStore.getState().nodes.filter(
              (n) => n.projectId === projectId && !n.deletedAt
            )

            // Calculate max Y position from existing nodes
            let maxY = 0
            for (const node of existingNodes) {
              if (node.position && node.position.y > maxY) {
                maxY = node.position.y
              }
            }

            // Add vertical spacing (200px) below the lowest existing node
            const yOffset = maxY + 200

            // Add new nodes with adjusted positions
            for (const node of result.nodes) {
              const newNode = {
                id: node.id,
                projectId,
                type: node.type,
                title: node.title,
                description: node.description,
                status: node.status,
                parentId: node.parentId,
                dependencies: node.dependencies,
                verification: node.verification,
                position: {
                  x: node.position.x,
                  y: node.position.y + yOffset, // Offset Y position
                },
                startDate: node.startDate,
                endDate: node.endDate,
                priority: node.priority as Priority | undefined,
                estimate: node.estimate as Estimate | undefined,
                dueDate: node.dueDate,
                milestoneId: node.milestoneId,
                labelIds: node.labelIds || [],
                createdAt: new Date(),
                updatedAt: new Date(),
              }
              usePlanStore.getState().addNode(newNode)
            }

            // Add edges between template nodes
            for (const edge of result.edges) {
              usePlanStore.getState().addEdge({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: edge.type,
              })
            }

            useToastStore.getState().add({
              type: "success",
              title: "Template applied",
              description: `Added ${result.nodes.length} nodes from template`,
            })

            // Close the sheet
            handleOpenChange(false)
          },
          onError: (error) => {
            console.error("[apply-template] Error:", error)
            useToastStore.getState().add({
              type: "error",
              title: "Failed to generate plan",
              description: error,
            })
            setIsApplying(false)
          },
          onDone: () => {
            console.log("[apply-template] Done")
            setIsApplying(false)
          },
        }
      )
    } catch (error) {
      console.error("[apply-template] Apply failed:", error)
      useToastStore.getState().add({
        type: "error",
        title: "Failed to apply template",
        description: error instanceof Error ? error.message : "Unknown error",
      })
      setIsApplying(false)
    }
  }, [selectedTemplate, projectId, parameterValues, handleOpenChange])

  // Render current step
  const renderStep = () => {
    switch (step) {
      case "gallery":
        return (
          <div className="flex flex-col h-full">
            <SheetHeader>
              <SheetTitle>Use Template</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden mt-4">
              <TemplateGallery
                templates={templates}
                categories={categories}
                isLoading={isLoading}
                onTemplateSelect={handleTemplateSelect}
              />
            </div>
          </div>
        )

      case "parameters":
        if (!selectedTemplate) return null

        const allParameters = [
          ...selectedTemplate.requiredParameters,
          ...selectedTemplate.optionalParameters,
        ]

        return (
          <div className="flex flex-col h-full">
            <SheetHeader className="flex-row items-center gap-2 space-y-0">
              <Button variant="ghost" size="sm" onClick={handleBack} className="shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <SheetTitle>{selectedTemplate.name}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-auto mt-4 px-6">
              <p className="text-sm text-muted-foreground mb-4">
                {selectedTemplate.description}
              </p>
              <TemplateParameterForm
                parameters={allParameters}
                values={parameterValues}
                errors={validationErrors}
                onChange={setParameterValue}
              />
            </div>
            <div className="border-t border-border p-4 mt-4">
              <Button onClick={handleParametersNext} className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Validating...
                  </>
                ) : (
                  "Next: Preview"
                )}
              </Button>
            </div>
          </div>
        )

      case "preview":
        if (!previewResult) return null

        return (
          <div className="flex flex-col h-full">
            <SheetHeader className="flex-row items-center gap-2 space-y-0">
              <Button variant="ghost" size="sm" onClick={handleBack} className="shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <SheetTitle>Preview</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-auto mt-4 px-6">
              <TemplatePreview preview={previewResult} />
            </div>
            <div className="border-t border-border p-4 mt-4">
              <Button onClick={handleApply} className="w-full" disabled={isApplying}>
                {isApplying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Applying template...
                  </>
                ) : (
                  "Apply to Plan"
                )}
              </Button>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-[600px] max-w-[90vw] p-0">
        <div className="flex flex-col h-full p-6">{renderStep()}</div>
      </SheetContent>
    </Sheet>
  )
}
