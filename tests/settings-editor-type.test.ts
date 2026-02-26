/**
 * Settings Store — Editor Type Tests
 *
 * Tests the editorType preference and setEditorType method on the settings store.
 *
 * Run with: npx vitest run tests/settings-editor-type.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock dataClient to prevent real API calls
vi.mock("../src/lib/data-client", () => ({
  dataClient: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock api-url
vi.mock("../src/lib/api-url", () => ({
  apiUrl: (path: string) => `http://localhost:3001${path}`,
}))

// Mock fetch for checkConnection
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ authenticated: false }),
}))

describe("useSettingsStore — editorType", () => {
  let useSettingsStore: typeof import("../src/stores/settings-store").useSettingsStore

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import("../src/stores/settings-store")
    useSettingsStore = mod.useSettingsStore
  })

  // ─── Default state ─────────────────────────────────────────────────

  it("has 'cursor' as default editorType", () => {
    const state = useSettingsStore.getState()
    expect(state.editorType).toBe("cursor")
  })

  // ─── setEditorType ─────────────────────────────────────────────────

  it("setEditorType changes to vscode", () => {
    useSettingsStore.getState().setEditorType("vscode")
    expect(useSettingsStore.getState().editorType).toBe("vscode")
  })

  it("setEditorType changes back to cursor", () => {
    useSettingsStore.getState().setEditorType("vscode")
    useSettingsStore.getState().setEditorType("cursor")
    expect(useSettingsStore.getState().editorType).toBe("cursor")
  })

  it("setEditorType persists via dataClient.updateSettings", async () => {
    const { dataClient } = await import("../src/lib/data-client")
    useSettingsStore.getState().setEditorType("vscode")

    // Wait for the async persist
    await new Promise((r) => setTimeout(r, 10))

    expect(dataClient.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        editorType: "vscode",
      })
    )
  })

  // ─── load from persisted settings ──────────────────────────────────

  describe("load", () => {
    it("loads editorType from persisted settings (cursor)", async () => {
      const { dataClient } = await import("../src/lib/data-client")
      ;(dataClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        editorType: "cursor",
      })

      await useSettingsStore.getState().load()
      expect(useSettingsStore.getState().editorType).toBe("cursor")
    })

    it("loads editorType from persisted settings (vscode)", async () => {
      const { dataClient } = await import("../src/lib/data-client")
      ;(dataClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        editorType: "vscode",
      })

      await useSettingsStore.getState().load()
      expect(useSettingsStore.getState().editorType).toBe("vscode")
    })

    it("ignores invalid editorType values from persisted settings", async () => {
      const { dataClient } = await import("../src/lib/data-client")
      ;(dataClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        editorType: "emacs",  // invalid
      })

      await useSettingsStore.getState().load()
      // Should keep the default
      expect(useSettingsStore.getState().editorType).toBe("cursor")
    })

    it("keeps default when editorType is not in persisted settings", async () => {
      const { dataClient } = await import("../src/lib/data-client")
      ;(dataClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})

      await useSettingsStore.getState().load()
      expect(useSettingsStore.getState().editorType).toBe("cursor")
    })
  })

  // ─── editorType does not affect model resolution ───────────────────

  it("setEditorType does not change model or modelTier", () => {
    const before = useSettingsStore.getState()
    const originalModel = before.model
    const originalTier = before.modelTier

    before.setEditorType("vscode")

    const after = useSettingsStore.getState()
    expect(after.model).toBe(originalModel)
    expect(after.modelTier).toBe(originalTier)
  })

  // ─── Type safety ───────────────────────────────────────────────────

  it("editorType is typed as 'cursor' | 'vscode'", () => {
    const state = useSettingsStore.getState()
    // TypeScript would reject assignment of invalid values at compile time.
    // At runtime, verify the value is one of the expected options.
    expect(["cursor", "vscode"]).toContain(state.editorType)
  })
})
