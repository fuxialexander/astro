import { useState } from "react"
import { useParams, Link } from "react-router"
import {
  Rocket,
  Star,
  Pencil,
  Plus,
  Share2,
  Ellipsis,
  FileText,
  CircleCheck,
  Play,
  User,
  MessageSquare,
  GitPullRequest,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { PlanGraphTab } from "@/components/plan-graph/plan-graph-tab"
import { PlanTimelineTab } from "@/components/plan-graph/plan-timeline-tab"
import { GenerationOverlay } from "@/components/agent/generation-overlay"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useAgentStore } from "@/stores/agent-store"
import { cn } from "@/lib/utils"
import type { Project } from "@/types"

type TabId = "overview" | "graph" | "timeline" | "list" | "updates"

const healthLabels: Record<string, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  off_track: "Off Track",
}

const healthColors: Record<string, string> = {
  on_track: "bg-green-500",
  at_risk: "bg-amber-500",
  off_track: "bg-red-500",
}

const statusBadgeVariant: Record<string, "success" | "warning" | "secondary" | "info" | "outline"> = {
  planned: "secondary",
  dispatched: "info",
  in_progress: "info",
  auto_verified: "success",
  awaiting_judgment: "warning",
  completed: "success",
  pruned: "outline",
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr + "T00:00:00Z")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

// --- Overview Tab Content ---
function OverviewTab({ project }: { project: Project }) {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {/* Description Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Description</h3>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-sm leading-relaxed">
            {project.description}
          </p>
        </div>

        {/* Metrics Section — 3 cards in a row */}
        <div className="flex gap-4">
          {/* Progress Card */}
          <Card className="flex-1">
            <CardContent className="flex flex-col gap-2 p-5">
              <span className="text-xs text-muted-foreground">Progress</span>
              <div className="flex items-end gap-2">
                <span className="text-[28px] font-bold leading-none">{project.progress ?? 0}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${project.progress ?? 0}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Health Status Card */}
          <Card className="flex-1">
            <CardContent className="flex flex-col gap-2 p-5">
              <span className="text-xs text-muted-foreground">Health Status</span>
              <div className="flex items-center gap-2">
                <span className={cn("h-3 w-3 rounded-full", healthColors[project.health ?? "on_track"])} />
                <span className="text-xl font-semibold">{healthLabels[project.health ?? "on_track"]}</span>
              </div>
              <span className="text-xs text-muted-foreground">All milestones on schedule</span>
            </CardContent>
          </Card>

          {/* Estimated Completion Card */}
          <Card className="flex-1">
            <CardContent className="flex flex-col gap-2 p-5">
              <span className="text-xs text-muted-foreground">Estimated Completion</span>
              <span className="text-xl font-semibold">{formatDate(project.targetDate)}</span>
              <span className="text-xs text-muted-foreground">Based on current velocity</span>
            </CardContent>
          </Card>
        </div>

        {/* Resources Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Resources</h3>
            <Plus className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3 px-4">
              <FileText className="h-[18px] w-[18px] text-primary" />
              <div className="flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">Vision Document</span>
                <span className="text-xs text-muted-foreground">Product vision and context for agents</span>
              </div>
              <span className="text-xs font-medium text-primary cursor-pointer">Open</span>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3 px-4">
              <GitPullRequest className="h-[18px] w-[18px]" />
              <div className="flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">feat: Agent Runner CLI (npx @nexus/agent)</span>
                <span className="text-xs text-muted-foreground">nexus#3 · Pull Request</span>
              </div>
              <span className="text-xs font-medium text-primary cursor-pointer">Open</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel — Properties + Activity */}
      <div className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card">
        {/* Properties */}
        <div className="flex flex-col gap-4 p-5">
          <h3 className="text-sm font-semibold">Properties</h3>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Status</span>
            <Badge variant="success" className="text-xs">
              {project.status === "active" ? "Active" : "Archived"}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Lead</span>
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                {(project.lead ?? "U").charAt(0)}
              </span>
              <span className="text-[13px]">{project.lead ?? "—"}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Start Date</span>
            <span className="text-[13px]">{formatDate(project.startDate)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Target Date</span>
            <span className="text-[13px]">{formatDate(project.targetDate)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Initiative</span>
            <div className="flex items-center gap-1">
              <Rocket className="h-3.5 w-3.5 text-primary" />
              <span className="text-[13px]">{project.initiative ?? "—"}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Recent Activity */}
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Recent Activity</h3>
            <span className="text-xs text-primary cursor-pointer">View all</span>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2.5">
              <CircleCheck className="h-4 w-4 shrink-0 text-green-500 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px]">Agent Runner CLI completed</span>
                <span className="text-[11px] text-muted-foreground">2 hours ago</span>
              </div>
            </div>
            <div className="flex gap-2.5">
              <Play className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px]">Provider abstraction started</span>
                <span className="text-[11px] text-muted-foreground">5 hours ago</span>
              </div>
            </div>
            <div className="flex gap-2.5">
              <User className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px]">Alex updated project description</span>
                <span className="text-[11px] text-muted-foreground">Yesterday</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- List Tab Content ---
function ListTab({ projectId }: { projectId: string }) {
  const nodes = usePlanStore((s) => s.nodes.filter((n) => n.projectId === projectId))

  const milestones = nodes.filter((n) => n.type === "milestone")
  const tasks = nodes.filter((n) => n.type !== "milestone")

  return (
    <div className="flex-1 overflow-auto">
      {/* Column headers */}
      <div className="flex items-center border-b border-border px-6 h-9 bg-muted/30">
        <span className="flex-1 text-[11px] font-semibold text-muted-foreground uppercase">Name</span>
        <span className="w-[120px] text-[11px] font-semibold text-muted-foreground uppercase">Status</span>
        <span className="w-[100px] text-[11px] font-semibold text-muted-foreground uppercase">Type</span>
        <span className="w-[120px] text-[11px] font-semibold text-muted-foreground uppercase">Verification</span>
        <span className="w-[100px] text-[11px] font-semibold text-muted-foreground uppercase">Environment</span>
      </div>

      {/* Milestones group */}
      {milestones.length > 0 && (
        <>
          <div className="flex items-center gap-2 bg-muted/50 px-6 h-8">
            <span className="text-xs font-semibold text-muted-foreground">Milestones</span>
            <span className="text-[11px] text-muted-foreground">{milestones.length}</span>
          </div>
          {milestones.map((node) => (
            <Link
              key={node.id}
              to={`/project/${projectId}/task/${node.id}`}
              className="flex items-center border-b border-border px-6 h-11 hover:bg-muted/30 transition-colors"
            >
              <span className="flex-1 text-sm truncate">◆ {node.title}</span>
              <div className="w-[120px]">
                <Badge variant={statusBadgeVariant[node.status] ?? "secondary"} className="text-[10px]">
                  {node.status.replace(/_/g, " ")}
                </Badge>
              </div>
              <span className="w-[100px] text-xs text-muted-foreground capitalize">{node.type}</span>
              <span className="w-[120px] text-xs text-muted-foreground capitalize">{node.verification}</span>
              <span className="w-[100px] text-xs text-muted-foreground">—</span>
            </Link>
          ))}
        </>
      )}

      {/* Tasks group */}
      <div className="flex items-center gap-2 bg-muted/50 px-6 h-8">
        <span className="text-xs font-semibold text-muted-foreground">Tasks</span>
        <span className="text-[11px] text-muted-foreground">{tasks.length}</span>
      </div>
      {tasks.map((node) => (
        <Link
          key={node.id}
          to={`/project/${projectId}/task/${node.id}`}
          className={cn(
            "flex items-center border-b border-border px-6 h-11 hover:bg-muted/30 transition-colors",
            node.status === "pruned" && "opacity-50"
          )}
        >
          <span className={cn("flex-1 text-sm truncate", node.status === "pruned" && "line-through")}>
            {node.title}
          </span>
          <div className="w-[120px]">
            <Badge variant={statusBadgeVariant[node.status] ?? "secondary"} className="text-[10px]">
              {node.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <span className="w-[100px] text-xs text-muted-foreground capitalize">{node.type}</span>
          <span className="w-[120px] text-xs text-muted-foreground capitalize">{node.verification}</span>
          <span className="w-[100px] text-xs text-muted-foreground capitalize">{node.environment ?? "—"}</span>
        </Link>
      ))}
    </div>
  )
}

// --- Updates Tab Content ---
function UpdatesTab() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <div className="flex flex-col items-center gap-2">
        <MessageSquare className="h-8 w-8" />
        <p className="text-sm font-medium">No project updates yet</p>
        <p className="text-xs">Post updates to keep your team informed</p>
      </div>
    </div>
  )
}

// --- Main Project Overview Page ---
export function ProjectOverview() {
  const { id } = useParams()
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const [activeTab, setActiveTab] = useState<TabId>("overview")

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Project not found
      </div>
    )
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "graph", label: "Graph" },
    { id: "timeline", label: "Timeline" },
    { id: "list", label: "List" },
    { id: "updates", label: "Updates" },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Rocket className="h-[18px] w-[18px] text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold">{project.name}</span>
          <Star className="h-[18px] w-[18px] text-muted-foreground" />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Ellipsis className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex border-b border-border px-6 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-3 text-[13px] transition-colors cursor-pointer",
              activeTab === tab.id
                ? "font-medium text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex flex-1 overflow-hidden relative">
        {activeTab === "overview" && <OverviewTab project={project} />}
        {activeTab === "graph" && <PlanGraphTab projectId={project.id} visionDoc={project.visionDoc} />}
        {activeTab === "timeline" && <PlanTimelineTab projectId={project.id} />}
        {activeTab === "list" && <ListTab projectId={project.id} />}
        {activeTab === "updates" && <UpdatesTab />}
        {isGenerating && activeTab === "graph" && <GenerationOverlay />}
      </div>
    </div>
  )
}
