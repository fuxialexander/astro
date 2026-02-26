import { create } from "zustand"
import { apiUrl } from "@/lib/api-url"
import { dataClient } from "@/lib/data-client"

export type ModelTier = "large" | "medium" | "small"

/**
 * Default model tier → provider → model ID mapping.
 * Users can override individual entries via customModelMap.
 *
 * For claude-code, we use CLI aliases ("opus", "sonnet", "haiku") instead of
 * full model IDs. The Claude Code CLI resolves these aliases via env vars:
 *   ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL
 * This ensures Bedrock/Vertex users whose env vars point to provider-specific
 * model names (e.g. "us.anthropic.claude-opus-4-6-vl") are not overridden.
 */
export const defaultModelTierMap: Record<ModelTier, Record<string, string>> = {
  large: {
    "claude-code": "opus",
    codex: "o3",
  },
  medium: {
    "claude-code": "sonnet",
    codex: "o4-mini",
  },
  small: {
    "claude-code": "haiku",
    codex: "codex-mini",
  },
}

/** @deprecated Use defaultModelTierMap instead */
export const modelTierMap = defaultModelTierMap

/**
 * User-customizable overrides: tier → provider → model ID.
 * Only stores entries that differ from defaultModelTierMap.
 */
export type CustomModelMap = Partial<Record<ModelTier, Record<string, string>>>

/**
 * Resolve a model tier + provider into a concrete model ID.
 * Checks custom overrides first, then default map, then falls back to claude-code.
 */
export function resolveModel(tier: ModelTier, provider?: string, customMap?: CustomModelMap): string {
  const effectiveProvider = provider || "claude-code"
  // Check user customizations first
  const custom = customMap?.[tier]?.[effectiveProvider]
  if (custom) return custom
  // Then check defaults
  return defaultModelTierMap[tier]?.[effectiveProvider] ?? defaultModelTierMap[tier]["claude-code"]
}

/**
 * Get the effective (merged) model tier map: defaults + custom overrides.
 */
export function getEffectiveModelTierMap(customMap?: CustomModelMap): Record<ModelTier, Record<string, string>> {
  const result: Record<ModelTier, Record<string, string>> = {
    large: { ...defaultModelTierMap.large },
    medium: { ...defaultModelTierMap.medium },
    small: { ...defaultModelTierMap.small },
  }
  if (customMap) {
    for (const tier of ["large", "medium", "small"] as ModelTier[]) {
      if (customMap[tier]) {
        Object.assign(result[tier], customMap[tier])
      }
    }
  }
  return result
}

interface SettingsState {
  model: string // kept for backward compat; derived from modelTier + provider
  modelTier: ModelTier
  defaultProvider: string // '' = auto/first available
  customModelMap: CustomModelMap // user overrides for tier → provider → model
  editorType: 'cursor' | 'vscode'
  connectionStatus: "connected" | "disconnected" | "checking"
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  checkConnection: () => Promise<void>
  setModel: (model: string) => void
  setModelTier: (tier: ModelTier) => void
  setDefaultProvider: (provider: string) => void
  setEditorType: (type: 'cursor' | 'vscode') => void
  setCustomModel: (tier: ModelTier, provider: string, model: string) => void
  removeCustomModel: (tier: ModelTier, provider: string) => void
  /** Resolve current tier to a model ID for the given provider */
  getModelForProvider: (provider?: string) => string
  /** Get the effective tier map (defaults merged with custom overrides) */
  getEffectiveTierMap: () => Record<ModelTier, Record<string, string>>
}

function tierFromModel(model: string): ModelTier {
  for (const [tier, providers] of Object.entries(defaultModelTierMap)) {
    for (const m of Object.values(providers)) {
      if (model === m || model.includes(m) || m.includes(model)) {
        return tier as ModelTier
      }
    }
  }
  return "medium"
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  model: "sonnet",
  modelTier: "medium",
  defaultProvider: "",
  customModelMap: {},
  editorType: "cursor",
  connectionStatus: "disconnected",
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const settings = await dataClient.getSettings()
      const updates: Partial<SettingsState> = { loaded: true, loading: false }
      if (settings.defaultProvider) {
        updates.defaultProvider = settings.defaultProvider
      }
      // Load custom model map
      if (settings.customModelMap) {
        try {
          updates.customModelMap = JSON.parse(settings.customModelMap) as CustomModelMap
        } catch {
          // ignore malformed JSON
        }
      }
      if (settings.editorType === 'cursor' || settings.editorType === 'vscode') {
        updates.editorType = settings.editorType
      }
      if (settings.modelTier) {
        const tier = settings.modelTier as ModelTier
        updates.modelTier = tier
        updates.model = resolveModel(tier, settings.defaultProvider || get().defaultProvider || "claude-code", updates.customModelMap || get().customModelMap)
      } else if (settings.model) {
        // Backward compat: derive tier from legacy model string
        updates.model = settings.model
        updates.modelTier = tierFromModel(settings.model)
      }
      set(updates)
    } catch (err) {
      set({ loaded: true, loading: false, error: err instanceof Error ? err.message : 'Failed to load settings' })
    }
    // Check connection on load
    get().checkConnection()
  },

  checkConnection: async () => {
    set({ connectionStatus: "checking" })
    try {
      const res = await fetch(apiUrl("/api/health"))
      if (!res.ok) throw new Error("Backend unreachable")
      const data = await res.json()
      set({ connectionStatus: data.authenticated ? "connected" : "disconnected" })
    } catch {
      set({ connectionStatus: "disconnected" })
    }
  },

  setModel: (model) => {
    const tier = tierFromModel(model)
    set({ model, modelTier: tier })
    dataClient.updateSettings({ model, modelTier: tier }).catch(() => {})
  },

  setModelTier: (modelTier) => {
    const { defaultProvider, customModelMap } = get()
    const provider = defaultProvider || "claude-code"
    const model = resolveModel(modelTier, provider, customModelMap)
    set({ modelTier, model })
    dataClient.updateSettings({ modelTier, model }).catch(() => {})
  },

  setEditorType: (editorType) => {
    set({ editorType })
    dataClient.updateSettings({ editorType }).catch(() => {})
  },

  setDefaultProvider: (defaultProvider) => {
    const { modelTier, customModelMap } = get()
    const model = resolveModel(modelTier, defaultProvider || "claude-code", customModelMap)
    set({ defaultProvider, model })
    dataClient.updateSettings({ defaultProvider, model, modelTier: modelTier }).catch(() => {})
  },

  setCustomModel: (tier, provider, model) => {
    const { customModelMap, modelTier, defaultProvider } = get()
    const next: CustomModelMap = { ...customModelMap }
    if (!next[tier]) next[tier] = {}
    // If model matches the default, remove the override
    if (model === defaultModelTierMap[tier]?.[provider]) {
      delete next[tier]![provider]
      if (Object.keys(next[tier]!).length === 0) delete next[tier]
    } else {
      next[tier]![provider] = model
    }
    // Re-resolve current model if affected
    const currentModel = resolveModel(modelTier, defaultProvider || "claude-code", next)
    set({ customModelMap: next, model: currentModel })
    dataClient.updateSettings({ customModelMap: JSON.stringify(next), model: currentModel }).catch(() => {})
  },

  removeCustomModel: (tier, provider) => {
    const { customModelMap, modelTier, defaultProvider } = get()
    const next: CustomModelMap = { ...customModelMap }
    if (next[tier]) {
      delete next[tier]![provider]
      if (Object.keys(next[tier]!).length === 0) delete next[tier]
    }
    const currentModel = resolveModel(modelTier, defaultProvider || "claude-code", next)
    set({ customModelMap: next, model: currentModel })
    dataClient.updateSettings({ customModelMap: JSON.stringify(next), model: currentModel }).catch(() => {})
  },

  getModelForProvider: (provider?: string) => {
    const { modelTier, defaultProvider, customModelMap } = get()
    return resolveModel(modelTier, provider || defaultProvider || "claude-code", customModelMap)
  },

  getEffectiveTierMap: () => {
    return getEffectiveModelTierMap(get().customModelMap)
  },
}))
