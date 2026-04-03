import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import {
  Rocket,
  Pencil,
  Plus,
  FileText,
  CircleCheck,
  Play,
  User,
  Users,
  MessageSquare,
  FolderGit2,
  Loader2,
  Download,
  Link2,
  Check,
  RotateCcw,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { RepoConfigDialog } from "@/components/repo-config-dialog"
import { ActivityDialog } from "@/components/activity-dialog"
import { LabelManagerDialog } from "@/components/label-manager-dialog"
import { RichTextEditor, type RichTextEditorRef } from "@/components/ui/rich-text-editor"
import { useProjectStore } from "@/stores/project-store"
import { useTeamStore } from "@/stores/team-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useActivityStore } from "@/stores/activity-store"
import { cn } from "@/lib/utils"
import { dataClient } from "@/lib/data-client"
import { fileToBase64, resolveEditorContent } from "@/lib/html-utils"
import { exportProject, downloadBundle } from "@/lib/sharing/export-project"
import { apiUrl } from "@/lib/api-url"
import type { Project } from "@/types"

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
  const updateProject = useProjectStore((s) => s.updateProject)
  const initiatives = useInitiativeStore((s) => s.initiatives)
  const addActivity = useActivityStore((s) => s.addActivity)
  const activities = useActivityStore((s) => s.activities)
  const teams = useTeamStore((s) => s.teams)
  const activeTeamId = useTeamStore((s) => s.activeTeamId)
  const projectTeamId = project.teamId || activeTeamId
  const teamMemberCount = useTeamStore((s) => (projectTeamId ? (s.teamMembers[projectTeamId]?.length ?? 0) : 0))
  const isSoloWorkspace = teamMemberCount <= 1
  const teamMembers = useTeamStore((s) => projectTeamId ? s.teamMembers[projectTeamId] ?? [] : [])
  const recentActivities = useMemo(
    () => activities.filter((a) => a.projectId === project.id).slice(0, 3),
    [activities, project.id]
  )

  const allNodes = useMemo(() => planNodes.filter((n) => n.projectId === project.id), [planNodes, project.id])
  const [visionOpen, setVisionOpen] = useState(false)
  const [repoOpen, setRepoOpen] = useState(false)
  const [activityDialogOpen, setActivityDialogOpen] = useState(false)
  const [editingStatus, setEditingStatus] = useState(false)
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [editingStartDate, setEditingStartDate] = useState(false)
  const [editingTargetDate, setEditingTargetDate] = useState(false)
  const [editingInitiative, setEditingInitiative] = useState(false)
  const [editingTeam, setEditingTeam] = useState(false)
  // Resolve description: may be stored as raw markdown (template-generated) or
  // HTML (previously edited via RichTextEditor). Use the same pattern as
  // task-content-tab for GitHub-imported node descriptions.
  const [descriptionDraft, setDescriptionDraft] = useState(() => resolveEditorContent(project.description))
  const [descriptionSaveStatus, setDescriptionSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [sharing, setSharing] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const descriptionEditorRef = useRef<RichTextEditorRef>(null)
  const descriptionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Editor state is now managed by EditorOpenControls component

  // Calculate real progress based on task completion
  const progress = useMemo(() => {
    const tasks = allNodes.filter((n) => n.type !== "milestone")
    if (tasks.length === 0) return 0
    const completed = tasks.filter((n) => n.status === "completed" || n.status === "auto_verified")
    return Math.round((completed.length / tasks.length) * 100)
  }, [allNodes])


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

  return (
    <div className="flex flex-1 overflow-hidden">
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />
      <RepoConfigDialog open={repoOpen} onOpenChange={setRepoOpen} project={project} />
      <ActivityDialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen} projectId={project.id} />
      <LabelManagerDialog open={labelManagerOpen} onOpenChange={setLabelManagerOpen} projectId={project.id} />
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

        {/* Skill Context */}
        <div
          className="flex items-center gap-3 rounded-xl bg-muted/50 border border-border/40 p-3 px-4 cursor-pointer hover:bg-muted/70 hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] transition-all duration-200"
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

        {/* Export & Share */}
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            onClick={() => {
              const bundle = exportProject(project.id)
              downloadBundle(bundle)
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-xs transition-colors",
              sharing ? "opacity-60 cursor-wait text-muted-foreground" : "text-muted-foreground hover:bg-muted/50"
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
            {shareCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Link2 className="h-3.5 w-3.5" />}
            {shareCopied ? "Copied!" : "Share"}
          </button>
        </div>
      </div>

      {/* Right Panel — Properties + Activity */}
      <div className="flex w-[320px] shrink-0 flex-col border-l border-border/60 bg-card">
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

          {project.targetDate && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Est. Completion</span>
              <span className="text-[13px]">{formatDate(project.targetDate)}</span>
            </div>
          )}

          {!isSoloWorkspace && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Lead</span>
              <select
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1 max-w-[160px]"
                value={project.lead ?? ""}
                onChange={(e) => updateProject(project.id, { lead: e.target.value || undefined })}
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => {
                  const label = m.user?.name || m.user?.email || m.userId
                  return (
                    <option key={m.userId} value={m.userId}>
                      {label}
                    </option>
                  )
                })}
              </select>
            </div>
          )}

          {teams.length > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Team</span>
              {editingTeam ? (
                <select
                  className="text-[13px] rounded-md border border-input bg-background px-2 py-1 max-w-[160px]"
                  value={project.teamId || ""}
                  onChange={(e) => {
                    updateProject(project.id, { teamId: e.target.value || undefined })
                    setEditingTeam(false)
                  }}
                  onBlur={() => setEditingTeam(false)}
                  autoFocus
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="flex items-center gap-1 cursor-pointer hover:opacity-80"
                  onClick={() => setEditingTeam(true)}
                >
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[13px]">
                    {teams.find(t => t.id === project.teamId)?.name ?? teams[0]?.name}
                  </span>
                </div>
              )}
            </div>
          )}

          {(project.startDate || editingStartDate) && (
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
          )}

          {(project.targetDate || editingTargetDate) && (
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
          )}

          {(project.initiativeId || editingInitiative) && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Initiative</span>
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
                  <option value="">No initiative</option>
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
          )}

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
