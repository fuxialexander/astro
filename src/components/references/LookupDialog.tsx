import { useState, useCallback } from "react"
import { Search, Plus, AlertCircle, Loader2, BookOpen, ExternalLink } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useReferenceStore } from "@/stores/reference-store"
import type { Reference, ReferenceSource } from "@/types/reference"

// ---------------------------------------------------------------------------
// Identifier detection
// ---------------------------------------------------------------------------

interface DetectedId {
  type: 'doi' | 'pmid' | 'arxiv' | 'url'
  value: string
}

function detectIdentifier(input: string): DetectedId | null {
  const trimmed = input.trim()

  // DOI patterns
  const doiMatch = trimmed.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?(?:doi:?\s*)?(10\.\d{4,}\/\S+)$/i)
  if (doiMatch) return { type: 'doi', value: doiMatch[1] }

  // PMID
  const pmidMatch = trimmed.match(/^(?:pmid:?\s*)?(\d{6,9})$/i)
  if (pmidMatch) return { type: 'pmid', value: pmidMatch[1] }

  // arXiv
  const arxivMatch = trimmed.match(/^(?:https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(?:arxiv:?\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i)
  if (arxivMatch) return { type: 'arxiv', value: arxivMatch[1] }

  // URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return { type: 'url', value: trimmed }
  }

  return null
}

// ---------------------------------------------------------------------------
// Mock lookup (replace with real API calls when backend routes exist)
// ---------------------------------------------------------------------------

interface LookupState {
  loading: boolean
  result: Partial<Reference> | null
  error: string | null
}

async function lookupIdentifier(detected: DetectedId): Promise<Partial<Reference>> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 800))

  // In a real implementation, this would call:
  // - DOI: CrossRef API (https://api.crossref.org/works/{doi})
  // - PMID: NCBI E-utilities (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi)
  // - arXiv: arXiv API (http://export.arxiv.org/api/query?id_list={id})
  // For now, return a structured placeholder so the UI flow works end-to-end.

  switch (detected.type) {
    case 'doi':
      return {
        title: `[DOI Lookup] ${detected.value}`,
        authors: ['Author lookup pending'],
        doi: detected.value,
        publicationType: 'article',
        source: 'doi' as ReferenceSource,
        url: `https://doi.org/${detected.value}`,
      }
    case 'pmid':
      return {
        title: `[PubMed Lookup] PMID:${detected.value}`,
        authors: ['Author lookup pending'],
        pmid: detected.value,
        publicationType: 'article',
        source: 'pmid' as ReferenceSource,
        url: `https://pubmed.ncbi.nlm.nih.gov/${detected.value}`,
      }
    case 'arxiv':
      return {
        title: `[arXiv Lookup] ${detected.value}`,
        authors: ['Author lookup pending'],
        arxivId: detected.value,
        publicationType: 'preprint',
        source: 'arxiv' as ReferenceSource,
        url: `https://arxiv.org/abs/${detected.value}`,
      }
    case 'url':
      return {
        title: `[URL] ${detected.value}`,
        authors: [],
        url: detected.value,
        publicationType: 'webpage',
        source: 'url' as ReferenceSource,
      }
    default:
      throw new Error('Unknown identifier type')
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LookupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function LookupDialog({ open, onOpenChange, projectId }: LookupDialogProps) {
  const addReference = useReferenceStore((s) => s.addReference)

  const [input, setInput] = useState('')
  const [detected, setDetected] = useState<DetectedId | null>(null)
  const [lookup, setLookup] = useState<LookupState>({ loading: false, result: null, error: null })
  const [added, setAdded] = useState(false)

  const handleInputChange = (value: string) => {
    setInput(value)
    setDetected(detectIdentifier(value))
    setLookup({ loading: false, result: null, error: null })
    setAdded(false)
  }

  const handleLookup = useCallback(async () => {
    if (!detected) return
    setLookup({ loading: true, result: null, error: null })
    setAdded(false)

    try {
      const result = await lookupIdentifier(detected)
      setLookup({ loading: false, result, error: null })
    } catch (err) {
      setLookup({
        loading: false,
        result: null,
        error: err instanceof Error ? err.message : 'Lookup failed',
      })
    }
  }, [detected])

  const handleAdd = () => {
    if (!lookup.result) return
    addReference({
      projectId,
      title: lookup.result.title ?? 'Untitled',
      authors: lookup.result.authors ?? [],
      year: lookup.result.year,
      doi: lookup.result.doi,
      pmid: lookup.result.pmid,
      arxivId: lookup.result.arxivId,
      isbn: lookup.result.isbn,
      url: lookup.result.url,
      abstract: lookup.result.abstract,
      journal: lookup.result.journal,
      volume: lookup.result.volume,
      issue: lookup.result.issue,
      pages: lookup.result.pages,
      publisher: lookup.result.publisher,
      publicationType: lookup.result.publicationType ?? 'other',
      source: lookup.result.source ?? 'manual',
      tags: [],
      collections: [],
      pdfUrl: lookup.result.pdfUrl,
      bibtex: lookup.result.bibtex,
      citationKey: lookup.result.citationKey,
    })
    setAdded(true)
  }

  const handleClose = () => {
    setInput('')
    setDetected(null)
    setLookup({ loading: false, result: null, error: null })
    setAdded(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Look up Reference
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          {/* Input */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5 block">
              Enter DOI, PMID, arXiv ID, or URL
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 10.1038/s41586-024-07487-w or 39142536"
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && detected && handleLookup()}
                className="text-sm"
                autoFocus
              />
              <Button
                size="sm"
                disabled={!detected || lookup.loading}
                onClick={handleLookup}
                className="gap-1 shrink-0"
              >
                {lookup.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Look up
              </Button>
            </div>

            {/* Detected type indicator */}
            {input.trim() && (
              <div className="mt-2">
                {detected ? (
                  <Badge variant="secondary" className="text-xs">
                    Detected: {detected.type.toUpperCase()}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Could not detect identifier type. Try a DOI (10.xxxx/...), PMID, arXiv ID, or URL.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {lookup.error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{lookup.error}</p>
            </div>
          )}

          {/* Result preview */}
          {lookup.result && (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">{lookup.result.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(lookup.result.authors ?? []).join(', ')}
                    {lookup.result.year ? ` (${lookup.result.year})` : ''}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {lookup.result.publicationType}
                </Badge>
              </div>

              {lookup.result.journal && (
                <p className="text-xs text-muted-foreground">{lookup.result.journal}</p>
              )}

              {lookup.result.abstract && (
                <p className="text-xs text-muted-foreground line-clamp-3">{lookup.result.abstract}</p>
              )}

              <div className="flex flex-wrap gap-1.5 pt-1">
                {lookup.result.doi && (
                  <Badge variant="secondary" className="text-[10px]">DOI: {lookup.result.doi}</Badge>
                )}
                {lookup.result.pmid && (
                  <Badge variant="secondary" className="text-[10px]">PMID: {lookup.result.pmid}</Badge>
                )}
                {lookup.result.arxivId && (
                  <Badge variant="secondary" className="text-[10px]">arXiv: {lookup.result.arxivId}</Badge>
                )}
              </div>

              {lookup.result.url && (
                <a
                  href={lookup.result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> View source
                </a>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <div className="flex items-center justify-between w-full">
            <div />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleClose}>
                {added ? 'Done' : 'Cancel'}
              </Button>
              {lookup.result && !added && (
                <Button size="sm" className="gap-1" onClick={handleAdd}>
                  <Plus className="h-3.5 w-3.5" /> Add to Library
                </Button>
              )}
              {added && (
                <Button size="sm" variant="outline" disabled className="gap-1 text-green-600">
                  <BookOpen className="h-3.5 w-3.5" /> Added
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
