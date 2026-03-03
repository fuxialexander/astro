import { create } from "zustand"

interface PendingSave {
  flush: () => Promise<void>
}

interface ContentSaveStore {
  // Map of nodeId -> flush function that cancels debounce and immediately executes save
  pendingSaves: Map<string, PendingSave>

  // Register a pending save for a node
  registerPendingSave: (nodeId: string, flushFn: () => Promise<void>) => void

  // Clear a pending save (called after save completes naturally)
  clearPendingSave: (nodeId: string) => void

  // Flush pending saves for one or more nodes (waits for saves to complete)
  flushPendingSaves: (nodeIds: string[]) => Promise<void>
}

export const useContentSaveStore = create<ContentSaveStore>((set, get) => ({
  pendingSaves: new Map(),

  registerPendingSave: (nodeId, flushFn) => {
    set((state) => {
      const newMap = new Map(state.pendingSaves)
      newMap.set(nodeId, { flush: flushFn })
      return { pendingSaves: newMap }
    })
  },

  clearPendingSave: (nodeId) => {
    set((state) => {
      const newMap = new Map(state.pendingSaves)
      newMap.delete(nodeId)
      return { pendingSaves: newMap }
    })
  },

  flushPendingSaves: async (nodeIds) => {
    const { pendingSaves } = get()
    const flushPromises: Promise<void>[] = []

    for (const nodeId of nodeIds) {
      const pending = pendingSaves.get(nodeId)
      if (pending) {
        flushPromises.push(pending.flush())
      }
    }

    // Wait for all flushes to complete
    await Promise.all(flushPromises)
  },
}))
