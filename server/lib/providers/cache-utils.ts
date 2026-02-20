/**
 * Prompt Caching Utilities
 *
 * Helpers for building cache-optimized system prompts.
 * Implements the cache_control pattern for Claude API.
 */

import type { RepoContextResult } from '../repo-context.js'

export interface CacheControlBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' }
}

/**
 * Build system prompt blocks with appropriate cache controls.
 *
 * Cache hierarchy (from most stable to most dynamic):
 * 1. Base instructions (no cache - always included)
 * 2. Repo context (1h cache - stable per project)
 * 3. Vision doc (1h cache - stable per project)
 * 4. Dynamic context (5m cache - task-specific)
 *
 * @param options - System prompt components
 * @returns Array of system prompt blocks with cache controls
 */
export function buildCachedSystemPrompt(options: {
  baseInstructions?: string
  repoContext?: RepoContextResult
  visionDoc?: string
  dependencyContext?: string
  workingDirectory?: string
}): CacheControlBlock[] {
  const blocks: CacheControlBlock[] = []

  // Base instructions (no cache - small and always different per task type)
  if (options.baseInstructions) {
    blocks.push({
      type: 'text',
      text: options.baseInstructions,
    })
  }

  // Repo context (1h cache - stable across all tasks in a project)
  // This is the BIG win for worktree scenarios
  if (options.repoContext && hasRepoContent(options.repoContext)) {
    const repoText = formatRepoContext(options.repoContext)
    blocks.push({
      type: 'text',
      text: repoText,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    })
  }

  // Vision doc (1h cache - stable per project, changes rarely)
  if (options.visionDoc) {
    blocks.push({
      type: 'text',
      text: `## Project Vision\n\n${options.visionDoc}`,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    })
  }

  // Dependency context (5m cache - changes per task but shared by downstream tasks)
  if (options.dependencyContext) {
    blocks.push({
      type: 'text',
      text: `## Previous Task Outputs\n\n${options.dependencyContext}`,
      cache_control: { type: 'ephemeral', ttl: '5m' },
    })
  }

  // Working directory (no cache - just for reference, very small)
  if (options.workingDirectory) {
    blocks.push({
      type: 'text',
      text: `## Working Directory\n\n${options.workingDirectory}`,
    })
  }

  return blocks
}

/**
 * Format repo context for caching.
 * This creates a stable, cacheable representation of the repo state.
 */
function formatRepoContext(context: RepoContextResult): string {
  const parts: string[] = ['## Repository Context']

  // CLAUDE.md - project-specific instructions
  if (context.claudeMd) {
    parts.push('### CLAUDE.md\n\n```markdown\n' + context.claudeMd + '\n```')
  }

  // README.md - project overview
  if (context.readmeMd) {
    parts.push('### README.md\n\n```markdown\n' + context.readmeMd + '\n```')
  }

  // Package metadata (package.json, pyproject.toml, etc)
  if (context.packageInfo) {
    parts.push('### Package Metadata\n\n```\n' + context.packageInfo + '\n```')
  }

  // File tree summary
  if (context.fileTreeSummary) {
    parts.push('### File Tree\n\n```\n' + context.fileTreeSummary + '\n```')
  }

  return parts.join('\n\n')
}

/**
 * Check if repo context has any content worth caching
 */
function hasRepoContent(context: RepoContextResult): boolean {
  return !!(
    context.claudeMd ||
    context.readmeMd ||
    context.packageInfo ||
    context.fileTreeSummary
  )
}

/**
 * Build the append content for a preset systemPrompt.
 *
 * When using `systemPrompt: { type: 'preset', preset: 'claude_code', append: ... }`,
 * the SDK loads CLAUDE.md automatically via settingSources. This function builds
 * only the Astro-specific context that should be appended (vision doc, dependency
 * context, working directory, environment info).
 */
export function buildAppendContent(options: {
  baseInstructions?: string
  visionDoc?: string
  dependencyContext?: string
  workingDirectory?: string
}): string | undefined {
  const parts: string[] = []

  if (options.baseInstructions) {
    parts.push(options.baseInstructions)
  }

  if (options.visionDoc) {
    parts.push(`## Project Vision\n\n${options.visionDoc}`)
  }

  if (options.dependencyContext) {
    parts.push(`## Previous Task Outputs\n\n${options.dependencyContext}`)
  }

  if (options.workingDirectory) {
    parts.push(`## Working Directory\n\n${options.workingDirectory}`)
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined
}

/**
 * Build tool definitions with cache control on the last tool.
 * This caches all MCP tool definitions as a stable prefix.
 *
 * @param tools - Array of tool definitions
 * @param cacheTtl - Cache TTL (default: 1h for stable tools)
 * @returns Same tools array with cache_control on the last tool
 */
export function addToolCaching<T extends { cache_control?: unknown }>(
  tools: T[],
  cacheTtl: '5m' | '1h' = '1h'
): T[] {
  if (tools.length === 0) return tools

  // Clone array to avoid mutation
  const cachedTools = [...tools]

  // Add cache control to the last tool (caches all tools as a prefix)
  const lastTool = cachedTools[cachedTools.length - 1]
  cachedTools[cachedTools.length - 1] = {
    ...lastTool,
    cache_control: { type: 'ephemeral', ttl: cacheTtl },
  }

  return cachedTools
}

/**
 * Calculate cache effectiveness from usage metrics.
 * Helps track ROI of caching strategy.
 */
export function calculateCacheStats(usage: {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
}): {
  totalInputTokens: number
  cacheHitRate: number
  estimatedSavings: number // as percentage
} {
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const directInput = usage.input_tokens ?? 0

  const totalInputTokens = cacheRead + cacheWrite + directInput
  const cacheHitRate = totalInputTokens > 0 ? cacheRead / totalInputTokens : 0

  // Cache reads are 90% cheaper than regular input
  // (cache read = 0.1x base price vs 1.0x base price)
  const estimatedSavings = cacheHitRate * 90

  return {
    totalInputTokens,
    cacheHitRate,
    estimatedSavings,
  }
}

/**
 * Extract the source repo path from a worktree path using git command.
 *
 * More robust than regex parsing, works across all platforms.
 *
 * @param worktreePath - Path to a git worktree
 * @returns Source repo path, or the original path if not a worktree or git is unavailable
 */
export async function extractSourceRepoPath(worktreePath: string): Promise<string> {
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)

    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-parse', '--show-toplevel'],
      { timeout: 5_000 }
    )
    const root = stdout.trim()
    return root || worktreePath
  } catch {
    // Fallback: if git command fails, try regex pattern (less reliable but better than nothing)
    const worktreePattern = /^(.+?)\/\.git\/worktrees\/[^/]+\/?$/
    const match = worktreePath.match(worktreePattern)
    return match ? match[1] : worktreePath
  }
}
