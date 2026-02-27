/**
 * Figure Extraction from LaTeX Source
 *
 * Extracts and organizes figures from arXiv paper LaTeX source.
 * Handles:
 * - \includegraphics commands
 * - figure environments with captions
 * - Common image formats (pdf, png, jpg, eps)
 */

import * as fs from 'fs/promises'
import * as path from 'path'

export interface FigureReference {
  /** The file path referenced in LaTeX */
  referencePath: string
  /** Caption from figure environment (if available) */
  caption?: string
  /** Label from figure environment (if available) */
  label?: string
  /** Options passed to includegraphics */
  options?: string
  /** Line number in source file */
  lineNumber: number
  /** Source file this was found in */
  sourceFile: string
}

export interface ExtractedFigure extends FigureReference {
  /** Resolved file path on disk */
  resolvedPath: string
  /** File extension */
  extension: string
  /** File size in bytes */
  size: number
  /** Whether the file was found */
  found: boolean
}

export interface FigureExtractionResult {
  /** List of figures found and their status */
  figures: ExtractedFigure[]
  /** Directory where figures were copied (if organized) */
  figuresDir?: string
  /** Count of found figures */
  foundCount: number
  /** Count of missing figures */
  missingCount: number
}

/**
 * Parse LaTeX source to find figure references
 */
export function parseFigureReferences(latexContent: string, sourceFile: string): FigureReference[] {
  const figures: FigureReference[] = []

  // Pattern for \includegraphics with optional arguments
  const includeGraphicsRegex = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g

  // Pattern for figure environment
  const figureEnvRegex =
    /\\begin\{figure\}[\s\S]*?\\end\{figure\}/g

  // Track figure environments and their content
  const figureEnvs: Array<{
    content: string
    startLine: number
  }> = []

  // Find all figure environments
  let figureMatch
  while ((figureMatch = figureEnvRegex.exec(latexContent)) !== null) {
    const content = figureMatch[0]
    const beforeMatch = latexContent.substring(0, figureMatch.index)
    const startLine = beforeMatch.split('\n').length

    figureEnvs.push({ content, startLine })
  }

  // Process figure environments first
  for (const env of figureEnvs) {
    // Extract caption
    const captionMatch = env.content.match(/\\caption\s*(?:\[[^\]]*\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/)
    const caption = captionMatch ? captionMatch[1].trim() : undefined

    // Extract label
    const labelMatch = env.content.match(/\\label\s*\{([^}]+)\}/)
    const label = labelMatch ? labelMatch[1] : undefined

    // Find includegraphics within this environment
    let graphicsMatch
    const envGraphicsRegex = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g

    while ((graphicsMatch = envGraphicsRegex.exec(env.content)) !== null) {
      const options = graphicsMatch[1]
      const filePath = graphicsMatch[2].trim()

      // Calculate line number
      const beforeGraphics = env.content.substring(0, graphicsMatch.index)
      const linesInEnv = beforeGraphics.split('\n').length - 1
      const lineNumber = env.startLine + linesInEnv

      figures.push({
        referencePath: filePath,
        caption,
        label,
        options,
        lineNumber,
        sourceFile,
      })
    }
  }

  // Find standalone includegraphics (not in figure environment)
  let match
  while ((match = includeGraphicsRegex.exec(latexContent)) !== null) {
    const matchStart = match.index
    const beforeMatch = latexContent.substring(0, matchStart)
    const lineNumber = beforeMatch.split('\n').length

    const filePath = match[2].trim()

    // Check if this is already captured in a figure environment
    const alreadyCaptured = figures.some(
      (f) => f.referencePath === filePath && Math.abs(f.lineNumber - lineNumber) < 5
    )

    if (!alreadyCaptured) {
      figures.push({
        referencePath: filePath,
        options: match[1],
        lineNumber,
        sourceFile,
      })
    }
  }

  return figures
}

/**
 * Resolve a figure path to an actual file
 * Handles:
 * - Files without extension (LaTeX auto-adds)
 * - Relative paths
 * - Common image directories
 */
async function resolveFigurePath(
  referencePath: string,
  sourceDir: string
): Promise<{ path: string; extension: string } | null> {
  // Common extensions to try (in order of preference)
  const extensions = ['', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg', '.gif']

  // Common directories to search
  const searchDirs = [
    sourceDir,
    path.join(sourceDir, 'figures'),
    path.join(sourceDir, 'figs'),
    path.join(sourceDir, 'images'),
    path.join(sourceDir, 'img'),
  ]

  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, `${referencePath}${ext}`)
      try {
        await fs.access(fullPath)
        const actualExt = ext || path.extname(referencePath)
        return { path: fullPath, extension: actualExt }
      } catch {
        // File doesn't exist, try next
      }
    }
  }

  // Try the reference path as-is (it might be absolute or have extension)
  const directPath = path.isAbsolute(referencePath)
    ? referencePath
    : path.join(sourceDir, referencePath)

  try {
    await fs.access(directPath)
    return { path: directPath, extension: path.extname(directPath) }
  } catch {
    return null
  }
}

/**
 * Extract figures from an extracted arXiv source directory
 *
 * @param sourceDir - Directory containing extracted LaTeX source
 * @param options - Extraction options
 * @returns Figure extraction result
 */
export async function extractFigures(
  sourceDir: string,
  options: {
    /** Output directory to copy figures to (optional) */
    outputDir?: string
    /** Whether to organize figures with renamed sequential names */
    organize?: boolean
  } = {}
): Promise<FigureExtractionResult> {
  const { outputDir, organize = false } = options

  // Find all .tex files
  const texFiles: string[] = []

  async function findTexFiles(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await findTexFiles(fullPath)
      } else if (entry.name.endsWith('.tex')) {
        texFiles.push(fullPath)
      }
    }
  }

  await findTexFiles(sourceDir)

  // Parse all tex files for figure references
  const allReferences: FigureReference[] = []

  for (const texFile of texFiles) {
    const content = await fs.readFile(texFile, 'utf-8')
    const refs = parseFigureReferences(content, texFile)
    allReferences.push(...refs)
  }

  // Deduplicate by reference path
  const uniqueRefs = new Map<string, FigureReference>()
  for (const ref of allReferences) {
    if (!uniqueRefs.has(ref.referencePath)) {
      uniqueRefs.set(ref.referencePath, ref)
    }
  }

  // Resolve each figure reference
  const figures: ExtractedFigure[] = []

  for (const ref of uniqueRefs.values()) {
    const resolved = await resolveFigurePath(ref.referencePath, sourceDir)

    if (resolved) {
      const stats = await fs.stat(resolved.path)
      figures.push({
        ...ref,
        resolvedPath: resolved.path,
        extension: resolved.extension,
        size: stats.size,
        found: true,
      })
    } else {
      figures.push({
        ...ref,
        resolvedPath: '',
        extension: '',
        size: 0,
        found: false,
      })
    }
  }

  const foundCount = figures.filter((f) => f.found).length
  const missingCount = figures.filter((f) => !f.found).length

  // Optionally copy/organize figures
  let figuresDir: string | undefined

  if (outputDir && figures.some((f) => f.found)) {
    figuresDir = outputDir
    await fs.mkdir(figuresDir, { recursive: true })

    let index = 1
    for (const figure of figures) {
      if (!figure.found) continue

      let destName: string
      if (organize) {
        // Use sequential naming: figure_01.png, figure_02.pdf, etc.
        destName = `figure_${String(index).padStart(2, '0')}${figure.extension}`
        index++
      } else {
        // Keep original filename
        destName = path.basename(figure.resolvedPath)
      }

      const destPath = path.join(figuresDir, destName)
      await fs.copyFile(figure.resolvedPath, destPath)
    }
  }

  return {
    figures,
    figuresDir,
    foundCount,
    missingCount,
  }
}

/**
 * Get a summary of figures in a paper
 */
export function summarizeFigures(result: FigureExtractionResult): string {
  const lines: string[] = []

  lines.push(`Found ${result.foundCount} figures (${result.missingCount} missing)`)
  lines.push('')

  for (let i = 0; i < result.figures.length; i++) {
    const fig = result.figures[i]
    const status = fig.found ? '✓' : '✗'
    const size = fig.found ? ` (${Math.round(fig.size / 1024)}KB)` : ''

    let line = `${status} [${i + 1}] ${fig.referencePath}${size}`

    if (fig.caption) {
      // Truncate long captions
      const caption = fig.caption.length > 80 ? fig.caption.substring(0, 77) + '...' : fig.caption
      line += `\n    Caption: ${caption}`
    }

    if (fig.label) {
      line += `\n    Label: ${fig.label}`
    }

    lines.push(line)
  }

  return lines.join('\n')
}
