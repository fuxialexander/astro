import { useState, useEffect, useRef, useCallback } from 'react'
import { BookOpen, Upload, Database, Plus, FileText, ChevronRight, Loader2, X, Download } from 'lucide-react'
import { downloadBibTeX } from '@/lib/export/download-bibtex'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/stores/project-store'
import { usePlanStore } from '@/stores/plan-store'
import { useReferenceStore } from '@/stores/reference-store'
import { useTeamStore } from '@/stores/team-store'
import { ReferenceList } from '@/components/references/reference-list'
import { Button } from '@/components/ui/button'
import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import type { Reference } from '@/types'

// ── Import Dialog ─────────────────────────────────────────────────────

type ImportMode = 'bibtex' | 'nbib' | 'zotero' | 'file'

interface ImportDialogProps {
  onClose: () => void
  onImported: (count: number) => void
}

function ImportDialog({ onClose, onImported }: ImportDialogProps) {
  const [mode, setMode] = useState<ImportMode>('bibtex')
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoteroStatus, setZoteroStatus] = useState<'idle' | 'detecting' | 'found' | 'notfound'>('idle')
  const [zoteroBibTeX, setZoteroBibTeX] = useState<string>('')
  const [zoteroCount, setZoteroCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { importBibTeX, importNBIB } = useReferenceStore()
  const desktop = isDesktop()

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const content = await file.text()
    if (file.name.endsWith('.bib')) {
      setMode('bibtex')
      setText(content)
    } else if (file.name.endsWith('.nbib') || file.name.endsWith('.txt')) {
      setMode('nbib')
      setText(content)
    }
    e.target.value = ''
  }, [])

  const handleImport = useCallback(async () => {
    setImporting(true)
    setError(null)
    try {
      let count = 0
      if (mode === 'bibtex') {
        count = await importBibTeX(text)
      } else if (mode === 'nbib') {
        count = await importNBIB(text)
      } else if (mode === 'zotero') {
        count = await importBibTeX(zoteroBibTeX)
      }
      onImported(count)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [mode, text, importBibTeX, importNBIB, zoteroBibTeX, onImported, onClose])

  const detectZotero = useCallback(async () => {
    if (!desktop) return
    setZoteroStatus('detecting')
    try {
      const result = await desktopBridge.invoke<{ found: boolean; bibtex?: string }>('zotero:scan', {})
      if (result.found && result.bibtex) {
        const count = (result.bibtex.match(/@\w+\{/g) ?? []).length
        setZoteroBibTeX(result.bibtex)
        setZoteroCount(count)
        setZoteroStatus('found')
      } else {
        setZoteroStatus('notfound')
      }
    } catch {
      setZoteroStatus('notfound')
    }
  }, [desktop])

  const canImport = (mode === 'bibtex' || mode === 'nbib') ? text.trim().length > 0 : mode === 'zotero' && zoteroBibTeX.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">Import References</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 px-5 pt-4">
          {([
            { id: 'bibtex', label: 'BibTeX', icon: FileText },
            { id: 'nbib', label: 'PubMed / NBIB', icon: FileText },
            ...(desktop ? [{ id: 'zotero', label: 'Zotero', icon: Database }] : []),
          ] as { id: ImportMode; label: string; icon: React.ComponentType<{ className?: string }> }[]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                mode === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
          <label className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors',
            'text-muted-foreground hover:bg-muted'
          )}>
            <Upload className="h-3.5 w-3.5" />
            Upload file
            <input ref={fileInputRef} type="file" accept=".bib,.nbib,.txt" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>

        {/* Content */}
        <div className="px-5 py-4 flex-1">
          {mode === 'bibtex' && (
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={'Paste your BibTeX here...\n\n@article{smith2024,\n  title = {Title},\n  author = {Smith, John},\n  journal = {Nature},\n  year = {2024},\n}'}
              className="w-full h-48 text-xs font-mono bg-muted/50 rounded-lg border p-3 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
            />
          )}
          {mode === 'nbib' && (
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={'Paste PubMed/NBIB export here...\n\nPMID- 12345678\nTI  - Title of paper\nAU  - Smith, John\nDP  - 2024 Jan\nER  -'}
              className="w-full h-48 text-xs font-mono bg-muted/50 rounded-lg border p-3 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
            />
          )}
          {mode === 'zotero' && (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              {zoteroStatus === 'idle' && (
                <>
                  <Database className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground text-center">
                    Detect your local Zotero library and import all references.
                  </p>
                  <Button size="sm" onClick={detectZotero}>
                    <Database className="h-3.5 w-3.5 mr-1.5" />
                    Detect Zotero Library
                  </Button>
                </>
              )}
              {zoteroStatus === 'detecting' && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning for Zotero database...
                </div>
              )}
              {zoteroStatus === 'found' && (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-medium">
                    <Database className="h-4 w-4" />
                    Found {zoteroCount} references in Zotero
                  </div>
                  <p className="text-xs text-muted-foreground">All will be imported to your library.</p>
                </div>
              )}
              {zoteroStatus === 'notfound' && (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm text-muted-foreground">Zotero library not found.</p>
                  <p className="text-xs text-muted-foreground/70 text-center">
                    Make sure Zotero is installed and has been opened at least once.
                  </p>
                  <Button size="sm" variant="outline" onClick={detectZotero}>Try again</Button>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-3 text-xs text-destructive">{error}</p>}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t bg-muted/20">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleImport} disabled={!canImport || importing}>
            {importing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Import
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main References Page ──────────────────────────────────────────────

export function References() {
  const projects = useProjectStore((s) => s.projects)
  const nodes = usePlanStore((s) => s.nodes)
  const {
    library,
    loaded,
    loadLibrary,
    getReferencesForProject,
    addReference,
    updateReference,
    removeReference,
  } = useReferenceStore()
  const activeTeamId = useTeamStore((s) => s.activeTeamId)

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Load library on mount / team change
  useEffect(() => {
    if (activeTeamId) {
      // Reset loaded state when team changes so library reloads
      useReferenceStore.setState({ loaded: false })
      void loadLibrary()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId])

  // Compute projects that have citations
  const projectsWithCitations = projects
    .map(p => ({
      project: p,
      refs: getReferencesForProject(p.id, nodes, p),
    }))
    .filter(({ refs }) => refs.length > 0)

  // Auto-select first project with citations
  useEffect(() => {
    if (!selectedProjectId && projectsWithCitations.length > 0) {
      setSelectedProjectId(projectsWithCitations[0].project.id)
    }
  }, [projectsWithCitations.length, selectedProjectId])

  const selectedProject = projects.find(p => p.id === selectedProjectId)
  const selectedRefs = selectedProject
    ? getReferencesForProject(selectedProject.id, nodes, selectedProject)
    : []

  const handleImported = useCallback((_count: number) => {
    // Reload library to pick up server-assigned IDs
    useReferenceStore.setState({ loaded: false })
    void useReferenceStore.getState().loadLibrary()
  }, [])

  // Adapter: ReferenceList calls onUpdateReference(id, updates: Partial<Reference>)
  // but our store's updateReference takes a full Reference object.
  const handleUpdate = useCallback(async (id: string, updates: Partial<Reference>) => {
    const existing = useReferenceStore.getState().library.find(r => r.id === id)
    if (!existing) return
    await updateReference({ ...existing, ...updates })
  }, [updateReference])

  // Empty state: no references in library at all
  if (loaded && library.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <h3 className="text-sm font-semibold mb-1">Your reference library is empty</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Import papers from BibTeX, PubMed, or your Zotero library.
              Then cite them anywhere with{' '}
              <code className="bg-muted px-1 py-0.5 rounded text-[11px]">[@author2024]</code>{' '}
              in task descriptions or project notes.
            </p>
          </div>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import references
          </Button>
          <div className="w-full border rounded-lg p-3 text-left">
            <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Quick tips</p>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              <li className="flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
                Export from Zotero &rarr; File &rarr; Export Library &rarr; BibTeX
              </li>
              <li className="flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
                From PubMed search &rarr; Send to &rarr; File &rarr; Format: PubMed
              </li>
              <li className="flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
                Type <code className="bg-muted px-0.5 rounded">[@</code> in any editor to cite
              </li>
            </ul>
          </div>
        </div>
        {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={handleImported} />}
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar: projects with citations */}
      <aside className="w-56 shrink-0 border-r flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Projects
          </h2>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => void downloadBibTeX(selectedProjectId ?? undefined)}
              title={selectedProjectId ? 'Export project BibTeX' : 'Export all BibTeX'}
            >
              <Download className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setImportOpen(true)}
              title="Import references"
            >
              <Upload className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {/* "All" entry */}
          <button
            onClick={() => setSelectedProjectId(null)}
            className={cn(
              'w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/50',
              !selectedProjectId ? 'bg-muted font-medium' : 'text-muted-foreground',
            )}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">All references</span>
            <span className="text-[10px] text-muted-foreground">{library.length}</span>
          </button>

          {projectsWithCitations.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground italic">
              No citations yet &mdash; type{' '}
              <code className="bg-muted px-0.5 rounded">[@</code> in any editor
            </p>
          ) : (
            projectsWithCitations.map(({ project, refs }) => (
              <button
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/50',
                  selectedProjectId === project.id ? 'bg-muted font-medium' : 'text-muted-foreground',
                )}
              >
                <span className="flex-1 truncate">{project.name ?? 'Untitled'}</span>
                <span className="text-[10px] text-muted-foreground">{refs.length}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main panel */}
      <main className="flex-1 overflow-y-auto">
        <div className="px-6 py-4">
          {selectedProjectId === null ? (
            // All references view
            <ReferenceList
              references={library}
              onAddReference={addReference}
              onUpdateReference={handleUpdate}
              onDeleteReference={removeReference}
            />
          ) : selectedProject ? (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-medium">
                  Citations in <span className="font-semibold">{selectedProject.name}</span>
                </h3>
                <span className="text-xs text-muted-foreground">
                  {selectedRefs.length} reference{selectedRefs.length !== 1 ? 's' : ''}
                </span>
              </div>
              {selectedRefs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <BookOpen className="h-6 w-6 opacity-30" />
                  <p className="text-sm">No citations in this project yet</p>
                  <p className="text-xs opacity-70">
                    Type <code className="bg-muted px-1 rounded">[@</code> in a task description or project notes to cite a reference
                  </p>
                </div>
              ) : (
                <ReferenceList
                  references={selectedRefs}
                  onAddReference={addReference}
                  onUpdateReference={handleUpdate}
                  onDeleteReference={removeReference}
                />
              )}
            </div>
          ) : null}
        </div>
      </main>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={handleImported} />}
    </div>
  )
}
