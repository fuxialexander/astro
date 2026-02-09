import { useState, useCallback } from "react"
import { FolderGit2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useProjectStore } from "@/stores/project-store"
import type { Project } from "@/types"

export function RepoConfigDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
}) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const [repoUrl, setRepoUrl] = useState(project.repository ?? "")
  const [workDir, setWorkDir] = useState(project.workingDirectory ?? "")
  const [saved, setSaved] = useState(false)

  const handleSave = useCallback(() => {
    updateProject(project.id, {
      repository: repoUrl.trim() || undefined,
      workingDirectory: workDir.trim() || undefined,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }, [updateProject, project.id, repoUrl, workDir])

  const hasChanges =
    repoUrl !== (project.repository ?? "") ||
    workDir !== (project.workingDirectory ?? "")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4" />
            Repository & Directory
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            At least one is required for task execution. Local directory takes priority over repository URL.
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Repository URL</label>
            <input
              type="text"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="https://github.com/user/repo.git"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value)
                setSaved(false)
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Local Working Directory</label>
            <input
              type="text"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="/path/to/project"
              value={workDir}
              onChange={(e) => {
                setWorkDir(e.target.value)
                setSaved(false)
              }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {saved ? "Saved" : hasChanges ? "Unsaved changes" : ""}
          </span>
          <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
