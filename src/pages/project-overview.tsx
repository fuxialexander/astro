import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import {
  Rocket,
  Pencil,
  Plus,
  FileText,
  CircleCheck,
  Play,
  User,
  MessageSquare,
  FolderGit2,
  Diamond,
  Loader2,
  Download,
  Link2,
  Check,
  RotateCcw,
  GitPullRequest,
  ListPlus,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { EditorOpenControls } from "@/components/ui/editor-open-controls"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { RepoConfigDialog } from "@/components/repo-config-dialog"
import { MilestoneDialog } from "@/components/milestone-dialog"
import { MilestoneTaskPopover } from "@/components/milestone-task-popover"
import { ActivityDialog } from "@/components/activity-dialog"
import { LabelManagerDialog } from "@/components/label-manager-dialog"
import { RichTextEditor, type RichTextEditorRef } from "@/components/ui/rich-text-editor"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useActivityStore } from "@/stores/activity-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useAgentStore } from "@/stores/agent-store"
import { cn } from "@/lib/utils"
import { deliveryModeLabel, remoteTypeLabel } from "@/lib/project-source"
import { dataClient } from "@/lib/data-client"
import { fileToBase64 } from "@/lib/html-utils"
import { exportProject, downloadBundle } from "@/lib/sharing/export-project"
import { apiUrl } from "@/lib/api-url"
import type { Project, PlanNode } from "@/types"

const healthLabels: Record<string, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  off_track: "Off Track",
}

const healthColors: Record<string, string> = {
  on_track: "bg-success",
  at_risk: "bg-warning",
  off_track: "bg-error",
}

import { formatDate, formatRelativeTime } from "@/lib/date-utils"

// --- Overview Tab Content ---
export function OverviewTab({
  project,
}: {
  project: Project
}) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const addNode = usePlanStore((s) => s.addNode)
  const updateNode = usePlanStore((s) => s.updateNode)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const updateProject = useProjectStore((s) => s.updateProject)
  const initiatives = useInitiativeStore((s) => s.initiatives)
  const addActivity = useActivityStore((s) => s.addActivity)
  const activities = useActivityStore((s) => s.activities)
  const machines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)
  const recentActivities = useMemo(
    () => activities.filter((a) => a.projectId === project.id).slice(0, 3),
    [activities, project.id]
  )

  // Fetch machines on mount (for displaying machine hostname)
  useEffect(() => {
    if (machines.length === 0) {
      fetchMachines()
    }
  }, [machines.length, fetchMachines])
  const allNodes = useMemo(() => planNodes.filter((n) => n.projectId === project.id), [planNodes, project.id])
  const [visionOpen, setVisionOpen] = useState(false)
  const [repoOpen, setRepoOpen] = useState(false)
  const [activityDialogOpen, setActivityDialogOpen] = useState(false)
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<PlanNode | undefined>(undefined)
  const [editingStatus, setEditingStatus] = useState(false)
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [editingStartDate, setEditingStartDate] = useState(false)
  const [editingTargetDate, setEditingTargetDate] = useState(false)
  const [editingInitiative, setEditingInitiative] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState(project.description)
  const [descriptionSaveStatus, setDescriptionSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [sharing, setSharing] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const descriptionEditorRef = useRef<RichTextEditorRef>(null)
  const descriptionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Editor state is now managed by EditorOpenControls component

  // Check if repo setup is in progress for this project
  const generationSession = useAgentStore((s) => s.sessions.get(project.id))
  const isRepoSetupInProgress = generationSession?.status === "active" && generationSession?.phase === "repo_setup"

  // Calculate real progress based on task completion
  const progress = useMemo(() => {
    const tasks = allNodes.filter((n) => n.type !== "milestone")
    if (tasks.length === 0) return 0
    const completed = tasks.filter((n) => n.status === "completed" || n.status === "auto_verified")
    return Math.round((completed.length / tasks.length) * 100)
  }, [allNodes])

  // Get milestones for this project
  const milestones = useMemo(() => allNodes.filter((n) => n.type === "milestone"), [allNodes])

  const handleMilestoneAdd = () => {
    setEditingMilestone(undefined)
    setMilestoneDialogOpen(true)
  }

  const handleMilestoneEdit = (milestone: PlanNode) => {
    setEditingMilestone(milestone)
    setMilestoneDialogOpen(true)
  }

  const handleMilestoneSave = (data: { title: string; description: string; dueDate?: string }) => {
    if (editingMilestone) {
      // Update existing milestone
      updateNode(editingMilestone.id, {
        title: data.title,
        description: data.description,
        dueDate: data.dueDate,
      })
      addActivity({
        projectId: project.id,
        type: "milestone.updated",
        title: `Updated milestone: ${data.title}`,
        nodeId: editingMilestone.id,
      })
    } else {
      // Create new milestone
      const newMilestone: PlanNode = {
        id: crypto.randomUUID(),
        projectId: project.id,
        type: "milestone",
        title: data.title,
        description: data.description,
        dueDate: data.dueDate,
        status: "planned",
        parentId: null,
        dependencies: [],
        verification: "human",
        position: { x: 0, y: 0 }, // Will be calculated by layout algorithm
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      addNode(newMilestone)
      addActivity({
        projectId: project.id,
        type: "milestone.created",
        title: `Created milestone: ${data.title}`,
        description: data.description,
        nodeId: newMilestone.id,
      })
    }
  }

  const handleMilestoneDelete = (milestoneId: string) => {
    // Check if any tasks are assigned to this milestone
    const milestone = allNodes.find((n) => n.id === milestoneId)
    const assignedTasks = allNodes.filter((n) => n.milestoneId === milestoneId && n.type !== "milestone")

    if (assignedTasks.length > 0) {
      const confirmDelete = window.confirm(
        `This milestone has ${assignedTasks.length} assigned task(s). Deleting it will unassign these tasks. Continue?`
      )
      if (!confirmDelete) return

      // Unassign tasks from this milestone
      for (const task of assignedTasks) {
        updateNode(task.id, { milestoneId: undefined })
      }
    }

    removeNodes([milestoneId])

    if (milestone) {
      addActivity({
        projectId: project.id,
        type: "milestone.deleted",
        title: `Deleted milestone: ${milestone.title}`,
        nodeId: milestoneId,
      })
    }
  }

  // Handle description changes from rich text editor with debounced autosave
  const handleDescriptionChange = useCallback((html: string) => {
    setDescriptionDraft(html)
    if (html === project.description) return

    if (descriptionDebounceRef.current) clearTimeout(descriptionDebounceRef.current)
    descriptionDebounceRef.current = setTimeout(() => {
      setDescriptionSaveStatus("saving")
      updateProject(project.id, { description: html })
      addActivity({
        projectId: project.id,
        type: "project.updated",
        title: "Updated project description",
      })
      setDescriptionSaveStatus("saved")
      setTimeout(() => setDescriptionSaveStatus("idle"), 1500)
    }, 800)
  }, [project.id, project.description, updateProject, addActivity])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (descriptionDebounceRef.current) clearTimeout(descriptionDebounceRef.current)
    }
  }, [])

  const handleDescriptionImageUpload = useCallback(async (file: File): Promise<string | null> => {
    try {
      const base64 = await fileToBase64(file)
      const blobId = await dataClient.uploadBlob(base64, file.type, file.size, file.name, project.id, project.id)
      return dataClient.getBlobUrl(blobId)
    } catch (err) {
      console.error('Failed to upload image:', err)
      return null
    }
  }, [project.id])

  // Machine info for editor URL construction
  const defaultMachine = project.defaultMachineId
    ? machines.find((m) => m.id === project.defaultMachineId)
    : (machines.length === 1 ? machines[0] : undefined)

  return (
    <div className="flex flex-1 overflow-hidden">
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />
      <RepoConfigDialog open={repoOpen} onOpenChange={setRepoOpen} project={project} />
      <ActivityDialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen} projectId={project.id} />
      <LabelManagerDialog open={labelManagerOpen} onOpenChange={setLabelManagerOpen} projectId={project.id} />
      <MilestoneDialog
        open={milestoneDialogOpen}
        onOpenChange={setMilestoneDialogOpen}
        milestone={editingMilestone}
        onSave={handleMilestoneSave}
        onDelete={editingMilestone ? () => handleMilestoneDelete(editingMilestone.id) : undefined}
      />
      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {/* Description Section */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Description</h3>
          <RichTextEditor
            ref={descriptionEditorRef}
            content={descriptionDraft}
            onChange={handleDescriptionChange}
            placeholder="Describe your project — goals, context, and key details. Paste or drop images..."
            onImageUpload={handleDescriptionImageUpload}
            className="min-h-[200px]"
            toolbarExtra={
              <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-[60px] justify-end">
                {descriptionSaveStatus === "saving" && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving...
                  </>
                )}
                {descriptionSaveStatus === "saved" && (
                  <>
                    <CircleCheck className="h-3 w-3" />
                    Saved
                  </>
                )}
              </span>
            }
          />
        </div>

        {/* Milestones Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Milestones</h3>
            <Plus
              className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={handleMilestoneAdd}
            />
          </div>
          {milestones.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <Diamond className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No milestones yet</p>
                <p className="text-xs text-muted-foreground">Click the + icon to create your first milestone</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {milestones.map((milestone) => {
                const tasks = allNodes.filter((n) => n.milestoneId === milestone.id && n.type !== "milestone")
                const completed = tasks.filter((t) => t.status === "completed" || t.status === "auto_verified").length
                const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0

                return (
                  <div
                    key={milestone.id}
                    className="flex items-start gap-3 rounded-lg bg-muted p-4 cursor-pointer hover:bg-muted/80 transition-colors"
                    onClick={() => handleMilestoneEdit(milestone)}
                  >
                    <Diamond className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div className="flex-1 flex flex-col gap-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{milestone.title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <MilestoneTaskPopover
                            milestoneId={milestone.id}
                            allNodes={allNodes}
                            onToggleTask={(taskId, mId) => updateNode(taskId, { milestoneId: mId })}
                          >
                            <button
                              type="button"
                              className="p-0.5 rounded hover:bg-background/60 text-muted-foreground hover:text-foreground transition-colors"
                              onClick={(e) => e.stopPropagation()}
                              title="Manage tasks"
                            >
                              <ListPlus className="h-3.5 w-3.5" />
                            </button>
                          </MilestoneTaskPopover>
                          {milestone.dueDate && (
                            <span className="text-xs text-muted-foreground">
                              Due {formatDate(milestone.dueDate)}
                            </span>
                          )}
                        </div>
                      </div>
                      {milestone.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{milestone.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground shrink-0">
                          {completed}/{tasks.length}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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
                <span className="text-sm font-medium">skill.md</span>
                <span className="text-xs text-muted-foreground">
                  {project.visionDoc ? "Skill context for agents" : "Click to add skill context for agents"}
                </span>
              </div>
              <span className="text-xs font-medium text-primary">
                {project.visionDoc ? "Edit" : "Add"}
              </span>
            </div>
            {/* Show repository/directory item when configured */}
            {(project.workingDirectory || project.repository) && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <FolderGit2 className="h-[18px] w-[18px] text-primary shrink-0" />
                  <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium shrink-0">Working Directory</span>
                      {defaultMachine && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          ({defaultMachine.name || 'unknown'})
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground font-mono truncate" title={project.workingDirectory || project.repository}>
                      {project.workingDirectory || project.repository}
                    </span>
                  </div>
                  <button
                    onClick={() => setRepoOpen(true)}
                    className="text-xs font-medium text-primary hover:underline shrink-0"
                  >
                    Edit
                  </button>
                </div>
                {project.workingDirectory && (
                  <EditorOpenControls
                    path={project.workingDirectory}
                    machine={defaultMachine}
                  />
                )}
              </div>
            )}
            {/* Source detection & delivery mode info */}
            {project.source && (
              <div className="flex flex-wrap items-center gap-1.5 px-1">
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1">
                  {project.source.isGit ? (
                    <>
                      <FolderGit2 className="h-3 w-3" />
                      {project.source.remoteType !== 'none' ? remoteTypeLabel(project.source.remoteType) : 'Local Git'}
                    </>
                  ) : (
                    'No Git'
                  )}
                </Badge>
                {project.deliveryMode && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                    {deliveryModeLabel(project.deliveryMode)}
                  </Badge>
                )}
                {project.source.baseBranch && project.source.baseBranch !== 'main' && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-mono">
                    {project.source.baseBranch}
                  </Badge>
                )}
                {project.projectPrUrl && (
                  <a
                    href={project.projectPrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex"
                  >
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 text-primary hover:bg-primary/10 transition-colors">
                      <GitPullRequest className="h-3 w-3" />
                      PR #{project.projectPrNumber}
                    </Badge>
                  </a>
                )}
              </div>
            )}
            {/* Show loading state during repo setup */}
            {!(project.workingDirectory || project.repository) && isRepoSetupInProgress && (
              <div className="flex items-center gap-3 rounded-lg bg-primary/5 border border-primary/20 p-3 px-4">
                <Loader2 className="h-[18px] w-[18px] text-primary animate-spin shrink-0" />
                <div className="flex-1 flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Setting up working directory...</span>
                  <span className="text-xs text-muted-foreground">
                    {project.defaultMachineId
                      ? `Creating project directory on ${defaultMachine?.name || 'remote machine'}`
                      : "Creating project directory"}
                  </span>
                </div>
              </div>
            )}
            {/* Show repository warning when NOT configured and NOT setting up */}
            {!(project.workingDirectory || project.repository) && !isRepoSetupInProgress && (
              <div
                className="flex items-center gap-3 rounded-lg bg-warning/10 border border-warning/20 p-3 px-4 cursor-pointer hover:bg-warning/15 transition-colors"
                onClick={() => setRepoOpen(true)}
              >
                <FolderGit2 className="h-[18px] w-[18px] text-warning" />
                <div className="flex-1 flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">Repository Not Configured</span>
                  <span className="text-xs text-warning">
                    Click to configure working directory for agents
                  </span>
                </div>
                <span className="text-xs font-medium text-warning">
                  Add
                </span>
              </div>
            )}
            {/* Export project */}
            <div
              className="flex items-center gap-3 rounded-lg bg-muted p-3 px-4 cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => {
                const bundle = exportProject(project.id)
                downloadBundle(bundle)
              }}
            >
              <Download className="h-[18px] w-[18px] text-primary" />
              <div className="flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">Export as JSON</span>
                <span className="text-xs text-muted-foreground">Download project plan as a file</span>
              </div>
            </div>
            {/* Share as link */}
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg bg-muted p-3 px-4 transition-colors",
                sharing ? "opacity-60 cursor-wait" : "cursor-pointer hover:bg-muted/80"
              )}
              onClick={async () => {
                if (sharing) return
                setSharing(true)
                try {
                  const bundle = exportProject(project.id)
                  const res = await fetch(apiUrl("/api/share"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(bundle),
                  })
                  if (!res.ok) throw new Error("Failed to create share link")
                  const { id: shareId } = await res.json()
                  const url = `${window.location.origin}/share/${shareId}`
                  await navigator.clipboard.writeText(url)
                  setShareCopied(true)
                  setTimeout(() => setShareCopied(false), 2000)
                } catch (err) {
                  console.error("[share] Failed:", err)
                } finally {
                  setSharing(false)
                }
              }}
            >
              {shareCopied ? (
                <Check className="h-[18px] w-[18px] text-success" />
              ) : (
                <Link2 className="h-[18px] w-[18px] text-primary" />
              )}
              <div className="flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {shareCopied ? "Link copied!" : "Share as link"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {shareCopied ? "Anyone with the link can import this project" : "Create a shareable link to this plan"}
                </span>
              </div>
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
            {editingStatus ? (
              <select
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.status}
                onChange={(e) => {
                  updateProject(project.id, { status: e.target.value as "active" | "archived" })
                  setEditingStatus(false)
                }}
                onBlur={() => setEditingStatus(false)}
                autoFocus
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            ) : (
              <Badge
                variant="success"
                className="text-xs cursor-pointer hover:opacity-80"
                onClick={() => setEditingStatus(true)}
              >
                {project.status === "active" ? "Active" : "Archived"}
              </Badge>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Progress</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[13px] font-medium">{progress}%</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Health</span>
            <div className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", healthColors[project.health ?? "on_track"])} />
              <span className="text-[13px]">{healthLabels[project.health ?? "on_track"]}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Est. Completion</span>
            <span className="text-[13px]">{formatDate(project.targetDate)}</span>
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
            {editingStartDate ? (
              <input
                type="date"
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.startDate || ""}
                onChange={(e) => {
                  updateProject(project.id, { startDate: e.target.value })
                }}
                onBlur={() => setEditingStartDate(false)}
                autoFocus
              />
            ) : (
              <span
                className="text-[13px] cursor-pointer hover:underline"
                onClick={() => setEditingStartDate(true)}
              >
                {formatDate(project.startDate)}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Target Date</span>
            {editingTargetDate ? (
              <input
                type="date"
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.targetDate || ""}
                onChange={(e) => {
                  updateProject(project.id, { targetDate: e.target.value })
                }}
                onBlur={() => setEditingTargetDate(false)}
                autoFocus
              />
            ) : (
              <span
                className="text-[13px] cursor-pointer hover:underline"
                onClick={() => setEditingTargetDate(true)}
              >
                {formatDate(project.targetDate)}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Grand Plan</span>
            {editingInitiative ? (
              <select
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.initiativeId || ""}
                onChange={(e) => {
                  updateProject(project.id, { initiativeId: e.target.value || undefined })
                  setEditingInitiative(false)
                }}
                onBlur={() => setEditingInitiative(false)}
                autoFocus
              >
                <option value="">No grand plan</option>
                {initiatives
                  .filter(i => i.status === "active")
                  .map((initiative) => (
                    <option key={initiative.id} value={initiative.id}>
                      {initiative.name}
                    </option>
                  ))}
              </select>
            ) : (
              <div
                className="flex items-center gap-1 cursor-pointer hover:opacity-80"
                onClick={() => setEditingInitiative(true)}
              >
                <Rocket className="h-3.5 w-3.5 text-primary" />
                <span className="text-[13px]">
                  {initiatives.find(i => i.id === project.initiativeId)?.name ?? "—"}
                </span>
              </div>
            )}
          </div>

          {/* Merge Queue (visible when repository is configured) */}
          {project.repository && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Merge Queue</span>
              <button
                onClick={() => updateProject(project.id, { mergeQueueEnabled: !project.mergeQueueEnabled })}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer",
                  project.mergeQueueEnabled ? "bg-primary" : "bg-muted-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                    project.mergeQueueEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
                  )}
                />
              </button>
            </div>
          )}

          {/* Merge Method (visible when merge queue is enabled) */}
          {project.repository && project.mergeQueueEnabled && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Merge Method</span>
              <select
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.mergeQueueMergeMethod || "squash"}
                onChange={(e) => {
                  updateProject(project.id, {
                    mergeQueueMergeMethod: e.target.value as "merge" | "squash" | "rebase",
                  })
                }}
              >
                <option value="squash">Squash</option>
                <option value="merge">Merge</option>
                <option value="rebase">Rebase</option>
              </select>
            </div>
          )}

          {/* Labels */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Labels</span>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {project.labels && project.labels.length > 0 ? (
                project.labels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: label.color }}
                  >
                    {label.name}
                  </span>
                ))
              ) : null}
              <button
                onClick={() => setLabelManagerOpen(true)}
                className="text-[11px] text-primary hover:underline cursor-pointer"
              >
                Manage
              </button>
            </div>
          </div>
        </div>

        <Separator />

        {/* Recent Activity */}
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Recent Activity</h3>
            <span
              className="text-xs text-primary cursor-pointer hover:underline"
              onClick={() => setActivityDialogOpen(true)}
            >
              View all
            </span>
          </div>
          {recentActivities.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-center">
              <div className="flex flex-col gap-1">
                <MessageSquare className="h-5 w-5 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">No activity yet</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recentActivities.map((activity) => {
                // Map activity types to icons
                const iconMap = {
                  "task.completed": { Icon: CircleCheck, color: "text-success" },
                  "task.started": { Icon: Play, color: "text-info" },
                  "task.failed": { Icon: User, color: "text-error" },
                  "task.cancelled": { Icon: User, color: "text-warning" },
                  "milestone.created": { Icon: Plus, color: "text-primary" },
                  "milestone.updated": { Icon: Pencil, color: "text-primary" },
                  "milestone.deleted": { Icon: User, color: "text-error" },
                  "vision.updated": { Icon: FileText, color: "text-primary" },
                  "repo.configured": { Icon: FolderGit2, color: "text-primary" },
                  "plan.refined": { Icon: User, color: "text-primary" },
                  "project.updated": { Icon: Pencil, color: "text-muted-foreground" },
                  "project.created": { Icon: Rocket, color: "text-primary" },
                  "task.created": { Icon: Plus, color: "text-info" },
                  "task.deleted": { Icon: User, color: "text-error" },
                  "task.bulk_deleted": { Icon: User, color: "text-error" },
                  "task.bulk_executed": { Icon: Play, color: "text-info" },
                  "task.bulk_reset": { Icon: RotateCcw, color: "text-warning" },
                }

                const config = iconMap[activity.type] || { Icon: User, color: "text-muted-foreground" }
                const Icon = config.Icon

                return (
                  <div key={activity.id} className="flex gap-2.5">
                    <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", config.color)} />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[13px] truncate">{activity.title}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

