import { useState, useCallback, useMemo } from "react"
import { LayoutTemplate } from "lucide-react"
import { TemplateGallery } from "@/components/templates/template-gallery"
import { TemplatePickerDialog } from "@/components/templates/template-picker-dialog"
import { useTemplateStore } from "@/stores/template-store"
import { EmptyState } from "@/components/ui/empty-state"
import type { UseCaseTemplateSummary } from "@astro/core/templates"

/**
 * Templates Browse Page
 *
 * Full-page template browsing experience with search, category filtering, and sorting.
 * Click a template to open the parameter form (TemplatePickerDialog wizard).
 * Launch creates a project and navigates to plan generation view.
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

  const handleTemplateSelect = useCallback((template: UseCaseTemplateSummary) => {
    selectTemplate(template.id)
    setPickerOpen(true)
  }, [selectTemplate])

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-primary font-semibold">Templates</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {templates.length}
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
          <TemplateGallery
            templates={templates}
            categories={categories}
            isLoading={isLoading}
            onTemplateSelect={handleTemplateSelect}
          />
        )}
      </div>

      {/* Template Picker Wizard Dialog */}
      <TemplatePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      />
    </div>
  )
}
