import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useReferenceStore } from "@/stores/reference-store"
import { useFeatureFlag } from "@/hooks/use-feature-flag"
import { cn } from "@/lib/utils"
import { extractTitle } from "@/lib/text-utils"
import { generateTitle, suggestLabels } from "@/lib/api-client"
import type { PlanNode, PlanEdge, Priority, Estimate, EdgeType, LoopConfig } from "@/types"

interface TaskCreationFormProps {
  projectId: string
  /**
   * Parent node ID - the new node will depend on this node.
   * Creates edge: parentNodeId → newNode
   */
  parentNodeId?: string
  /**
   * Child node ID - the new node will be a predecessor of this node.
   * Creates edge: newNode → childNodeId
   * Also updates childNode's dependencies to include the new node.
   * Mutually exclusive with parentNodeId.
   */
  childNodeId?: string
  defaultMilestoneId?: string
  defaultNodeType?: "task" | "milestone" | "loop"
  position?: { x: number; y: number }
  mode: "inline" | "popover" | "dialog"
  /** When true, the description field is expanded by default */
  defaultShowDescription?: boolean
  onCreated?: (node: PlanNode) => void
  onCancel?: () => void
}

export function TaskCreationForm({
  projectId,
  parentNodeId,
  childNodeId,
  defaultMilestoneId,
  defaultNodeType,
  position,
  mode,
  defaultShowDescription = false,
  onCreated,
  onCancel,
}: TaskCreationFormProps) {
  const { t } = useTranslation(['dialogs', 'common'])
  const addNode = usePlanStore((s) => s.addNode)
  const addEdge = usePlanStore((s) => s.addEdge)
  const updateNode = usePlanStore((s) => s.updateNode)
  const nodes = usePlanStore((s) => s.nodes)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const projectReferences = useReferenceStore((s) => s.library)
  const loopNodesEnabled = useFeatureFlag('loop-nodes')

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [showDescription, setShowDescription] = useState(defaultShowDescription)
  const [nodeType, setNodeType] = useState<"task" | "milestone" | "loop">(defaultNodeType ?? "task")
  const [priority, setPriority] = useState<Priority>("none")
  const [estimate, setEstimate] = useState<Estimate | "">("")
  const [dueDate, setDueDate] = useState("")
  const [edgeType, setEdgeType] = useState<EdgeType>("dependency")
  const [milestoneId, setMilestoneId] = useState(defaultMilestoneId ?? "")
  const [createMore, setCreateMore] = useState(false)

  // Loop config state
  const [loopMaxIterations, setLoopMaxIterations] = useState(10)
  const [loopTaskTemplate, setLoopTaskTemplate] = useState("")
  const [loopAutonomousMode, setLoopAutonomousMode] = useState(true)
  const [loopMetric, setLoopMetric] = useState("")
  const [loopDirection, setLoopDirection] = useState<"minimize" | "maximize">("minimize")
  const [loopThreshold, setLoopThreshold] = useState("")
  const [loopPlateauWindow, setLoopPlateauWindow] = useState("")

  const titleRef = useRef<HTMLInputElement>(null)

  // Get milestones for the project
  const rawAllNodes = usePlanStore((s) => s.nodes)
  const allNodes = useMemo(() => rawAllNodes.filter(isLive), [rawAllNodes])
  const milestones = useMemo(
    () => allNodes.filter((n) => n.projectId === projectId && n.type === "milestone"),
    [allNodes, projectId]
  )

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const resetForm = useCallback(() => {
    setTitle("")
    setDescription("")
    setShowDescription(false)
    setNodeType("task")
    setPriority("none")
    setEstimate("")
    setDueDate("")
    setEdgeType("dependency")
    setMilestoneId(defaultMilestoneId ?? "")
    setLoopMaxIterations(10)
    setLoopTaskTemplate("")
    setLoopAutonomousMode(true)
    setLoopMetric("")
    setLoopDirection("minimize")
    setLoopThreshold("")
    setLoopPlateauWindow("")
  }, [defaultMilestoneId])

  const handleCreate = useCallback(() => {
    if (!title.trim() && !description.trim()) return
    if (nodeType === 'loop' && !loopTaskTemplate.trim()) return

    const nodeId = crypto.randomUUID()
    const now = new Date()

    // If title is empty but description exists, derive title from description
    const effectiveTitle = title.trim() || extractTitle(description.trim())
    const effectiveDescription = description.trim()

    const loopConfig: LoopConfig | undefined = nodeType === 'loop' ? {
      maxIterations: loopMaxIterations,
      taskTemplate: loopTaskTemplate,
      autonomousMode: loopAutonomousMode,
      stopCondition: loopMetric ? {
        metric: loopMetric,
        direction: loopDirection,
        threshold: loopThreshold ? parseFloat(loopThreshold) : undefined,
        plateauWindow: loopPlateauWindow ? parseInt(loopPlateauWindow) : undefined,
      } : undefined,
    } : undefined

    // In predecessor mode (childNodeId), the new node has no dependencies from this relation
    // In successor mode (parentNodeId), the new node depends on the parent
    const newNode: PlanNode = {
      id: nodeId,
      projectId,
      type: nodeType,
      title: effectiveTitle,
      description: effectiveDescription,
      status: "planned",
      parentId: null,
      dependencies: parentNodeId ? [parentNodeId] : [],
      verification: nodeType === "milestone" ? "human" : "auto",
      position: position ?? { x: 40, y: 40 },
      priority: nodeType === "task" ? priority : undefined,
      estimate: nodeType === "task" && estimate ? (estimate as Estimate) : undefined,
      dueDate: dueDate || undefined,
      milestoneId: milestoneId || undefined,
      loopConfig,
      createdAt: now,
      updatedAt: now,
    }

    addNode(newNode)

    // Fire-and-forget AI title refinement when title was derived from long description
    if (!title.trim() && effectiveDescription.length > 80) {
      generateTitle(effectiveDescription).then((aiTitle) => {
        if (aiTitle && aiTitle !== effectiveTitle) {
          usePlanStore.getState().updateNode(nodeId, { title: aiTitle })
        }
      }).catch(() => {}) // silent — heuristic title is fine
    }

    // Fire-and-forget AI label suggestion
    if (effectiveDescription.length > 20 || effectiveTitle.length > 10) {
      suggestLabels(effectiveTitle, effectiveDescription).then((labelIds) => {
        if (labelIds.length > 0) {
          usePlanStore.getState().updateNode(nodeId, { labelIds })
        }
      }).catch(() => {})
    }

    if (parentNodeId) {
      // Successor mode: parentNodeId → newNode
      const edgeId = crypto.randomUUID()
      const newEdge: PlanEdge = {
        id: edgeId,
        source: parentNodeId,
        target: nodeId,
        type: edgeType,
      }
      addEdge(newEdge)
    } else if (childNodeId) {
      // Predecessor mode: newNode → childNodeId
      const edgeId = crypto.randomUUID()
      const newEdge: PlanEdge = {
        id: edgeId,
        source: nodeId,
        target: childNodeId,
        type: edgeType,
      }
      addEdge(newEdge)

      // Update the child node's dependencies to include the new node
      const childNode = nodes.find((n) => n.id === childNodeId)
      if (childNode) {
        const updatedDependencies = [...(childNode.dependencies || []), nodeId]
        updateNode(childNodeId, { dependencies: updatedDependencies })
      }
    }

    onCreated?.(newNode)

    if (createMore) {
      resetForm()
      titleRef.current?.focus()
    } else {
      onCancel?.()
    }
  }, [
    title, description, nodeType, priority, estimate, dueDate, milestoneId, edgeType,
    projectId, parentNodeId, childNodeId, position, createMore, nodes,
    loopMaxIterations, loopTaskTemplate, loopAutonomousMode, loopMetric, loopDirection, loopThreshold, loopPlateauWindow,
    addNode, addEdge, updateNode, onCreated, onCancel, resetForm,
  ])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
    if (e.key === "Escape") {
      e.preventDefault()
      onCancel?.()
    }
  }, [handleCreate, onCancel])

  const isInline = mode === "inline"
  const isPopover = mode === "popover"

  // Simplified popover mode — visually matches a real task node
  if (isPopover) {
    return (
      <div
        className="rounded-md border-2 border-primary/60 bg-card shadow-md flex flex-col gap-1 px-2.5 py-2"
        style={{ width: 164, minHeight: 56 }}
        onKeyDown={handleKeyDown}
      >
        {/* Status row: dot + type hint */}
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#94a3b8' }} />
          <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">planned</span>
        </div>
        {/* Title input */}
        <input
          ref={titleRef}
          type="text"
          placeholder={t('taskCreation.titlePlaceholder', { ns: 'dialogs' })}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 bg-transparent text-[11px] font-medium leading-snug outline-none placeholder:text-muted-foreground/50"
          autoFocus
        />
      </div>
    )
  }

  // Full form for inline and dialog modes
  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        isInline && "px-6 py-2 border-b border-border",
        mode === "dialog" && "gap-3"
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Title input */}
      <input
        ref={titleRef}
        type="text"
        placeholder={t('taskCreation.titlePlaceholder', { ns: 'dialogs' })}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={cn(
          "w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground",
          mode === "dialog" && "text-base"
        )}
      />

      {/* Description */}
      {showDescription ? (
        <FileCompletionTextarea
          projectId={projectId}
          machineId={project?.defaultMachineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          references={projectReferences}
          value={description}
          onChange={setDescription}
          placeholder={`${t('taskCreation.descriptionPlaceholder', { ns: 'dialogs' })} (@ for files · type [@ to cite a paper from your reference library)`}
          rows={mode === "dialog" ? 4 : 2}
          className={cn(
            "w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground",
            mode === "dialog" ? "resize-y min-h-[80px]" : "resize-none"
          )}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowDescription(true)}
          className="text-left text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {t('taskCreation.descriptionPlaceholder', { ns: 'dialogs' })}
        </button>
      )}

      {/* Property row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as "task" | "milestone" | "loop")}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs cursor-pointer"
        >
          <option value="task">{t('taskCreation.typeTask', { ns: 'dialogs' })}</option>
          <option value="milestone">{t('milestone.new', { ns: 'plan' })}</option>
          {loopNodesEnabled && <option value="loop">Loop</option>}
        </select>

        {(parentNodeId || childNodeId) && (
          <select
            value={edgeType}
            onChange={(e) => setEdgeType(e.target.value as EdgeType)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs cursor-pointer"
          >
            <option value="dependency">{t('dependencies', { ns: 'plan' })}</option>
            <option value="branch">{t('taskCreation.typeBranch', { ns: 'dialogs' })}</option>
          </select>
        )}

        {milestones.length > 0 && (
          <select
            value={milestoneId}
            onChange={(e) => setMilestoneId(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs cursor-pointer max-w-[120px]"
          >
            <option value="">{t('milestone.noMilestone', { ns: 'plan' })}</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
        )}
      </div>

      {/* Loop config panel */}
      {nodeType === 'loop' && (
        <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50/50 dark:bg-violet-950/20 dark:border-violet-800 p-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-28 shrink-0">Max iterations</label>
            <input
              type="number"
              min={1}
              max={100}
              value={loopMaxIterations}
              onChange={(e) => setLoopMaxIterations(parseInt(e.target.value) || 1)}
              className="h-7 w-20 rounded border border-border bg-background px-2 text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Task template</label>
            <textarea
              value={loopTaskTemplate}
              onChange={(e) => setLoopTaskTemplate(e.target.value)}
              placeholder="Describe what the agent should do each iteration..."
              rows={3}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Stop condition (optional)</label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={loopMetric}
                onChange={(e) => setLoopMetric(e.target.value)}
                placeholder="metric name"
                className="h-7 flex-1 min-w-[100px] rounded border border-border bg-background px-2 text-xs"
              />
              <select
                value={loopDirection}
                onChange={(e) => setLoopDirection(e.target.value as "minimize" | "maximize")}
                className="h-7 rounded border border-border bg-background px-2 text-xs"
              >
                <option value="minimize">minimize</option>
                <option value="maximize">maximize</option>
              </select>
              <input
                value={loopThreshold}
                onChange={(e) => setLoopThreshold(e.target.value)}
                placeholder="threshold"
                type="number"
                step="any"
                className="h-7 w-24 rounded border border-border bg-background px-2 text-xs"
              />
              <input
                value={loopPlateauWindow}
                onChange={(e) => setLoopPlateauWindow(e.target.value)}
                placeholder="plateau N"
                type="number"
                className="h-7 w-20 rounded border border-border bg-background px-2 text-xs"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={loopAutonomousMode}
              onChange={(e) => setLoopAutonomousMode(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Autonomous mode
          </label>
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none mr-auto">
          <input
            type="checkbox"
            checked={createMore}
            onChange={(e) => setCreateMore(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t('taskCreation.createMore', { ns: 'dialogs' })}
        </label>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleCreate}
          disabled={
            (!title.trim() && !description.trim()) ||
            (nodeType === 'loop' && !loopTaskTemplate.trim())
          }
        >
          {t('create', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}
