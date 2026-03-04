/**
 * Built-in Skill Definition Types
 *
 * These types define the full skill schema as specified in SKILL.md frontmatter,
 * including all metadata for seeding and skill management.
 */

/**
 * Allowed tools that a skill can request access to
 */
export type AllowedTool = 'Bash' | 'Read' | 'Write' | 'Glob' | 'Grep' | 'Edit' | string

/**
 * Full skill definition with all metadata
 */
export interface BuiltinSkillDefinition {
  /** Skill identifier (kebab-case) */
  name: string
  /** Semantic version */
  version: string
  /** Description of when this skill should be used */
  description: string
  /** Full markdown instructions injected into agent prompts */
  instructions: string
  /** Skill category */
  category: 'tools' | 'workflows' | 'templates' | 'integrations' | string
  /** Searchable tags */
  tags: string[]
  /** Tools the skill is allowed to use */
  allowedTools: AllowedTool[]
  /** Exclude from auto-injection into agent prompts (default false) */
  disableModelInvocation?: boolean
  /** Expose as slash command (default true) */
  userInvocable?: boolean
}

// ── Catalog Collection Types ──────────────────────────────────────

/**
 * COLLECTION.yaml manifest for a skill catalog collection.
 */
export interface CatalogCollectionManifest {
  /** Unique collection identifier (directory name, e.g. 'anthropic') */
  id: string
  /** Display name (e.g. 'Claude Official') */
  name: string
  /** Provider organization name */
  provider: string
  /** Lucide icon name */
  icon: string
  /** Brief description of the collection */
  description?: string
}

/**
 * A loaded catalog collection with its manifest and parsed skills.
 */
export interface CatalogCollection {
  manifest: CatalogCollectionManifest
  skills: BuiltinSkillDefinition[]
}
