/**
 * Reference Manager — panel for adding/managing bibliographic references.
 *
 * Used in project settings or as a sidebar panel. Supports:
 * - Manual reference entry
 * - BibTeX import (paste)
 * - Reference list with search
 * - Citation style selection
 */

import { useState, useCallback, useMemo } from 'react'
import { BookOpen, Plus, Upload, Trash2, Search, X, Settings2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useReferenceStore } from '@/stores/reference-store'
import { CITATION_STYLES, type CitationStyle } from '@/lib/citation/types'
import { useToastStore } from '@/stores/toast-store'

interface ReferenceManagerProps {
  projectId: string
  className?: string
}

export function ReferenceManager({ projectId, className }: ReferenceManagerProps) {
  const {
    getReferences,
    searchReferences,
    addReference,
    removeReference,
    importBibTeX,
    citationStyle,
    setCitationStyle,
  } = useReferenceStore()

  const references = getReferences(projectId)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [showBibTeX, setShowBibTeX] = useState(false)
  const [bibtexInput, setBibtexInput] = useState('')

  // Add form state
  const [newRef, setNewRef] = useState({
    id: '',
    title: '',
    authors: '',
    year: new Date().getFullYear(),
    venue: '',
    doi: '',
    url: '',
    abstract: '',
  })

  const filteredRefs = useMemo(() => {
    if (!searchQuery.trim()) return references
    return searchReferences(projectId, searchQuery)
  }, [references, searchQuery, projectId, searchReferences])

  const handleAddReference = useCallback(async () => {
    if (!newRef.title.trim() || !newRef.authors.trim()) {
      useToastStore.getState().add({ type: 'error', title: 'Missing fields', description: 'Title and authors are required' })
      return
    }

    const authors = newRef.authors.split(/\s*,\s*and\s+|\s*,\s*/).map(a => a.trim()).filter(Boolean)
    // Auto-generate cite key if not provided
    const firstAuthor = authors[0]?.split(' ').pop()?.toLowerCase() || 'unknown'
    const id = newRef.id.trim() || `${firstAuthor}${newRef.year}`

    try {
      await addReference(projectId, {
        id,
        title: newRef.title.trim(),
        authors,
        year: newRef.year,
        venue: newRef.venue.trim() || undefined,
        doi: newRef.doi.trim() || undefined,
        url: newRef.url.trim() || undefined,
        abstract: newRef.abstract.trim() || undefined,
      })
      setShowAddForm(false)
      setNewRef({ id: '', title: '', authors: '', year: new Date().getFullYear(), venue: '', doi: '', url: '', abstract: '' })
      useToastStore.getState().add({ type: 'success', title: 'Reference added', description: `[@${id}] added` })
    } catch (err) {
      useToastStore.getState().add({ type: 'error', title: 'Failed', description: err instanceof Error ? err.message : 'Failed to add reference' })
    }
  }, [projectId, newRef, addReference])

  const handleImportBibTeX = useCallback(async () => {
    if (!bibtexInput.trim()) return
    try {
      const count = await importBibTeX(projectId, bibtexInput)
      useToastStore.getState().add({ type: 'success', title: 'Imported', description: `${count} reference${count !== 1 ? 's' : ''} imported` })
      setBibtexInput('')
      setShowBibTeX(false)
    } catch (err) {
      useToastStore.getState().add({ type: 'error', title: 'Import failed', description: err instanceof Error ? err.message : 'Failed to import BibTeX' })
    }
  }, [projectId, bibtexInput, importBibTeX])

  const handleDelete = useCallback(async (citeKey: string) => {
    try {
      await removeReference(projectId, citeKey)
      useToastStore.getState().add({ type: 'success', title: 'Removed', description: `[@${citeKey}] removed` })
    } catch {
      useToastStore.getState().add({ type: 'error', title: 'Failed', description: 'Failed to remove reference' })
    }
  }, [projectId, removeReference])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">References</h3>
          <span className="text-xs text-muted-foreground">({references.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => { setShowAddForm(!showAddForm); setShowBibTeX(false) }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => { setShowBibTeX(!showBibTeX); setShowAddForm(false) }}
          >
            <Upload className="h-3 w-3 mr-1" />
            BibTeX
          </Button>
        </div>
      </div>

      {/* Citation Style Selector */}
      <div className="flex items-center gap-2">
        <Settings2 className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Style:</span>
        <select
          value={citationStyle}
          onChange={(e) => setCitationStyle(e.target.value as CitationStyle)}
          className="h-6 rounded border border-border bg-background px-1.5 text-[10px]"
        >
          {CITATION_STYLES.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
          <div className="text-xs font-medium">Add Reference</div>
          <input
            placeholder="Cite key (auto-generated if empty)"
            value={newRef.id}
            onChange={(e) => setNewRef(prev => ({ ...prev, id: e.target.value }))}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
          />
          <input
            placeholder="Title *"
            value={newRef.title}
            onChange={(e) => setNewRef(prev => ({ ...prev, title: e.target.value }))}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
          />
          <input
            placeholder="Authors * (comma-separated)"
            value={newRef.authors}
            onChange={(e) => setNewRef(prev => ({ ...prev, authors: e.target.value }))}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Year"
              value={newRef.year}
              onChange={(e) => setNewRef(prev => ({ ...prev, year: parseInt(e.target.value) || 0 }))}
              className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
            />
            <input
              placeholder="Venue/Journal"
              value={newRef.venue}
              onChange={(e) => setNewRef(prev => ({ ...prev, venue: e.target.value }))}
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
            />
          </div>
          <input
            placeholder="DOI"
            value={newRef.doi}
            onChange={(e) => setNewRef(prev => ({ ...prev, doi: e.target.value }))}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 text-xs" onClick={handleAddReference}>
              Add Reference
            </Button>
          </div>
        </div>
      )}

      {/* BibTeX Import */}
      {showBibTeX && (
        <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
          <div className="text-xs font-medium">Import BibTeX</div>
          <textarea
            placeholder="Paste BibTeX entries here..."
            value={bibtexInput}
            onChange={(e) => setBibtexInput(e.target.value)}
            rows={6}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowBibTeX(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 text-xs" onClick={handleImportBibTeX}>
              Import
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      {references.length > 3 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            placeholder="Search references..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded border border-border bg-background pl-7 pr-7 py-1 text-xs"
          />
          {searchQuery && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setSearchQuery('')}
            >
              <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      )}

      {/* Reference List */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {filteredRefs.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            {references.length === 0
              ? 'No references yet. Add references to cite them in chat with [@key].'
              : 'No matching references.'}
          </div>
        ) : (
          filteredRefs.map(ref => (
            <div
              key={ref.id}
              className="group flex items-start gap-2 rounded-md border border-border/50 p-2 hover:border-border transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{ref.title}</div>
                <div className="text-[10px] text-muted-foreground">
                  {ref.authors.slice(0, 3).join(', ')}{ref.authors.length > 3 ? ' et al.' : ''} ({ref.year})
                </div>
                <div className="text-[10px] font-mono text-muted-foreground/60">@{ref.id}</div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {(ref.doi || ref.url) && (
                  <a
                    href={ref.doi ? `https://doi.org/${ref.doi}` : ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-0.5 rounded hover:bg-accent"
                    title="Open"
                  >
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                )}
                <button
                  className="p-0.5 rounded hover:bg-destructive/10"
                  onClick={() => handleDelete(ref.id)}
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
