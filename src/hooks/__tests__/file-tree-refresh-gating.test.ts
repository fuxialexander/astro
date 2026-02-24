import { describe, it, expect } from "vitest"

/**
 * Tests for the file tree refresh gating logic used in app.tsx DataLoader.
 *
 * The condition is:
 *   if (!projectsLoaded) return
 *   if (isLocalMode || realtimeMachinesSize > 0) refreshAllFileTrees()
 *
 * This ensures:
 * - In local mode: refresh fires as soon as projects load (no relay/machines needed)
 * - In server mode: refresh waits until at least one machine is connected via relay
 * - Refresh never fires before projects are loaded
 */

interface GatingInput {
  projectsLoaded: boolean
  isLocalMode: boolean
  realtimeMachinesSize: number
}

/**
 * Pure function representing the gating logic extracted from the useEffect in app.tsx.
 * Returns true if refreshAllFileTrees() should be called.
 */
function shouldRefreshFileTrees({ projectsLoaded, isLocalMode, realtimeMachinesSize }: GatingInput): boolean {
  if (!projectsLoaded) return false
  return isLocalMode || realtimeMachinesSize > 0
}

describe("file tree refresh gating logic", () => {
  describe("projects not loaded", () => {
    it("does not refresh when projects are not loaded (local mode)", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: false, isLocalMode: true, realtimeMachinesSize: 0 })).toBe(false)
    })

    it("does not refresh when projects are not loaded (server mode, machines connected)", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: false, isLocalMode: false, realtimeMachinesSize: 3 })).toBe(false)
    })

    it("does not refresh when projects are not loaded (server mode, no machines)", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: false, isLocalMode: false, realtimeMachinesSize: 0 })).toBe(false)
    })
  })

  describe("local mode", () => {
    it("refreshes immediately when projects are loaded (no machines needed)", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: true, realtimeMachinesSize: 0 })).toBe(true)
    })

    it("refreshes when projects are loaded even if machines happen to be connected", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: true, realtimeMachinesSize: 2 })).toBe(true)
    })
  })

  describe("server mode", () => {
    it("does not refresh when no machines are connected", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: false, realtimeMachinesSize: 0 })).toBe(false)
    })

    it("refreshes when at least one machine is connected", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: false, realtimeMachinesSize: 1 })).toBe(true)
    })

    it("refreshes when multiple machines are connected", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: false, realtimeMachinesSize: 5 })).toBe(true)
    })
  })

  describe("transition scenarios", () => {
    it("simulates startup sequence: projects load first, then machines connect", () => {
      // Step 1: Nothing loaded
      expect(shouldRefreshFileTrees({ projectsLoaded: false, isLocalMode: false, realtimeMachinesSize: 0 })).toBe(false)
      // Step 2: Projects loaded, no machines yet
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: false, realtimeMachinesSize: 0 })).toBe(false)
      // Step 3: Machine connects via relay
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: false, realtimeMachinesSize: 1 })).toBe(true)
    })

    it("simulates startup sequence: machines connect first, then projects load", () => {
      // Step 1: Machine connects before projects
      expect(shouldRefreshFileTrees({ projectsLoaded: false, isLocalMode: false, realtimeMachinesSize: 1 })).toBe(false)
      // Step 2: Projects load
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: false, realtimeMachinesSize: 1 })).toBe(true)
    })

    it("simulates local mode startup: projects load, no machines ever", () => {
      expect(shouldRefreshFileTrees({ projectsLoaded: false, isLocalMode: true, realtimeMachinesSize: 0 })).toBe(false)
      expect(shouldRefreshFileTrees({ projectsLoaded: true, isLocalMode: true, realtimeMachinesSize: 0 })).toBe(true)
    })
  })
})
