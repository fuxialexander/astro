import { create } from "zustand"

interface PendingSave {
  flush: () => Promise<void>
}

interface ContentSaveStore {
  // Map of nodeId -> flush function that cancels debounce and immediately executes save
  pendingSaves: Map<string, PendingSave>

  // Register a pending save for a node
  registerPendingSave: (nodeId: string, flushFn: () => Promise<void>) => void

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

  flushPendingSaves: async (nodeIds) => {
    const { pendingSaves } = get()

    // Build array of {nodeId, promise} to track which promise belongs to which node
    const flushTasks: Array<{ nodeId: string; promise: Promise<void> }> = []
    for (const nodeId of nodeIds) {
      const pending = pendingSaves.get(nodeId)
      if (pending) {
        flushTasks.push({ nodeId, promise: pending.flush() })
      }
    }

    // Wait for all flushes to complete
    // Catch errors from individual flushes to prevent blocking execution
    // (errors are logged in the flush functions themselves)
    const results = await Promise.allSettled(flushTasks.map((t) => t.promise))

    // Check if any flushes failed and throw a consolidated error with node IDs
    const failures = results
      .map((result, index) => ({ result, nodeId: flushTasks[index].nodeId }))
      .filter((item) => item.result.status === 'rejected')

    if (failures.length > 0) {
      const failedNodeIds = failures.map((f) => f.nodeId)
      const errors = failures.map((f) => (f.result as PromiseRejectedResult).reason)
      console.error('[content-save-store] Some content saves failed:', { nodeIds: failedNodeIds, errors })
      throw new Error(`Failed to save content for tasks: ${failedNodeIds.join(', ')}`)
    }
  },
}))
