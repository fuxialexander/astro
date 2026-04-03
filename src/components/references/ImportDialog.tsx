import { useState, useCallback, useRef } from "react"
import { Upload, Check, AlertCircle } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useReferenceStore } from "@/stores/reference-store"
import { parseReferences } from "@/lib/reference-parsers"
import { cn } from "@/lib/utils"
import type { ParsedReference } from "@/types/reference"

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function ImportDialog({ open, onOpenChange, projectId }: ImportDialogProps) {
  const importParsed = useReferenceStore((s) => s.importParsed)

  const [parsed, setParsed] = useState<ParsedReference[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      const results = parseReferences(text)
      if (results.length === 0) {
        setError(`Could not parse any references from "${file.name}". Supported formats: BibTeX (.bib), RIS (.ris).`)
        setParsed([])
      } else {
        setParsed(results)
      }
    } catch (err) {
      setError(`Failed to read file: ${err instanceof Error ? err.message : 'unknown error'}`)
      setParsed([])
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (text.trim()) {
      const results = parseReferences(text)
      if (results.length > 0) {
        setParsed(results)
        setError(null)
      } else {
        setError('Could not parse references from pasted text.')
      }
    }
  }, [])

  const toggleItem = (index: number) => {
    setParsed((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, selected: !item.selected } : item
      )
    )
  }

  const toggleAll = () => {
    const allSelected = parsed.every((p) => p.selected)
    setParsed((prev) => prev.map((item) => ({ ...item, selected: !allSelected })))
  }

  const selectedCount = parsed.filter((p) => p.selected).length

  const handleImport = () => {
    importParsed(projectId, parsed)
    setParsed([])
    setError(null)
    onOpenChange(false)
  }

  const handleClose = () => {
    setParsed([])
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import References
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4" onPaste={handlePaste}>
          {/* Drop zone */}
          {parsed.length === 0 && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                "flex flex-col items-center justify-center gap-3 py-12 rounded-lg border-2 border-dashed transition-colors cursor-pointer",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className={cn("h-10 w-10", dragOver ? "text-primary" : "text-muted-foreground")} />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {dragOver ? 'Drop file here' : 'Drag & drop a file here'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  or click to browse. Supports .bib, .ris, and .xml formats.
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  You can also paste BibTeX or RIS text directly.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".bib,.ris,.xml,.txt"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm mt-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Preview list */}
          {parsed.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium">
                  {parsed.length} reference{parsed.length !== 1 ? 's' : ''} found
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleAll}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {parsed.every((p) => p.selected) ? 'Deselect all' : 'Select all'}
                  </button>
                  <Badge variant="secondary" className="text-xs">
                    {selectedCount} selected
                  </Badge>
                </div>
              </div>

              <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
                {parsed.map((item, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer",
                      item.selected ? "bg-accent/40" : "hover:bg-muted/50 opacity-60"
                    )}
                    onClick={() => toggleItem(index)}
                  >
                    <div className={cn(
                      "mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center",
                      item.selected ? "bg-primary border-primary" : "border-border"
                    )}>
                      {item.selected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.authors.length > 2
                          ? `${item.authors[0]} et al.`
                          : item.authors.join(', ')}
                        {item.year ? ` (${item.year})` : ''}
                        {item.journal ? ` \u2014 ${item.journal}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{item.publicationType}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <div className="flex items-center justify-between w-full">
            {parsed.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => { setParsed([]); setError(null) }}>
                Clear
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={selectedCount === 0}
                onClick={handleImport}
              >
                Import {selectedCount > 0 ? `(${selectedCount})` : ''}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
