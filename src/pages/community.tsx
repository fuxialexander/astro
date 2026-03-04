import { useEffect, useState, useCallback } from "react"
import { Search, ChevronLeft, ChevronRight, Globe, FileText, Edit2, Trash2, Star, GitFork, Sparkles } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { useCommunityStore } from "@/stores/community-store"
import { useToastStore } from "@/stores/toast-store"
import { updatePublishedPlan, deletePublishedPlan, getFeatured } from "@/lib/community-client"
import type { SharedPlanSummary } from "@/lib/community-client"
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
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

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

/** MyPlanCard - displays a user's published plan with Edit and Unpublish actions */
interface MyPlanCardProps {
  plan: SharedPlanSummary
  onEdit: (plan: SharedPlanSummary) => void
  onUnpublish: () => void
}

function MyPlanCard({ plan, onEdit, onUnpublish }: MyPlanCardProps) {
  const [isUnpublishing, setIsUnpublishing] = useState(false)

  const handleUnpublish = async () => {
    if (!confirm("Are you sure you want to unpublish this plan? This action cannot be undone.")) return
    setIsUnpublishing(true)
    try {
      await deletePublishedPlan(plan.id)
      onUnpublish()
    } catch (err) {
      console.error("Failed to unpublish plan:", err)
      useToastStore.getState().add({
        type: "error",
        title: "Failed to unpublish",
        description: err instanceof Error ? err.message : "Something went wrong",
      })
    } finally {
      setIsUnpublishing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg line-clamp-1">{plan.title}</CardTitle>
          {plan.category && (
            <Badge variant="secondary" className="shrink-0">
              {plan.category}
            </Badge>
          )}
        </div>
        <CardDescription className="line-clamp-2">
          {plan.description || "No description provided"}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Tags */}
        {plan.tags && plan.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {plan.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
          <div className="flex items-center gap-1.5">
            <Star className="h-4 w-4" />
            <span>{plan.starsCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <GitFork className="h-4 w-4" />
            <span>{plan.forksCount}</span>
          </div>
          <div className="ml-auto text-xs">
            {formatDistanceToNow(new Date(plan.createdAt), { addSuffix: true })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit(plan)}
            className="flex-1 gap-2"
          >
            <Edit2 className="h-4 w-4" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleUnpublish}
            disabled={isUnpublishing}
            className="flex-1 gap-2 hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="h-4 w-4" />
            {isUnpublishing ? "Unpublishing..." : "Unpublish"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

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
    myPlans,
    isLoading,
    filters,
    pagination,
    setFilters,
    fetchPlans,
    fetchMyPlans,
  } = useCommunityStore()

  const [searchInput, setSearchInput] = useState(filters.search || "")
  const [searchDebounceTimer, setSearchDebounceTimer] = useState<NodeJS.Timeout | null>(null)
  const [activeTab, setActiveTab] = useState<"browse" | "my-plans">("browse")
  const [featuredPlans, setFeaturedPlans] = useState<SharedPlanSummary[]>([])

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<SharedPlanSummary | null>(null)
  const [editDescription, setEditDescription] = useState("")
  const [editTags, setEditTags] = useState("")
  const [editVisibility, setEditVisibility] = useState<"public" | "team" | "unlisted">("public")
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  // Fetch initial plans, my plans, and featured on mount
  useEffect(() => {
    fetchPlans()
    fetchMyPlans()
    getFeatured().then(setFeaturedPlans).catch((err) => {
      console.error('[Community] Failed to load featured plans:', err)
    })
  }, [fetchPlans, fetchMyPlans])

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

  // Edit plan handlers
  const handleEditPlan = (plan: SharedPlanSummary) => {
    setEditingPlan(plan)
    setEditDescription(plan.description || "")
    setEditTags(plan.tags.join(", "))
    setEditVisibility(plan.visibility)
    setEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingPlan) return
    setIsSavingEdit(true)
    try {
      await updatePublishedPlan(editingPlan.id, {
        description: editDescription.trim() || undefined,
        tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
        visibility: editVisibility,
      })
      setEditDialogOpen(false)
      // Refresh my plans
      await fetchMyPlans()
    } catch (err) {
      console.error("Failed to update plan:", err)
      useToastStore.getState().add({
        type: "error",
        title: "Failed to update plan",
        description: err instanceof Error ? err.message : "Something went wrong",
      })
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleUnpublish = async () => {
    // Refresh my plans after unpublish
    await fetchMyPlans()
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
          {/* Top-level tabs: Browse and My Plans */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "browse" | "my-plans")}>
            <TabsList className="mb-6">
              <TabsTrigger value="browse" className="gap-2">
                <Globe className="h-4 w-4" />
                Browse Community
              </TabsTrigger>
              <TabsTrigger value="my-plans" className="gap-2">
                <FileText className="h-4 w-4" />
                My Plans
              </TabsTrigger>
            </TabsList>

            {/* Browse Tab */}
            <TabsContent value="browse" className="space-y-6">
              {/* Featured Plans Section */}
              {featuredPlans.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h2 className="text-base font-semibold">Featured Plans</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {featuredPlans.slice(0, 3).map((plan) => (
                      <PlanCard key={plan.id} plan={plan} featured />
                    ))}
                  </div>
                </div>
              )}

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
            </TabsContent>

            {/* My Plans Tab */}
            <TabsContent value="my-plans">
              {/* Loading State */}
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="text-muted-foreground">Loading your plans...</div>
                </div>
              )}

              {/* Empty State */}
              {!isLoading && myPlans.length === 0 && (
                <EmptyState
                  icon={FileText}
                  title="No published plans"
                  description="You haven't published any plans to the community yet. Share your work to get feedback and help others!"
                />
              )}

              {/* My Plans Grid */}
              {!isLoading && myPlans.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {myPlans.map((plan) => (
                    <MyPlanCard
                      key={plan.id}
                      plan={plan}
                      onEdit={handleEditPlan}
                      onUnpublish={handleUnpublish}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Edit Plan Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Plan</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Describe your plan..."
                rows={4}
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
              <Input
                id="edit-tags"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="e.g., react, typescript, api"
              />
            </div>

            {/* Visibility */}
            <div className="space-y-2">
              <Label htmlFor="edit-visibility">Visibility</Label>
              <Select value={editVisibility} onValueChange={(v) => setEditVisibility(v as "public" | "team" | "unlisted")}>
                <SelectTrigger id="edit-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="team">Team Only</SelectItem>
                  <SelectItem value="unlisted">Unlisted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={isSavingEdit}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSavingEdit}>
              {isSavingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
