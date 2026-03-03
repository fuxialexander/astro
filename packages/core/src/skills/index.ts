/**
 * Built-in Skills
 *
 * Exports skill types and the SKILL.md parser for built-in skills.
 * Built-in skill definitions are loaded from skills/ directory at repo root
 * via the server-side loader (server/lib/load-builtin-skills.ts).
 */

// Types
export * from './types.js'

// Parser for SKILL.md files
export { parseBuiltinSkillMd } from './builtin-parser.js'
