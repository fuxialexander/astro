import { useState } from "react"
import {
  X, Copy, ExternalLink, FileDown, BookOpen, Pencil, Check, Tag,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { useReferenceStore } from "@/stores/reference-store"
import { formatCitation } from "@/lib/reference-parsers"
import { cn } from "@/lib/utils"
import type { Reference } from "@/types/reference"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MetadataRow({ label, value, href }: { label: string; value?: string | number | null; href?: string }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase w-20 shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 min-w-0">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline break-all"
          >
            {value}
          </a>
        ) : (
          <span className="text-sm break-all">{String(value)}</span>
        )}
      </div>
    </div>
  )
}

function EditableField({
  label,
  value,
  onSave,
  multiline,
}: {
  label: string
  value: string
  onSave: (value: string) => void
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    onSave(draft)
    setEditing(false)
  }

  return (
    <div className="py-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase">{label}</span>
        {!editing && (
          <button onClick={() => { setDraft(value); setEditing(true) }} className="p-0.5 rounded hover:bg-muted transition-colors">
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex gap-1">
          {multiline ? (
            <textarea
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm resize-none min-h-[60px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          ) : (
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-7 text-sm"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={commit}>
            <Check className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <p className={cn("text-sm", !value && "text-muted-foreground italic")}>
          {value || 'None'}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function ReferenceDetail({
  reference,
  onClose,
}: {
  reference: Reference
  onClose: () => void
}) {
  const updateReference = useReferenceStore((s) => s.updateReference)
  const [tagInput, setTagInput] = useState('')
  const [copied, setCopied] = useState(false)

  const citation = formatCitation(reference)

  const handleCopyCitation = () => {
    navigator.clipboard.writeText(citation).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !reference.tags.includes(tag)) {
      updateReference(reference.id, { tags: [...reference.tags, tag] })
    }
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    updateReference(reference.id, { tags: reference.tags.filter((t) => t !== tag) })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold truncate">Reference Details</h3>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Title */}
        <EditableField
          label="Title"
          value={reference.title}
          onSave={(v) => updateReference(reference.id, { title: v })}
        />

        {/* Authors */}
        <EditableField
          label="Authors"
          value={reference.authors.join('; ')}
          onSave={(v) => updateReference(reference.id, { authors: v.split(';').map((a) => a.trim()).filter(Boolean) })}
        />

        <Separator className="my-2" />

        {/* Citation preview */}
        <div className="py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Citation</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={handleCopyCitation} className="p-0.5 rounded hover:bg-muted transition-colors">
                  {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied!' : 'Copy citation'}</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-sm text-muted-foreground italic bg-muted/30 rounded px-2 py-1.5 leading-relaxed">
            {citation}
          </p>
        </div>

        <Separator className="my-2" />

        {/* Metadata */}
        <div className="space-y-0.5">
          <MetadataRow label="Year" value={reference.year} />
          <MetadataRow label="Journal" value={reference.journal} />
          <MetadataRow label="Volume" value={reference.volume} />
          <MetadataRow label="Issue" value={reference.issue} />
          <MetadataRow label="Pages" value={reference.pages} />
          <MetadataRow label="Publisher" value={reference.publisher} />
          <MetadataRow label="DOI" value={reference.doi} href={reference.doi ? `https://doi.org/${reference.doi}` : undefined} />
          <MetadataRow label="PMID" value={reference.pmid} href={reference.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${reference.pmid}` : undefined} />
          <MetadataRow label="arXiv" value={reference.arxivId} href={reference.arxivId ? `https://arxiv.org/abs/${reference.arxivId}` : undefined} />
          <MetadataRow label="ISBN" value={reference.isbn} />
          <MetadataRow label="URL" value={reference.url} href={reference.url} />
          <MetadataRow label="Type" value={reference.publicationType} />
          <MetadataRow label="Source" value={reference.source} />
          <MetadataRow label="Added" value={new Date(reference.dateAdded).toLocaleDateString()} />
        </div>

        <Separator className="my-2" />

        {/* Tags */}
        <div className="py-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
            <Tag className="h-3 w-3" /> Tags
          </span>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {reference.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-xs cursor-pointer hover:bg-destructive/10 group"
                onClick={() => removeTag(tag)}
              >
                {tag}
                <X className="h-2.5 w-2.5 ml-1 opacity-0 group-hover:opacity-100" />
              </Badge>
            ))}
            <div className="flex gap-1">
              <Input
                placeholder="Add tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                className="h-6 w-24 text-xs px-1.5"
              />
            </div>
          </div>
        </div>

        <Separator className="my-2" />

        {/* Notes */}
        <EditableField
          label="Notes"
          value={reference.notes ?? ''}
          onSave={(v) => updateReference(reference.id, { notes: v || undefined })}
          multiline
        />

        {/* Abstract */}
        {reference.abstract && (
          <>
            <Separator className="my-2" />
            <div className="py-1">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">Abstract</span>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                {reference.abstract}
              </p>
            </div>
          </>
        )}

        {/* BibTeX */}
        {reference.bibtex && (
          <>
            <Separator className="my-2" />
            <div className="py-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase">BibTeX</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigator.clipboard.writeText(reference.bibtex!)}
                      className="p-0.5 rounded hover:bg-muted transition-colors"
                    >
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Copy BibTeX</TooltipContent>
                </Tooltip>
              </div>
              <pre className="text-xs bg-muted/30 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap font-mono">
                {reference.bibtex}
              </pre>
            </div>
          </>
        )}
      </div>

      {/* Action bar */}
      <div className="border-t px-4 py-2 flex gap-2">
        {reference.pdfUrl && (
          <Button variant="outline" size="sm" className="gap-1" asChild>
            <a href={reference.pdfUrl} target="_blank" rel="noopener noreferrer">
              <FileDown className="h-3.5 w-3.5" /> PDF
            </a>
          </Button>
        )}
        {reference.doi && (
          <Button variant="outline" size="sm" className="gap-1" asChild>
            <a href={`https://doi.org/${reference.doi}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> Open DOI
            </a>
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-1" disabled>
          <BookOpen className="h-3.5 w-3.5" /> Read with AI
        </Button>
      </div>
    </div>
  )
}
