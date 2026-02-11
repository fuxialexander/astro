import { useState, useMemo, useEffect } from "react"
import { useParams, useNavigate } from "react-router"
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
  FolderGit2,
  Diamond,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { RepoConfigDialog } from "@/components/repo-config-dialog"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { cn } from "@/lib/utils"
import type { Project } from "@/types"

type TabId = "overview" | "updates"

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

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr + "T00:00:00Z")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

// --- Overview Tab Content ---
function OverviewTab({ project }: { project: Project }) {
  const planNodes = usePlanStore((s) => s.nodes)
  const allNodes = useMemo(() => planNodes.filter((n) => n.projectId === project.id), [planNodes, project.id])
  const [visionOpen, setVisionOpen] = useState(false)
  const [repoOpen, setRepoOpen] = useState(false)
  return (
    <div className="flex flex-1 overflow-hidden">
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />
      <RepoConfigDialog open={repoOpen} onOpenChange={setRepoOpen} project={project} />
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
            <div
              className="flex items-center gap-3 rounded-lg bg-muted p-3 px-4 cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => setVisionOpen(true)}
            >
              <FileText className="h-[18px] w-[18px] text-primary" />
              <div className="flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">Vision Document</span>
                <span className="text-xs text-muted-foreground">
                  {project.visionDoc ? "Product vision and context for agents" : "Click to add vision context for agents"}
                </span>
              </div>
              <span className="text-xs font-medium text-primary">
                {project.visionDoc ? "Edit" : "Add"}
              </span>
            </div>
            <div
              className="flex items-center gap-3 rounded-lg bg-muted p-3 px-4 cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => setRepoOpen(true)}
            >
              <FolderGit2 className="h-[18px] w-[18px] text-primary" />
              <div className="flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">Repository & Directory</span>
                <span className="text-xs text-muted-foreground">
                  {project.workingDirectory || project.repository
                    ? (project.workingDirectory || project.repository)
                    : "Click to configure working directory for agents"}
                </span>
              </div>
              <span className="text-xs font-medium text-primary">
                {project.workingDirectory || project.repository ? "Edit" : "Add"}
              </span>
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

          {/* Labels */}
          {project.labels && project.labels.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Labels</span>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {project.labels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: label.color }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Milestones */}
          {(() => {
            const milestones = allNodes.filter((n) => n.type === "milestone")
            if (milestones.length === 0) return null
            return (
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-muted-foreground">Milestones</span>
                <div className="flex flex-col gap-1.5">
                  {milestones.map((m) => {
                    const tasks = allNodes.filter((n) => n.milestoneId === m.id && n.type !== "milestone")
                    const completed = tasks.filter((t) => t.status === "completed" || t.status === "auto_verified").length
                    const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0
                    return (
                      <div key={m.id} className="flex items-center gap-2">
                        <Diamond className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-[12px] flex-1 truncate">{m.title}</span>
                        <span className="text-[11px] text-muted-foreground">{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
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
const FILE_TREE_STALE_MS = 5 * 60 * 1000 // 5 minutes

export function ProjectOverview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const updateFileTree = useProjectStore((s) => s.updateFileTree)
  const [activeTab, setActiveTab] = useState<TabId>("overview")

  // Refresh file tree cache if stale or missing (only on mount / project change)
  useEffect(() => {
    if (!project?.workingDirectory) return
    const updatedAt = project.fileTreeUpdatedAt ? new Date(project.fileTreeUpdatedAt).getTime() : 0
    if (Date.now() - updatedAt < FILE_TREE_STALE_MS && project.fileTree?.length) return

    fetch(`/api/repo/file-tree?workingDirectory=${encodeURIComponent(project.workingDirectory)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.files?.length) {
          updateFileTree(project.id, data.files)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.workingDirectory])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Project not found
      </div>
    )
  }

  type TabDef = { id: string; label: string; route?: string }
  const tabs: TabDef[] = [
    { id: "overview", label: "Overview" },
    { id: "graph", label: "Graph", route: `/project/${id}/plan?view=graph` },
    { id: "timeline", label: "Timeline", route: `/project/${id}/plan?view=timeline` },
    { id: "list", label: "List", route: `/project/${id}/plan?view=list` },
    { id: "board", label: "Board", route: `/project/${id}/plan?view=board` },
    { id: "updates", label: "Updates" },
  ]

  function handleTabClick(tab: TabDef) {
    if (tab.route) {
      navigate(tab.route)
    } else {
      setActiveTab(tab.id as TabId)
    }
  }

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
            onClick={() => handleTabClick(tab)}
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
        {activeTab === "updates" && <UpdatesTab />}
      </div>
    </div>
  )
}
