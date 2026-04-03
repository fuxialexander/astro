import { useState, useMemo, useCallback } from "react"
import {
  Search, Plus, Upload, BookOpen, FileText, Globe, GraduationCap,
  ArrowUpDown, ChevronDown, Trash2, ExternalLink, SlidersHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { useReferenceStore } from "@/stores/reference-store"
import { cn } from "@/lib/utils"
import type { Reference, ReferenceType, ReferenceSource } from "@/types/reference"
import { ImportDialog } from "./ImportDialog"
import { LookupDialog } from "./LookupDialog"
import { ReferenceDetail } from "./ReferenceDetail"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<ReferenceType, typeof BookOpen> = {
  article: FileText,
  book: BookOpen,
  chapter: BookOpen,
  conference: GraduationCap,
  preprint: FileText,
  thesis: GraduationCap,
  report: FileText,
  webpage: Globe,
  dataset: FileText,
  software: FileText,
  other: FileText,
}

type SortField = 'title' | 'author' | 'year' | 'dateAdded'
type SortDir = 'asc' | 'desc'

interface FilterState {
  collection: string
  type: string
  source: string
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterPopover({
  filters,
  onUpdate,
  collections,
}: {
  filters: FilterState
  onUpdate: (f: Partial<FilterState>) => void
  collections: string[]
}) {
  const types: ReferenceType[] = ['article', 'book', 'chapter', 'conference', 'preprint', 'thesis', 'report', 'webpage', 'dataset', 'software', 'other']
  const sources: ReferenceSource[] = ['manual', 'doi', 'pmid', 'arxiv', 'url', 'bibtex', 'ris', 'zotero']

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0">
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Filter &amp; Display</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64">
        <div className="flex flex-col gap-3">
          {/* Collection filter */}
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Collection</span>
            <select
              value={filters.collection}
              onChange={(e) => onUpdate({ collection: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">All</option>
              {collections.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Type filter */}
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Type</span>
            <select
              value={filters.type}
              onChange={(e) => onUpdate({ type: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">All</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Source filter */}
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Source</span>
            <select
              value={filters.source}
              onChange={(e) => onUpdate({ source: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">All</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <Separator />
          <button
            onClick={() => onUpdate({ collection: '', type: '', source: '' })}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-left"
          >
            Reset filters
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ReferenceRow({
  reference,
  selected,
  onSelect,
  onDelete,
}: {
  reference: Reference
  selected: boolean
  onSelect: (ref: Reference) => void
  onDelete: (id: string) => void
}) {
  const Icon = TYPE_ICONS[reference.publicationType] ?? FileText
  const authorStr = reference.authors.length > 2
    ? `${reference.authors[0]} et al.`
    : reference.authors.join(', ')

  return (
    <div
      className={cn(
        "group flex items-start gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors border border-transparent",
        selected
          ? "bg-accent/60 border-accent"
          : "hover:bg-muted/50"
      )}
      onClick={() => onSelect(reference)}
    >
      <div className="mt-0.5 shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight truncate">{reference.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {authorStr}{reference.year ? ` (${reference.year})` : ''}
          {reference.journal ? ` \u2014 ${reference.journal}` : ''}
        </p>
        {reference.tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {reference.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">{tag}</Badge>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {reference.doi && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`https://doi.org/${reference.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-muted"
              >
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
            </TooltipTrigger>
            <TooltipContent>Open DOI</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(reference.id) }}
              className="p-1 rounded hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReferenceBrowser({ projectId }: { projectId: string }) {
  const references = useReferenceStore((s) => s.references)
  const deleteReference = useReferenceStore((s) => s.deleteReference)

  const [query, setQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('dateAdded')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filters, setFilters] = useState<FilterState>({ collection: '', type: '', source: '' })
  const [selectedRef, setSelectedRef] = useState<Reference | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [lookupOpen, setLookupOpen] = useState(false)

  // Derive collections from current references
  const allCollections = useMemo(() => {
    const set = new Set<string>()
    references.forEach((r) => r.collections.forEach((c) => set.add(c)))
    return Array.from(set).sort()
  }, [references])

  // Filter project refs
  const projectRefs = useMemo(() => {
    return references.filter((r) => r.projectId === projectId)
  }, [references, projectId])

  // Apply filters + search
  const filtered = useMemo(() => {
    let list = projectRefs

    if (filters.collection) {
      list = list.filter((r) => r.collections.includes(filters.collection))
    }
    if (filters.type) {
      list = list.filter((r) => r.publicationType === filters.type)
    }
    if (filters.source) {
      list = list.filter((r) => r.source === filters.source)
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        r.authors.some((a) => a.toLowerCase().includes(q)) ||
        (r.journal?.toLowerCase().includes(q)) ||
        (r.doi?.toLowerCase().includes(q)) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      )
    }

    return list
  }, [projectRefs, filters, query])

  // Sort
  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'title':
          cmp = a.title.localeCompare(b.title)
          break
        case 'author':
          cmp = (a.authors[0] ?? '').localeCompare(b.authors[0] ?? '')
          break
        case 'year':
          cmp = (a.year ?? 0) - (b.year ?? 0)
          break
        case 'dateAdded':
          cmp = a.dateAdded.localeCompare(b.dateAdded)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortField, sortDir])

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }, [sortField])

  const activeFilterCount = [filters.collection, filters.type, filters.source].filter(Boolean).length

  return (
    <div className="flex h-full">
      {/* Left panel: list */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search references..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <FilterPopover
            filters={filters}
            onUpdate={(partial) => setFilters((f) => ({ ...f, ...partial }))}
            collections={allCollections}
          />

          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}</Badge>
          )}

          <Separator orientation="vertical" className="h-5" />

          {/* Sort dropdown */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <ArrowUpDown className="h-3 w-3" />
                <span className="hidden sm:inline capitalize">{sortField}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-36 p-1">
              {(['title', 'author', 'year', 'dateAdded'] as SortField[]).map((field) => (
                <button
                  key={field}
                  onClick={() => toggleSort(field)}
                  className={cn(
                    "w-full text-left rounded-sm px-2 py-1.5 text-xs transition-colors cursor-pointer hover:bg-accent",
                    sortField === field && "bg-accent font-medium"
                  )}
                >
                  {field === 'dateAdded' ? 'Date Added' : field.charAt(0).toUpperCase() + field.slice(1)}
                  {sortField === field && (sortDir === 'asc' ? ' \u2191' : ' \u2193')}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <Separator orientation="vertical" className="h-5" />

          {/* Action buttons */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setLookupOpen(true)}>
                <Search className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Look up DOI / PMID / arXiv</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import from file</TooltipContent>
          </Tooltip>

          <Button size="sm" className="h-8 gap-1" onClick={() => setLookupOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </div>

        {/* Reference list */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 py-12">
              <BookOpen className="h-8 w-8" />
              <p className="text-sm font-medium">No references yet</p>
              <p className="text-xs">Import a .bib file or look up a DOI to get started.</p>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Import
                </Button>
                <Button size="sm" onClick={() => setLookupOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Look up
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="px-3 py-1.5 text-[11px] text-muted-foreground font-medium">
                {sorted.length} reference{sorted.length !== 1 ? 's' : ''}
                {query && ` matching "${query}"`}
              </div>
              {sorted.map((ref) => (
                <ReferenceRow
                  key={ref.id}
                  reference={ref}
                  selected={selectedRef?.id === ref.id}
                  onSelect={setSelectedRef}
                  onDelete={deleteReference}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: detail view */}
      {selectedRef && (
        <>
          <Separator orientation="vertical" />
          <div className="w-[400px] shrink-0 overflow-y-auto">
            <ReferenceDetail
              reference={selectedRef}
              onClose={() => setSelectedRef(null)}
            />
          </div>
        </>
      )}

      {/* Dialogs */}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={projectId}
      />
      <LookupDialog
        open={lookupOpen}
        onOpenChange={setLookupOpen}
        projectId={projectId}
      />
    </div>
  )
}
