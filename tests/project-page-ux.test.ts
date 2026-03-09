/**
 * Project Page UX Improvements — Unit Tests
 *
 * Tests for:
 * 1. UI store sidebar width clamping and persistence
 * 2. Instruction picker preset/instruction resolution
 * 3. Theme default detection (system preference)
 */
import { describe, it, expect } from "vitest"

// ---------------------------------------------------------------------------
// 1. Sidebar width clamping logic (extracted from ui-store)
// ---------------------------------------------------------------------------

describe("sidebar width clamping", () => {
  // Replicate the clamping logic from ui-store.ts
  function clampWidth(width: number): number {
    return Math.max(200, Math.min(480, width))
  }

  it("clamps width below minimum to 200", () => {
    expect(clampWidth(100)).toBe(200)
    expect(clampWidth(0)).toBe(200)
    expect(clampWidth(-50)).toBe(200)
  })

  it("clamps width above maximum to 480", () => {
    expect(clampWidth(500)).toBe(480)
    expect(clampWidth(1000)).toBe(480)
  })

  it("leaves width within range unchanged", () => {
    expect(clampWidth(200)).toBe(200)
    expect(clampWidth(260)).toBe(260)
    expect(clampWidth(350)).toBe(350)
    expect(clampWidth(480)).toBe(480)
  })

  it("handles the default width of 260", () => {
    expect(clampWidth(260)).toBe(260)
  })
})

describe("sidebar width localStorage parsing", () => {
  // Replicate the initialization logic from ui-store.ts
  function parseSidebarWidth(stored: string | null): number {
    try {
      if (!stored) return 260
      const n = Number(stored)
      return Number.isFinite(n) ? Math.max(200, Math.min(480, n)) : 260
    } catch {
      return 260
    }
  }

  it("returns 260 when nothing stored", () => {
    expect(parseSidebarWidth(null)).toBe(260)
  })

  it("parses valid stored width", () => {
    expect(parseSidebarWidth("300")).toBe(300)
    expect(parseSidebarWidth("400")).toBe(400)
  })

  it("clamps stored width below min", () => {
    expect(parseSidebarWidth("50")).toBe(200)
  })

  it("clamps stored width above max", () => {
    expect(parseSidebarWidth("999")).toBe(480)
  })

  it("returns 260 for non-numeric values", () => {
    // Number("not-a-number") = NaN — guarded by Number.isFinite() check
    expect(parseSidebarWidth("not-a-number")).toBe(260)
  })

  it("handles empty string as falsy — returns default", () => {
    // Empty string is falsy, so the ternary returns the default 260
    expect(parseSidebarWidth("")).toBe(260)
  })
})

// ---------------------------------------------------------------------------
// 2. Instruction picker resolution logic
// ---------------------------------------------------------------------------

describe("instruction picker resolution", () => {
  interface Preset {
    id: string
    name: string
    description: string
  }

  interface Instruction {
    id: string
    name: string
    tags: string[]
  }

  const presets: Preset[] = [
    { id: "preset-default", name: "Default Compute Guide", description: "Universal guide" },
    { id: "preset-k8s", name: "Local Machine + Kubernetes", description: "K8s cluster" },
    { id: "preset-slurm", name: "Local Machine + Slurm HPC", description: "Slurm cluster" },
    { id: "preset-hpc-login", name: "Slurm HPC (Agent on Login Node)", description: "Login node" },
  ]

  const instructions: Instruction[] = [
    { id: "custom-1", name: "My Custom Instruction", tags: ["gpu", "docker"] },
    { id: "custom-2", name: "Another Instruction", tags: ["slurm"] },
  ]

  // Replicate the resolution logic from instruction-picker.tsx
  function resolveDisplayName(
    currentInstructionId: string | null | undefined,
    instrs: Instruction[],
    psets: Preset[],
  ): string | null {
    const currentInstruction = instrs.find((i) => i.id === currentInstructionId)
    const currentPreset = psets.find((p) => p.id === currentInstructionId)
    return currentInstruction?.name ?? currentPreset?.name ?? null
  }

  it("returns null when no instruction selected", () => {
    expect(resolveDisplayName(null, instructions, presets)).toBeNull()
    expect(resolveDisplayName(undefined, instructions, presets)).toBeNull()
  })

  it("resolves custom instruction name", () => {
    expect(resolveDisplayName("custom-1", instructions, presets)).toBe("My Custom Instruction")
    expect(resolveDisplayName("custom-2", instructions, presets)).toBe("Another Instruction")
  })

  it("resolves preset name", () => {
    expect(resolveDisplayName("preset-default", instructions, presets)).toBe("Default Compute Guide")
    expect(resolveDisplayName("preset-k8s", instructions, presets)).toBe("Local Machine + Kubernetes")
    expect(resolveDisplayName("preset-slurm", instructions, presets)).toBe("Local Machine + Slurm HPC")
    expect(resolveDisplayName("preset-hpc-login", instructions, presets)).toBe("Slurm HPC (Agent on Login Node)")
  })

  it("returns null for unknown instruction ID", () => {
    expect(resolveDisplayName("unknown-id", instructions, presets)).toBeNull()
  })

  it("prefers custom instruction over preset if IDs collide", () => {
    const overlappingInstrs = [{ id: "preset-default", name: "Custom Override", tags: [] }]
    expect(resolveDisplayName("preset-default", overlappingInstrs, presets)).toBe("Custom Override")
  })
})

// ---------------------------------------------------------------------------
// 3. Theme system default behavior
// ---------------------------------------------------------------------------

describe("theme default detection", () => {
  // Replicate the theme resolution logic from theme-provider.tsx
  function resolveThemeInit(stored: string | null, defaultTheme: string): string {
    if (stored === "bright") return "light" // legacy migration
    return stored || defaultTheme
  }

  it("returns stored theme when present", () => {
    expect(resolveThemeInit("dark", "system")).toBe("dark")
    expect(resolveThemeInit("light", "system")).toBe("light")
  })

  it("returns default when nothing stored", () => {
    expect(resolveThemeInit(null, "system")).toBe("system")
    expect(resolveThemeInit(null, "light")).toBe("light")
  })

  it("migrates legacy 'bright' theme to 'light'", () => {
    expect(resolveThemeInit("bright", "system")).toBe("light")
  })

  it("preserves custom theme names", () => {
    expect(resolveThemeInit("my-custom-theme", "system")).toBe("my-custom-theme")
  })

  // isDark resolution logic from sidebar.tsx
  function isDark(theme: string, systemPrefersDark: boolean): boolean {
    return theme === "dark" || (theme === "system" && systemPrefersDark)
  }

  it("detects dark when theme is explicitly dark", () => {
    expect(isDark("dark", false)).toBe(true)
    expect(isDark("dark", true)).toBe(true)
  })

  it("detects dark when system theme is dark and theme is system", () => {
    expect(isDark("system", true)).toBe(true)
  })

  it("detects light when system theme is light and theme is system", () => {
    expect(isDark("system", false)).toBe(false)
  })

  it("detects light when theme is explicitly light", () => {
    expect(isDark("light", false)).toBe(false)
    expect(isDark("light", true)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Provider resolution for WorkdirBar AI agent selector
// ---------------------------------------------------------------------------

describe("provider resolution for AI agent selector", () => {
  interface LiveProvider {
    type: string
    status: string
  }

  interface LiveMachine {
    machineId: string
    providers: LiveProvider[]
  }

  interface RegisteredMachine {
    id: string
    providers: string[]
  }

  // Replicate the provider resolution logic from plan-view.tsx WorkdirBar
  function resolveProviderIds(
    machineId: string | undefined,
    liveMachines: LiveMachine[],
    machines: RegisteredMachine[],
  ): string[] {
    if (!machineId) return []
    const live = liveMachines.find((lm) => lm.machineId === machineId)
    const reg = machines.find((m) => m.id === machineId)
    return live?.providers?.map((p) => p.type) ?? reg?.providers ?? []
  }

  const liveMachines: LiveMachine[] = [
    {
      machineId: "machine-1",
      providers: [
        { type: "claude-sdk", status: "available" },
        { type: "codex", status: "available" },
      ],
    },
  ]

  const registeredMachines: RegisteredMachine[] = [
    { id: "machine-1", providers: ["claude-sdk"] },
    { id: "machine-2", providers: ["claude-sdk", "codex"] },
  ]

  it("returns empty array when no machine selected", () => {
    expect(resolveProviderIds(undefined, liveMachines, registeredMachines)).toEqual([])
  })

  it("prefers live providers over registered", () => {
    const result = resolveProviderIds("machine-1", liveMachines, registeredMachines)
    expect(result).toEqual(["claude-sdk", "codex"])
  })

  it("falls back to registered providers when not live", () => {
    const result = resolveProviderIds("machine-2", liveMachines, registeredMachines)
    expect(result).toEqual(["claude-sdk", "codex"])
  })

  it("returns empty for unknown machine", () => {
    expect(resolveProviderIds("unknown", liveMachines, registeredMachines)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. Settings panel collapse persistence
// ---------------------------------------------------------------------------

describe("settings panel collapse state", () => {
  // Replicate the initialization logic from sidebar.tsx
  function parseSettingsExpanded(stored: string | null): boolean {
    return stored !== "collapsed"
  }

  it("defaults to expanded when nothing stored", () => {
    expect(parseSettingsExpanded(null)).toBe(true)
  })

  it("reads expanded state", () => {
    expect(parseSettingsExpanded("expanded")).toBe(true)
  })

  it("reads collapsed state", () => {
    expect(parseSettingsExpanded("collapsed")).toBe(false)
  })

  it("treats unknown values as expanded", () => {
    expect(parseSettingsExpanded("anything-else")).toBe(true)
  })
})
