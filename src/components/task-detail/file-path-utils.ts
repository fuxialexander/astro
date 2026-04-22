/**
 * Utility functions for resolving file paths in the file browser.
 *
 * These functions derive the effective browse root for a project and resolve
 * file_change event paths into browsable absolute paths.
 */

import type { Project } from "@/types"
import { deriveDeliveryMode } from "@/lib/project-source"

/**
 * Derive the project worktree path from working directory + project branch.
 * Project branch: astro/{shortProjectId} → .astro/worktrees/{shortProjectId}/
 * This is a persistent worktree (detached HEAD) that survives task completion.
 */
export function projectWorktreePath(workingDirectory: string, projectBranch: string): string {
  const parts = projectBranch.split('/')
  const suffix = parts[parts.length - 1]
  return `${workingDirectory.replace(/\/$/, '')}/.astro/worktrees/${suffix}`
}

/**
 * Resolve the directory the UI should browse for a project.
 *
 * Only PR/push delivery should default to the persistent project worktree.
 * Direct delivery works in-place, and branch delivery should browse the
 * project directory rather than forcing the hidden worktree path.
 */
export function getProjectFileBrowserRoot(project: Project | undefined): string | undefined {
  if (!project?.workingDirectory) return undefined

  const deliveryMode = project.deliveryMode ?? (project.source ? deriveDeliveryMode(project.source) : undefined)
  const shouldBrowseProjectWorktree =
    !!project.projectBranch &&
    project.useWorktree !== false &&
    (deliveryMode === 'pr' || deliveryMode === 'push')

  return shouldBrowseProjectWorktree && project.projectBranch
    ? projectWorktreePath(project.workingDirectory, project.projectBranch)
    : project.workingDirectory
}

/**
 * Resolve a file path from a file_change event into an absolute path
 * suitable for the file browser.
 *
 * Handles three cases:
 * 1. Absolute worktree path (.astro/worktrees/<task-id>/...) → strip prefix, resolve into browseDir
 * 2. Absolute path (starts with /) → pass through
 * 3. Relative path (from git diff --numstat) → prepend browseDir
 */
export function resolveFilePathForBrowsing(filePath: string, browseDir: string): string {
  // Strip worktree prefix from absolute paths — the file browser already points
  // to the project worktree directory, so we just need the relative part.
  const worktreeMatch = filePath.match(/\.astro\/worktrees\/[^/]+\/(.+)/)
  if (worktreeMatch) {
    return `${browseDir.replace(/\/$/, '')}/${worktreeMatch[1]}`
  }
  if (filePath.startsWith('/')) return filePath
  return `${browseDir.replace(/\/$/, '')}/${filePath}`
}
