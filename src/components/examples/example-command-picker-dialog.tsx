import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from "react"
import { Search, X, BookOpen, Tag, Loader2 } from "lucide-react"
import Fuse from "fuse.js"
import { cn } from "@/lib/utils"
import { useExampleStore } from "@/stores/example-store"
import type { UseCaseTemplateSummary } from "@astro/core/templates"

interface ExampleCommandPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectTemplate: (template: UseCaseTemplateSummary) => void
}

const categoryLabels: Record<string, string> = {
  "software-development": "Development",
  "data-science": "Data Science",
  "machine-learning": "ML",
  "devops-infrastructure": "DevOps",
  research: "Research",
  "research-analysis": "Research",
  documentation: "Docs",
  "testing-qa": "Testing",
  security: "Security",
  "computational-biology": "Bio",
  custom: "Custom",
}

function getCategoryLabel(category: string): string {
  return categoryLabels[category] ?? category
}

export function ExampleCommandPickerDialog({
  open,
  onOpenChange,
  onSelectTemplate,
}: ExampleCommandPickerDialogProps) {
  const templates = useExampleStore((s) => s.templates)
  const loaded = useExampleStore((s) => s.loaded)
  const isLoading = useExampleStore((s) => s.isLoading)
  const load = useExampleStore((s) => s.load)

  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && !loaded) load()
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, loaded, load])

  const prevOpen = useRef(open)
  useLayoutEffect(() => {
    if (open && !prevOpen.current) {
      setQuery("") // eslint-disable-line react-hooks/set-state-in-effect -- reset picker state on open
      setSelectedIndex(0)
    }
    prevOpen.current = open
  }, [open])

  const fuse = useMemo(
    () =>
      new Fuse(templates, {
        keys: ["name", "description", "category", "tags"],
        threshold: 0.35,
        includeScore: true,
      }),
    [templates]
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return templates
    return fuse.search(query).map((result) => result.item)
  }, [query, templates, fuse])

  const clampedSelectedIndex = selectedIndex >= filtered.length
    ? Math.max(0, filtered.length - 1)
    : selectedIndex

  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll("[data-example-item]")
    items[clampedSelectedIndex]?.scrollIntoView({ block: "nearest" })
  }, [clampedSelectedIndex])

  const handleSelect = useCallback((template: UseCaseTemplateSummary) => {
    onSelectTemplate(template)
    onOpenChange(false)
  }, [onSelectTemplate, onOpenChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onOpenChange(false)
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (filtered[clampedSelectedIndex]) handleSelect(filtered[clampedSelectedIndex])
    }
  }, [filtered, clampedSelectedIndex, handleSelect, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" onKeyDown={handleKeyDown}>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200"
        onClick={() => onOpenChange(false)}
      />

      <div className="fixed left-1/2 top-[15vh] w-full max-w-[560px] -translate-x-1/2 rounded-xl border border-border bg-background shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Search examples..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} className="max-h-[400px] overflow-y-auto p-1.5">
          {isLoading && templates.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {query ? "No matching examples" : "No examples found"}
              </p>
            </div>
          ) : (
            filtered.map((template, index) => (
              <button
                key={template.id}
                data-example-item
                onClick={() => handleSelect(template)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={cn(
                  "w-full flex flex-col gap-1 px-3 py-2.5 rounded-lg text-left transition-colors",
                  index === clampedSelectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">
                    {template.icon || <BookOpen className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{template.name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {template.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground pl-12">
                  <span className="flex items-center gap-0.5 shrink-0">
                    <Tag className="h-2.5 w-2.5" />
                    {getCategoryLabel(template.category)}
                  </span>
                  <span>{template.parameterCount} params</span>
                  {template.tags && template.tags.length > 0 && (
                    <span className="truncate">{template.tags.slice(0, 3).join(" • ")}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[9px]">&uarr;&darr;</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[9px]">Enter</kbd>
            choose example
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[9px]">Esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  )
}
