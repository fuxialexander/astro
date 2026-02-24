import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, FileDown, Layers, GitBranch } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { checkVersionCompatibility } from '@/lib/sharing/version'
import { importProject } from '@/lib/sharing/import-project'
import { importWorkspaceConfig } from '@/lib/sharing/import-config'
import type { AstroExportBundle, ProjectExportData, WorkspaceConfigExportData } from '@/lib/sharing/types'

interface ImportPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bundle: AstroExportBundle | null
}

export function ImportPreviewDialog({ open, onOpenChange, bundle }: ImportPreviewDialogProps) {
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!bundle) return null

  const { compatible, warnings: versionWarnings } = checkVersionCompatibility(bundle)

  const isProject = bundle.type === 'project'
  const projectData = isProject ? (bundle.data as ProjectExportData) : null
  const nodeCount = projectData?.nodes.length ?? 0
  const edgeCount = projectData?.edges.length ?? 0

  const handleImport = async () => {
    setImporting(true)
    setError(null)
    try {
      if (bundle.type === 'project') {
        const result = importProject(bundle.data as ProjectExportData)
        if (result.success && result.projectId) {
          onOpenChange(false)
          navigate(`/project/${result.projectId}/graph`)
        }
      } else if (bundle.type === 'workspace-config') {
        importWorkspaceConfig(bundle.data as WorkspaceConfigExportData)
        onOpenChange(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            Import {isProject ? 'Project' : 'Configuration'}
          </DialogTitle>
          <DialogDescription>
            Review the contents before importing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Bundle info */}
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{bundle.name}</span>
              <Badge variant="secondary">{bundle.type}</Badge>
            </div>
            {bundle.description && (
              <p className="text-sm text-muted-foreground">{bundle.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Exported {new Date(bundle.exportedAt).toLocaleDateString()}</span>
              <span>v{bundle.version}</span>
            </div>
          </div>

          {/* Project stats */}
          {isProject && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Layers className="h-4 w-4" />
                {nodeCount} node{nodeCount !== 1 ? 's' : ''}
              </div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <GitBranch className="h-4 w-4" />
                {edgeCount} edge{edgeCount !== 1 ? 's' : ''}
              </div>
            </div>
          )}

          {/* Warnings */}
          {versionWarnings.length > 0 && (
            <div className="flex flex-col gap-1">
              {versionWarnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!compatible || importing}>
            {importing ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
