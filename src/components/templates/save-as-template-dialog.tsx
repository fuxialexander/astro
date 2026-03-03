import { useState, useMemo, useCallback } from "react"
import { X, Plus, Check, Code2, Eye, ChevronRight } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { usePlanStore } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"
import type { UseCaseCategory } from "@astro/core/templates"
import type { Project } from "@/types"

interface SaveAsTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
}

// Category options for templates
const CATEGORY_OPTIONS: Array<{ value: UseCaseCategory; label: string }> = [
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

// Common tags for templates
const SUGGESTED_TAGS = [
  'web', 'api', 'frontend', 'backend', 'database', 'testing',
  'ci-cd', 'deployment', 'data-analysis', 'ml-training', 'research',
  'documentation', 'security', 'performance', 'automation'
]

interface ExtractedValue {
  nodeId: string
  nodeTitle: string
  field: string
  value: string
  isParameterized: boolean
  parameterName: string
  parameterType: 'string' | 'number' | 'file-path'
}

type DialogStep = 'details' | 'parameters' | 'preview'

export function SaveAsTemplateDialog({ open, onOpenChange, project }: SaveAsTemplateDialogProps) {
  const planNodes = usePlanStore((s) => s.nodes.filter((n) => n.projectId === project.id))
  const addToast = useToastStore((s) => s.add)

  const [step, setStep] = useState<DialogStep>('details')
  const [name, setName] = useState(project.name)
  const [category, setCategory] = useState<UseCaseCategory>('custom')
  const [description, setDescription] = useState(project.description || '')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  // Extract potential parameterizable values from plan nodes
  const extractedValues = useMemo((): ExtractedValue[] => {
    const values: ExtractedValue[] = []

    for (const node of planNodes) {
      // Extract working directory references
      if (project.workingDirectory && node.description.includes(project.workingDirectory)) {
        values.push({
          nodeId: node.id,
          nodeTitle: node.title,
          field: 'description',
          value: project.workingDirectory,
          isParameterized: false,
          parameterName: 'workingDirectory',
          parameterType: 'file-path',
        })
      }

      // Extract project name references
      if (node.description.includes(project.name)) {
        values.push({
          nodeId: node.id,
          nodeTitle: node.title,
          field: 'description',
          value: project.name,
          isParameterized: false,
          parameterName: 'projectName',
          parameterType: 'string',
        })
      }

      // Extract repository URLs
      if (project.repository && node.description.includes(project.repository)) {
        values.push({
          nodeId: node.id,
          nodeTitle: node.title,
          field: 'description',
          value: project.repository,
          isParameterized: false,
          parameterName: 'repositoryUrl',
          parameterType: 'string',
        })
      }

      // Extract paths that look like file paths (common patterns)
      const pathMatches = node.description.match(/\/[\w/-]+/g)
      if (pathMatches) {
        for (const path of pathMatches) {
          if (path.length > 5 && !values.some(v => v.value === path)) {
            values.push({
              nodeId: node.id,
              nodeTitle: node.title,
              field: 'description',
              value: path,
              isParameterized: false,
              parameterName: `path${values.filter(v => v.parameterType === 'file-path').length + 1}`,
              parameterType: 'file-path',
            })
          }
        }
      }
    }

    return values
  }, [planNodes, project])

  const [parameters, setParameters] = useState<ExtractedValue[]>(extractedValues)

  const toggleParameterize = useCallback((index: number) => {
    setParameters((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        isParameterized: !next[index].isParameterized,
      }
      return next
    })
  }, [])

  const updateParameterName = useCallback((index: number, newName: string) => {
    setParameters((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        parameterName: newName,
      }
      return next
    })
  }, [])

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
      setTagInput('')
    }
  }, [tagInput, tags])

  const removeTag = useCallback((tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }, [tags])

  const handleSave = useCallback(async () => {
    // Validation
    if (!name.trim()) {
      addToast({ type: 'error', title: 'Template name required', description: 'Please enter a name for the template' })
      return
    }

    if (!description.trim()) {
      addToast({ type: 'error', title: 'Template description required', description: 'Please enter a description' })
      return
    }

    // Build template structure
    const parameterizedNodes = planNodes.map((node) => {
      let parameterizedDescription = node.description
      let parameterizedTitle = node.title

      // Apply parameterization
      for (const param of parameters.filter(p => p.isParameterized)) {
        const placeholder = `{{${param.parameterName}}}`
        parameterizedDescription = parameterizedDescription.replace(
          new RegExp(param.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          placeholder
        )
        parameterizedTitle = parameterizedTitle.replace(
          new RegExp(param.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          placeholder
        )
      }

      return {
        title: parameterizedTitle,
        description: parameterizedDescription,
        type: node.type,
        dependencies: node.dependencies,
        verification: node.verification,
        priority: node.priority,
        estimate: node.estimate,
        milestoneId: node.milestoneId,
      }
    })

    const templateParams = parameters
      .filter(p => p.isParameterized)
      .reduce((acc, param) => {
        // Deduplicate by parameter name
        if (!acc.find(p => p.id === param.parameterName)) {
          acc.push({
            id: param.parameterName,
            name: param.parameterName.replace(/([A-Z])/g, ' $1').trim(),
            description: `The ${param.parameterName}`,
            type: param.parameterType,
            required: true,
            default: param.value,
          })
        }
        return acc
      }, [] as Array<{id: string, name: string, description: string, type: string, required: boolean, default: string}>)

    const templateData = {
      name,
      description,
      category,
      tags,
      version: '1.0.0',
      icon: project.icon || '📋',
      source: 'custom' as const,
      enabled: true,
      requiredParameters: templateParams,
      optionalParameters: [],
      prompts: {
        planGeneration: `Generate a plan for: ${name}\n\n${description}\n\nThe plan should follow this structure:\n${parameterizedNodes.map((n, i) => `${i + 1}. ${n.title}`).join('\n')}`,
        sharedContext: project.visionDoc || undefined,
      },
      planHints: {
        targetNodeCount: {
          min: Math.max(6, planNodes.length - 3),
          max: Math.min(15, planNodes.length + 3),
        },
      },
      nodes: parameterizedNodes,
    }

    try {
      // TODO: Save to backend via API
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to save template')
      }

      addToast({
        type: 'success',
        title: 'Template saved',
        description: `"${name}" is now available in the template gallery`,
      })

      onOpenChange(false)

      // Reset form
      setStep('details')
      setName(project.name)
      setDescription(project.description || '')
      setTags([])
      setParameters(extractedValues)
    } catch (error) {
      console.error('Failed to save template:', error)
      addToast({
        type: 'error',
        title: 'Failed to save template',
        description: error instanceof Error ? error.message : 'An error occurred',
      })
    }
  }, [name, description, category, tags, planNodes, parameters, project, extractedValues, addToast, onOpenChange])

  const canProceedToParameters = name.trim() && category && description.trim()
  const parameterizedCount = parameters.filter(p => p.isParameterized).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-xl">
            Save as Template
            <Badge variant="outline" className="ml-auto text-xs">
              Step {step === 'details' ? 1 : step === 'parameters' ? 2 : 3} of 3
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {step === 'details' && 'Provide template details and categorization'}
            {step === 'parameters' && 'Select values to parameterize (make them configurable when using this template)'}
            {step === 'preview' && 'Review your template before saving'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Step 1: Template Details */}
          {step === 'details' && (
            <div className="space-y-6">
              {/* Name */}
              <div>
                <label htmlFor="template-name" className="block text-sm font-medium mb-2">
                  Template Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="template-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Web Application Starter"
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Category */}
              <div>
                <label htmlFor="template-category" className="block text-sm font-medium mb-2">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  id="template-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as UseCaseCategory)}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="template-description" className="block text-sm font-medium mb-2">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="template-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this template is for, what it generates, and any prerequisites..."
                  rows={4}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Tags */}
              <div>
                <label htmlFor="template-tags" className="block text-sm font-medium mb-2">
                  Tags (optional)
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="hover:text-destructive transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    id="template-tags"
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addTag()
                      }
                    }}
                    placeholder="Add a tag..."
                    className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button size="sm" onClick={addTag} disabled={!tagInput.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {SUGGESTED_TAGS.filter(t => !tags.includes(t)).slice(0, 10).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setTags([...tags, tag])}
                      className="px-2 py-0.5 rounded text-xs bg-muted hover:bg-muted/80 transition-colors"
                    >
                      + {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Parameter Extraction */}
          {step === 'parameters' && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground mb-4">
                We found <strong>{parameters.length}</strong> values that can be parameterized. Click to mark them as template parameters.
                {parameterizedCount > 0 && (
                  <span className="text-primary font-medium ml-2">
                    ({parameterizedCount} selected)
                  </span>
                )}
              </div>

              {parameters.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Code2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No parameterizable values detected.</p>
                  <p className="text-xs mt-1">You can still save this template with fixed values.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {parameters.map((param, index) => (
                    <div
                      key={`${param.nodeId}-${param.field}-${param.value}-${index}`}
                      className={cn(
                        "p-3 rounded-lg border transition-all cursor-pointer",
                        param.isParameterized
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/40"
                      )}
                      onClick={() => toggleParameterize(index)}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "mt-0.5 h-5 w-5 rounded border flex items-center justify-center shrink-0",
                            param.isParameterized
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-muted-foreground/40"
                          )}
                        >
                          {param.isParameterized && <Check className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">{param.nodeTitle}</span>
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">{param.field}</span>
                            <Badge variant="outline" className="text-xs">
                              {param.parameterType}
                            </Badge>
                          </div>
                          <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                            {param.value}
                          </code>
                          {param.isParameterized && (
                            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                              <label className="text-xs text-muted-foreground">Variable name:</label>
                              <input
                                type="text"
                                value={param.parameterName}
                                onChange={(e) => updateParameterName(index, e.target.value)}
                                className="mt-1 w-full px-2 py-1 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && (
            <div className="space-y-6">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Name:</span>
                  <div className="text-base font-semibold mt-1">{name}</div>
                </div>
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Category:</span>
                  <div className="text-sm mt-1">
                    {CATEGORY_OPTIONS.find(c => c.value === category)?.label}
                  </div>
                </div>
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Description:</span>
                  <div className="text-sm mt-1 text-muted-foreground">{description}</div>
                </div>
                {tags.length > 0 && (
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Tags:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Template Structure:</div>
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {planNodes.length} tasks with {parameterizedCount} parameters
                  </div>
                  {parameterizedCount > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">Parameters:</div>
                      <div className="space-y-1">
                        {parameters
                          .filter(p => p.isParameterized)
                          .reduce((acc, param) => {
                            if (!acc.find(p => p.parameterName === param.parameterName)) {
                              acc.push(param)
                            }
                            return acc
                          }, [] as ExtractedValue[])
                          .map((param) => (
                            <div key={param.parameterName} className="flex items-center gap-2 text-xs">
                              <code className="px-2 py-0.5 rounded bg-muted">
                                {`{{${param.parameterName}}}`}
                              </code>
                              <span className="text-muted-foreground">({param.parameterType})</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer with navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
          <div className="flex gap-2">
            {step !== 'details' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(step === 'preview' ? 'parameters' : 'details')}
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step === 'details' && (
              <Button
                size="sm"
                onClick={() => setStep('parameters')}
                disabled={!canProceedToParameters}
              >
                Next: Parameters
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === 'parameters' && (
              <Button size="sm" onClick={() => setStep('preview')}>
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
            )}
            {step === 'preview' && (
              <Button size="sm" onClick={handleSave}>
                Save Template
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
