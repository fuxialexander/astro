/**
 * Reference list — shows all references for a project with add/import actions.
 */

import { useState, useCallback } from 'react'
import {
  Plus,
  Search,
  FileText,
  BookOpen,
  Loader2,
  Globe,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Reference } from '@/types'
import { ReferenceDetail } from './reference-detail'
import { fetchDoiMetadata, resolveDoiPdf } from '@/lib/pdf-resolver'
import { downloadPdfForReference } from '@/lib/pdf-downloader'
import { isTauri } from '@/lib/skill-provider'

// ── Props ────────────────────────────────────────────────────────────

interface ReferenceListProps {
  references: Reference[]
  onUpdateReference?: (id: string, updates: Partial<Reference>) => void
  onAddReference?: (reference: Reference) => void
  onDeleteReference?: (id: string) => void
  className?: string
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

  const selectedRef = references.find((r) => r.id === selectedId)

  const handleImportDoi = useCallback(async () => {
    if (!doiInput.trim()) return
    setImporting(true)
    setImportError(null)

    try {
      // Fetch metadata from CrossRef
      const metadata = await fetchDoiMetadata(doiInput.trim())
      if (!metadata) {
        setImportError('Could not resolve DOI. Check the identifier and try again.')
        return
      }

      // Create reference
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

      // Check for open-access PDF
      if (metadata.doi) {
        const pdfResolution = await resolveDoiPdf(metadata.doi)
        if (pdfResolution.pdfUrl) {
          newRef.pdfUrl = pdfResolution.pdfUrl
          newRef.isOpenAccess = pdfResolution.isOa
          newRef.oaSource = pdfResolution.oaSource ?? undefined

          // Auto-download in Tauri mode
          if (isTauri()) {
            try {
              const downloadResult = await downloadPdfForReference(newRef)
              Object.assign(newRef, downloadResult)
            } catch {
              // Download failed — ref still added without local PDF
            }
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

  const handleUpdateRef = useCallback(
    (updates: Partial<Reference>) => {
      if (selectedId) {
        onUpdateReference?.(selectedId, updates)
      }
    },
    [selectedId, onUpdateReference],
  )

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <BookOpen className="h-4 w-4" />
          References
          <span className="text-muted-foreground font-normal">({references.length})</span>
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDoiInput(!showDoiInput)}
            className="h-7 gap-1"
          >
            <Search className="h-3.5 w-3.5" />
            Add by DOI
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
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
            }}
            className="h-7 gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add manual
          </Button>
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
            <Button
              size="sm"
              onClick={handleImportDoi}
              disabled={importing || !doiInput.trim()}
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                'Import'
              )}
            </Button>
          </div>
          {importError && (
            <p className="text-xs text-destructive">{importError}</p>
          )}
        </div>
      )}

      {/* Reference List */}
      {references.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <FileText className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">No references yet</p>
          <p className="text-xs">Add papers by DOI or manually</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {references.map((ref) => (
            <button
              key={ref.id}
              onClick={() => setSelectedId(selectedId === ref.id ? null : ref.id)}
              className={cn(
                'flex items-start gap-2 p-2 rounded-md text-left transition-colors',
                'hover:bg-muted/50',
                selectedId === ref.id && 'bg-muted',
              )}
            >
              <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{ref.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {ref.authors?.[0] && (
                    <span>{ref.authors[0]}{ref.authors.length > 1 ? ' et al.' : ''}</span>
                  )}
                  {ref.year && <span>{ref.year}</span>}
                  {ref.journal && <span className="truncate">{ref.journal}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {ref.isOpenAccess && (
                  <Globe className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                )}
                {ref.pdfDownloaded ? (
                  <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                ) : ref.pdfUrl ? (
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Selected Reference Detail */}
      {selectedRef && (
        <div className="border-t pt-3">
          <ReferenceDetail
            reference={selectedRef}
            onUpdate={handleUpdateRef}
            onDelete={() => {
              onDeleteReference?.(selectedRef.id)
              setSelectedId(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
