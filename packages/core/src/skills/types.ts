/**
 * Built-in skill definition type.
 *
 * Represents a complete skill definition as parsed from SKILL.md frontmatter + body.
 * These definitions are used for seeding the skill catalog and for prompt injection
 * when the corresponding infrastructure is detected.
 */
export interface BuiltinSkillDefinition {
  /** Unique skill identifier (kebab-case) */
  name: string
  /** Semantic version */
  version: string
  /** When this skill should be activated — describes trigger phrases and keywords */
  description: string
  /** Full markdown instructions injected into the agent prompt */
  instructions: string
  /** Skill category (e.g., 'tools', 'workflow') */
  category: string
  /** Tags for discovery and filtering */
  tags: string[]
  /** Claude Code tools this skill is allowed to use */
  allowedTools: string[]
}
