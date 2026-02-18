/**
 * Repo Setup Utilities
 *
 * Core logic for setting up git-backed project directories:
 * - git init / clone
 * - .gitignore generation (scan for large files + common patterns)
 * - CLAUDE.md generation (project description + data map)
 * - File tree listing via git ls-files
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

/** Common ignore patterns for .gitignore generation */
const COMMON_IGNORES = [
  'node_modules/',
  '.venv/',
  'venv/',
  'dist/',
  'build/',
  '.next/',
  '__pycache__/',
  '.mypy_cache/',
  '.pytest_cache/',
  'target/',
  '.gradle/',
  '*.pyc',
  '.DS_Store',
  '.env',
  '.env.local',
]

/** Size threshold for auto-ignoring files (1 MB) */
const LARGE_FILE_THRESHOLD = 1_000_000

export interface RepoSetupOptions {
  projectId: string
  projectName: string
  projectDescription?: string
  workingDirectory?: string
  repository?: string
}

export interface RepoSetupResult {
  workingDirectory: string
  fileTree: string[]
  repository?: string
  needsGitInit?: boolean
  claudeMdCreated?: boolean
  gitignoreCreated?: boolean
}

export interface DataMapEntry {
  relativePath: string
  absolutePath: string
  sizeBytes: number
}

/**
 * Main setup orchestrator.
 *
 * 1. No dir + no repo → create ~/.astro/projects/{projectId}/ + git init
 * 2. Repo URL → clone to ~/.astro/repos/{projectId}/
 * 3. Local dir (git) → proceed
 * 4. Local dir (not git) → return { needsGitInit: true }
 *
 * Note: workingDirectory must be an absolute path (enforced in frontend validation)
 */
export function setupProjectRepo(options: RepoSetupOptions): RepoSetupResult {
  const { projectId, projectName, projectDescription, workingDirectory, repository } = options

  // Case 1: No directory and no repository — create a fresh project dir
  if (!workingDirectory && !repository) {
    const dir = join(homedir(), '.astro', 'projects', projectId)
    mkdirSync(dir, { recursive: true })
    gitInit(dir)
    const gitignoreCreated = generateGitignoreIfMissing(dir)
    const claudeMdCreated = generateClaudeMdIfMissing(dir, projectName, projectDescription)
    initialCommit(dir)
    const fileTree = getFileTree(dir)
    return { workingDirectory: dir, fileTree, claudeMdCreated, gitignoreCreated }
  }

  // Case 2: Repository URL provided — clone it
  if (repository && !workingDirectory) {
    const dir = cloneRepo(repository, projectId)
    const fileTree = getFileTree(dir)
    return { workingDirectory: dir, fileTree }
  }

  // Case 3/4: Local directory provided
  if (workingDirectory) {
    if (!existsSync(workingDirectory)) {
      // Directory doesn't exist — create it + git init
      mkdirSync(workingDirectory, { recursive: true })
      gitInit(workingDirectory)
      const gitignoreCreated = generateGitignoreIfMissing(workingDirectory)
      const claudeMdCreated = generateClaudeMdIfMissing(workingDirectory, projectName, projectDescription)
      initialCommit(workingDirectory)
      const fileTree = getFileTree(workingDirectory)
      return { workingDirectory, fileTree, claudeMdCreated, gitignoreCreated }
    }

    if (isGitRepo(workingDirectory)) {
      // Already a git repo — return file tree + auto-detect remote URL
      const fileTree = getFileTree(workingDirectory)
      const repository = getGitRemoteUrl(workingDirectory)
      return { workingDirectory, fileTree, repository }
    }

    // Not a git repo — ask user to confirm
    return { workingDirectory, fileTree: [], needsGitInit: true }
  }

  // Should not reach here
  return { workingDirectory: workingDirectory || '', fileTree: [] }
}

/**
 * Initialize git in a directory + generate .gitignore + CLAUDE.md + initial commit.
 * Called after user confirms git init for an existing non-git directory.
 *
 * Note: workingDirectory must be an absolute path (enforced in frontend validation)
 */
export function initializeGitRepo(
  workingDirectory: string,
  projectName: string,
  projectDescription?: string,
): RepoSetupResult {
  gitInit(workingDirectory)
  const gitignoreCreated = generateGitignoreIfMissing(workingDirectory)
  const claudeMdCreated = generateClaudeMdIfMissing(workingDirectory, projectName, projectDescription)
  initialCommit(workingDirectory)
  const fileTree = getFileTree(workingDirectory)
  return { workingDirectory, fileTree, claudeMdCreated, gitignoreCreated }
}

/**
 * Get file tree for a directory via `git ls-files`.
 *
 * Note: workingDirectory must be an absolute path (enforced in frontend validation)
 */
export function getFileTree(workingDirectory: string): string[] {
  if (!existsSync(workingDirectory)) return []

  try {
    const output = execFileSync('git', ['ls-files'], {
      cwd: workingDirectory,
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 5 * 1024 * 1024,
    })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

// --- Internal helpers ---

function getGitRemoteUrl(dir: string): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: 'pipe',
    }).trim()
    return url || undefined
  } catch {
    return undefined
  }
}

function isGitRepo(dir: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

function gitInit(dir: string): void {
  execFileSync('git', ['init'], {
    cwd: dir,
    timeout: 10_000,
    stdio: 'pipe',
  })
}

/**
 * Clone a git repository to the local cache directory.
 *
 * SECURITY (CRITICAL-005): Uses execFileSync instead of execSync to prevent
 * command injection via malicious git URLs.
 */
function cloneRepo(url: string, projectId: string): string {
  const repoDir = join(homedir(), '.astro', 'repos', projectId)
  if (existsSync(join(repoDir, '.git'))) {
    // Already cloned — fetch latest
    try {
      execFileSync('git', ['fetch', '--all'], {
        cwd: repoDir,
        stdio: 'ignore',
        timeout: 30_000,
      })
    } catch {
      // Non-fatal
    }
  } else {
    mkdirSync(join(homedir(), '.astro', 'repos'), { recursive: true })
    // Use execFileSync to prevent command injection (CRITICAL-005)
    execFileSync('git', ['clone', url, repoDir], {
      stdio: 'ignore',
      timeout: 120_000,
    })
  }
  return repoDir
}

function initialCommit(dir: string): void {
  try {
    execSync('git add -A && git commit -m "Initial setup" --allow-empty', {
      cwd: dir,
      timeout: 10_000,
      stdio: 'pipe',
    })
  } catch {
    // May fail if nothing to commit — that's fine
  }
}

/**
 * Generate .gitignore if one doesn't already exist.
 * Scans for large files (>1 MB) and adds them along with common patterns.
 */
function generateGitignoreIfMissing(dir: string): boolean {
  const gitignorePath = join(dir, '.gitignore')
  if (existsSync(gitignorePath)) return false

  const largeFiles = findLargeFiles(dir)
  const lines = [...COMMON_IGNORES]

  for (const entry of largeFiles) {
    lines.push(entry.relativePath)
  }

  writeFileSync(gitignorePath, lines.join('\n') + '\n', 'utf-8')
  return true
}

/**
 * Scan for files larger than LARGE_FILE_THRESHOLD.
 * Only scans top-level and one level deep for performance.
 */
function findLargeFiles(dir: string): DataMapEntry[] {
  const entries: DataMapEntry[] = []

  try {
    const output = execFileSync('find', [
      '.', '-maxdepth', '3',
      '-type', 'f', '-size', `+${Math.floor(LARGE_FILE_THRESHOLD / 1024)}k`,
      // Exclude common large dirs
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.git/*',
      '-not', '-path', '*/.venv/*',
      '-not', '-path', '*/venv/*',
    ], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })

    for (const line of output.trim().split('\n').filter(Boolean)) {
      const relativePath = line.replace(/^\.\//, '')
      const absolutePath = join(dir, relativePath)
      try {
        const stats = statSync(absolutePath)
        entries.push({
          relativePath,
          absolutePath,
          sizeBytes: stats.size,
        })
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // find may fail on some systems
  }

  return entries
}

/**
 * Generate a data map of large ignored files.
 */
export function generateDataMap(dir: string): DataMapEntry[] {
  return findLargeFiles(dir)
}

/**
 * Generate CLAUDE.md if one doesn't already exist.
 */
function generateClaudeMdIfMissing(
  dir: string,
  projectName: string,
  projectDescription?: string,
): boolean {
  const claudeMdPath = join(dir, 'CLAUDE.md')
  if (existsSync(claudeMdPath)) return false

  const dataMap = findLargeFiles(dir)
  const content = generateClaudeMdContent(projectName, projectDescription, dataMap)
  writeFileSync(claudeMdPath, content, 'utf-8')
  return true
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

function generateClaudeMdContent(
  projectName: string,
  projectDescription?: string,
  dataMap?: DataMapEntry[],
): string {
  const parts: string[] = []

  parts.push(`# ${projectName}`)
  parts.push('')

  if (projectDescription) {
    parts.push(projectDescription)
    parts.push('')
  }

  if (dataMap && dataMap.length > 0) {
    parts.push('## Data Map')
    parts.push('')
    parts.push('Large files not tracked by git (access via absolute paths):')
    parts.push('')
    parts.push('| File | Path | Size |')
    parts.push('|------|------|------|')
    for (const entry of dataMap) {
      parts.push(`| ${basename(entry.relativePath)} | ${entry.absolutePath} | ${formatFileSize(entry.sizeBytes)} |`)
    }
    parts.push('')
  }

  return parts.join('\n')
}
