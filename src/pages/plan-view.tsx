import { useState } from "react"
import { useParams, Link } from "react-router"
import { ArrowLeft, FileText, Plus, Share2, CheckCircle2, Clock, Circle, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { GenerationOverlay } from "@/components/agent/generation-overlay"
import { ChatPanel } from "@/components/agent/chat-panel"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
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

export function PlanView() {
  const { id } = useParams()
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const [chatOpen, setChatOpen] = useState(false)

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Project not found
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link to="/projects" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
          <span className="font-semibold">{project.name}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">Plan</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Link to={`/project/${id}/timeline`}>
            <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
              <span className="rounded-md bg-card px-3.5 py-1 text-xs font-medium">Graph</span>
              <span className="rounded-md px-3.5 py-1 text-xs text-muted-foreground">Timeline</span>
            </div>
          </Link>
          <Button variant="outline" size="sm">
            <FileText className="h-3.5 w-3.5" />
            Vision
          </Button>
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </Button>
          <Button
            variant={chatOpen ? "default" : "outline"}
            size="sm"
            onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setSelectedNode(null) }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <Share2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Canvas + Detail/Chat pane */}
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <PlanCanvas projectId={project.id} onNodeSelect={setSelectedNode} />
          {isGenerating && <GenerationOverlay />}
        </div>

        {/* Chat panel */}
        {chatOpen && <ChatPanel projectId={project.id} visionDoc={project.visionDoc} />}

        {/* Detail pane */}
        {selectedNode && !chatOpen && (
          <div className="flex w-[380px] shrink-0 flex-col gap-5 border-l border-border bg-card p-6 overflow-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{selectedNode.title}</h3>
              <Badge variant={statusVariant[selectedNode.status] ?? "secondary"}>
                {statusLabels[selectedNode.status]}
              </Badge>
            </div>
            <Separator />
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
            <div>
              <h4 className="mb-2 text-sm font-semibold">Description</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{selectedNode.description}</p>
            </div>
            <Separator />
            <div>
              <h4 className="mb-3 text-sm font-semibold">Agent Output</h4>
              <div className="rounded-[10px] bg-muted p-4">
                <p className="font-primary text-xs text-muted-foreground">
                  {selectedNode.status === "completed" || selectedNode.status === "auto_verified"
                    ? "All checks passed. Output verified."
                    : selectedNode.status === "in_progress"
                      ? "Agent is currently working on this task..."
                      : "No output yet."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 mt-auto">
              <Button size="sm" className="flex-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button variant="outline" size="sm" className="flex-1">
                <Clock className="h-3.5 w-3.5" />
                Defer
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <Circle className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
