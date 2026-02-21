import { useState, useMemo, useCallback } from "react"
import { Link } from "react-router"
import { FileText, XCircle, RotateCcw, X } from "lucide-react"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { PropertyPicker } from "@/components/property-picker"
import { ExecutionPanel } from "@/components/execution"
import { usePlanStore } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { statusLabels } from "@/lib/status-config"
import { cn } from "@/lib/utils"
import type { PlanNode, Priority } from "@/types"

interface NodeInspectorProps {
  node: PlanNode
  /** Project context for file completion and execution links */
  project: {
    id: string
    workingDirectory?: string
    defaultMachineId?: string
    fileTree?: string[]
  }
  /** Current view mode, used in "View Execution" link query param */
  viewMode?: string
  /** Called when inspector wants to close */
  onClose: () => void
  /** Called when node is updated (to sync local state) */
  onNodeUpdate: (node: PlanNode) => void
}

/**
 * Reusable node inspector content panel.
 * Shows priority, estimate, dependencies, status, description, and action buttons.
 */
export function NodeInspectorContent({
  node,
  project,
  viewMode = "list",
  onNodeUpdate,
}: NodeInspectorProps) {
  const updateNode = usePlanStore((s) => s.updateNode)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const [isResetting, setIsResetting] = useState(false)

  const upstreamCount = useMemo(() => {
    const planEdges = usePlanStore.getState().edges
    return planEdges.filter((e) => e.target === node.id).length
  }, [node.id])

  const handleUpdate = useCallback((updates: Partial<PlanNode>) => {
    updateNode(node.id, updates)
    onNodeUpdate({ ...node, ...updates })
  }, [node, updateNode, onNodeUpdate])

  const handlePrune = useCallback(() => {
    handleUpdate({ status: "pruned" })
  }, [handleUpdate])

  // Voice transcription for description
  const handleTranscript = useCallback((text: string) => {
    const currentDescription = node.description ?? ""
    const newDescription = currentDescription ? `${currentDescription} ${text}` : text
    handleUpdate({ description: newDescription })
  }, [node.description, handleUpdate])

  const {
    isRecording,
    isTranscribing,
    isAvailable,
    duration,
    toggleRecording,
  } = useVoiceTranscription({
    onTranscript: handleTranscript,
  })

  return (
    <>
      <div className="flex flex-col gap-3.5">
        {/* Priority */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Priority</span>
          <PropertyPicker
            value={node.priority ?? "none"}
            options={PRIORITY_OPTIONS}
            title="Set priority"
            onSelect={(id) => handleUpdate({ priority: id as Priority })}
          >
            {(() => {
              const config = PRIORITY_CONFIG[(node.priority ?? "none") as Priority]
              return (
                <span className={cn("text-[13px] font-medium", config.color)}>
                  {config.label}
                </span>
              )
            })()}
          </PropertyPicker>
        </div>

        {/* Estimate */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Estimate</span>
          <PropertyPicker
            value={node.estimate}
            options={ESTIMATE_OPTIONS}
            title="Set estimate"
            onSelect={(id) => handleUpdate({ estimate: id as PlanNode["estimate"] })}
          >
            <span className="text-[13px] font-medium text-foreground">
              {node.estimate ?? "\u2014"}
            </span>
          </PropertyPicker>
        </div>

        {/* Dependencies */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Dependencies</span>
          <span className="text-[13px] font-medium text-foreground">
            {upstreamCount > 0 ? `${upstreamCount} upstream` : "\u2014"}
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Status</span>
          <PropertyPicker
            value={node.status}
            options={STATUS_OPTIONS}
            title="Set status"
            onSelect={(id) => handleUpdate({ status: id as PlanNode["status"] })}
          >
            <span className="text-[13px] font-medium text-foreground">
              {statusLabels[node.status]}
            </span>
          </PropertyPicker>
        </div>

        {/* Elapsed time */}
        {node.executionId && (
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Elapsed</span>
            <span className="text-[13px] font-medium text-blue-500">3:24</span>
          </div>
        )}
      </div>
      <Separator />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-muted-foreground">Description</h4>
          <VoiceInputButton
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            isAvailable={isAvailable}
            duration={duration}
            onClick={toggleRecording}
            size="sm"
          />
        </div>
        <FileCompletionTextarea
          projectId={project.id}
          machineId={project.defaultMachineId}
          workingDirectory={project.workingDirectory}
          fileTree={project.fileTree}
          value={node.description ?? ""}
          onChange={(val) => handleUpdate({ description: val })}
          placeholder="Describe this task... Use @ to reference files"
          rows={4}
          className="w-full resize-none rounded-md border-none bg-transparent px-0 py-0 text-[13px] leading-[1.5] text-muted-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0"
        />
      </div>
      <Separator />

      <div className="flex flex-col gap-2.5">
        {node.executionId ? (
          <>
            <Link
              to={`/project/${project.id}/task/${node.id}?from=${viewMode}`}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              View Execution
            </Link>
            <button
              disabled={isResetting}
              onClick={async () => {
                setIsResetting(true)
                try {
                  await resetExecution(node.id)
                  const freshNode = usePlanStore.getState().nodes.find((n) => n.id === node.id)
                  if (freshNode) onNodeUpdate(freshNode)
                } finally {
                  setIsResetting(false)
                }
              }}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] border border-border bg-transparent text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={cn("h-4 w-4", isResetting && "animate-spin")} />
              {isResetting ? "Resetting..." : "Re-execute"}
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <ExecutionPanel node={node} projectId={project.id} viewMode={viewMode} />
          </div>
        )}

        {node.status !== "pruned" && (
          <button
            onClick={handlePrune}
            className="flex items-center justify-center gap-2 h-10 rounded-[10px] border border-border bg-transparent text-destructive text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <XCircle className="h-4 w-4" />
            Prune Branch
          </button>
        )}
      </div>
    </>
  )
}

/**
 * Mobile: full-screen sheet wrapping NodeInspectorContent.
 */
export function NodeInspectorSheet(props: NodeInspectorProps & { open: boolean }) {
  const { open, onClose, node, ...rest } = props
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full p-0">
        <div className="flex flex-col gap-5 p-4 overflow-auto h-full">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-base truncate flex-1">{node.title}</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Separator />
          <NodeInspectorContent node={node} onClose={onClose} {...rest} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Desktop: right sidebar wrapping NodeInspectorContent.
 */
export function NodeInspectorSidebar(props: NodeInspectorProps) {
  const { node, onClose, ...rest } = props
  return (
    <div className="flex flex-col gap-5 border-l bg-card p-5 overflow-auto border-border w-[320px] shrink-0">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-muted-foreground">Node Inspector</h4>
        <Button
          variant="ghost"
          size="icon"
          className="h-[18px] w-[18px] shrink-0 p-0 hover:bg-transparent"
          onClick={onClose}
        >
          <X className="h-[18px] w-[18px] text-muted-foreground" />
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-xl text-foreground truncate font-serif">
          {node.title}
        </h3>
        {node.executionId && (
          <div className="flex items-center gap-2 text-xs">
            <div className="h-2 w-2 rounded-full bg-muted" />
            <span className="text-muted-foreground">MacBook Pro</span>
          </div>
        )}
      </div>
      <Separator />
      <NodeInspectorContent node={node} onClose={onClose} {...rest} />
    </div>
  )
}
