import { useState, useCallback } from "react"
import { BookOpen } from "lucide-react"
import { TemplatePickerDialog } from "@/components/templates/template-picker-dialog"
import { useTemplateStore } from "@/stores/template-store"
import { EmptyState } from "@/components/ui/empty-state"
import { Card } from "@/components/ui/card"

/**
 * Examples Page
 *
 * Focused page showing curated example templates. Currently features
 * a single polished example: Academic Paper Presentation.
 *
 * Clicking an example card opens the TemplatePickerDialog directly
 * at the Configure step (skipping the Browse step).
 */
export function Examples() {
  const templates = useTemplateStore((s) => s.templates)
  const isLoading = useTemplateStore((s) => s.isLoading)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [initialTemplateId, setInitialTemplateId] = useState<string | null>(null)

  const handleExampleClick = useCallback((templateId: string) => {
    setInitialTemplateId(templateId)
    setPickerOpen(true)
  }, [])

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-primary font-semibold">Examples</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {templates.length === 0 && !isLoading ? (
          <EmptyState
            icon={BookOpen}
            title="No examples available"
            description="Examples help you quickly start projects with curated templates and best practices."
            className="h-full"
          />
        ) : (
          <div className="flex flex-col gap-6">
            <p className="text-sm text-muted-foreground">
              Get started quickly with a curated example. Click to configure and create a project.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((t) => (
                <Card
                  key={t.id}
                  className="p-5 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all group"
                  onClick={() => handleExampleClick(t.id)}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                      {t.icon ? (
                        <span className="text-2xl">{t.icon}</span>
                      ) : (
                        <BookOpen className="h-6 w-6 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold group-hover:text-primary transition-colors">
                        {t.name}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-3">
                        {t.description}
                      </p>
                      <div className="flex items-center gap-2 mt-3">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                          {t.category}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Template Picker Dialog — opens directly at Configure step */}
      <TemplatePickerDialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open)
          if (!open) setInitialTemplateId(null)
        }}
        initialTemplateId={initialTemplateId}
        skipBrowse
      />
    </div>
  )
}
