/**
 * Publish to Community Dialog
 *
 * Allows users to publish their project plan to the community marketplace.
 * Includes options for title, description, category, tags, customization notes,
 * execution results, visibility, and anonymous publishing.
 */

import { useState, useEffect } from "react"
import { Globe, Loader2, X } from "lucide-react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCommunityStore } from "@/stores/community-store"
import { useUsageStore } from "@/stores/usage-store"
import { useToastStore } from "@/stores/toast-store"
import { isLive } from "@/stores/plan-store"
import { sanitizeNode } from "@/lib/sharing/sanitize"
import type { Project, PlanNode, PlanEdge } from "@/types"
import type { PublishPlanRequest, ExecutionSummary } from "@/lib/community-client"

// Category options for community plans
const CATEGORY_OPTIONS = [
  { value: 'software-development', label: 'Software Development' },
  { value: 'research-analysis', label: 'Research & Analysis' },
  { value: 'machine-learning', label: 'Machine Learning' },
  { value: 'data-science', label: 'Data Science' },
  { value: 'security', label: 'Security' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'devops', label: 'DevOps' },
  { value: 'computational-biology', label: 'Computational Biology' },
  { value: 'other', label: 'Other' },
]

interface PublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  nodes: PlanNode[]
  edges: PlanEdge[]
}

export function PublishDialog({
  open,
  onOpenChange,
  project,
  nodes,
  edges,
}: PublishDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('other')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [customizationNotes, setCustomizationNotes] = useState('')
  const [includeExecutionResults, setIncludeExecutionResults] = useState(false)
  const [visibility, setVisibility] = useState<'public' | 'team' | 'unlisted'>('public')
  const [publishAnonymously, setPublishAnonymously] = useState(false)

  const publishPlan = useCommunityStore((s) => s.publishPlan)
  const sessionMetrics = useUsageStore((s) => s.sessionMetrics)
  const addToast = useToastStore((s) => s.add)

  // Initialize form with project data when dialog opens
  useEffect(() => {
    if (open) {
      setTitle(project.name)
      setDescription(project.description || '')
      setCategory('other')
      setTags([])
      setTagInput('')
      setCustomizationNotes('Explain what others should change when adapting this plan to their needs.')
      setIncludeExecutionResults(false)
      setVisibility('public')
      setPublishAnonymously(false)
    }
  }, [open, project.name, project.description])

  const handleAddTag = () => {
    const trimmed = tagInput.trim()
    if (trimmed && tags.length < 10 && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
      setTagInput('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag))
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      addToast({
        type: 'error',
        title: 'Title required',
        description: 'Please enter a title for your published plan',
      })
      return
    }

    setIsSubmitting(true)

    try {
      // Sanitize nodes and edges for export
      const projectNodes = nodes.filter(isLive).filter((n) => n.projectId === project.id)
      const nodeIds = new Set(projectNodes.map((n) => n.id))
      const projectEdges = edges.filter(isLive).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

      const sanitizedNodes = projectNodes.map(sanitizeNode)

      // Compute execution summary if requested
      let executionSummary: ExecutionSummary | undefined
      if (includeExecutionResults) {
        executionSummary = {
          totalTasks: projectNodes.length,
          completed: sessionMetrics.tasksCompleted,
          failed: sessionMetrics.tasksFailed,
          totalCost: sessionMetrics.totalCostUsd,
          totalTokens: sessionMetrics.totalInputTokens + sessionMetrics.totalOutputTokens,
        }
      }

      // Build publish request
      const publishRequest: PublishPlanRequest = {
        title: title.trim(),
        description: description.trim() || undefined,
        projectId: project.id,
        isAnonymous: publishAnonymously,
        visionDoc: project.visionDoc || undefined,
        planData: {
          nodes: sanitizedNodes as Array<Record<string, unknown>>,
          edges: projectEdges.map(e => ({ ...e })) as Array<Record<string, unknown>>,
        },
        customizationNotes: customizationNotes.trim() || undefined,
        executionSummary,
        category: category !== 'other' ? category : undefined,
        tags: tags.length > 0 ? tags : undefined,
        visibility,
      }

      // Publish the plan
      await publishPlan(publishRequest)

      addToast({
        type: 'success',
        title: 'Plan published',
        description: `"${title}" is now available in the community marketplace`,
      })

      // Close dialog
      onOpenChange(false)

      // TODO: Optionally navigate to published plan detail page
      // navigate(`/community/plans/${published.id}`)
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to publish plan',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit = title.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Globe className="h-4 w-4 text-primary-foreground" />
            </div>
            <DialogTitle>Publish to Community</DialogTitle>
          </div>
          <DialogDescription>
            Share your plan with the Astro community. Others can fork and adapt it to their needs.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Title */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="e.g., Full-Stack SaaS Starter"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe what this plan accomplishes... (Markdown supported)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Markdown formatting is supported.
            </p>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category">
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

          {/* Tags */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="tags"
                placeholder="Add a tag... (press Enter)"
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
                    className="cursor-pointer hover:bg-secondary/80"
                    onClick={() => handleRemoveTag(tag)}
                  >
                    {tag}
                    <X className="ml-1 h-3 w-3" />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Customization Notes */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="customizationNotes">Customization Notes</Label>
            <Textarea
              id="customizationNotes"
              placeholder="Explain what others should change when adapting this plan..."
              value={customizationNotes}
              onChange={(e) => setCustomizationNotes(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Help others understand how to adapt your plan to their specific needs.
            </p>
          </div>

          {/* Include Execution Results */}
          <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
            <Checkbox
              id="includeExecutionResults"
              checked={includeExecutionResults}
              onCheckedChange={(checked) => setIncludeExecutionResults(checked === true)}
            />
            <div className="flex-1">
              <Label htmlFor="includeExecutionResults" className="cursor-pointer">
                Include Execution Results
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Share execution statistics (tasks completed, cost, tokens) to help others
                understand the scope and complexity.
              </p>
              {includeExecutionResults && (
                <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                  <p>• Total tasks: {nodes.filter(n => n.projectId === project.id && isLive(n)).length}</p>
                  <p>• Completed: {sessionMetrics.tasksCompleted}</p>
                  <p>• Failed: {sessionMetrics.tasksFailed}</p>
                  <p>• Cost: ${sessionMetrics.totalCostUsd.toFixed(4)}</p>
                  <p>• Tokens: {(sessionMetrics.totalInputTokens + sessionMetrics.totalOutputTokens).toLocaleString()}</p>
                </div>
              )}
            </div>
          </div>

          {/* Visibility */}
          <div className="flex flex-col gap-3">
            <Label>Visibility</Label>
            <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="public" id="visibility-public" />
                <Label htmlFor="visibility-public" className="cursor-pointer font-normal">
                  <span className="font-medium">Public</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    — Anyone can discover and fork this plan
                  </span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="team" id="visibility-team" />
                <Label htmlFor="visibility-team" className="cursor-pointer font-normal">
                  <span className="font-medium">Team Only</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    — Only your team members can see this plan
                  </span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="unlisted" id="visibility-unlisted" />
                <Label htmlFor="visibility-unlisted" className="cursor-pointer font-normal">
                  <span className="font-medium">Unlisted</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    — Anyone with the link can access, but won't appear in search
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Publish Anonymously */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="publishAnonymously"
              checked={publishAnonymously}
              onCheckedChange={(checked) => setPublishAnonymously(checked === true)}
            />
            <div className="flex-1">
              <Label htmlFor="publishAnonymously" className="cursor-pointer">
                Publish Anonymously
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Your username will not be displayed. The plan will be attributed to "Anonymous".
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !canSubmit}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              <>
                <Globe className="h-4 w-4 mr-2" />
                Publish to Community
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
