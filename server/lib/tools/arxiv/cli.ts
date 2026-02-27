#!/usr/bin/env node
/**
 * arXiv Paper Fetcher CLI
 *
 * A command-line interface for fetching and processing arXiv papers.
 *
 * Usage:
 *   npx tsx server/lib/tools/arxiv/cli.ts fetch 2401.12345
 *   npx tsx server/lib/tools/arxiv/cli.ts search "transformer attention"
 *   npx tsx server/lib/tools/arxiv/cli.ts download 2401.12345 --output ./papers
 *   npx tsx server/lib/tools/arxiv/cli.ts figures ./extracted_source
 */

import { parseArgs } from 'util'
import * as path from 'path'
import {
  parseArxivId,
  isValidArxivInput,
  getArxivUrls,
  fetchArxivMetadata,
  searchArxiv,
  downloadArxivPaper,
  downloadAndExtractSource,
  extractFigures,
  summarizeFigures,
  type ArxivPaperMetadata,
} from './index.js'

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
arXiv Paper Fetcher CLI

Usage:
  arxiv-fetch <command> [options] [arguments]

Commands:
  metadata <paper_id>     Fetch and display paper metadata
  search <query>          Search arXiv for papers
  download <paper_id>     Download paper (source or PDF)
  figures <source_dir>    Extract figures from downloaded source
  validate <input>        Validate and parse arXiv ID/URL

Options:
  -o, --output <dir>      Output directory for downloads
  -n, --max-results <n>   Max results for search (default: 10)
  --pdf                   Prefer PDF download over source
  --no-extract            Don't extract downloaded tarball
  --organize              Organize extracted figures with sequential names
  -h, --help              Show this help message

Examples:
  arxiv-fetch metadata 2401.12345
  arxiv-fetch search "transformer attention" -n 5
  arxiv-fetch download https://arxiv.org/abs/2401.12345 -o ./papers
  arxiv-fetch figures ./papers/2401.12345 --organize
`)
}

function formatMetadata(metadata: ArxivPaperMetadata): string {
  const lines: string[] = []

  lines.push('\n┌─────────────────────────────────────────────────────────────────────────────')
  lines.push(`│ ${metadata.title}`)
  lines.push('├─────────────────────────────────────────────────────────────────────────────')
  lines.push(`│ Authors: ${metadata.authors.map((a) => a.name).join(', ')}`)
  lines.push(`│ ID: ${metadata.id} | Category: ${metadata.primaryCategory}`)
  lines.push(`│ Published: ${metadata.published.toISOString().split('T')[0]} | Updated: ${metadata.updated.toISOString().split('T')[0]}`)

  if (metadata.doi) {
    lines.push(`│ DOI: ${metadata.doi}`)
  }

  if (metadata.journalRef) {
    lines.push(`│ Journal: ${metadata.journalRef}`)
  }

  if (metadata.comment) {
    lines.push(`│ Comment: ${metadata.comment}`)
  }

  lines.push('├─────────────────────────────────────────────────────────────────────────────')
  lines.push('│ Abstract:')

  // Word wrap abstract
  const words = metadata.abstract.split(' ')
  let currentLine = '│ '
  for (const word of words) {
    if (currentLine.length + word.length > 78) {
      lines.push(currentLine)
      currentLine = '│ ' + word + ' '
    } else {
      currentLine += word + ' '
    }
  }
  if (currentLine.trim() !== '│') {
    lines.push(currentLine)
  }

  lines.push('├─────────────────────────────────────────────────────────────────────────────')
  lines.push('│ Links:')
  lines.push(`│   Abstract: ${metadata.urls.abstract}`)
  lines.push(`│   PDF: ${metadata.urls.pdf}`)
  lines.push(`│   Source: ${metadata.urls.source}`)
  lines.push('└─────────────────────────────────────────────────────────────────────────────\n')

  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────────────

async function cmdMetadata(paperId: string) {
  if (!paperId) {
    console.error('Error: paper_id is required')
    process.exit(1)
  }

  if (!isValidArxivInput(paperId)) {
    console.error(`Error: Invalid arXiv ID or URL: ${paperId}`)
    process.exit(1)
  }

  console.log(`Fetching metadata for ${paperId}...`)

  const metadata = await fetchArxivMetadata(paperId)

  if (!metadata) {
    console.error(`Error: Paper not found: ${paperId}`)
    process.exit(1)
  }

  console.log(formatMetadata(metadata))
}

async function cmdSearch(query: string, maxResults: number) {
  if (!query) {
    console.error('Error: search query is required')
    process.exit(1)
  }

  console.log(`Searching arXiv for: "${query}"...\n`)

  const results = await searchArxiv(query, { maxResults })

  if (results.length === 0) {
    console.log('No papers found.')
    return
  }

  console.log(`Found ${results.length} papers:\n`)

  for (let i = 0; i < results.length; i++) {
    const paper = results[i]
    const authors =
      paper.authors.length > 3
        ? `${paper.authors.slice(0, 3).map((a) => a.name).join(', ')} et al.`
        : paper.authors.map((a) => a.name).join(', ')

    console.log(`[${i + 1}] ${paper.title}`)
    console.log(`    ID: ${paper.id} | ${paper.primaryCategory} | ${paper.published.toISOString().split('T')[0]}`)
    console.log(`    Authors: ${authors}`)
    console.log('')
  }
}

async function cmdDownload(paperId: string, outputDir: string, preferPdf: boolean, extract: boolean) {
  if (!paperId) {
    console.error('Error: paper_id is required')
    process.exit(1)
  }

  if (!isValidArxivInput(paperId)) {
    console.error(`Error: Invalid arXiv ID or URL: ${paperId}`)
    process.exit(1)
  }

  console.log(`Downloading ${paperId}...`)

  if (preferPdf || !extract) {
    const result = await downloadArxivPaper(paperId, { outputDir, preferPdf })
    console.log(`\n✓ Downloaded: ${result.metadata.title}`)
    console.log(`  Type: ${result.type}${result.isFallback ? ' (fallback - source not available)' : ''}`)
    console.log(`  File: ${result.filePath}`)
    console.log(`  Size: ${Math.round(result.size / 1024)} KB`)
  } else {
    try {
      const result = await downloadAndExtractSource(paperId, { outputDir })
      console.log(`\n✓ Downloaded and extracted: ${result.download.metadata.title}`)
      console.log(`  Archive: ${result.download.filePath}`)
      console.log(`  Extracted to: ${result.extractedDir}`)
      console.log(`  Files: ${result.extractedFiles.length}`)

      // Show some extracted files
      const texFiles = result.extractedFiles.filter((f) => f.endsWith('.tex'))
      const figFiles = result.extractedFiles.filter((f) =>
        /\.(pdf|png|jpg|jpeg|eps|svg)$/i.test(f)
      )

      if (texFiles.length > 0) {
        console.log(`\n  LaTeX files (${texFiles.length}):`)
        texFiles.slice(0, 5).forEach((f) => console.log(`    - ${path.basename(f)}`))
        if (texFiles.length > 5) console.log(`    ... and ${texFiles.length - 5} more`)
      }

      if (figFiles.length > 0) {
        console.log(`\n  Figure files (${figFiles.length}):`)
        figFiles.slice(0, 5).forEach((f) => console.log(`    - ${path.basename(f)}`))
        if (figFiles.length > 5) console.log(`    ... and ${figFiles.length - 5} more`)
      }
    } catch {
      console.log('Source not available, falling back to PDF...')
      const result = await downloadArxivPaper(paperId, { outputDir, preferPdf: true })
      console.log(`\n✓ Downloaded (PDF fallback): ${result.metadata.title}`)
      console.log(`  File: ${result.filePath}`)
      console.log(`  Size: ${Math.round(result.size / 1024)} KB`)
    }
  }
}

async function cmdFigures(sourceDir: string, outputDir: string | undefined, organize: boolean) {
  if (!sourceDir) {
    console.error('Error: source_dir is required')
    process.exit(1)
  }

  console.log(`Extracting figures from ${sourceDir}...`)

  const result = await extractFigures(sourceDir, { outputDir, organize })

  console.log('\n' + summarizeFigures(result))

  if (result.figuresDir) {
    console.log(`\nFigures copied to: ${result.figuresDir}`)
  }
}

async function cmdValidate(input: string) {
  if (!input) {
    console.error('Error: input is required')
    process.exit(1)
  }

  if (!isValidArxivInput(input)) {
    console.log(`✗ Invalid arXiv ID or URL: ${input}`)
    process.exit(1)
  }

  const parsed = parseArxivId(input)!
  const urls = getArxivUrls(parsed.paperId, parsed.version)

  console.log(`✓ Valid arXiv identifier\n`)
  console.log(`  Paper ID: ${parsed.paperId}`)
  console.log(`  Format: ${parsed.isOldFormat ? 'Old (category/id)' : 'New (YYMM.nnnnn)'}`)
  if (parsed.version) {
    console.log(`  Version: v${parsed.version}`)
  }
  if (parsed.category) {
    console.log(`  Category: ${parsed.category}`)
  }
  console.log(`\n  URLs:`)
  console.log(`    Abstract: ${urls.abstract}`)
  console.log(`    PDF: ${urls.pdf}`)
  console.log(`    Source: ${urls.source}`)
  console.log(`    API: ${urls.api}`)
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      'max-results': { type: 'string', short: 'n' },
      pdf: { type: 'boolean' },
      'no-extract': { type: 'boolean' },
      organize: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help || positionals.length === 0) {
    printUsage()
    process.exit(0)
  }

  const [command, ...args] = positionals
  const outputDir = values.output || '.'
  const maxResults = parseInt(values['max-results'] || '10', 10)
  const preferPdf = values.pdf || false
  const extract = !values['no-extract']
  const organize = values.organize || false

  try {
    switch (command) {
      case 'metadata':
      case 'meta':
      case 'info':
        await cmdMetadata(args[0])
        break

      case 'search':
      case 's':
        await cmdSearch(args.join(' '), maxResults)
        break

      case 'download':
      case 'dl':
      case 'get':
        await cmdDownload(args[0], outputDir, preferPdf, extract)
        break

      case 'figures':
      case 'figs':
        await cmdFigures(args[0], values.output, organize)
        break

      case 'validate':
      case 'parse':
        await cmdValidate(args[0])
        break

      default:
        console.error(`Unknown command: ${command}`)
        printUsage()
        process.exit(1)
    }
  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exit(1)
  }
}

main()
