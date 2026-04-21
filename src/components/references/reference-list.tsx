/**
 * Reference list — shows all references for a project with add/import actions.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  Plus,
  Search,
  FileText,
  BookOpen,
  Loader2,
  Globe,
  Download,
  Trash2,
  CheckSquare,
  Square,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  X,
  PenLine,
  Link2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Reference } from '@/types'
import { ReferenceDetail } from './reference-detail'
import { fetchDoiMetadata, resolveDoiPdf } from '@/lib/pdf-resolver'
import { downloadPdfForReference } from '@/lib/pdf-downloader'
import { isDesktop } from '@/lib/desktop-detect'

// ── Props ────────────────────────────────────────────────────────────

interface ReferenceListProps {
  references: Reference[]
  onUpdateReference?: (id: string, updates: Partial<Reference>) => void
  onAddReference?: (reference: Reference) => void
  onDeleteReference?: (id: string) => void
  className?: string
}

// ── Hover tooltip for truncated cells ────────────────────────────────

function Cell({ text, className }: { text: string; className?: string }) {
  const [hovered, setHovered] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const ref = useRef<HTMLTableCellElement>(null)

  const onEnter = useCallback(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) })
    setHovered(true)
  }, [])

  return (
    <td
      ref={ref}
      className={cn('px-3 py-2 max-w-0', className)}
      onMouseEnter={onEnter}
      onMouseLeave={() => setHovered(false)}
    >
      <p className="truncate text-xs">{text}</p>
      {hovered && text && (
        <div
          className="fixed z-50 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md text-popover-foreground whitespace-normal break-words pointer-events-none"
          style={{ top: pos.top, left: pos.left, maxWidth: Math.max(pos.width, 320) }}
        >
          {text}
        </div>
      )}
    </td>
  )
}

// ── Component ────────────────────────────────────────────────────────

export function ReferenceList({
  references,
  onUpdateReference,
  onAddReference,
  onDeleteReference,
  className,
}: ReferenceListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showDoiInput, setShowDoiInput] = useState(false)
  const [doiInput, setDoiInput] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [sortCol, setSortCol] = useState<'title' | 'author' | 'year' | 'journal' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)

  // Close add dropdown on outside click
  useEffect(() => {
    if (!addOpen) return
    const handler = (e: MouseEvent) => {
      if (!addRef.current?.contains(e.target as Node)) setAddOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addOpen])

  const handleSort = useCallback((col: 'title' | 'author' | 'year' | 'journal') => {
    setSortCol(prev => { if (prev !== col) setSortDir('asc'); return col })
    setSortDir(prev => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'asc')
  }, [sortCol])

  const filtered = useMemo(() => {
    if (!search.trim()) return references
    const q = search.toLowerCase()
    return references.filter(r =>
      r.title?.toLowerCase().includes(q) ||
      r.authors?.some(a => a.toLowerCase().includes(q)) ||
      String(r.year).includes(q) ||
      r.journal?.toLowerCase().includes(q) ||
      r.venue?.toLowerCase().includes(q)
    )
  }, [references, search])

  const sorted = useMemo(() => {
    if (!sortCol) return filtered
    return [...filtered].sort((a, b) => {
      let av = '', bv = ''
      if (sortCol === 'title') { av = a.title ?? ''; bv = b.title ?? '' }
      else if (sortCol === 'author') { av = a.authors?.[0] ?? ''; bv = b.authors?.[0] ?? '' }
      else if (sortCol === 'year') { av = String(a.year ?? 0); bv = String(b.year ?? 0) }
      else if (sortCol === 'journal') { av = a.journal ?? a.venue ?? ''; bv = b.journal ?? b.venue ?? '' }
      const cmp = sortCol === 'year'
        ? Number(av) - Number(bv)
        : av.localeCompare(bv, undefined, { sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortCol, sortDir])

  const allChecked = sorted.length > 0 && sorted.every(r => checked.has(r.id))

  const toggleCheckAll = useCallback(() => {
    setChecked(allChecked ? new Set() : new Set(sorted.map(r => r.id)))
  }, [allChecked, sorted])

  const toggleCheck = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setChecked(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id) } else { n.add(id) } return n })
  }, [])

  const handleDeleteChecked = useCallback(async () => {
    if (!onDeleteReference || checked.size === 0) return
    setDeleting(true)
    for (const id of checked) {
      try { onDeleteReference(id) } catch { /* continue */ }
    }
    setChecked(new Set())
    if (checked.has(selectedId ?? '')) setSelectedId(null)
    setDeleting(false)
  }, [checked, onDeleteReference, selectedId])

  const handleImportDoi = useCallback(async () => {
    if (!doiInput.trim()) return
    setImporting(true)
    setImportError(null)
    try {
      const metadata = await fetchDoiMetadata(doiInput.trim())
      if (!metadata) { setImportError('Could not resolve DOI. Check the identifier and try again.'); return }
      const newRef: Reference = {
        id: crypto.randomUUID(),
        title: metadata.title ?? 'Untitled',
        authors: metadata.authors ?? [],
        year: metadata.year ?? 0,
        journal: metadata.journal,
        doi: metadata.doi,
        abstract: metadata.abstract,
        url: metadata.url,
        source: 'doi',
        addedAt: new Date().toISOString(),
      }
      if (metadata.doi) {
        const pdfResolution = await resolveDoiPdf(metadata.doi)
        if (pdfResolution.pdfUrl) {
          newRef.pdfUrl = pdfResolution.pdfUrl
          newRef.isOpenAccess = pdfResolution.isOa
          newRef.oaSource = pdfResolution.oaSource ?? undefined
          if (isDesktop()) {
            try { Object.assign(newRef, await downloadPdfForReference(newRef)) } catch { /* no pdf */ }
          }
        }
      }
      onAddReference?.(newRef)
      setDoiInput('')
      setShowDoiInput(false)
      setSelectedId(newRef.id)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [doiInput, onAddReference])

  const handleAddManual = useCallback(() => {
    const newRef: Reference = {
      id: crypto.randomUUID(),
      title: 'New Reference',
      authors: [],
      year: new Date().getFullYear(),
      source: 'manual',
      addedAt: new Date().toISOString(),
    }
    onAddReference?.(newRef)
    setSelectedId(newRef.id)
    setAddOpen(false)
  }, [onAddReference])

  const handleUpdateRef = useCallback(
    (updates: Partial<Reference>) => {
      if (selectedId) onUpdateReference?.(selectedId, updates)
    },
    [selectedId, onUpdateReference],
  )

  const cols = [
    { col: 'title', label: 'Title', cls: '' },
    { col: 'author', label: 'Author', cls: 'w-[15%]' },
    { col: 'year', label: 'Year', cls: 'w-[6%]' },
    { col: 'journal', label: 'Journal / Venue', cls: 'w-[15%]' },
  ] as { col: 'title' | 'author' | 'year' | 'journal'; label: string; cls: string }[]

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5 shrink-0">
          <BookOpen className="h-4 w-4" />
          References
          <span className="text-muted-foreground font-normal">({references.length})</span>
        </h2>

        <div className="flex items-center gap-1">
          {/* Inline search */}
          {showSearch ? (
            <div className="flex items-center gap-1 border rounded-md px-2 bg-background h-7">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-36 text-xs bg-transparent outline-none"
                onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); setShowSearch(false) } }}
              />
              <button onClick={() => { setSearch(''); setShowSearch(false) }}>
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowSearch(true)} title="Search">
              <Search className="h-3.5 w-3.5" />
            </Button>
          )}

          {checked.size > 0 ? (
            <Button variant="destructive" size="sm" onClick={handleDeleteChecked} disabled={deleting} className="h-7 gap-1">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete {checked.size}
            </Button>
          ) : (
            /* Add dropdown */
            <div ref={addRef} className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1"
                onClick={() => setAddOpen(o => !o)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
              {addOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border bg-popover shadow-md py-1">
                  <button
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                    onClick={() => { setShowDoiInput(true); setAddOpen(false) }}
                  >
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Add by DOI
                  </button>
                  <button
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                    onClick={handleAddManual}
                  >
                    <PenLine className="h-3.5 w-3.5 text-muted-foreground" />
                    Add manually
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* DOI Import Input */}
      {showDoiInput && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Enter DOI (e.g., 10.1038/s41586-024-07487-w)"
              value={doiInput}
              onChange={(e) => setDoiInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleImportDoi()}
              className="flex-1 bg-background border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
            <Button size="sm" onClick={handleImportDoi} disabled={importing || !doiInput.trim()}>
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Import'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowDoiInput(false); setDoiInput(''); setImportError(null) }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {importError && <p className="text-xs text-destructive">{importError}</p>}
        </div>
      )}

      {/* Reference Table */}
      {references.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <FileText className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">No references yet</p>
          <p className="text-xs">Add papers by DOI or manually</p>
        </div>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="w-8 px-3 py-2 text-left">
                  <button onClick={toggleCheckAll} className="flex items-center">
                    {allChecked
                      ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                      : <Square className="h-3.5 w-3.5" />}
                  </button>
                </th>
                {cols.map(({ col, label, cls }) => (
                  <th
                    key={col}
                    className={cn('px-3 py-2 text-left font-medium select-none cursor-pointer hover:text-foreground transition-colors', cls)}
                    onClick={() => handleSort(col)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortCol === col
                        ? sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                        : <ChevronsUpDown className="h-3 w-3 opacity-30" />}
                    </span>
                  </th>
                ))}
                {/* badges col */}
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((ref) => (
                <React.Fragment key={ref.id}>
                  <tr
                    className={cn(
                      'group border-b last:border-0 cursor-pointer transition-colors',
                      checked.has(ref.id) ? 'bg-primary/5' : selectedId === ref.id ? 'bg-muted' : 'hover:bg-muted/50',
                    )}
                    onClick={() => setSelectedId(selectedId === ref.id ? null : ref.id)}
                  >
                    <td className="px-3 py-2 w-8" onClick={e => toggleCheck(ref.id, e)}>
                      {checked.has(ref.id)
                        ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                        : <Square className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />}
                    </td>
                    <Cell text={ref.title ?? '—'} className="font-medium" />
                    <Cell text={ref.authors?.[0] ? `${ref.authors[0]}${ref.authors.length > 1 ? ' et al.' : ''}` : '—'} className="text-muted-foreground" />
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {ref.year || '—'}
                    </td>
                    <Cell text={ref.journal ?? ref.venue ?? '—'} className="text-muted-foreground" />
                    <td className="px-2 py-2 w-16">
                      <div className="flex items-center gap-1">
                        {ref.isOpenAccess && <Globe className="h-3 w-3 text-green-600 dark:text-green-400" />}
                        {ref.pdfDownloaded
                          ? <FileText className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                          : ref.pdfUrl ? <Download className="h-3 w-3 text-muted-foreground" /> : null}
                      </div>
                    </td>
                  </tr>
                  {selectedId === ref.id && (
                    <tr className="bg-muted/30">
                      <td colSpan={7} className="px-4 py-3 border-b last:border-0">
                        <ReferenceDetail
                          reference={ref}
                          onUpdate={handleUpdateRef}
                          onDelete={() => { onDeleteReference?.(ref.id); setSelectedId(null) }}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && search && (
            <div className="py-8 text-center text-xs text-muted-foreground">No results for "{search}"</div>
          )}
        </div>
      )}
    </div>
  )
}
