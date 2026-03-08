import { useState, useEffect, useRef } from "react"
import { FileText, Check, Loader2, Eye, Pencil } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { useProjectStore } from "@/stores/project-store"
import { useActivityStore } from "@/stores/activity-store"
import type { Project } from "@/types"

function VisionDocEditor({ project }: { project: Project }) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const addActivity = useActivityStore((s) => s.addActivity)
  const [draft, setDraft] = useState(project.visionDoc ?? "")
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  // Default to preview mode when there is existing content
  const [isPreview, setIsPreview] = useState(!!project.visionDoc)
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
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        {/* Toolbar: preview/edit toggle + save status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
            <button
              onClick={() => setIsPreview(false)}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                !isPreview
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
            <button
              onClick={() => setIsPreview(true)}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                isPreview
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="h-3 w-3" />
              Preview
            </button>
          </div>
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

        {isPreview ? (
          <div
            className="flex-1 min-h-[300px] overflow-auto rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed cursor-text"
            onClick={() => setIsPreview(false)}
            title="Click to edit"
          >
            {draft ? (
              <MarkdownRenderer content={draft} />
            ) : (
              <span className="text-muted-foreground">
                No content yet. Click to add skill context...
              </span>
            )}
          </div>
        ) : (
          <textarea
            className="flex-1 min-h-[300px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            placeholder="Define the skill context, product vision, research question, or project context here. This will be provided to all agents working on this project..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            // Switch to preview on Cmd/Ctrl+Enter
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                setIsPreview(true)
              }
            }}
            autoFocus
          />
        )}
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
