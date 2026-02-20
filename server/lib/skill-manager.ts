/**
 * Skill Manager (Server-side)
 *
 * Loads OpenClaw-compatible skills from SKILL.md files, manages their
 * lifecycle, and produces prompt injection XML for agent sessions.
 */

import { readdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OpenClawSkill } from '../../src/types/skill.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Parse a SKILL.md file into an OpenClawSkill.
 *
 * Format:
 * ```
 * ---
 * name: skill-name
 * description: What it does
 * ...
 * ---
 *
 * Instructions body (markdown)
 * ```
 */
function parseSkillMd(content: string, source: OpenClawSkill['source']): OpenClawSkill | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!fmMatch) return null

  const frontmatter = fmMatch[1]
  const instructions = fmMatch[2].trim()

  // Simple YAML-like key: value parser (no nested objects for the basics)
  const meta: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key && value) meta[key] = value
  }

  if (!meta.name) return null

  return {
    name: meta.name,
    description: meta.description || '',
    instructions,
    userInvocable: meta.userInvocable !== 'false',
    disableModelInvocation: meta.disableModelInvocation === 'true',
    source,
    enabled: true,
  }
}

export class SkillManager {
  private skills = new Map<string, OpenClawSkill>()
  private skillsDir: string

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? join(__dirname, '..', '..', 'skills')
  }

  /**
   * Load skills from the skills/ directory
   */
  async loadSkills(): Promise<Map<string, OpenClawSkill>> {
    this.skills.clear()

    if (!existsSync(this.skillsDir)) {
      console.log(`[skill-manager] No skills directory at ${this.skillsDir}, skipping`)
      return this.skills
    }

    const entries = readdirSync(this.skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Look for SKILL.md inside the directory
        const skillFile = join(this.skillsDir, entry.name, 'SKILL.md')
        if (existsSync(skillFile)) {
          this.loadSkillFile(skillFile, 'workspace')
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Top-level .md files as skills
        this.loadSkillFile(join(this.skillsDir, entry.name), 'workspace')
      }
    }

    console.log(`[skill-manager] Loaded ${this.skills.size} skills`)
    return this.skills
  }

  private loadSkillFile(path: string, source: OpenClawSkill['source']): void {
    try {
      const content = readFileSync(path, 'utf-8')
      const skill = parseSkillMd(content, source)
      if (skill) {
        this.skills.set(skill.name, skill)
      } else {
        console.warn(`[skill-manager] Could not parse skill from ${path}`)
      }
    } catch (err) {
      console.warn(`[skill-manager] Failed to read ${path}:`, err)
    }
  }

  /**
   * Add a skill programmatically (e.g., from a plugin)
   */
  addSkill(skill: OpenClawSkill): void {
    this.skills.set(skill.name, skill)
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): OpenClawSkill[] {
    return Array.from(this.skills.values())
  }

  /**
   * Get skills that pass gating requirements (enabled + not model-invocation-disabled)
   */
  getEligibleSkills(): OpenClawSkill[] {
    return this.getAllSkills().filter(
      (s) => s.enabled && !s.disableModelInvocation
    )
  }

  /**
   * Build XML prompt injection for eligible skills
   */
  getSkillPromptInjection(): string {
    const eligible = this.getEligibleSkills()
    if (eligible.length === 0) return ''

    const skillBlocks = eligible.map(
      (s) => `  <skill name="${s.name}" description="${s.description}">\n${s.instructions}\n  </skill>`
    )

    return `<skills>\n${skillBlocks.join('\n')}\n</skills>`
  }

  /**
   * Stub for future ClawHub integration
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async installFromClawHub(_slug: string): Promise<OpenClawSkill> {
    throw new Error('ClawHub integration not yet implemented')
  }

  /**
   * Uninstall a skill by name (removes from disk if workspace skill)
   */
  uninstallSkill(name: string): boolean {
    const skill = this.skills.get(name)
    if (!skill) return false

    // Remove from disk if it's a workspace skill
    if (skill.source === 'workspace') {
      const dirPath = join(this.skillsDir, name)
      const filePath = join(this.skillsDir, `${name}.md`)
      if (existsSync(dirPath)) {
        rmSync(dirPath, { recursive: true, force: true })
      } else if (existsSync(filePath)) {
        rmSync(filePath)
      }
    }

    this.skills.delete(name)
    return true
  }

  /**
   * Update a skill's configuration
   */
  updateSkillConfig(name: string, config: Record<string, unknown>): boolean {
    const skill = this.skills.get(name)
    if (!skill) return false
    skill.config = { ...skill.config, ...config }
    return true
  }
}

export const skillManager = new SkillManager()
