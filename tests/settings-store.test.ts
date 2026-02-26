/**
 * Settings Store Unit Tests
 *
 * Tests model tier resolution, custom model mapping, and provider fallback logic.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  resolveModel,
  defaultModelTierMap,
  getEffectiveModelTierMap,
  type ModelTier,
  type CustomModelMap,
} from "../src/stores/settings-store"

// ---------------------------------------------------------------------------
// resolveModel — pure function tests
// ---------------------------------------------------------------------------

describe("resolveModel", () => {
  describe("default mappings (no custom overrides)", () => {
    it("resolves large tier for claude-code", () => {
      expect(resolveModel("large", "claude-code")).toBe("claude-opus-4-6")
    })

    it("resolves medium tier for claude-code", () => {
      expect(resolveModel("medium", "claude-code")).toBe("claude-sonnet-4-6")
    })

    it("resolves small tier for claude-code", () => {
      expect(resolveModel("small", "claude-code")).toBe("claude-haiku-4-5-20251001")
    })

    it("resolves large tier for codex", () => {
      expect(resolveModel("large", "codex")).toBe("o3")
    })

    it("resolves medium tier for codex", () => {
      expect(resolveModel("medium", "codex")).toBe("o4-mini")
    })

    it("resolves small tier for codex", () => {
      expect(resolveModel("small", "codex")).toBe("codex-mini")
    })
  })

  describe("fallback behavior", () => {
    it("defaults to claude-code when no provider specified", () => {
      expect(resolveModel("medium")).toBe("claude-sonnet-4-6")
    })

    it("defaults to claude-code when provider is undefined", () => {
      expect(resolveModel("large", undefined)).toBe("claude-opus-4-6")
    })

    it("falls back to claude-code for unknown provider", () => {
      expect(resolveModel("large", "unknown-provider")).toBe("claude-opus-4-6")
    })

    it("falls back to claude-code for bedrock (not in defaults)", () => {
      expect(resolveModel("medium", "bedrock")).toBe("claude-sonnet-4-6")
    })
  })

  describe("with custom model map", () => {
    it("uses custom override when present", () => {
      const custom: CustomModelMap = {
        large: { "claude-code": "my-custom-opus" },
      }
      expect(resolveModel("large", "claude-code", custom)).toBe("my-custom-opus")
    })

    it("falls back to default when custom map has no entry for tier", () => {
      const custom: CustomModelMap = {
        large: { "claude-code": "my-custom-opus" },
      }
      expect(resolveModel("medium", "claude-code", custom)).toBe("claude-sonnet-4-6")
    })

    it("falls back to default when custom map has no entry for provider", () => {
      const custom: CustomModelMap = {
        large: { codex: "custom-codex-large" },
      }
      expect(resolveModel("large", "claude-code", custom)).toBe("claude-opus-4-6")
    })

    it("supports custom provider in custom map", () => {
      const custom: CustomModelMap = {
        large: { bedrock: "anthropic.claude-3-opus-20240229-v1:0" },
        medium: { bedrock: "anthropic.claude-3-sonnet-20240229-v1:0" },
        small: { bedrock: "anthropic.claude-3-haiku-20240307-v1:0" },
      }
      expect(resolveModel("large", "bedrock", custom)).toBe("anthropic.claude-3-opus-20240229-v1:0")
      expect(resolveModel("medium", "bedrock", custom)).toBe("anthropic.claude-3-sonnet-20240229-v1:0")
      expect(resolveModel("small", "bedrock", custom)).toBe("anthropic.claude-3-haiku-20240307-v1:0")
    })

    it("custom map does not affect other providers", () => {
      const custom: CustomModelMap = {
        large: { bedrock: "bedrock-opus" },
      }
      // claude-code should still use default
      expect(resolveModel("large", "claude-code", custom)).toBe("claude-opus-4-6")
      // codex should still use default
      expect(resolveModel("large", "codex", custom)).toBe("o3")
    })

    it("custom map does not affect other tiers", () => {
      const custom: CustomModelMap = {
        large: { "claude-code": "custom-large" },
      }
      // medium and small should still use defaults
      expect(resolveModel("medium", "claude-code", custom)).toBe("claude-sonnet-4-6")
      expect(resolveModel("small", "claude-code", custom)).toBe("claude-haiku-4-5-20251001")
    })

    it("handles empty custom map gracefully", () => {
      expect(resolveModel("large", "claude-code", {})).toBe("claude-opus-4-6")
    })

    it("handles undefined custom map gracefully", () => {
      expect(resolveModel("large", "claude-code", undefined)).toBe("claude-opus-4-6")
    })
  })
})

// ---------------------------------------------------------------------------
// getEffectiveModelTierMap
// ---------------------------------------------------------------------------

describe("getEffectiveModelTierMap", () => {
  it("returns defaults when no custom map provided", () => {
    const result = getEffectiveModelTierMap()
    expect(result).toEqual(defaultModelTierMap)
  })

  it("returns defaults when empty custom map provided", () => {
    const result = getEffectiveModelTierMap({})
    expect(result).toEqual(defaultModelTierMap)
  })

  it("merges custom overrides into defaults", () => {
    const custom: CustomModelMap = {
      large: { "claude-code": "custom-opus" },
    }
    const result = getEffectiveModelTierMap(custom)
    expect(result.large["claude-code"]).toBe("custom-opus")
    // Other entries should be unchanged
    expect(result.large.codex).toBe("o3")
    expect(result.medium["claude-code"]).toBe("claude-sonnet-4-6")
  })

  it("adds new providers from custom map", () => {
    const custom: CustomModelMap = {
      large: { bedrock: "bedrock-opus" },
      medium: { bedrock: "bedrock-sonnet" },
      small: { bedrock: "bedrock-haiku" },
    }
    const result = getEffectiveModelTierMap(custom)
    expect(result.large.bedrock).toBe("bedrock-opus")
    expect(result.medium.bedrock).toBe("bedrock-sonnet")
    expect(result.small.bedrock).toBe("bedrock-haiku")
    // Defaults still present
    expect(result.large["claude-code"]).toBe("claude-opus-4-6")
    expect(result.medium.codex).toBe("o4-mini")
  })

  it("does not mutate the default map", () => {
    const originalLarge = { ...defaultModelTierMap.large }
    const custom: CustomModelMap = {
      large: { "claude-code": "modified", bedrock: "new-entry" },
    }
    getEffectiveModelTierMap(custom)
    expect(defaultModelTierMap.large).toEqual(originalLarge)
  })
})

// ---------------------------------------------------------------------------
// defaultModelTierMap structure validation
// ---------------------------------------------------------------------------

describe("defaultModelTierMap", () => {
  it("has all three tiers", () => {
    expect(defaultModelTierMap).toHaveProperty("large")
    expect(defaultModelTierMap).toHaveProperty("medium")
    expect(defaultModelTierMap).toHaveProperty("small")
  })

  it("has claude-code entries for all tiers", () => {
    expect(defaultModelTierMap.large["claude-code"]).toBeTruthy()
    expect(defaultModelTierMap.medium["claude-code"]).toBeTruthy()
    expect(defaultModelTierMap.small["claude-code"]).toBeTruthy()
  })

  it("has codex entries for all tiers", () => {
    expect(defaultModelTierMap.large.codex).toBeTruthy()
    expect(defaultModelTierMap.medium.codex).toBeTruthy()
    expect(defaultModelTierMap.small.codex).toBeTruthy()
  })

  it("claude-code large is opus", () => {
    expect(defaultModelTierMap.large["claude-code"]).toContain("opus")
  })

  it("claude-code medium is sonnet", () => {
    expect(defaultModelTierMap.medium["claude-code"]).toContain("sonnet")
  })

  it("claude-code small is haiku", () => {
    expect(defaultModelTierMap.small["claude-code"]).toContain("haiku")
  })
})

// ---------------------------------------------------------------------------
// useSettingsStore — stateful tests (zustand store)
// ---------------------------------------------------------------------------

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

describe("useSettingsStore", () => {
  // Dynamic import to ensure mocks are in place
  let useSettingsStore: typeof import("../src/stores/settings-store").useSettingsStore

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import("../src/stores/settings-store")
    useSettingsStore = mod.useSettingsStore
  })

  it("has correct initial state", () => {
    const state = useSettingsStore.getState()
    expect(state.modelTier).toBe("medium")
    expect(state.model).toBe("claude-sonnet-4-6")
    expect(state.defaultProvider).toBe("")
    expect(state.customModelMap).toEqual({})
  })

  it("setModelTier updates model for current provider", () => {
    const store = useSettingsStore.getState()
    store.setModelTier("large")
    const state = useSettingsStore.getState()
    expect(state.modelTier).toBe("large")
    expect(state.model).toBe("claude-opus-4-6")
  })

  it("setModelTier updates model for codex provider", () => {
    const store = useSettingsStore.getState()
    store.setDefaultProvider("codex")
    store.setModelTier("large")
    const state = useSettingsStore.getState()
    expect(state.model).toBe("o3")
  })

  it("setDefaultProvider re-resolves model", () => {
    const store = useSettingsStore.getState()
    store.setModelTier("large")
    expect(useSettingsStore.getState().model).toBe("claude-opus-4-6")
    store.setDefaultProvider("codex")
    expect(useSettingsStore.getState().model).toBe("o3")
  })

  it("getModelForProvider resolves for given provider", () => {
    const store = useSettingsStore.getState()
    store.setModelTier("medium")
    expect(store.getModelForProvider("claude-code")).toBe("claude-sonnet-4-6")
    expect(store.getModelForProvider("codex")).toBe("o4-mini")
  })

  it("getModelForProvider uses default provider when none given", () => {
    const store = useSettingsStore.getState()
    store.setDefaultProvider("codex")
    store.setModelTier("small")
    // No provider arg → uses default (codex)
    expect(useSettingsStore.getState().getModelForProvider()).toBe("codex-mini")
  })

  describe("custom model map", () => {
    it("setCustomModel adds override", () => {
      const store = useSettingsStore.getState()
      store.setCustomModel("large", "claude-code", "my-custom-model")
      const state = useSettingsStore.getState()
      expect(state.customModelMap.large?.["claude-code"]).toBe("my-custom-model")
    })

    it("setCustomModel removes override when matching default", () => {
      const store = useSettingsStore.getState()
      // First set a custom value
      store.setCustomModel("large", "claude-code", "custom-value")
      expect(useSettingsStore.getState().customModelMap.large?.["claude-code"]).toBe("custom-value")
      // Then set it back to the default
      store.setCustomModel("large", "claude-code", "claude-opus-4-6")
      const state = useSettingsStore.getState()
      expect(state.customModelMap.large?.["claude-code"]).toBeUndefined()
    })

    it("setCustomModel affects getModelForProvider", () => {
      const store = useSettingsStore.getState()
      store.setModelTier("large")
      store.setCustomModel("large", "claude-code", "my-custom-opus")
      expect(useSettingsStore.getState().getModelForProvider("claude-code")).toBe("my-custom-opus")
    })

    it("setCustomModel supports new custom providers", () => {
      const store = useSettingsStore.getState()
      store.setCustomModel("large", "bedrock", "bedrock-opus-model")
      store.setCustomModel("medium", "bedrock", "bedrock-sonnet-model")
      const state = useSettingsStore.getState()
      expect(state.getModelForProvider("bedrock")).toBe("bedrock-sonnet-model") // medium is default tier
      store.setModelTier("large")
      expect(useSettingsStore.getState().getModelForProvider("bedrock")).toBe("bedrock-opus-model")
    })

    it("setCustomModel re-resolves current model when affected", () => {
      const store = useSettingsStore.getState()
      store.setModelTier("large")
      expect(useSettingsStore.getState().model).toBe("claude-opus-4-6")
      store.setCustomModel("large", "claude-code", "overridden-opus")
      expect(useSettingsStore.getState().model).toBe("overridden-opus")
    })

    it("removeCustomModel removes override and restores default", () => {
      const store = useSettingsStore.getState()
      store.setModelTier("large")
      store.setCustomModel("large", "claude-code", "custom-opus")
      expect(useSettingsStore.getState().model).toBe("custom-opus")
      store.removeCustomModel("large", "claude-code")
      expect(useSettingsStore.getState().model).toBe("claude-opus-4-6")
      expect(useSettingsStore.getState().customModelMap.large?.["claude-code"]).toBeUndefined()
    })

    it("getEffectiveTierMap merges custom overrides", () => {
      const store = useSettingsStore.getState()
      store.setCustomModel("large", "bedrock", "bedrock-opus")
      store.setCustomModel("large", "claude-code", "custom-claude-large")
      const map = useSettingsStore.getState().getEffectiveTierMap()
      expect(map.large["claude-code"]).toBe("custom-claude-large")
      expect(map.large.bedrock).toBe("bedrock-opus")
      expect(map.large.codex).toBe("o3") // unchanged
      expect(map.medium["claude-code"]).toBe("claude-sonnet-4-6") // unchanged
    })
  })

  describe("persistence", () => {
    it("setCustomModel persists to dataClient", async () => {
      const { dataClient } = await import("../src/lib/data-client")
      const store = useSettingsStore.getState()
      store.setCustomModel("large", "bedrock", "bedrock-opus")
      // Wait for the async persist
      await new Promise((r) => setTimeout(r, 10))
      expect(dataClient.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          customModelMap: expect.stringContaining("bedrock-opus"),
        })
      )
    })

    it("setModelTier persists tier and model", async () => {
      const { dataClient } = await import("../src/lib/data-client")
      const store = useSettingsStore.getState()
      store.setModelTier("small")
      await new Promise((r) => setTimeout(r, 10))
      expect(dataClient.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          modelTier: "small",
          model: "claude-haiku-4-5-20251001",
        })
      )
    })
  })
})
