import { useMemo } from "react"
import { LayoutTemplate, ChevronRight } from "lucide-react"
import { useTemplateStore } from "@/stores/template-store"
import type { UseCaseTemplateSummary } from "@astro/core/templates"

/** Short display labels for template categories */
const categoryLabels: Record<string, string> = {
  'software-development': 'Development',
  'data-science': 'Data Science',
  'machine-learning': 'ML',
  'devops-infrastructure': 'DevOps',
  'research-analysis': 'Research',
  'documentation': 'Docs',
  'testing-qa': 'Testing',
  'security': 'Security',
  'computational-biology': 'Bio',
  'custom': 'Custom',
}

interface FeaturedTemplateChipsProps {
  /** Called when a template chip is clicked (should open picker with this template) */
  onSelect: (templateId: string) => void
  /** Called when "More..." is clicked (should navigate to /templates) */
  onShowAll: () => void
  /** Max chips to show before "More..." */
  maxVisible?: number
}

/**
 * Compact row of featured template chips shown on the Plan page.
 * Shows stable templates as clickable cards between the textarea and the OR divider.
 */
export function FeaturedTemplateChips({
  onSelect,
  onShowAll,
  maxVisible = 5,
}: FeaturedTemplateChipsProps) {
  const templates = useTemplateStore((s) => s.templates)
  const loaded = useTemplateStore((s) => s.loaded)

  // Pick featured templates: stable maturity, diverse categories, up to maxVisible
  const featured = useMemo(() => {
    if (!templates.length) return []

    const stable = templates.filter(
      (t) => t.maturity === 'stable' && t.source === 'builtin'
    )

    // Pick one per category for diversity, then fill remaining slots
    const seenCategories = new Set<string>()
    const diverse: UseCaseTemplateSummary[] = []
    const rest: UseCaseTemplateSummary[] = []

    for (const t of stable) {
      if (!seenCategories.has(t.category)) {
        seenCategories.add(t.category)
        diverse.push(t)
      } else {
        rest.push(t)
      }
    }

    const result = [...diverse, ...rest].slice(0, maxVisible)
    return result
  }, [templates, maxVisible])

  if (!loaded || featured.length === 0) return null

  const hasMore = templates.filter((t) => t.maturity === 'stable').length > maxVisible

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
          or start with a use case
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {featured.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs transition-all cursor-pointer hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm"
          >
            {t.icon ? (
              <span className="text-sm">{t.icon}</span>
            ) : (
              <LayoutTemplate className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="font-medium">{t.name}</span>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              {categoryLabels[t.category] ?? t.category}
            </span>
          </button>
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={onShowAll}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            More
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
