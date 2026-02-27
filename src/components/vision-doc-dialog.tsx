import { useState, useEffect, useRef } from "react"
import { FileText, Check, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useProjectStore } from "@/stores/project-store"
import { useActivityStore } from "@/stores/activity-store"
import type { Project } from "@/types"

function VisionDocEditor({ project }: { project: Project }) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const addActivity = useActivityStore((s) => s.addActivity)
  const [draft, setDraft] = useState(project.visionDoc ?? "")
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced autosave
  useEffect(() => {
    const current = project.visionDoc ?? ""
    if (draft === current) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSaveStatus("saving")
      updateProject(project.id, { visionDoc: draft })
      addActivity({
        projectId: project.id,
        type: "vision.updated",
        title: "Updated skill.md",
        description: draft.slice(0, 100) + (draft.length > 100 ? "..." : ""),
      })
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus("idle"), 1500)
    }, 800)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [draft, project.id, project.visionDoc, updateProject, addActivity])

  return (
    <>
      <div className="flex-1 flex flex-col">
        <textarea
          className="flex-1 min-h-[300px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          placeholder="Define the skill context, product vision, research question, or project context here. This will be provided to all agents working on this project..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-end">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <Check className="h-3 w-3" />
              Saved
            </>
          )}
        </span>
      </div>
    </>
  )
}

export function VisionDocDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            skill.md
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Define the skill context for agents. This is injected into every agent session as context.
          </p>
        </DialogHeader>
        {open && <VisionDocEditor project={project} />}
      </DialogContent>
    </Dialog>
  )
}
