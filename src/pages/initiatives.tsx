import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { Target, Plus, Pencil, Trash2, Folder, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useProjectStore } from "@/stores/project-store"
import { formatShortDate } from "@/lib/date-utils"
import { ColorIconPicker, ColorIconBadge } from "@/components/color-icon-picker"
import { getRandomColor, getRandomInitiativeIcon } from "@/lib/color-icon-utils"
import { OnboardingHint } from "@/components/onboarding-hint"
import { cn } from "@/lib/utils"
import type { Initiative, Project } from "@/types"

const healthDot: Record<string, string> = {
  on_track: "bg-success",
  at_risk: "bg-warning",
  off_track: "bg-error",
}

const statusConfig: Record<Initiative["status"], { label: string; variant: "default" | "success" | "warning" | "destructive" }> = {
  active: { label: "Active", variant: "success" },
  on_hold: { label: "On hold", variant: "warning" },
  completed: { label: "Completed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

export default function InitiativesPage() {
  const navigate = useNavigate()
  const { initiatives, addInitiative, updateInitiative, deleteInitiative } = useInitiativeStore()
  const { projects, updateProject } = useProjectStore()
  const [showDialog, setShowDialog] = useState(false)
  const [showProjectsDialog, setShowProjectsDialog] = useState(false)
  const [selectedInitiativeId, setSelectedInitiativeId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<Partial<Initiative>>({
    name: "",
    description: "",
    goal: "",
    status: "active",
    startDate: "",
    targetDate: "",
    lead: "",
    color: "#3b82f6",
  })

  const projectsByInitiative = useMemo(() => {
    const map = new Map<string, Project[]>()
    projects.forEach(p => {
      if (p.initiativeId) {
        const list = map.get(p.initiativeId) || []
        list.push(p)
        map.set(p.initiativeId, list)
      }
    })
    return map
  }, [projects])

  const handleOpenDialog = (initiative?: Initiative) => {
    if (initiative) {
      setEditingId(initiative.id)
      setFormData(initiative)
    } else {
      setEditingId(null)
      setFormData({
        name: "",
        description: "",
        goal: "",
        status: "active",
        startDate: "",
        targetDate: "",
        lead: "",
        color: getRandomColor(),
        icon: getRandomInitiativeIcon(),
      })
    }
    setShowDialog(true)
  }

  const handleSave = () => {
    if (!formData.name?.trim()) return

    if (editingId) {
      updateInitiative(editingId, formData)
    } else {
      const newInitiative: Initiative = {
        id: crypto.randomUUID(),
        name: formData.name,
        description: formData.description || "",
        goal: formData.goal,
        status: formData.status || "active",
        startDate: formData.startDate,
        targetDate: formData.targetDate,
        lead: formData.lead,
        color: formData.color || getRandomColor(),
        icon: formData.icon || getRandomInitiativeIcon(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      addInitiative(newInitiative)
    }
    setShowDialog(false)
  }

  const handleDelete = (id: string) => {
    if (confirm("Delete this initiative? Projects assigned to it will be unassigned.")) {
      deleteInitiative(id)
      // Unassign projects
      projects.forEach(p => {
        if (p.initiativeId === id) {
          const { updateProject } = useProjectStore.getState()
          updateProject(p.id, { initiativeId: undefined })
        }
      })
    }
  }

  const handleOpenProjectsDialog = (initiativeId: string) => {
    setSelectedInitiativeId(initiativeId)
    setShowProjectsDialog(true)
  }

  const handleToggleProject = (projectId: string, initiativeId: string | null) => {
    updateProject(projectId, { initiativeId: initiativeId || undefined })
  }

  const sortedInitiatives = useMemo(() => {
    return [...initiatives].sort((a, b) => {
      // Active first, then by name
      if (a.status === "active" && b.status !== "active") return -1
      if (a.status !== "active" && b.status === "active") return 1
      return a.name.localeCompare(b.name)
    })
  }, [initiatives])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between h-14 px-6">
          <div className="flex items-center gap-3">
            <Target className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-primary font-semibold">Initiatives</h1>
            <Badge variant="outline" className="text-xs">
              {initiatives.length}
            </Badge>
          </div>
          <Button onClick={() => handleOpenDialog()} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            New Initiative
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <OnboardingHint hintId="initiatives-intro" icon={Target} className="mx-6 mt-3">
          Initiatives group related projects under a shared goal — useful when managing many projects.
        </OnboardingHint>
        <div className="p-6">
          {sortedInitiatives.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No initiatives yet"
              description="Create your first initiative to group and organize projects"
              action={{
                label: "New Initiative",
                onClick: () => handleOpenDialog(),
              }}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sortedInitiatives.map((initiative) => {
                const initiativeProjects = projectsByInitiative.get(initiative.id) || []
                const projectCount = initiativeProjects.length
                return (
                  <Card key={initiative.id} className="group">
                    {/* Header */}
                    <div className="flex items-center justify-between p-6">
                      <div className="flex items-center gap-3 min-w-0">
                        <ColorIconBadge
                          color={initiative.color}
                          icon={initiative.icon}
                          type="initiative"
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{initiative.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {initiative.description || "No description"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={statusConfig[initiative.status].variant} className="text-xs">
                          {statusConfig[initiative.status].label}
                        </Badge>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleOpenDialog(initiative)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => handleDelete(initiative.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    {/* Content */}
                    <div className="flex flex-col gap-2 px-6 pb-6">
                      {initiative.goal && (
                        <div className="rounded-lg bg-muted p-3">
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            <span className="font-medium text-foreground">Goal:</span> {initiative.goal}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpenProjectsDialog(initiative.id)
                              }}
                            >
                              <Folder className="h-3.5 w-3.5" />
                              <span>{projectCount} project{projectCount !== 1 ? "s" : ""}</span>
                            </button>
                          </TooltipTrigger>
                          {initiativeProjects.length > 0 && (
                            <TooltipContent
                              side="bottom"
                              align="start"
                              className="bg-popover text-popover-foreground border border-border shadow-lg rounded-lg px-0 py-1.5 max-w-[220px]"
                            >
                              {initiativeProjects.map((p) => (
                                <div
                                  key={p.id}
                                  className="flex items-center gap-2 px-3 py-1"
                                >
                                  <span className={cn(
                                    "h-1.5 w-1.5 rounded-full shrink-0",
                                    healthDot[p.health ?? "on_track"] ?? "bg-muted-foreground"
                                  )} />
                                  <span className="text-xs truncate">{p.name}</span>
                                </div>
                              ))}
                            </TooltipContent>
                          )}
                        </Tooltip>
                        <div className="flex items-center gap-3">
                          {initiative.lead && (
                            <span>{initiative.lead}</span>
                          )}
                          {initiative.targetDate && (
                            <span>{formatShortDate(initiative.targetDate)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={showProjectsDialog} onOpenChange={setShowProjectsDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Manage Projects</DialogTitle>
            <DialogDescription>
              {selectedInitiativeId
                ? `Assign or unassign projects for "${initiatives.find(i => i.id === selectedInitiativeId)?.name}"`
                : "Select an initiative to manage projects"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4 max-h-[400px] overflow-y-auto">
            {projects.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                No projects available
              </div>
            ) : (
              projects.map((project) => {
                const isAssigned = project.initiativeId === selectedInitiativeId
                return (
                  <div
                    key={project.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{project.name}</span>
                        {project.initiativeId && project.initiativeId !== selectedInitiativeId && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            {initiatives.find(i => i.id === project.initiativeId)?.name}
                          </Badge>
                        )}
                      </div>
                      {project.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {project.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => navigate(`/project/${project.id}/graph`)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant={isAssigned ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          handleToggleProject(
                            project.id,
                            isAssigned ? null : selectedInitiativeId
                          )
                        }
                      >
                        {isAssigned ? "Unassign" : "Assign"}
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProjectsDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Initiative" : "New Initiative"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the initiative details below."
                : "Create a new initiative to group related projects."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Platform Development, Q1 Research"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description || ""}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief overview of this initiative..."
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="goal">Goal</Label>
              <Textarea
                id="goal"
                value={formData.goal || ""}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, goal: e.target.value })}
                placeholder="What is the target outcome?"
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status || "active"}
                onValueChange={(value) => setFormData({ ...formData, status: value as Initiative["status"] })}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on_hold">On hold</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Appearance</Label>
              <ColorIconPicker
                color={formData.color}
                icon={formData.icon}
                type="initiative"
                onColorChange={(color) => setFormData({ ...formData, color })}
                onIconChange={(icon) => setFormData({ ...formData, icon })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate || ""}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="targetDate">Target Date</Label>
                <Input
                  id="targetDate"
                  type="date"
                  value={formData.targetDate || ""}
                  onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lead">Lead</Label>
              <Input
                id="lead"
                value={formData.lead || ""}
                onChange={(e) => setFormData({ ...formData, lead: e.target.value })}
                placeholder="Person or team leading this initiative"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!formData.name?.trim()}>
              {editingId ? "Save Changes" : "Create Initiative"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
