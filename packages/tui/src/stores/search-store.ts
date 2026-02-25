/**
 * Fuzzy search store. Indexes all cached entities.
 */
import { create } from 'zustand'

export interface SearchItem {
  type: 'project' | 'task' | 'machine' | 'execution'
  id: string
  title: string
  subtitle?: string
  status?: string
}

export interface SearchState {
  items: SearchItem[]
  query: string
  results: SearchItem[]
  selectedIndex: number
  isOpen: boolean
}

export interface SearchActions {
  setItems: (items: SearchItem[]) => void
  setQuery: (query: string) => void
  setResults: (results: SearchItem[]) => void
  setSelectedIndex: (index: number) => void
  moveUp: () => void
  moveDown: () => void
  open: () => void
  close: () => void
}

export const useSearchStore = create<SearchState & SearchActions>((set, get) => ({
  items: [],
  query: '',
  results: [],
  selectedIndex: 0,
  isOpen: false,

  setItems: (items) => set({ items }),
  setQuery: (query) => set({ query, selectedIndex: 0 }),
  setResults: (results) => set({ results }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  moveUp: () => {
    const { selectedIndex } = get()
    set({ selectedIndex: Math.max(0, selectedIndex - 1) })
  },
  moveDown: () => {
    const { selectedIndex, results } = get()
    set({ selectedIndex: Math.min(results.length - 1, selectedIndex + 1) })
  },
  open: () => set({ isOpen: true, query: '', results: [], selectedIndex: 0 }),
  close: () => set({ isOpen: false, query: '', results: [], selectedIndex: 0 }),
}))
