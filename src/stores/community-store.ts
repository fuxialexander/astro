import { create } from "zustand"
import type {
  SharedPlanSummary,
  SharedPlanDetail,
  Comment,
  PublishPlanRequest,
  ListCommunityPlansParams,
  Category,
} from "@/lib/community-client"
import {
  listCommunityPlans,
  getCommunityPlan,
  publishPlan as apiPublishPlan,
  forkPlan as apiForkPlan,
  toggleStar as apiToggleStar,
  listComments,
  addComment as apiAddComment,
  getTrending,
  getCategories as apiGetCategories,
  getMyPlans as apiGetMyPlans,
} from "@/lib/community-client"

/** Filter and sort options for community plans */
export interface CommunityFilters {
  category?: string
  tags?: string[]
  sort: 'trending' | 'stars' | 'recent' | 'forks'
  search?: string
}

/** Pagination state */
interface PaginationState {
  page: number
  total: number
  hasMore: boolean
}

interface CommunityState {
  // Data
  plans: SharedPlanSummary[]
  trending: SharedPlanSummary[]
  categories: Category[]
  myPlans: SharedPlanSummary[]
  selectedPlan: SharedPlanDetail | null
  comments: Comment[]
  pagination: PaginationState
  isLoading: boolean
  filters: CommunityFilters

  // Actions
  fetchPlans: () => Promise<void>
  fetchPlan: (id: string) => Promise<void>
  publishPlan: (data: PublishPlanRequest) => Promise<SharedPlanDetail>
  forkPlan: (id: string, projectName: string, workDir?: string) => Promise<string>
  toggleStar: (id: string) => Promise<void>
  fetchComments: (planId: string) => Promise<void>
  addComment: (planId: string, content: string, parentId?: string) => Promise<void>
  fetchTrending: () => Promise<void>
  fetchCategories: () => Promise<void>
  fetchMyPlans: () => Promise<void>
  setFilters: (filters: Partial<CommunityFilters>) => void
  clearSelectedPlan: () => void
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  // Initial state
  plans: [],
  trending: [],
  categories: [],
  myPlans: [],
  selectedPlan: null,
  comments: [],
  pagination: {
    page: 1,
    total: 0,
    hasMore: false,
  },
  isLoading: false,
  filters: {
    sort: 'trending',
  },

  // Fetch community plans with current filters
  fetchPlans: async () => {
    set({ isLoading: true })
    try {
      const { filters, pagination } = get()
      const params: ListCommunityPlansParams = {
        category: filters.category,
        tags: filters.tags,
        sort: filters.sort === 'trending' ? 'stars' : filters.sort,
        search: filters.search,
        page: pagination.page,
        limit: 20,
      }

      const result = await listCommunityPlans(params)
      set({
        plans: result.data,
        pagination: {
          page: result.pagination.page,
          total: result.pagination.total,
          hasMore: result.pagination.page < result.pagination.totalPages,
        },
        isLoading: false,
      })
    } catch (err) {
      console.error('[community-store] Failed to fetch plans:', err)
      set({ isLoading: false })
    }
  },

  // Fetch a single plan detail
  fetchPlan: async (id: string) => {
    set({ isLoading: true })
    try {
      const plan = await getCommunityPlan(id)
      set({ selectedPlan: plan, isLoading: false })
    } catch (err) {
      console.error('[community-store] Failed to fetch plan:', err)
      set({ isLoading: false })
    }
  },

  // Publish a new plan to the community
  publishPlan: async (data: PublishPlanRequest) => {
    set({ isLoading: true })
    try {
      const published = await apiPublishPlan(data)
      set({ isLoading: false })
      // Refresh myPlans to include the newly published plan
      get().fetchMyPlans()
      return published
    } catch (err) {
      console.error('[community-store] Failed to publish plan:', err)
      set({ isLoading: false })
      throw err
    }
  },

  // Fork a plan to create a new project
  forkPlan: async (id: string, projectName: string, workDir?: string) => {
    set({ isLoading: true })
    try {
      const result = await apiForkPlan(id, projectName, workDir)
      set({ isLoading: false })
      // Optimistically increment forksCount on the selected plan
      const { selectedPlan } = get()
      if (selectedPlan && selectedPlan.id === id) {
        set({
          selectedPlan: {
            ...selectedPlan,
            forksCount: selectedPlan.forksCount + 1,
          },
        })
      }
      return result.projectId
    } catch (err) {
      console.error('[community-store] Failed to fork plan:', err)
      set({ isLoading: false })
      throw err
    }
  },

  // Toggle star status (optimistic update with rollback on error)
  toggleStar: async (id: string) => {
    const { plans, selectedPlan } = get()

    // Capture current star count for rollback
    let previousStarsCount = 0

    // Find plan in any list to get current count
    const planInList = plans.find((p) => p.id === id)
    if (planInList) {
      previousStarsCount = planInList.starsCount
    }
    if (selectedPlan && selectedPlan.id === id) {
      previousStarsCount = selectedPlan.starsCount
    }

    // Optimistic update: assume toggling means adding a star (increment)
    const optimisticIncrement = 1
    const optimisticStarsCount = previousStarsCount + optimisticIncrement

    // Update all occurrences optimistically
    set({
      plans: plans.map((p) =>
        p.id === id ? { ...p, starsCount: optimisticStarsCount } : p
      ),
      selectedPlan:
        selectedPlan && selectedPlan.id === id
          ? { ...selectedPlan, starsCount: optimisticStarsCount }
          : selectedPlan,
    })

    try {
      const result = await apiToggleStar(id)
      // Apply actual result from server
      const actualStarsCount = result.starsCount
      set({
        plans: plans.map((p) =>
          p.id === id ? { ...p, starsCount: actualStarsCount } : p
        ),
        selectedPlan:
          selectedPlan && selectedPlan.id === id
            ? { ...selectedPlan, starsCount: actualStarsCount }
            : selectedPlan,
      })
    } catch (err) {
      console.error('[community-store] Failed to toggle star:', err)
      // Rollback: restore previous count
      set({
        plans: plans.map((p) =>
          p.id === id ? { ...p, starsCount: previousStarsCount } : p
        ),
        selectedPlan:
          selectedPlan && selectedPlan.id === id
            ? { ...selectedPlan, starsCount: previousStarsCount }
            : selectedPlan,
      })
    }
  },

  // Fetch comments for a plan
  fetchComments: async (planId: string) => {
    try {
      const comments = await listComments(planId)
      set({ comments })
    } catch (err) {
      console.error('[community-store] Failed to fetch comments:', err)
    }
  },

  // Add a comment (or reply)
  addComment: async (planId: string, content: string, parentId?: string) => {
    try {
      const newComment = await apiAddComment(planId, content, parentId)
      // Append to local comments list
      const { comments } = get()
      set({ comments: [...comments, newComment] })
    } catch (err) {
      console.error('[community-store] Failed to add comment:', err)
      throw err
    }
  },

  // Fetch trending plans
  fetchTrending: async () => {
    try {
      const trending = await getTrending()
      set({ trending })
    } catch (err) {
      console.error('[community-store] Failed to fetch trending:', err)
    }
  },

  // Fetch categories with plan counts
  fetchCategories: async () => {
    try {
      const categories = await apiGetCategories()
      set({ categories })
    } catch (err) {
      console.error('[community-store] Failed to fetch categories:', err)
    }
  },

  // Fetch current user's published plans
  fetchMyPlans: async () => {
    try {
      const myPlans = await apiGetMyPlans()
      set({ myPlans })
    } catch (err) {
      console.error('[community-store] Failed to fetch my plans:', err)
    }
  },

  // Update filters and trigger fetchPlans
  setFilters: (filters: Partial<CommunityFilters>) => {
    const current = get().filters
    const updated = { ...current, ...filters }
    set({ filters: updated, pagination: { page: 1, total: 0, hasMore: false } })
    get().fetchPlans()
  },

  // Clear selected plan and comments
  clearSelectedPlan: () => {
    set({ selectedPlan: null, comments: [] })
  },
}))
