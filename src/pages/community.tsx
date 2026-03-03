import { useEffect, useState, useCallback } from "react"
import { Search, ChevronLeft, ChevronRight } from "lucide-react"
import { useCommunityStore } from "@/stores/community-store"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PlanCard } from "@/components/community/plan-card"
import { Globe } from "lucide-react"

// Category options
const CATEGORIES = [
  { value: "", label: "All" },
  { value: "Software", label: "Software" },
  { value: "Research", label: "Research" },
  { value: "ML", label: "ML" },
  { value: "DevOps", label: "DevOps" },
  { value: "Docs", label: "Docs" },
  { value: "Biology", label: "Biology" },
  { value: "Security", label: "Security" },
]

// Sort options
const SORT_OPTIONS = [
  { value: "trending", label: "Trending" },
  { value: "stars", label: "Most Stars" },
  { value: "recent", label: "Newest" },
  { value: "forks", label: "Most Forked" },
]

/**
 * Community Page
 *
 * Browser for community-shared plans with:
 * - Search input (debounced 300ms)
 * - Category tabs
 * - Sort dropdown
 * - Responsive grid of plan cards
 * - Pagination
 * - Empty state
 */
export function Community() {
  const {
    plans,
    isLoading,
    filters,
    pagination,
    setFilters,
    fetchPlans,
  } = useCommunityStore()

  const [searchInput, setSearchInput] = useState(filters.search || "")
  const [searchDebounceTimer, setSearchDebounceTimer] = useState<NodeJS.Timeout | null>(null)

  // Fetch initial plans on mount
  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  // Debounced search handler
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value)

      // Clear existing timer
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
      }

      // Set new timer
      const timer = setTimeout(() => {
        setFilters({ search: value || undefined })
      }, 300)

      setSearchDebounceTimer(timer)
    },
    [searchDebounceTimer, setFilters]
  )

  // Category change handler
  const handleCategoryChange = (category: string) => {
    setFilters({ category: category || undefined })
  }

  // Sort change handler
  const handleSortChange = (sort: string) => {
    setFilters({ sort: sort as 'trending' | 'stars' | 'recent' | 'forks' })
  }

  // Pagination handlers
  const handlePreviousPage = () => {
    if (pagination.page > 1) {
      useCommunityStore.setState({
        pagination: { ...pagination, page: pagination.page - 1 }
      })
      fetchPlans()
    }
  }

  const handleNextPage = () => {
    if (pagination.hasMore) {
      useCommunityStore.setState({
        pagination: { ...pagination, page: pagination.page + 1 }
      })
      fetchPlans()
    }
  }

  const handlePageClick = (page: number) => {
    useCommunityStore.setState({
      pagination: { ...pagination, page }
    })
    fetchPlans()
  }

  // Calculate total pages
  const totalPages = pagination.total > 0 ? Math.ceil(pagination.total / 20) : 0

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const current = pagination.page
    const total = totalPages

    if (total <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= total; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)

      if (current > 3) {
        pages.push("...")
      }

      // Show pages around current
      const start = Math.max(2, current - 1)
      const end = Math.min(total - 1, current + 1)

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }

      if (current < total - 2) {
        pages.push("...")
      }

      // Always show last page
      pages.push(total)
    }

    return pages
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <h1 className="text-xl font-primary font-semibold">Community Plans</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Search and Sort Controls */}
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search plans..."
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Sort Dropdown */}
            <Select value={filters.sort} onValueChange={handleSortChange}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category Tabs */}
          <Tabs
            value={filters.category || ""}
            onValueChange={handleCategoryChange}
          >
            <TabsList className="w-full justify-start overflow-x-auto">
              {CATEGORIES.map((category) => (
                <TabsTrigger key={category.value} value={category.value}>
                  {category.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Content for all tabs is the same - just filtered by category */}
            {CATEGORIES.map((category) => (
              <TabsContent key={category.value} value={category.value}>
                {/* Loading State */}
                {isLoading && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-muted-foreground">Loading plans...</div>
                  </div>
                )}

                {/* Empty State */}
                {!isLoading && plans.length === 0 && (
                  <EmptyState
                    icon={Globe}
                    title="No plans found"
                    description="Try adjusting your search or filters to find community plans."
                  />
                )}

                {/* Plan Cards Grid */}
                {!isLoading && plans.length > 0 && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                      {plans.map((plan) => (
                        <PlanCard key={plan.id} plan={plan} />
                      ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 mt-8">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handlePreviousPage}
                          disabled={pagination.page === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Previous
                        </Button>

                        <div className="flex items-center gap-1">
                          {getPageNumbers().map((page, index) =>
                            typeof page === "number" ? (
                              <Button
                                key={index}
                                variant={
                                  pagination.page === page ? "default" : "outline"
                                }
                                size="sm"
                                onClick={() => handlePageClick(page)}
                                className="min-w-[2.5rem]"
                              >
                                {page}
                              </Button>
                            ) : (
                              <span
                                key={index}
                                className="px-2 text-muted-foreground"
                              >
                                {page}
                              </span>
                            )
                          )}
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleNextPage}
                          disabled={!pagination.hasMore}
                        >
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  )
}
