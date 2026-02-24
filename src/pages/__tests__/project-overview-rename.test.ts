import { describe, it, expect } from "vitest"
import { validateProjectName } from "../../lib/project-validation"

const existingProjects = [
  { id: "p1", name: "My Project" },
  { id: "p2", name: "Another Project" },
  { id: "p3", name: "Third" },
]

describe("validateProjectName", () => {
  it("returns null for a valid, unique name", () => {
    expect(validateProjectName("New Name", "p1", existingProjects)).toBeNull()
  })

  it("rejects empty string", () => {
    expect(validateProjectName("", "p1", existingProjects)).toBe("Project name cannot be empty")
  })

  it("rejects whitespace-only string", () => {
    expect(validateProjectName("   ", "p1", existingProjects)).toBe("Project name cannot be empty")
  })

  it("rejects names longer than 100 characters", () => {
    const longName = "a".repeat(101)
    expect(validateProjectName(longName, "p1", existingProjects)).toBe(
      "Project name is too long (max 100 characters)"
    )
  })

  it("allows exactly 100 characters", () => {
    const exactName = "a".repeat(100)
    expect(validateProjectName(exactName, "p1", existingProjects)).toBeNull()
  })

  it("detects duplicate names (case-insensitive)", () => {
    expect(validateProjectName("another project", "p1", existingProjects)).toBe(
      "A project with this name already exists"
    )
  })

  it("detects duplicate names with different casing", () => {
    expect(validateProjectName("ANOTHER PROJECT", "p1", existingProjects)).toBe(
      "A project with this name already exists"
    )
  })

  it("allows renaming to same name for the same project (not a duplicate)", () => {
    expect(validateProjectName("My Project", "p1", existingProjects)).toBeNull()
  })

  it("rejects tab characters as whitespace-only", () => {
    expect(validateProjectName("\t\t", "p1", existingProjects)).toBe("Project name cannot be empty")
  })

  it("rejects newlines as whitespace-only", () => {
    expect(validateProjectName("\n\n", "p1", existingProjects)).toBe("Project name cannot be empty")
  })

  it("allows special characters in names", () => {
    expect(validateProjectName("Project (v2) — rewrite!", "p1", existingProjects)).toBeNull()
  })

  it("allows emoji in names", () => {
    expect(validateProjectName("🚀 Launch", "p1", existingProjects)).toBeNull()
  })

  it("handles empty project list", () => {
    expect(validateProjectName("Any Name", "p1", [])).toBeNull()
  })

  it("length check uses raw string (not trimmed)", () => {
    // 99 chars + 2 spaces = 101 chars total — should fail length check
    const padded = " " + "a".repeat(99) + " "
    expect(padded.length).toBe(101)
    expect(validateProjectName(padded, "p1", existingProjects)).toBe(
      "Project name is too long (max 100 characters)"
    )
  })
})
