import { describe, it, expect } from "vitest"
import { deriveAvailableProviders, isProviderAvailable, PROVIDER_NAMES } from "../provider-utils"
import type { ProviderStatus } from "@/types"

describe("deriveAvailableProviders", () => {
  const globalProviders: ProviderStatus[] = [
    {
      id: "global-provider",
      name: "Global Provider",
      installed: true,
      authStatus: "authenticated",
      available: true,
    },
  ]

  it("builds providers from machine provider list when available", () => {
    const machineProviders = [
      { type: "claude-sdk", status: "available" },
      { type: "codex", status: "available" },
    ]

    const result = deriveAvailableProviders(machineProviders, globalProviders)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: "claude-sdk",
      name: "Claude Agent SDK",
      available: true,
      installed: true,
      authStatus: "authenticated",
    })
    expect(result[1]).toEqual({
      id: "codex",
      name: "OpenAI Codex",
      available: true,
      installed: true,
      authStatus: "authenticated",
    })
  })

  it("falls back to global providers when machineProviders is undefined", () => {
    const result = deriveAvailableProviders(undefined, globalProviders)
    expect(result).toBe(globalProviders)
  })

  it("falls back to global providers when machineProviders is null", () => {
    const result = deriveAvailableProviders(null, globalProviders)
    expect(result).toBe(globalProviders)
  })

  it("falls back to global providers when machineProviders is empty array", () => {
    const result = deriveAvailableProviders([], globalProviders)
    expect(result).toBe(globalProviders)
  })

  it("maps 'available' status to authenticated authStatus", () => {
    const machineProviders = [{ type: "claude-sdk", status: "available" }]
    const result = deriveAvailableProviders(machineProviders, [])
    expect(result[0].authStatus).toBe("authenticated")
    expect(result[0].available).toBe(true)
  })

  it("maps non-available status to unknown authStatus", () => {
    const machineProviders = [{ type: "claude-sdk", status: "initializing" }]
    const result = deriveAvailableProviders(machineProviders, [])
    expect(result[0].authStatus).toBe("unknown")
    expect(result[0].available).toBe(false)
  })

  it("maps 'error' status to unknown authStatus and not available", () => {
    const machineProviders = [{ type: "codex", status: "error" }]
    const result = deriveAvailableProviders(machineProviders, [])
    expect(result[0].authStatus).toBe("unknown")
    expect(result[0].available).toBe(false)
  })

  it("uses provider type as name for unknown provider types", () => {
    const machineProviders = [{ type: "custom-provider-xyz", status: "available" }]
    const result = deriveAvailableProviders(machineProviders, [])
    expect(result[0].id).toBe("custom-provider-xyz")
    expect(result[0].name).toBe("custom-provider-xyz")
  })

  it("uses human-readable names for all known provider types", () => {
    const knownTypes = Object.keys(PROVIDER_NAMES)
    const machineProviders = knownTypes.map((type) => ({ type, status: "available" }))
    const result = deriveAvailableProviders(machineProviders, [])

    for (const provider of result) {
      expect(provider.name).toBe(PROVIDER_NAMES[provider.id])
      expect(provider.name).not.toBe(provider.id) // Should use display name, not ID
    }
  })

  it("always sets installed to true for machine-derived providers", () => {
    const machineProviders = [
      { type: "claude-sdk", status: "available" },
      { type: "codex", status: "error" },
    ]
    const result = deriveAvailableProviders(machineProviders, [])
    for (const provider of result) {
      expect(provider.installed).toBe(true)
    }
  })

  it("returns empty array when both machine and global providers are empty", () => {
    const result = deriveAvailableProviders([], [])
    expect(result).toEqual([])
  })

  it("returns a new array (not the same reference) when deriving from machine", () => {
    const machineProviders = [{ type: "claude-sdk", status: "available" }]
    const result = deriveAvailableProviders(machineProviders, globalProviders)
    expect(result).not.toBe(globalProviders)
  })

  it("handles mixed available and unavailable providers", () => {
    const machineProviders = [
      { type: "claude-sdk", status: "available" },
      { type: "codex", status: "unavailable" },
      { type: "claude-code", status: "available" },
    ]
    const result = deriveAvailableProviders(machineProviders, [])

    expect(result).toHaveLength(3)
    expect(result[0].available).toBe(true)
    expect(result[1].available).toBe(false)
    expect(result[2].available).toBe(true)
  })
})

describe("isProviderAvailable", () => {
  const providers: ProviderStatus[] = [
    { id: "claude-sdk", name: "Claude Agent SDK", installed: true, authStatus: "authenticated", available: true },
    { id: "codex", name: "OpenAI Codex", installed: true, authStatus: "unknown", available: false },
  ]

  it("returns true when provider exists in list", () => {
    expect(isProviderAvailable("claude-sdk", providers)).toBe(true)
  })

  it("returns true even when provider is not available (exists but disabled)", () => {
    // isProviderAvailable checks existence, not availability status
    expect(isProviderAvailable("codex", providers)).toBe(true)
  })

  it("returns false when provider does not exist in list", () => {
    expect(isProviderAvailable("nonexistent-provider", providers)).toBe(false)
  })

  it("returns true for empty string (Auto option)", () => {
    expect(isProviderAvailable("", providers)).toBe(true)
  })

  it("returns true for empty string even with empty provider list", () => {
    expect(isProviderAvailable("", [])).toBe(true)
  })

  it("returns false for any named provider with empty list", () => {
    expect(isProviderAvailable("claude-sdk", [])).toBe(false)
  })
})

describe("PROVIDER_NAMES", () => {
  it("contains entries for claude-sdk, claude-code, and codex", () => {
    expect(PROVIDER_NAMES["claude-sdk"]).toBe("Claude Agent SDK")
    expect(PROVIDER_NAMES["claude-code"]).toBe("Claude Code")
    expect(PROVIDER_NAMES["codex"]).toBe("OpenAI Codex")
  })

  it("returns undefined for unknown provider types", () => {
    expect(PROVIDER_NAMES["unknown"]).toBeUndefined()
  })
})
