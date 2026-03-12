import { useMemo, useState, useCallback } from "react"
import { Search, FileText, ArrowUpDown } from "lucide-react"
import { ExampleCard } from "./example-card"
import { EmptyState } from "@/components/ui/empty-state"
import { Card } from "@/components/ui/card"
import type { UseCaseTemplateSummary } from "@astro/core/templates"
import { cn } from "@/lib/utils"

interface ExampleGalleryProps {
  templates: UseCaseTemplateSummary[]
  categories: Array<{ name: string; count: number }>
  isLoading?: boolean
  onTemplateSelect?: (template: UseCaseTemplateSummary) => void
  onTemplateEdit?: (template: UseCaseTemplateSummary) => void
  onTemplateDelete?: (template: UseCaseTemplateSummary) => void
}

type SortOption = 'popular' | 'newest' | 'a-z'

// Category display names (same as in example-card)
const categoryLabels: Record<string, string> = {
  'software-development': 'Development',
  'data-science': 'Data Science',
  'machine-learning': 'ML',
  'devops-infrastructure': 'DevOps',
  'research-analysis': 'Research',
  'research': 'Research',
  'documentation': 'Docs',
  'testing-qa': 'Testing',
  'security': 'Security',
  'computational-biology': 'Bio',
  'custom': 'Custom',
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="p-4 flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="h-3 bg-muted rounded animate-pulse w-full" />
            <div className="h-3 bg-muted rounded animate-pulse w-5/6" />
          </div>
          <div className="flex gap-2">
            <div className="h-5 bg-muted rounded animate-pulse w-16" />
            <div className="h-5 bg-muted rounded animate-pulse w-16" />
          </div>
        </Card>
      ))}
    </div>
  )
}

export function ExampleGallery({
  templates,
  categories,
  isLoading = false,
  onTemplateSelect,
  onTemplateEdit,
  onTemplateDelete,
}: ExampleGalleryProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortOption>("a-z")

  // Filter templates
  const filteredTemplates = useMemo(() => {
    let result = templates

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags?.some((tag) => tag.toLowerCase().includes(q))
      )
    }

    // Filter by category
    if (selectedCategory !== "all") {
      result = result.filter((t) => t.category === selectedCategory)
    }

    // Sort
    const sorted = [...result]
    switch (sortBy) {
      case "a-z":
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      case "newest":
        // Sort by version descending (higher version = newer)
        sorted.sort((a, b) => b.version.localeCompare(a.version))
        break
      case "popular":
        // For now, sort by parameter count ascending (simpler = more popular)
        // In production, this would use actual usage metrics
        sorted.sort((a, b) => a.parameterCount - b.parameterCount)
        break
    }

    return sorted
  }, [templates, searchQuery, selectedCategory, sortBy])

  // Category tabs
  const categoryTabs = useMemo(() => {
    const allCount = templates.length
    const tabs = [{ id: "all", label: "All", count: allCount }]

    for (const cat of categories) {
      tabs.push({
        id: cat.name,
        label: categoryLabels[cat.name] ?? cat.name,
        count: cat.count,
      })
    }

    return tabs
  }, [categories, templates.length])

  const handleCategoryChange = useCallback((categoryId: string) => {
    setSelectedCategory(categoryId)
  }, [])

  const handleSortChange = useCallback((value: SortOption) => {
    setSortBy(value)
  }, [])

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Category Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categoryTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleCategoryChange(tab.id)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
              selectedCategory === tab.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {tab.label} <span className="text-[10px] opacity-70">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Search and Sort Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-transparent pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => handleSortChange(e.target.value as SortOption)}
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            <option value="popular">Popular</option>
            <option value="newest">Newest</option>
            <option value="a-z">A-Z</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <LoadingSkeleton />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No templates available"
            description="Templates help you quickly start projects with predefined structures and best practices."
            className="h-full"
          />
        ) : filteredTemplates.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matching templates"
            description="Try adjusting your search or filters to find what you're looking for."
            className="h-full"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <ExampleCard
                key={template.id}
                template={template}
                onClick={onTemplateSelect}
                onEdit={onTemplateEdit}
                onDelete={onTemplateDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
