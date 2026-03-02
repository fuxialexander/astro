/**
 * Repo Context Reader
 *
 * Reads key files from a working directory and returns their contents
 * for injection into plan generation prompts.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const FILE_CAP = 15_000 // 15KB cap for CLAUDE.md and README
const PKG_CAP = 5_000   // 5KB cap for package metadata
const FILE_TREE_CAP = 3000 // max files to show in tree summary (after smart filtering)

/**
 * Sort and filter a file tree to prioritize relevant files.
 * Source files come first; generated/junk files are excluded entirely.
 */
function prioritizeFileTree(files: string[]): string[] {
  const junkPatterns = [
    /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/, /bun\.lockb$/,
    /\.d\.ts$/, /\.js\.map$/, /\.css\.map$/,
    /^dist\//, /^build\//, /^coverage\//, /^\.next\//, /^out\//,
    /node_modules\//,
    /\.min\.js$/, /\.min\.css$/,
  ]
  const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.rb', '.c', '.cpp', '.h']

  const isJunk = (f: string) => junkPatterns.some(p => p.test(f))
  const isSource = (f: string) => sourceExts.some(ext => f.endsWith(ext))

  return files
    .filter(f => !isJunk(f))
    .sort((a, b) => {
      const aSource = isSource(a) ? 0 : 1
      const bSource = isSource(b) ? 0 : 1
      return aSource - bSource || a.localeCompare(b)
    })
}

export interface RepoContextResult {
  claudeMd?: string
  readmeMd?: string
  packageInfo?: string
  fileTreeSummary?: string
}

function readFileCapped(path: string, cap: number): string | undefined {
  if (!existsSync(path)) return undefined
  try {
    const content = readFileSync(path, 'utf-8')
    if (content.length > cap) {
      return content.slice(0, cap) + '\n\n[... truncated ...]'
    }
    return content
  } catch {
    return undefined
  }
}

/**
 * Read key files from a working directory for context injection.
 * When workingDirectory is empty/falsy, only the file tree is used (remote repo case).
 */
export function readRepoContext(workingDirectory: string, fileTree?: string[]): RepoContextResult {
  const result: RepoContextResult = {}

  // Only read files if we have a valid local working directory
  if (workingDirectory && existsSync(workingDirectory)) {
    // Read CLAUDE.md
    result.claudeMd = readFileCapped(join(workingDirectory, 'CLAUDE.md'), FILE_CAP)

    // Read README.md (try both cases)
    result.readmeMd =
      readFileCapped(join(workingDirectory, 'README.md'), FILE_CAP) ??
      readFileCapped(join(workingDirectory, 'readme.md'), FILE_CAP)

    // Read first package metadata found
    const packageFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
    for (const pkg of packageFiles) {
      const content = readFileCapped(join(workingDirectory, pkg), PKG_CAP)
      if (content) {
        result.packageInfo = `# ${pkg}\n${content}`
        break
      }
    }
  }

  // Format file tree summary with smart filtering
  if (fileTree && fileTree.length > 0) {
    const total = fileTree.length
    const filtered = prioritizeFileTree(fileTree)
    const shown = filtered.slice(0, FILE_TREE_CAP)
    const lines = shown.join('\n')
    result.fileTreeSummary = filtered.length > FILE_TREE_CAP
      ? `${lines}\n\n... and ${filtered.length - FILE_TREE_CAP} more files (${total} total)`
      : total > filtered.length
        ? `${lines}\n\n(${total - filtered.length} generated/junk files excluded)`
        : lines
  }

  return result
}
