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
import { existsSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { validateGitUrl, detectRemoteType, urlsMatchSameRepo } from './git-url-utils.js'
import type { ProjectSource, DeliveryMode } from '../../src/types/index.js'

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
  '.astro/worktrees/',
  '.astro/cache/',
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
  keyFiles?: { claudeMd?: string; readmeMd?: string; packageInfo?: string }
  needsGitInit?: boolean
  claudeMdCreated?: boolean
  gitignoreCreated?: boolean
  source?: ProjectSource
  deliveryMode?: DeliveryMode
  agentDir?: string
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

  // Validate repository URL if provided - ensure it's in SSH format
  let validatedRepository = repository
  if (repository) {
    const validation = validateGitUrl(repository)
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid Git URL')
    }
    // Use SSH URL
    validatedRepository = validation.sshUrl
  }

  // Run core setup logic
  return setupProjectRepoCore(projectId, projectName, projectDescription, workingDirectory, validatedRepository)
}

/** Core setup logic (separated to allow reference URL handling as a post-step). */
function setupProjectRepoCore(
  projectId: string,
  projectName: string,
  projectDescription: string | undefined,
  workingDirectory: string | undefined,
  validatedRepository: string | undefined,
): RepoSetupResult {
  // Case 1: No directory and no repository — create a fresh project dir
  if (!workingDirectory && !validatedRepository) {
    const dir = join(homedir(), '.astro', 'projects', projectId)
    mkdirSync(dir, { recursive: true })
    gitInit(dir)
    const gitignoreCreated = generateGitignoreIfMissing(dir)
    const claudeMdCreated = generateClaudeMdIfMissing(dir, projectName, projectDescription)
    initialCommit(dir)
    const { agentDir } = ensureAgentDir(dir)
    const fileTree = getFileTree(dir)
    const keyFiles = readKeyFiles(dir)
    const { source, deliveryMode } = buildProjectSource(dir, {})
    return { workingDirectory: dir, fileTree, keyFiles, claudeMdCreated, gitignoreCreated, source, deliveryMode, agentDir }
  }

  // Case 2: Repository URL + working directory
  if (validatedRepository && workingDirectory) {
    // Smart URL classification: if working dir is already a git repo,
    // check whether its remote matches the provided URL
    if (existsSync(workingDirectory) && isGitRepo(workingDirectory)) {
      const existingRemote = getGitRemoteUrl(workingDirectory)

      if (existingRemote && urlsMatchSameRepo(existingRemote, validatedRepository)) {
        // Same repo — URL is redundant, treat working dir as the source
        const { agentDir } = ensureAgentDir(workingDirectory)
        const fileTree = getFileTree(workingDirectory)
        const keyFiles = readKeyFiles(workingDirectory)
        const { source, deliveryMode } = buildProjectSource(workingDirectory, { remoteUrl: existingRemote })
        return { workingDirectory, fileTree, keyFiles, repository: existingRemote, source, deliveryMode, agentDir }
      }

      if (existingRemote) {
        // Different repo — clone as a subdirectory reference
        const repoName = extractRepoName(validatedRepository)
        const refDir = join(workingDirectory, '.astro-refs', repoName)
        try {
          cloneRepo(validatedRepository, refDir)
          addToGitignore(workingDirectory, '.astro-refs/')
        } catch (refError) {
          console.warn(`[repo-setup] Failed to clone reference repo: ${refError}`)
        }

        const { agentDir } = ensureAgentDir(workingDirectory)
        const fileTree = getFileTree(workingDirectory)
        const keyFiles = readKeyFiles(workingDirectory)
        const { source, deliveryMode } = buildProjectSource(workingDirectory, { remoteUrl: existingRemote })
        return { workingDirectory, fileTree, keyFiles, repository: existingRemote, source, deliveryMode, agentDir }
      }
    }

    // Default: clone into user-specified dir
    const repoName = extractRepoName(validatedRepository)
    const cloneTarget = join(workingDirectory, repoName)
    const dir = cloneRepo(validatedRepository, cloneTarget)
    const { agentDir } = ensureAgentDir(dir)
    const fileTree = getFileTree(dir)
    const keyFiles = readKeyFiles(dir)
    const { source, deliveryMode } = buildProjectSource(dir, { remoteUrl: validatedRepository })
    return { workingDirectory: dir, fileTree, keyFiles, repository: validatedRepository, source, deliveryMode, agentDir }
  }

  // Case 2b: Repository URL, no working directory — error
  if (validatedRepository && !workingDirectory) {
    throw new Error('Working directory required for git URL projects. Specify a local folder where the repository will be cloned.')
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
      const { agentDir } = ensureAgentDir(workingDirectory)
      const fileTree = getFileTree(workingDirectory)
      const keyFiles = readKeyFiles(workingDirectory)
      const { source, deliveryMode } = buildProjectSource(workingDirectory, {})
      return { workingDirectory, fileTree, keyFiles, claudeMdCreated, gitignoreCreated, source, deliveryMode, agentDir }
    }

    if (isGitRepo(workingDirectory)) {
      // Already a git repo — return file tree + auto-detect remote URL + key files
      const { agentDir } = ensureAgentDir(workingDirectory)
      const fileTree = getFileTree(workingDirectory)
      const repository = getGitRemoteUrl(workingDirectory)
      const keyFiles = readKeyFiles(workingDirectory)
      const { source, deliveryMode } = buildProjectSource(workingDirectory, { remoteUrl: repository })
      return { workingDirectory, fileTree, keyFiles, repository, source, deliveryMode, agentDir }
    }

    // Not a git repo — return with needsGitInit and a preliminary source
    const nonGitSource: ProjectSource = {
      localPath: workingDirectory,
      remoteType: 'none',
      baseBranch: 'main',
      isGit: false,
    }
    return { workingDirectory, fileTree: [], needsGitInit: true, source: nonGitSource, deliveryMode: 'direct' as DeliveryMode }
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
  const { agentDir } = ensureAgentDir(workingDirectory)
  const fileTree = getFileTree(workingDirectory)
  const keyFiles = readKeyFiles(workingDirectory)
  const { source, deliveryMode } = buildProjectSource(workingDirectory, {})
  return { workingDirectory, fileTree, keyFiles, claudeMdCreated, gitignoreCreated, source, deliveryMode, agentDir }
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

/**
 * Read key files (CLAUDE.md, README.md, package metadata) from a directory.
 * Returns them for use as context in plan generation.
 */
function readKeyFiles(dir: string): RepoSetupResult['keyFiles'] {
  const keyFiles: NonNullable<RepoSetupResult['keyFiles']> = {}

  const claudeMdPath = join(dir, 'CLAUDE.md')
  if (existsSync(claudeMdPath)) {
    try { keyFiles.claudeMd = readFileSync(claudeMdPath, 'utf-8').slice(0, 15_000) } catch { /* skip */ }
  }

  const readmePath = existsSync(join(dir, 'README.md'))
    ? join(dir, 'README.md')
    : existsSync(join(dir, 'readme.md'))
      ? join(dir, 'readme.md')
      : null
  if (readmePath) {
    try { keyFiles.readmeMd = readFileSync(readmePath, 'utf-8').slice(0, 15_000) } catch { /* skip */ }
  }

  const packageFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
  for (const pkg of packageFiles) {
    const pkgPath = join(dir, pkg)
    if (existsSync(pkgPath)) {
      try { keyFiles.packageInfo = `# ${pkg}\n${readFileSync(pkgPath, 'utf-8').slice(0, 5_000)}` } catch { /* skip */ }
      break
    }
  }

  return Object.keys(keyFiles).length > 0 ? keyFiles : undefined
}

// --- Source detection helpers ---

function getGitRoot(dir: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: 'pipe',
    }).trim() || undefined
  } catch {
    return undefined
  }
}

function getDefaultBranch(dir: string): string {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: 'pipe',
    }).trim() || 'main'
  } catch {
    return 'main'
  }
}

function deriveDeliveryMode(source: ProjectSource): DeliveryMode {
  if (!source.isGit) return 'direct'
  switch (source.remoteType) {
    case 'github':
    case 'gitlab':
    case 'bitbucket':
      return 'pr'
    case 'generic':
      return 'push'
    case 'none':
    default:
      return 'branch'
  }
}

/**
 * Build a ProjectSource from a working directory that has been set up.
 */
function buildProjectSource(
  dir: string,
  opts: {
    remoteUrl?: string
  }
): { source: ProjectSource; deliveryMode: DeliveryMode } {
  const gitRoot = getGitRoot(dir)
  const isGit = !!gitRoot
  const baseBranch = isGit ? getDefaultBranch(dir) : 'main'
  const remoteType = detectRemoteType(opts.remoteUrl)

  // Compute subdirectory relative to git root
  let subdirectory: string | undefined
  if (gitRoot && dir !== gitRoot) {
    const relative = dir.replace(gitRoot, '').replace(/^\//, '')
    if (relative) subdirectory = relative
  }

  const source: ProjectSource = {
    localPath: dir,
    subdirectory,
    remoteUrl: opts.remoteUrl,
    remoteType,
    baseBranch,
    isGit,
  }

  return { source, deliveryMode: deriveDeliveryMode(source) }
}

/**
 * Ensure the agent directory exists with a config.json.
 * Creates {workingDir}/{agentDirName}/ and writes config.json
 * with auto-detected settings. Updates .gitignore.
 */
export function ensureAgentDir(workingDir: string, agentDirName: string = '.astro'): { agentDir: string } {
  const agentDirPath = join(workingDir, agentDirName)

  mkdirSync(agentDirPath, { recursive: true })

  // Write config.json if it doesn't exist
  const configPath = join(agentDirPath, 'config.json')
  if (!existsSync(configPath)) {
    // Auto-detect settings
    let baseBranch = 'main'
    let remoteType = 'none'
    let deliveryMode = 'branch'

    try {
      baseBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: 'pipe',
      }).trim() || 'main'
    } catch { /* use default */ }

    try {
      const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: 'pipe',
      }).trim()
      if (url) {
        const rt = detectRemoteType(url)
        remoteType = rt
        switch (rt) {
          case 'github':
          case 'gitlab':
          case 'bitbucket':
            deliveryMode = 'pr'
            break
          case 'generic':
            deliveryMode = 'push'
            break
          default:
            deliveryMode = 'branch'
        }
      }
    } catch { /* no remote */ }

    writeFileSync(configPath, JSON.stringify({
      baseBranch,
      branchPrefix: 'astro/',
      remoteType,
      deliveryMode,
    }, null, 2) + '\n', 'utf-8')
  }

  // Add agent dir entries to .gitignore
  addToGitignore(workingDir, `${agentDirName}/worktrees/`)
  addToGitignore(workingDir, `${agentDirName}/cache/`)

  return { agentDir: agentDirName }
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
 * Extract repository name from a git URL.
 * e.g., "git@github.com:user/repo.git" → "repo"
 *       "https://github.com/user/repo.git" → "repo"
 */
function extractRepoName(url: string): string {
  const name = basename(url).replace(/\.git$/, '')
  return name || 'repo'
}

/**
 * Clone a git repository to the specified target directory.
 *
 * SECURITY (CRITICAL-005): Uses execFileSync instead of execSync to prevent
 * command injection via malicious git URLs.
 */
function cloneRepo(url: string, targetDir: string): string {
  if (existsSync(join(targetDir, '.git'))) {
    // Already cloned — fetch latest
    try {
      execFileSync('git', ['fetch', '--all'], {
        cwd: targetDir,
        stdio: 'ignore',
        timeout: 30_000,
      })
    } catch {
      // Non-fatal
    }
  } else {
    mkdirSync(join(targetDir, '..'), { recursive: true })
    // Use execFileSync to prevent command injection (CRITICAL-005)
    execFileSync('git', ['clone', url, targetDir], {
      stdio: 'ignore',
      timeout: 120_000,
    })
  }
  return targetDir
}

/**
 * Add an entry to .gitignore if not already present.
 */
function addToGitignore(dir: string, entry: string): void {
  const gitignorePath = join(dir, '.gitignore')
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8')
      if (content.includes(entry)) return
      writeFileSync(gitignorePath, content.trimEnd() + '\n' + entry + '\n', 'utf-8')
    } else {
      writeFileSync(gitignorePath, entry + '\n', 'utf-8')
    }
  } catch {
    // Non-fatal
  }
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
