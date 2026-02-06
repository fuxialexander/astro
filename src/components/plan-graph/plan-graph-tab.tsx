import { useState } from "react"
import { CheckCircle2, Clock, Circle, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { GenerationOverlay } from "@/components/agent/generation-overlay"
import { ChatPanel } from "@/components/agent/chat-panel"
import { ExecutionPanel } from "@/components/execution"
import { useAgentStore } from "@/stores/agent-store"
import { usePlanStore } from "@/stores/plan-store"
import type { PlanNode } from "@/types"

const statusLabels: Record<string, string> = {
  planned: "Planned",
  dispatched: "Dispatched",
  in_progress: "In Progress",
  auto_verified: "Auto Verified",
  awaiting_judgment: "Awaiting Judgment",
  completed: "Completed",
  pruned: "Pruned",
}

const statusVariant: Record<string, "secondary" | "info" | "success" | "warning" | "outline"> = {
  planned: "secondary",
  dispatched: "info",
  in_progress: "info",
  auto_verified: "success",
  awaiting_judgment: "warning",
  completed: "success",
  pruned: "outline",
}

interface PlanGraphTabProps {
  projectId: string
  visionDoc?: string
}

export function PlanGraphTab({ projectId, visionDoc }: PlanGraphTabProps) {
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const updateNode = usePlanStore((s) => s.updateNode)
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const chatOpen = false // TODO: wire up chat toggle

  const handleApprove = () => {
    if (selectedNode) {
      updateNode(selectedNode.id, { status: "completed" })
      setSelectedNode({ ...selectedNode, status: "completed" })
    }
  }

  const handleReject = () => {
    if (selectedNode) {
      updateNode(selectedNode.id, { status: "planned" })
      setSelectedNode({ ...selectedNode, status: "planned" })
    }
  }

  const handlePrune = () => {
    if (selectedNode) {
      updateNode(selectedNode.id, { status: "pruned" })
      setSelectedNode({ ...selectedNode, status: "pruned" })
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="relative flex-1">
        <PlanCanvas projectId={projectId} onNodeSelect={setSelectedNode} />
        {isGenerating && <GenerationOverlay />}
      </div>

      {/* Chat panel */}
      {chatOpen && <ChatPanel projectId={projectId} visionDoc={visionDoc} />}

      {/* Detail pane with Execution Panel */}
      {selectedNode && !chatOpen && (
        <div className="flex w-[400px] shrink-0 flex-col gap-5 border-l border-border bg-card p-6 overflow-auto">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{selectedNode.title}</h3>
            <Badge variant={statusVariant[selectedNode.status] ?? "secondary"}>
              {statusLabels[selectedNode.status]}
            </Badge>
          </div>
          <Separator />

          {/* Node Details */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Type</span>
              <span className="capitalize">{selectedNode.type}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Verification</span>
              <span className="capitalize">{selectedNode.verification}</span>
            </div>
            {selectedNode.environment && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Environment</span>
                <span className="capitalize">{selectedNode.environment}</span>
              </div>
            )}
          </div>
          <Separator />

          {/* Description */}
          <div>
            <h4 className="mb-2 text-sm font-semibold">Description</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{selectedNode.description}</p>
          </div>
          <Separator />

          {/* Execution Panel */}
          <div>
            <h4 className="mb-3 text-sm font-semibold">Execution</h4>
            <ExecutionPanel node={selectedNode} projectId={projectId} />
          </div>

          {/* Action buttons for awaiting_judgment status */}
          {selectedNode.status === "awaiting_judgment" && (
            <>
              <Separator />
              <div className="flex items-center gap-2.5">
                <Button size="sm" className="flex-1" onClick={handleApprove}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={handleReject}>
                  <Clock className="h-3.5 w-3.5" />
                  Retry
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrune}>
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}

          {/* Prune button for other statuses */}
          {selectedNode.status !== "awaiting_judgment" && selectedNode.status !== "pruned" && (
            <>
              <Separator />
              <div className="flex items-center gap-2.5">
                <Button variant="outline" size="sm" className="flex-1" onClick={handlePrune}>
                  <Circle className="h-3.5 w-3.5" />
                  Prune Branch
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
