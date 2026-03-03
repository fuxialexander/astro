import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, FileText, Sparkles } from "lucide-react"
import type { PreviewTemplateResult } from "@/lib/api-client"

interface TemplatePreviewProps {
  preview: PreviewTemplateResult
  className?: string
}

/**
 * TemplatePreview - Shows interpolated prompt preview from template
 *
 * Displays the resolved parameters and interpolated prompts that would be
 * used for plan generation and task execution.
 */
export function TemplatePreview({ preview, className }: TemplatePreviewProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["planGeneration"])
  )

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  // Extract resolved parameter entries for display
  const parameterEntries = Object.entries(preview.resolvedParameters || {})

  return (
    <div className={cn("space-y-4", className)}>
      {/* Template Info Header */}
      <Card className="p-4 bg-muted/30">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{preview.templateName}</h3>
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                {preview.templateId}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Preview of prompts and configuration with current parameter values
            </p>
          </div>
        </div>
      </Card>

      {/* Resolved Parameters */}
      {parameterEntries.length > 0 && (
        <Card className="p-4">
          <button
            type="button"
            onClick={() => toggleSection("parameters")}
            className="flex w-full items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
          >
            {expandedSections.has("parameters") ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Resolved Parameters</span>
            <span className="text-xs font-normal text-muted-foreground">
              ({parameterEntries.length})
            </span>
          </button>
          {expandedSections.has("parameters") && (
            <div className="mt-3 space-y-2 pl-6 border-l-2 border-border">
              {parameterEntries.map(([key, value]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {key}
                  </Label>
                  <div className="text-xs font-mono bg-muted/50 rounded px-2 py-1 break-all">
                    {typeof value === "string"
                      ? value
                      : JSON.stringify(value, null, 2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Plan Generation Prompt */}
      <PromptSection
        title="Plan Generation Prompt"
        content={preview.interpolatedPrompts.planGeneration}
        expanded={expandedSections.has("planGeneration")}
        onToggle={() => toggleSection("planGeneration")}
      />

      {/* Task Execution Prompt (if present) */}
      {preview.interpolatedPrompts.taskExecution && (
        <PromptSection
          title="Task Execution Prompt"
          content={preview.interpolatedPrompts.taskExecution}
          expanded={expandedSections.has("taskExecution")}
          onToggle={() => toggleSection("taskExecution")}
        />
      )}

      {/* Plan Refinement Prompt (if present) */}
      {preview.interpolatedPrompts.planRefinement && (
        <PromptSection
          title="Plan Refinement Prompt"
          content={preview.interpolatedPrompts.planRefinement}
          expanded={expandedSections.has("planRefinement")}
          onToggle={() => toggleSection("planRefinement")}
        />
      )}

      {/* Shared Context (if present) */}
      {preview.interpolatedPrompts.sharedContext && (
        <PromptSection
          title="Shared Context"
          content={preview.interpolatedPrompts.sharedContext}
          expanded={expandedSections.has("sharedContext")}
          onToggle={() => toggleSection("sharedContext")}
        />
      )}
    </div>
  )
}

/**
 * PromptSection - Collapsible section for a single prompt
 */
interface PromptSectionProps {
  title: string
  content: string
  expanded: boolean
  onToggle: () => void
}

function PromptSection({ title, content, expanded, onToggle }: PromptSectionProps) {
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <FileText className="h-3.5 w-3.5" />
        <span>{title}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {content.length} chars
        </span>
      </button>
      {expanded && (
        <div className="mt-3 pl-6 border-l-2 border-border">
          <div className="rounded-md bg-muted/50 p-3 max-h-[400px] overflow-y-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground">
              {content}
            </pre>
          </div>
        </div>
      )}
    </Card>
  )
}
