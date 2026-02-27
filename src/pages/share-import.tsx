import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router"
import { AlertTriangle, Loader2, Layers, GitBranch, FileDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { checkVersionCompatibility } from "@/lib/sharing/version"
import { importProject } from "@/lib/sharing/import-project"
import { apiUrl } from "@/lib/api-url"
import type { AstroExportBundle, ProjectExportData } from "@/lib/sharing/types"

export function ShareImport() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [bundle, setBundle] = useState<AstroExportBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    fetch(apiUrl(`/api/share/${id}`), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Shared project not found" : "Failed to load shared project")
        return res.json()
      })
      .then((data) => {
        if (data.$schema !== "astro-export") throw new Error("Invalid share link")
        setBundle(data as AstroExportBundle)
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load")
        }
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [id])

  const handleImport = () => {
    if (!bundle || bundle.type !== "project") return
    setImporting(true)
    try {
      const result = importProject(bundle.data as ProjectExportData)
      if (result.success && result.projectId) {
        navigate(`/project/${result.projectId}/graph`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed")
      setImporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading shared project...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <AlertTriangle className="h-8 w-8 text-warning" />
          <div>
            <h2 className="text-lg font-semibold mb-1">Could not load share</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/projects")}>
            Go to Projects
          </Button>
        </div>
      </div>
    )
  }

  if (!bundle) return null

  const { compatible, warnings } = checkVersionCompatibility(bundle)
  const isProject = bundle.type === "project"
  const projectData = isProject ? (bundle.data as ProjectExportData) : null
  const nodeCount = projectData?.nodes.length ?? 0
  const edgeCount = projectData?.edges.length ?? 0

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col gap-6 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            Shared Project
          </h1>
          <p className="text-sm text-muted-foreground">
            Someone shared a project plan with you. Import it to get started.
          </p>
        </div>

        {/* Bundle preview */}
        <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-medium">{bundle.name}</span>
          </div>
          {bundle.description && (
            <p className="text-sm text-muted-foreground">{bundle.description}</p>
          )}
          {isProject && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                {nodeCount} task{nodeCount !== 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                {edgeCount} edge{edgeCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Shared {new Date(bundle.exportedAt).toLocaleDateString()}
          </div>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="flex flex-col gap-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleImport}
            disabled={!compatible || importing || !isProject}
            className="flex-1"
          >
            {importing ? "Importing..." : "Import Project"}
          </Button>
          <Button variant="outline" onClick={() => navigate("/projects")}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
