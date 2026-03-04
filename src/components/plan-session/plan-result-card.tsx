/**
 * Plan Result Card
 *
 * Shows when plan JSON is extracted from the final output.
 * Displays node/edge counts, a "View Plan" navigation button,
 * collapsible JSON display, copy-to-clipboard, and create-new-project.
 */

import { useState, useMemo } from "react"
import { useNavigate } from "react-router"
import { CheckCircle2, ArrowRight, GitBranch, ChevronDown, ChevronRight, Copy, Check, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { planNodesToExportJson } from "@/lib/plan-extraction"
import { importProject } from "@/lib/sharing/import-project"

interface PlanResultCardProps {
  projectId: string
  projectName: string
  nodeCount: number
  edgeCount: number
  milestoneNames: string[]
  status: 'success' | 'partial'
}

export function PlanResultCard({
  projectId,
  projectName,
  nodeCount,
  edgeCount,
  milestoneNames,
  status,
}: PlanResultCardProps) {
  const navigate = useNavigate()
  const [jsonExpanded, setJsonExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showNameInput, setShowNameInput] = useState(false)
  const [newProjectName, setNewProjectName] = useState(`${projectName} (Copy)`)

  // Read plan data from store
  const allNodes = usePlanStore((s) => s.nodes)
  const allEdges = usePlanStore((s) => s.edges)

  const exportJson = useMemo(() => {
    const nodes = allNodes.filter((n) => n.projectId === projectId && isLive(n))
    const edges = allEdges.filter((e) => {
      const nodeIds = new Set(nodes.map((n) => n.id))
      return (nodeIds.has(e.source) || nodeIds.has(e.target)) && isLive(e)
    })
    return planNodesToExportJson(projectName, nodes, edges)
  }, [allNodes, allEdges, projectId, projectName])

  const jsonString = useMemo(() => JSON.stringify(exportJson, null, 2), [exportJson])

  async function handleCopy() {
    await navigator.clipboard.writeText(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleCreateProject() {
    const name = newProjectName.trim() || `${projectName} (Copy)`
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
    const result = importProject({
      project: {
        name,
        description: project?.description ?? '',
        visionDoc: project?.visionDoc ?? '',
      },
      nodes: exportJson.nodes.map((n) => ({
        ...n,
        parentId: n.parentId ?? undefined,
        status: n.status as 'planned',
        type: n.type as 'task' | 'milestone',
        verification: n.verification as 'auto' | 'human',
        priority: n.priority as 'low' | 'medium' | 'high' | 'urgent' | undefined,
        estimate: n.estimate as 'XS' | 'S' | 'M' | 'L' | 'XL' | undefined,
      })),
      edges: exportJson.edges.map((e) => ({
        ...e,
        type: e.type as 'dependency' | 'branch',
      })),
    })
    if (result.success && result.projectId) {
      navigate(`/project/${result.projectId}/graph`)
    }
  }

  const statusColor = status === 'success'
    ? 'border-success/30 bg-success/5'
    : 'border-warning/30 bg-warning/5'

  const statusBadge = status === 'success'
    ? 'bg-success/10 text-success'
    : 'bg-warning/10 text-warning'

  return (
    <div className={cn("mx-4 my-3 rounded-lg border p-4", statusColor)}>
      <div className="flex items-start gap-3">
        <CheckCircle2 className={cn(
          "h-5 w-5 mt-0.5 shrink-0",
          status === 'success' ? "text-success" : "text-warning"
        )} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold">Plan Created</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", statusBadge)}>
              {status}
            </span>
          </div>

          <p className="text-sm text-foreground font-medium mb-2">{projectName}</p>

          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
            <span>{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
            <span>{edgeCount} edge{edgeCount !== 1 ? 's' : ''}</span>
            {milestoneNames.length > 0 && (
              <span className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {milestoneNames.length} milestone{milestoneNames.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {milestoneNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {milestoneNames.map((name) => (
                <span
                  key={name}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                >
                  {name}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mb-3">
            <Button
              size="sm"
              onClick={() => navigate(`/project/${projectId}/graph`)}
              className="gap-1.5"
            >
              View Plan
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Collapsible Plan JSON section */}
          <div className="border-t border-border/50 pt-2">
            <button
              onClick={() => setJsonExpanded(!jsonExpanded)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {jsonExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Plan JSON
            </button>

            {jsonExpanded && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5 mb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="h-7 text-xs gap-1.5"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy JSON'}
                  </Button>
                  {!showNameInput ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowNameInput(true)}
                      className="h-7 text-xs gap-1.5"
                    >
                      <Plus className="h-3 w-3" />
                      Create New Project
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateProject()
                          if (e.key === 'Escape') setShowNameInput(false)
                        }}
                        className="h-7 px-2 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleCreateProject}
                        className="h-7 text-xs"
                      >
                        Create
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowNameInput(false)}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
                <pre className="text-[11px] leading-relaxed bg-muted/50 rounded-md p-3 overflow-auto max-h-80 border border-border/30">
                  {jsonString}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
