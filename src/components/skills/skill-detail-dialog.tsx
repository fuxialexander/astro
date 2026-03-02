import { useState, useCallback } from "react"
import { Edit2, Trash2, ExternalLink, Save, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { useSkillStore } from "@/stores/skill-store"
import { cn } from "@/lib/utils"
import type { OpenClawSkill } from "@/types/skill"

interface SkillDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: OpenClawSkill | null
}

/**
 * Get display category from skill source
 */
function getSkillCategory(skill: OpenClawSkill): string {
  switch (skill.source) {
    case "builtin":
      return "Built-in"
    case "workspace":
      return "Workspace"
    case "clawhub":
      return "ClawHub"
    case "plugin":
      return skill.pluginId ? `Plugin: ${skill.pluginId}` : "Plugin"
    default:
      return "Unknown"
  }
}

/**
 * Get tags from skill metadata
 */
function getSkillTags(skill: OpenClawSkill): string[] {
  const tags: string[] = []

  // Add OS requirements as tags
  const os = skill.metadata?.openclaw?.os
  if (os && os.length > 0) {
    tags.push(...os.map((o) => o === "darwin" ? "macOS" : o === "linux" ? "Linux" : "Windows"))
  }

  // Add special flags as tags
  if (skill.metadata?.openclaw?.always) {
    tags.push("Always Active")
  }
  if (skill.userInvocable) {
    tags.push("User Invocable")
  }
  if (skill.disableModelInvocation) {
    tags.push("Manual Only")
  }
  if (skill.commandDispatch === "tool") {
    tags.push("Tool Command")
  }

  return tags
}

/**
 * Delete confirmation dialog
 */
function DeleteConfirmDialog({
  open,
  onOpenChange,
  skillName,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skillName: string
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete Skill</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{skillName}</strong>? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SkillDetailDialog({
  open,
  onOpenChange,
  skill,
}: SkillDetailDialogProps) {
  const enableSkill = useSkillStore((s) => s.enableSkill)
  const disableSkill = useSkillStore((s) => s.disableSkill)
  const removeSkill = useSkillStore((s) => s.removeSkill)

  const [isEditing, setIsEditing] = useState(false)
  const [editedInstructions, setEditedInstructions] = useState("")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleToggleEnabled = useCallback(() => {
    if (!skill) return
    if (skill.enabled) {
      disableSkill(skill.name)
    } else {
      enableSkill(skill.name)
    }
  }, [skill, enableSkill, disableSkill])

  const handleStartEdit = useCallback(() => {
    if (!skill) return
    setEditedInstructions(skill.instructions)
    setIsEditing(true)
  }, [skill])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditedInstructions("")
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (!skill) return
    // Note: In a real implementation, this would call an API to update the skill
    // For now, we'll just close the edit mode
    // The skill store would need an updateSkillInstructions method
    console.log("Save skill instructions:", editedInstructions)
    setIsEditing(false)
  }, [skill, editedInstructions])

  const handleDelete = useCallback(() => {
    if (!skill) return
    removeSkill(skill.name)
    onOpenChange(false)
  }, [skill, removeSkill, onOpenChange])

  if (!skill) return null

  const category = getSkillCategory(skill)
  const tags = getSkillTags(skill)
  const hasHomepage = !!skill.homepage

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="flex-1 min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  {skill.metadata?.openclaw?.emoji && (
                    <span className="text-lg">{skill.metadata.openclaw.emoji}</span>
                  )}
                  <span className="truncate">{skill.name}</span>
                </DialogTitle>
                {skill.description && (
                  <DialogDescription className="mt-1">
                    {skill.description}
                  </DialogDescription>
                )}
              </div>
            </div>

            {/* Metadata row: category, tags */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Badge variant="outline" className="text-xs">
                {category}
              </Badge>
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs"
                >
                  {tag}
                </Badge>
              ))}
              {hasHomepage && (
                <a
                  href={skill.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-info hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Homepage
                </a>
              )}
            </div>
          </DialogHeader>

          {/* Enable/Disable toggle */}
          <div className="flex items-center justify-between py-3 px-1 border-y border-border shrink-0">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Enable Skill</span>
              <span className="text-xs text-muted-foreground">
                {skill.enabled
                  ? "Skill is active and will be injected into agent prompts"
                  : "Skill is disabled and won't be used"}
              </span>
            </div>
            <Switch
              checked={skill.enabled}
              onCheckedChange={handleToggleEnabled}
            />
          </div>

          {/* Instructions section */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h3 className="text-sm font-medium">Instructions</h3>
              {!isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={handleStartEdit}
                >
                  <Edit2 className="h-3 w-3" />
                  Edit
                </Button>
              )}
            </div>

            {isEditing ? (
              <div className="flex-1 flex flex-col gap-2 min-h-0">
                <Textarea
                  value={editedInstructions}
                  onChange={(e) => setEditedInstructions(e.target.value)}
                  className="flex-1 min-h-[200px] font-mono text-xs resize-none"
                  placeholder="Enter skill instructions in markdown..."
                />
                <div className="flex justify-end gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={handleCancelEdit}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1"
                    onClick={handleSaveEdit}
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-4">
                {skill.instructions ? (
                  <MarkdownRenderer
                    content={skill.instructions}
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No instructions provided.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer with delete button */}
          <DialogFooter className="shrink-0 pt-4 border-t border-border sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10",
                skill.source === "builtin" && "opacity-50 cursor-not-allowed"
              )}
              disabled={skill.source === "builtin"}
              onClick={() => setShowDeleteConfirm(true)}
              title={skill.source === "builtin" ? "Built-in skills cannot be deleted" : "Delete this skill"}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Skill
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        skillName={skill.name}
        onConfirm={handleDelete}
      />
    </>
  )
}
