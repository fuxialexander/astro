import { describe, it, expect } from "vitest"
import { getModelItemStyle } from "../model-utils"

describe("getModelItemStyle", () => {
  const defaultModel = "claude-sonnet-4-20250514"

  it("returns highlighted style when model is selected", () => {
    const result = getModelItemStyle("claude-sonnet-4-20250514", "claude-sonnet-4-20250514", defaultModel)
    expect(result.isSelected).toBe(true)
    expect(result.itemClassName).toContain("bg-success/10")
    expect(result.itemClassName).toContain("text-success")
    expect(result.itemClassName).toContain("font-medium")
  })

  it("returns plain style when model is not selected", () => {
    const result = getModelItemStyle("claude-opus-4-20250514", "claude-sonnet-4-20250514", defaultModel)
    expect(result.isSelected).toBe(false)
    expect(result.itemClassName).toBe("gap-2")
    expect(result.itemClassName).not.toContain("bg-success")
  })

  it("marks model as default when it matches defaultModel", () => {
    const result = getModelItemStyle("claude-sonnet-4-20250514", "other-model", defaultModel)
    expect(result.isDefault).toBe(true)
    expect(result.badgeVariant).toBe("secondary")
  })

  it("marks model as not default when it does not match", () => {
    const result = getModelItemStyle("claude-opus-4-20250514", "claude-opus-4-20250514", defaultModel)
    expect(result.isDefault).toBe(false)
  })

  it("uses completed badge variant when model is both selected and default", () => {
    const result = getModelItemStyle("claude-sonnet-4-20250514", "claude-sonnet-4-20250514", defaultModel)
    expect(result.isSelected).toBe(true)
    expect(result.isDefault).toBe(true)
    expect(result.badgeVariant).toBe("completed")
  })

  it("uses secondary badge variant when model is default but not selected", () => {
    const result = getModelItemStyle("claude-sonnet-4-20250514", "other-model", defaultModel)
    expect(result.isDefault).toBe(true)
    expect(result.isSelected).toBe(false)
    expect(result.badgeVariant).toBe("secondary")
  })

  it("handles undefined defaultModel", () => {
    const result = getModelItemStyle("any-model", "any-model", undefined)
    expect(result.isSelected).toBe(true)
    expect(result.isDefault).toBe(false)
    expect(result.badgeVariant).toBe("secondary")
  })

  it("handles empty string selectedModel (no selection)", () => {
    const result = getModelItemStyle("claude-sonnet-4-20250514", "", defaultModel)
    expect(result.isSelected).toBe(false)
    expect(result.isDefault).toBe(true)
    expect(result.itemClassName).toBe("gap-2")
  })

  it("handles both selectedModel and defaultModel as empty/undefined", () => {
    const result = getModelItemStyle("model-a", "", undefined)
    expect(result.isSelected).toBe(false)
    expect(result.isDefault).toBe(false)
    expect(result.badgeVariant).toBe("secondary")
    expect(result.itemClassName).toBe("gap-2")
  })

  it("treats model names as case-sensitive", () => {
    const result = getModelItemStyle("Claude-Sonnet", "claude-sonnet", "Claude-Sonnet")
    expect(result.isSelected).toBe(false)
    expect(result.isDefault).toBe(true)
  })

  it("returns correct style for each model in a list", () => {
    const models = ["model-a", "model-b", "model-c"]
    const selected = "model-b"
    const def = "model-a"

    const results = models.map((m) => getModelItemStyle(m, selected, def))

    // model-a: default, not selected
    expect(results[0].isDefault).toBe(true)
    expect(results[0].isSelected).toBe(false)
    expect(results[0].badgeVariant).toBe("secondary")

    // model-b: selected, not default
    expect(results[1].isDefault).toBe(false)
    expect(results[1].isSelected).toBe(true)
    expect(results[1].itemClassName).toContain("bg-success/10")

    // model-c: neither
    expect(results[2].isDefault).toBe(false)
    expect(results[2].isSelected).toBe(false)
    expect(results[2].itemClassName).toBe("gap-2")
  })
})
