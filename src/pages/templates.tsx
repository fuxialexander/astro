import { useState, useCallback, useMemo } from "react"
import { LayoutTemplate, Sparkles } from "lucide-react"
import { TemplateGallery } from "@/components/templates/template-gallery"
import { TemplatePickerDialog } from "@/components/templates/template-picker-dialog"
import { useTemplateStore } from "@/stores/template-store"
import { EmptyState } from "@/components/ui/empty-state"
import { Card } from "@/components/ui/card"
import type { UseCaseTemplateSummary } from "@astro/core/templates"


/** Short category display labels */
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

/**
 * Templates Browse Page
 *
 * Full-page template browsing experience with:
 * - Hero section with popular templates
 * - Search, category filtering, and sorting
 * - Click a template to open the parameter form (TemplatePickerDialog wizard)
 * - Launch creates a project and navigates to plan generation view
 */
export function Templates() {
  const templates = useTemplateStore((s) => s.templates)
  const rawCategories = useTemplateStore((s) => s.categories)
  const selectTemplate = useTemplateStore((s) => s.selectTemplate)
  const isLoading = useTemplateStore((s) => s.isLoading)

  // Map TemplateCategory to { name, count } format expected by TemplateGallery
  const categories = useMemo(
    () => rawCategories.map((c) => ({ name: c.category, count: c.count })),
    [rawCategories]
  )

  const [pickerOpen, setPickerOpen] = useState(false)
  const [initialTemplateId, setInitialTemplateId] = useState<string | null>(null)

  // Pick top 3 popular templates (stable, diverse categories)
  const popularTemplates = useMemo(() => {
    const stable = templates.filter(
      (t) => t.maturity === 'stable' && t.source === 'builtin'
    )
    const seen = new Set<string>()
    const result: UseCaseTemplateSummary[] = []
    for (const t of stable) {
      if (!seen.has(t.category)) {
        seen.add(t.category)
        result.push(t)
      }
      if (result.length >= 3) break
    }
    return result
  }, [templates])

  const handleTemplateSelect = useCallback((template: UseCaseTemplateSummary) => {
    selectTemplate(template.id)
    setInitialTemplateId(template.id)
    setPickerOpen(true)
  }, [selectTemplate])

  const handlePopularClick = useCallback((template: UseCaseTemplateSummary) => {
    setInitialTemplateId(template.id)
    setPickerOpen(true)
  }, [])

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-primary font-semibold">Templates</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {templates.length} templates
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {templates.length === 0 && !isLoading ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No templates available"
            description="Templates help you quickly start projects with predefined structures and best practices."
            className="h-full"
          />
        ) : (
          <div className="flex flex-col gap-6">
            {/* Popular Templates Hero */}
            {popularTemplates.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">Popular Templates</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {popularTemplates.map((t) => (
                    <Card
                      key={t.id}
                      className="p-4 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all flex items-start gap-3 group"
                      onClick={() => handlePopularClick(t)}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                        {t.icon ? (
                          <span className="text-xl">{t.icon}</span>
                        ) : (
                          <LayoutTemplate className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">
                          {t.name}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {t.description}
                        </p>
                        <span className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {categoryLabels[t.category] ?? t.category}
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Full Gallery */}
            <div>
              <h2 className="text-base font-semibold mb-3">All Templates</h2>
              <TemplateGallery
                templates={templates}
                categories={categories}
                isLoading={isLoading}
                onTemplateSelect={handleTemplateSelect}
              />
            </div>
          </div>
        )}
      </div>

      {/* Template Picker Wizard Dialog */}
      <TemplatePickerDialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open)
          if (!open) setInitialTemplateId(null)
        }}
        initialTemplateId={initialTemplateId}
      />
    </div>
  )
}
