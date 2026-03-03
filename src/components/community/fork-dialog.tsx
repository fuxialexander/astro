/**
 * Fork Plan Dialog
 *
 * Allows users to fork a community plan into a new project.
 * Includes options for project name and optional working directory.
 */

import { useState, useEffect } from "react"
import { useNavigate } from "react-router"
import { GitFork, Loader2, FolderOpen, Info } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCommunityStore } from "@/stores/community-store"
import { useToastStore } from "@/stores/toast-store"

interface ForkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  planTitle: string
  taskCount: number
}

export function ForkDialog({
  open,
  onOpenChange,
  planId,
  planTitle,
  taskCount,
}: ForkDialogProps) {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form state
  const [projectName, setProjectName] = useState("")
  const [workDir, setWorkDir] = useState("")

  const forkPlan = useCommunityStore((s) => s.forkPlan)
  const addToast = useToastStore((s) => s.add)

  // Initialize form with default project name when dialog opens
  useEffect(() => {
    if (open) {
      setProjectName(`Fork of ${planTitle}`)
      setWorkDir("")
    }
  }, [open, planTitle])

  const handleSubmit = async () => {
    if (!projectName.trim()) {
      addToast({
        type: "error",
        title: "Project name required",
        description: "Please enter a name for your new project",
      })
      return
    }

    setIsSubmitting(true)

    try {
      // Fork the plan and get the new project ID
      const newProjectId = await forkPlan(
        planId,
        projectName.trim(),
        workDir.trim() || undefined
      )

      addToast({
        type: "success",
        title: "Plan forked successfully",
        description: `"${projectName}" has been created from the community plan`,
      })

      // Close dialog and navigate to the new project
      onOpenChange(false)
      navigate(`/project/${newProjectId}/graph`)
    } catch (error) {
      addToast({
        type: "error",
        title: "Failed to fork plan",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit = projectName.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <GitFork className="h-4 w-4 text-primary-foreground" />
            </div>
            <DialogTitle>Create a new project from this plan</DialogTitle>
          </div>
          <DialogDescription>
            Fork this community plan to create your own customizable project.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Project Name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="projectName">
              Project Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="projectName"
              placeholder="e.g., My Forked Project"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit && !isSubmitting) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
          </div>

          {/* Working Directory */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="workDir">Working Directory (optional)</Label>
            <div className="relative">
              <Input
                id="workDir"
                placeholder="/path/to/project"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                className="pr-10"
              />
              <FolderOpen className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
            <p className="text-xs text-muted-foreground">
              Optionally specify a local directory for this project.
            </p>
          </div>

          {/* Info text */}
          <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              This plan has <span className="font-medium text-foreground">{taskCount} task{taskCount !== 1 ? "s" : ""}</span>.
              Customizable fields are highlighted after forking.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !canSubmit}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <GitFork className="h-4 w-4 mr-2" />
                Create Project
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
