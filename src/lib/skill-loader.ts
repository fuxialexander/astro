/**
 * Skill Loader
 *
 * Parses OpenClaw SKILL.md files and validates skill requirements.
 * Compatible with the OpenClaw/ClawHub ecosystem format.
 */

import type { OpenClawSkill, OpenClawSkillMetadata } from "@/types/skill"

/**
 * Parse YAML frontmatter from a SKILL.md file content.
 * Handles simple key: value pairs and JSON metadata.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content.trim() }
  }

  const [, yaml, body] = match
  const frontmatter: Record<string, unknown> = {}

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    let value: unknown = trimmed.slice(colonIdx + 1).trim()

    // Remove surrounding quotes
    if (typeof value === "string") {
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      // Try to parse JSON values (OpenClaw stores metadata as JSON strings)
      if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
        try {
          value = JSON.parse(value)
        } catch {
          // Keep as string if not valid JSON
        }
      }
      // Parse booleans
      if (value === "true") value = true
      if (value === "false") value = false
    }

    frontmatter[key] = value
  }

  return { frontmatter, body: body.trim() }
}

/**
 * Parse a SKILL.md file content into an OpenClawSkill
 */
export function parseSkillMd(
  content: string,
  source: OpenClawSkill["source"] = "workspace"
): OpenClawSkill {
  const { frontmatter, body } = parseFrontmatter(content)

  const name = String(frontmatter.name || "unnamed-skill")
  const description = String(frontmatter.description || "")

  // Parse metadata (may be a JSON object from frontmatter)
  let metadata: OpenClawSkillMetadata | undefined
  if (frontmatter.metadata && typeof frontmatter.metadata === "object") {
    metadata = frontmatter.metadata as OpenClawSkillMetadata
  }

  return {
    name,
    description,
    instructions: body,
    userInvocable: frontmatter.userInvocable !== false,
    disableModelInvocation: frontmatter.disableModelInvocation === true,
    commandDispatch: frontmatter.commandDispatch as 'tool' | undefined,
    commandTool: frontmatter.commandTool as string | undefined,
    homepage: frontmatter.homepage as string | undefined,
    metadata,
    source,
    enabled: true,
    config: {},
  }
}

/**
 * Check skill gating requirements.
 * On the frontend, real checks (bins, env vars) aren't possible,
 * so this always returns eligible: true. Server-side does real validation.
 */
export function checkSkillRequirements(
  skill: OpenClawSkill
): { eligible: boolean; missing: string[] } {
  // Frontend can't check bins/env/config — server handles real gating
  // Basic check: if skill has OS requirements, validate platform
  const os = skill.metadata?.openclaw?.os
  if (os && os.length > 0) {
    const platform = navigator.platform.toLowerCase()
    const isMatch = os.some(
      (o) =>
        (o === "darwin" && platform.includes("mac")) ||
        (o === "linux" && platform.includes("linux")) ||
        (o === "win32" && platform.includes("win"))
    )
    if (!isMatch) {
      return { eligible: false, missing: [`Platform: ${os.join(", ")}`] }
    }
  }
  return { eligible: true, missing: [] }
}
