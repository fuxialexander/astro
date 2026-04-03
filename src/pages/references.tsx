import { useEffect } from "react"
import { BookOpen } from "lucide-react"
import { useProjectStore } from "@/stores/project-store"
import { useReferenceStore } from "@/stores/reference-store"
import { ReferenceBrowser } from "@/components/references/ReferenceBrowser"

/**
 * Top-level References page.
 *
 * If the user has a single active project, it shows that project's references.
 * Otherwise it shows a project selector (simplified for now — uses the first project).
 */
export function References() {
  const projects = useProjectStore((s) => s.projects)
  const loaded = useReferenceStore((s) => s.loaded)
  const load = useReferenceStore((s) => s.load)

  // Pick the first project as default context
  const activeProject = projects[0]

  useEffect(() => {
    if (activeProject && !loaded) {
      load(activeProject.id)
    }
  }, [activeProject, loaded, load])

  if (!activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
        <BookOpen className="h-10 w-10" />
        <p className="text-sm font-medium">No projects yet</p>
        <p className="text-xs">Create a project first to start managing references.</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <ReferenceBrowser projectId={activeProject.id} />
    </div>
  )
}
