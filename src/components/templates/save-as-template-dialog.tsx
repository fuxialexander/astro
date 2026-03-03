/**
 * Save As Template Dialog
 *
 * A multi-step wizard dialog that allows users to save their current project/plan
 * as a reusable custom template. The wizard has three steps:
 * 1. Basic Details - Name, description, category, icon
 * 2. Parameters - Extract configurable parameters from the plan
 * 3. Preview - Review the template before saving
 */

import { useState, useMemo } from "react"
import { FileStack, ChevronRight, ChevronLeft, Check, Loader2 } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { createCustomTemplate, type CustomTemplateInput } from "@/lib/api-client"
import { useToastStore } from "@/stores/toast-store"
import type { PlanNode } from "@/types"

// Category options for templates
const CATEGORY_OPTIONS = [
  { value: 'software-development', label: 'Software Development' },
  { value: 'data-science', label: 'Data Science' },
  { value: 'machine-learning', label: 'Machine Learning' },
  { value: 'devops-infrastructure', label: 'DevOps & Infrastructure' },
  { value: 'research-analysis', label: 'Research & Analysis' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'testing-qa', label: 'Testing & QA' },
  { value: 'security', label: 'Security' },
  { value: 'computational-biology', label: 'Computational Biology' },
  { value: 'custom', label: 'Custom' },
]

// Emoji options for template icons
const ICON_OPTIONS = [
  '📋', '🚀', '🔧', '💡', '🎯', '📊', '🔬', '💻', '🧪', '📝',
  '⚙️', '🔐', '📦', '🎨', '🤖', '📈', '🔍', '🛠️', '💾', '🌐',
]

interface SaveAsTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: {
    id: string
    name: string
    description: string
    visionDoc: string
  }
  nodes: PlanNode[]
  onSuccess?: (templateId: string) => void
}

type WizardStep = 'details' | 'parameters' | 'preview'

interface TemplateParameter {
  id: string
  name: string
  description: string
  type: 'string' | 'number' | 'boolean' | 'select'
  required: boolean
  default?: string
  placeholder?: string
  extractedFrom?: string // Which node/field this was extracted from
}

export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  project,
  nodes,
  onSuccess,
}: SaveAsTemplateDialogProps) {
  const [step, setStep] = useState<WizardStep>('details')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Step 1: Details
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('custom')
  const [icon, setIcon] = useState('📋')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  // Step 2: Parameters
  const [parameters, setParameters] = useState<TemplateParameter[]>([])

  // Initialize form with project data when dialog opens
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      // Reset form state
      setStep('details')
      setName(`${project.name} Template`)
      setDescription(project.description)
      setCategory('custom')
      setIcon('📋')
      setTags([])
      setTagInput('')

      // Extract potential parameters from nodes
      const extractedParams: TemplateParameter[] = []

      // Look for common parameterizable values in nodes
      const seenValues = new Set<string>()
      for (const node of nodes) {
        // Extract from descriptions
        const urlMatches = node.description.match(/https?:\/\/[^\s]+/g)
        if (urlMatches) {
          for (const url of urlMatches) {
            if (!seenValues.has(url)) {
              seenValues.add(url)
              extractedParams.push({
                id: `url_${extractedParams.length}`,
                name: 'URL',
                description: `URL extracted from "${node.title}"`,
                type: 'string',
                required: false,
                default: url,
                extractedFrom: node.title,
              })
            }
          }
        }

        // Extract file paths
        const pathMatches = node.description.match(/(?:\/[\w.-]+)+/g)
        if (pathMatches) {
          for (const path of pathMatches) {
            if (!seenValues.has(path) && path.length > 3) {
              seenValues.add(path)
              extractedParams.push({
                id: `path_${extractedParams.length}`,
                name: 'File Path',
                description: `Path extracted from "${node.title}"`,
                type: 'string',
                required: false,
                default: path,
                extractedFrom: node.title,
              })
            }
          }
        }
      }

      setParameters(extractedParams.slice(0, 10)) // Limit to 10 parameters
    }
  }

  // Generate the plan generation prompt from the current plan
  const generatedPrompt = useMemo(() => {
    if (nodes.length === 0) {
      return project.visionDoc || project.description
    }

    const taskDescriptions = nodes
      .filter(n => n.type === 'task')
      .map((n, i) => `${i + 1}. **${n.title}**: ${n.description}`)
      .join('\n')

    const milestones = nodes
      .filter(n => n.type === 'milestone')
      .map(n => `- ${n.title}: ${n.description}`)
      .join('\n')

    let prompt = project.visionDoc || project.description

    if (milestones) {
      prompt += `\n\n## Milestones\n${milestones}`
    }

    if (taskDescriptions) {
      prompt += `\n\n## Task Structure\nThe plan should include tasks similar to:\n${taskDescriptions}`
    }

    return prompt
  }, [nodes, project])

  const handleAddTag = () => {
    if (tagInput.trim() && tags.length < 10 && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()])
      setTagInput('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag))
  }

  const handleToggleParameter = (paramId: string) => {
    setParameters(params =>
      params.map(p =>
        p.id === paramId ? { ...p, required: !p.required } : p
      )
    )
  }

  const handleRemoveParameter = (paramId: string) => {
    setParameters(params => params.filter(p => p.id !== paramId))
  }

  const handleSubmit = async () => {
    if (!name.trim()) return

    setIsSubmitting(true)

    const templateInput: CustomTemplateInput = {
      name: name.trim(),
      description: description.trim(),
      category,
      icon,
      tags,
      maturity: 'stable',
      enabled: true,
      requiredParameters: parameters
        .filter(p => p.required)
        .map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          type: p.type,
          required: true,
          default: p.default,
          placeholder: p.placeholder,
        })),
      optionalParameters: parameters
        .filter(p => !p.required)
        .map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          type: p.type,
          required: false,
          default: p.default,
          placeholder: p.placeholder,
        })),
      prompts: {
        planGeneration: generatedPrompt,
        sharedContext: project.visionDoc || undefined,
      },
      planHints: {
        targetNodeCount: { min: Math.max(1, nodes.length - 2), max: nodes.length + 5 },
        preferParallelTasks: true,
      },
      sourceProjectId: project.id,
    }

    try {
      const result = await createCustomTemplate(templateInput)
      useToastStore.getState().add({
        type: 'success',
        title: 'Template created',
        description: `"${name}" is now available in your template library`,
      })
      onOpenChange(false)
      if (onSuccess) {
        // Extract the actual UUID from the template ID (remove 'custom/' prefix)
        const templateId = result.template.id.replace('custom/', '')
        onSuccess(templateId)
      }
    } catch (error) {
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to create template',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const canProceed = () => {
    switch (step) {
      case 'details':
        return name.trim().length > 0
      case 'parameters':
        return true // Parameters are optional
      case 'preview':
        return true
      default:
        return false
    }
  }

  const goNext = () => {
    if (step === 'details') setStep('parameters')
    else if (step === 'parameters') setStep('preview')
  }

  const goBack = () => {
    if (step === 'parameters') setStep('details')
    else if (step === 'preview') setStep('parameters')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <FileStack className="h-4 w-4 text-primary-foreground" />
            </div>
            <DialogTitle>Save as Template</DialogTitle>
          </div>
          <DialogDescription>
            Turn this project into a reusable template for future use.
          </DialogDescription>

          {/* Step Indicator */}
          <div className="flex items-center gap-2 pt-2">
            {(['details', 'parameters', 'preview'] as WizardStep[]).map((s, i) => (
              <div key={s} className="flex items-center">
                {i > 0 && (
                  <div className={cn(
                    "h-px w-8 mx-1",
                    step === s || ['parameters', 'preview'].indexOf(step) > ['parameters', 'preview'].indexOf(s)
                      ? "bg-primary"
                      : "bg-muted"
                  )} />
                )}
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  step === s
                    ? "bg-primary text-primary-foreground"
                    : ['parameters', 'preview'].indexOf(step) > ['parameters', 'preview'].indexOf(s)
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                )}>
                  {i + 1}
                </div>
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {/* Step 1: Details */}
          {step === 'details' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Template Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., React SaaS Starter"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe what this template is for..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="category">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Icon</Label>
                  <div className="flex flex-wrap gap-1">
                    {ICON_OPTIONS.slice(0, 10).map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setIcon(emoji)}
                        className={cn(
                          "w-8 h-8 rounded text-lg hover:bg-muted flex items-center justify-center",
                          icon === emoji && "bg-primary/20 ring-1 ring-primary"
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="tags">Tags</Label>
                <div className="flex gap-2">
                  <Input
                    id="tags"
                    placeholder="Add a tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddTag()
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={handleAddTag}>
                    Add
                  </Button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tags.map(tag => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => handleRemoveTag(tag)}
                      >
                        {tag} &times;
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Parameters */}
          {step === 'parameters' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Parameters allow users to customize the template when they use it.
                We've extracted some potential parameters from your plan.
              </p>

              {parameters.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No parameters extracted from this plan.</p>
                  <p className="text-xs mt-1">
                    You can add parameters later by editing the template.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {parameters.map(param => (
                    <div
                      key={param.id}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{param.name}</span>
                          {param.required && (
                            <Badge variant="outline" className="text-[10px]">Required</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {param.description}
                        </p>
                        {param.default && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                            Default: {param.default}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleParameter(param.id)}
                        >
                          {param.required ? 'Make Optional' : 'Make Required'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveParameter(param.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && (
            <div className="flex flex-col gap-4">
              <div className="p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <h3 className="font-semibold">{name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_OPTIONS.find(c => c.value === category)?.label}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-3">{description}</p>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">PLAN GENERATION PROMPT</Label>
                <div className="mt-1 p-3 rounded-lg border bg-muted/30 max-h-[200px] overflow-y-auto">
                  <pre className="text-xs whitespace-pre-wrap font-mono">
                    {generatedPrompt.slice(0, 1000)}
                    {generatedPrompt.length > 1000 && '...'}
                  </pre>
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{parameters.filter(p => p.required).length} required parameters</span>
                <span>{parameters.filter(p => !p.required).length} optional parameters</span>
                <span>{nodes.length} tasks in original plan</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between border-t pt-4">
          <div>
            {step !== 'details' && (
              <Button variant="outline" onClick={goBack}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step !== 'preview' ? (
              <Button onClick={goNext} disabled={!canProceed()}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isSubmitting || !canProceed()}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Create Template
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
