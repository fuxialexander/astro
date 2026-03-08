import { useState, useCallback, useRef, useMemo } from "react"
import { FileText, Check, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RichTextEditor, type RichTextEditorRef } from "@/components/ui/rich-text-editor"
import { useProjectStore } from "@/stores/project-store"
import { useActivityStore } from "@/stores/activity-store"
import { resolveEditorContent } from "@/lib/html-utils"
import type { Project } from "@/types"

function VisionDocEditor({ project }: { project: Project }) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const addActivity = useActivityStore((s) => s.addActivity)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const editorRef = useRef<RichTextEditorRef>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Convert stored markdown → HTML for TipTap (same pattern as task-content-tab)
  const initialContent = useMemo(
    () => resolveEditorContent(project.visionDoc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id]
  )

  const handleChange = useCallback(() => {
    const markdown = editorRef.current?.getMarkdown() ?? ""

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSaveStatus("saving")
      updateProject(project.id, { visionDoc: markdown })
      addActivity({
        projectId: project.id,
        type: "vision.updated",
        title: "Updated skill.md",
        description: markdown.slice(0, 100) + (markdown.length > 100 ? "..." : ""),
      })
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus("idle"), 1500)
    }, 800)
  }, [project.id, updateProject, addActivity])

  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0">
      {/* Save status indicator */}
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

      <RichTextEditor
        ref={editorRef}
        content={initialContent}
        onChange={handleChange}
        placeholder="Define the skill context, product vision, research question, or project context here. This will be provided to all agents working on this project..."
        className="flex-1 min-h-[300px]"
      />
    </div>
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
