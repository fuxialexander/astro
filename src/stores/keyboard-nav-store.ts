import { create } from "zustand"

export interface KeyboardNavItem {
  id: string
  type: "project" | "task" | "node" | "execution"
  element?: HTMLElement
}

interface KeyboardNavState {
  /** Current focused item ID */
  focusedId: string | null
  /** All navigable items in current view */
  items: KeyboardNavItem[]
  /** Whether keyboard navigation is active */
  active: boolean
  /** Register an item for keyboard navigation */
  registerItem: (item: KeyboardNavItem) => void
  /** Unregister an item */
  unregisterItem: (id: string) => void
  /** Set all items at once (for list views) */
  setItems: (items: KeyboardNavItem[]) => void
  /** Move focus to next item */
  focusNext: () => void
  /** Move focus to previous item */
  focusPrev: () => void
  /** Set focus to specific item */
  setFocus: (id: string | null) => void
  /** Activate/deactivate keyboard navigation */
  setActive: (active: boolean) => void
  /** Clear all items (on unmount) */
  clear: () => void
}

export const useKeyboardNavStore = create<KeyboardNavState>((set, get) => ({
  focusedId: null,
  items: [],
  active: false,

  registerItem: (item) => {
    const { items } = get()
    const existing = items.find((i) => i.id === item.id)
    if (!existing) {
      set({ items: [...items, item] })
    }
  },

  unregisterItem: (id) => {
    const { items, focusedId } = get()
    set({
      items: items.filter((i) => i.id !== id),
      focusedId: focusedId === id ? null : focusedId,
    })
  },

  setItems: (items) => {
    set({ items })
  },

  focusNext: () => {
    const { items, focusedId } = get()
    if (items.length === 0) return

    if (focusedId === null) {
      // Focus first item
      set({ focusedId: items[0].id, active: true })
      items[0].element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      return
    }

    const currentIndex = items.findIndex((i) => i.id === focusedId)
    if (currentIndex === -1 || currentIndex === items.length - 1) return

    const nextItem = items[currentIndex + 1]
    set({ focusedId: nextItem.id, active: true })
    nextItem.element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  },

  focusPrev: () => {
    const { items, focusedId } = get()
    if (items.length === 0) return

    if (focusedId === null) {
      // Focus last item
      const lastItem = items[items.length - 1]
      set({ focusedId: lastItem.id, active: true })
      lastItem.element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      return
    }

    const currentIndex = items.findIndex((i) => i.id === focusedId)
    if (currentIndex <= 0) return

    const prevItem = items[currentIndex - 1]
    set({ focusedId: prevItem.id, active: true })
    prevItem.element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  },

  setFocus: (id) => {
    set({ focusedId: id, active: id !== null })
    if (id) {
      const item = get().items.find((i) => i.id === id)
      item?.element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  },

  setActive: (active) => {
    set({ active })
    if (!active) {
      set({ focusedId: null })
    }
  },

  clear: () => {
    set({ items: [], focusedId: null, active: false })
  },
}))
