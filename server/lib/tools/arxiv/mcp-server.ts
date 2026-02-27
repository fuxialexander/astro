#!/usr/bin/env node
/**
 * arXiv Paper Fetcher MCP Server
 *
 * Provides MCP tools for fetching and processing arXiv papers.
 * Can be used standalone or integrated with other MCP servers.
 *
 * Tools:
 * - arxiv_fetch_metadata: Get paper metadata (title, authors, abstract)
 * - arxiv_download: Download paper (source or PDF)
 * - arxiv_search: Search arXiv for papers
 * - arxiv_extract_figures: Extract figures from downloaded source
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import * as path from 'path'
import * as os from 'os'

import { parseArxivId, isValidArxivInput, getArxivUrls } from './parser.js'
import { fetchArxivMetadata, searchArxiv, type ArxivPaperMetadata } from './api.js'
import { downloadArxivPaper, downloadAndExtractSource } from './downloader.js'
import { extractFigures, summarizeFigures } from './figures.js'

// ────────────────────────────────────────────────────────────────────────────
// MCP Server Definition
// ────────────────────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'arxiv-tools',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Default output directory
const defaultOutputDir = process.env.ARXIV_OUTPUT_DIR || path.join(os.tmpdir(), 'arxiv-papers')

// ────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'arxiv_fetch_metadata',
    description:
      'Fetch metadata for an arXiv paper including title, authors, abstract, categories, and links. ' +
      'Accepts paper IDs (e.g., "2401.12345") or URLs (e.g., "https://arxiv.org/abs/2401.12345").',
    inputSchema: {
      type: 'object',
      properties: {
        paper_id: {
          type: 'string',
          description: 'arXiv paper ID or URL (e.g., "2401.12345" or "https://arxiv.org/abs/2401.12345")',
        },
      },
      required: ['paper_id'],
    },
  },
  {
    name: 'arxiv_download',
    description:
      'Download an arXiv paper. By default, downloads LaTeX source if available, otherwise falls back to PDF. ' +
      'Most CS papers have LaTeX source available. Returns file path and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        paper_id: {
          type: 'string',
          description: 'arXiv paper ID or URL',
        },
        output_dir: {
          type: 'string',
          description: 'Output directory for downloaded files (optional)',
        },
        prefer_pdf: {
          type: 'boolean',
          description: 'If true, prefer PDF even if source is available (default: false)',
        },
        extract: {
          type: 'boolean',
          description: 'If true and source is downloaded, extract the tarball (default: true)',
        },
      },
      required: ['paper_id'],
    },
  },
  {
    name: 'arxiv_search',
    description:
      'Search arXiv for papers matching a query. Supports full arXiv search syntax including ' +
      'field-specific searches like "au:author" for authors, "ti:title" for titles, "cat:cs.AI" for categories.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query. Examples: "transformer attention", "au:vaswani", "cat:cs.AI AND ti:language"',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10, max: 100)',
        },
        sort_by: {
          type: 'string',
          enum: ['relevance', 'lastUpdatedDate', 'submittedDate'],
          description: 'Sort order (default: relevance)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'arxiv_extract_figures',
    description:
      'Extract figures from a downloaded and extracted arXiv paper source. ' +
      'Parses LaTeX files to find \\includegraphics commands and copies figures to an output directory.',
    inputSchema: {
      type: 'object',
      properties: {
        source_dir: {
          type: 'string',
          description: 'Directory containing extracted LaTeX source',
        },
        output_dir: {
          type: 'string',
          description: 'Directory to copy figures to (optional)',
        },
        organize: {
          type: 'boolean',
          description: 'If true, rename figures sequentially (figure_01.png, etc.) (default: true)',
        },
      },
      required: ['source_dir'],
    },
  },
  {
    name: 'arxiv_validate_id',
    description:
      'Validate and parse an arXiv paper ID or URL. Returns normalized ID and URLs for various formats.',
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'arXiv paper ID or URL to validate',
        },
      },
      required: ['input'],
    },
  },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}))

// ────────────────────────────────────────────────────────────────────────────
// Tool Handlers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format paper metadata for display
 */
function formatMetadata(metadata: ArxivPaperMetadata): string {
  const lines: string[] = []

  lines.push(`Title: ${metadata.title}`)
  lines.push('')
  lines.push(`Authors: ${metadata.authors.map((a) => a.name).join(', ')}`)
  lines.push('')
  lines.push(`arXiv ID: ${metadata.id}`)
  lines.push(`Category: ${metadata.primaryCategory}`)
  lines.push(`Published: ${metadata.published.toISOString().split('T')[0]}`)
  lines.push(`Updated: ${metadata.updated.toISOString().split('T')[0]}`)

  if (metadata.doi) {
    lines.push(`DOI: ${metadata.doi}`)
  }

  if (metadata.journalRef) {
    lines.push(`Journal: ${metadata.journalRef}`)
  }

  if (metadata.comment) {
    lines.push(`Comment: ${metadata.comment}`)
  }

  lines.push('')
  lines.push('Abstract:')
  lines.push(metadata.abstract)

  lines.push('')
  lines.push('Links:')
  lines.push(`  Abstract: ${metadata.urls.abstract}`)
  lines.push(`  PDF: ${metadata.urls.pdf}`)
  lines.push(`  Source: ${metadata.urls.source}`)

  return lines.join('\n')
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name
  const args = request.params.arguments as Record<string, unknown>

  try {
    // ── arxiv_validate_id ────────────────────────────────────────────────────
    if (toolName === 'arxiv_validate_id') {
      const input = args.input as string

      if (!input) {
        throw new Error('input is required')
      }

      if (!isValidArxivInput(input)) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid arXiv ID or URL: ${input}`,
            },
          ],
          isError: true,
        }
      }

      const parsed = parseArxivId(input)!
      const urls = getArxivUrls(parsed.paperId, parsed.version)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                valid: true,
                paperId: parsed.paperId,
                isOldFormat: parsed.isOldFormat,
                version: parsed.version,
                category: parsed.category,
                urls,
              },
              null,
              2
            ),
          },
        ],
      }
    }

    // ── arxiv_fetch_metadata ─────────────────────────────────────────────────
    if (toolName === 'arxiv_fetch_metadata') {
      const paperId = args.paper_id as string

      if (!paperId) {
        throw new Error('paper_id is required')
      }

      const metadata = await fetchArxivMetadata(paperId)

      if (!metadata) {
        return {
          content: [
            {
              type: 'text',
              text: `Paper not found: ${paperId}`,
            },
          ],
          isError: true,
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: formatMetadata(metadata),
          },
        ],
      }
    }

    // ── arxiv_download ───────────────────────────────────────────────────────
    if (toolName === 'arxiv_download') {
      const paperId = args.paper_id as string
      const outputDir = (args.output_dir as string) || defaultOutputDir
      const preferPdf = (args.prefer_pdf as boolean) || false
      const extract = args.extract !== false // Default true

      if (!paperId) {
        throw new Error('paper_id is required')
      }

      let result
      if (preferPdf || !extract) {
        result = await downloadArxivPaper(paperId, { outputDir, preferPdf })
        return {
          content: [
            {
              type: 'text',
              text: [
                `Downloaded: ${result.metadata.title}`,
                `Type: ${result.type}${result.isFallback ? ' (fallback - source not available)' : ''}`,
                `File: ${result.filePath}`,
                `Size: ${Math.round(result.size / 1024)} KB`,
              ].join('\n'),
            },
          ],
        }
      } else {
        try {
          const extracted = await downloadAndExtractSource(paperId, { outputDir })
          return {
            content: [
              {
                type: 'text',
                text: [
                  `Downloaded and extracted: ${extracted.download.metadata.title}`,
                  `Source archive: ${extracted.download.filePath}`,
                  `Extracted to: ${extracted.extractedDir}`,
                  `Files extracted: ${extracted.extractedFiles.length}`,
                  '',
                  'Extracted files:',
                  ...extracted.extractedFiles.slice(0, 20).map((f) => `  - ${path.basename(f)}`),
                  extracted.extractedFiles.length > 20
                    ? `  ... and ${extracted.extractedFiles.length - 20} more`
                    : '',
                ].join('\n'),
              },
            ],
          }
        } catch {
          // Fallback to PDF
          result = await downloadArxivPaper(paperId, { outputDir, preferPdf: true })
          return {
            content: [
              {
                type: 'text',
                text: [
                  `Downloaded (PDF fallback): ${result.metadata.title}`,
                  `Note: LaTeX source not available, downloaded PDF instead`,
                  `File: ${result.filePath}`,
                  `Size: ${Math.round(result.size / 1024)} KB`,
                ].join('\n'),
              },
            ],
          }
        }
      }
    }

    // ── arxiv_search ─────────────────────────────────────────────────────────
    if (toolName === 'arxiv_search') {
      const query = args.query as string
      const maxResults = Math.min((args.max_results as number) || 10, 100)
      const sortBy = (args.sort_by as 'relevance' | 'lastUpdatedDate' | 'submittedDate') || 'relevance'

      if (!query) {
        throw new Error('query is required')
      }

      const results = await searchArxiv(query, { maxResults, sortBy })

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No papers found for query: ${query}`,
            },
          ],
        }
      }

      const formatted = results.map((paper, i) => {
        const authors =
          paper.authors.length > 3
            ? `${paper.authors.slice(0, 3).map((a) => a.name).join(', ')} et al.`
            : paper.authors.map((a) => a.name).join(', ')

        return [
          `[${i + 1}] ${paper.title}`,
          `    ID: ${paper.id} | ${paper.primaryCategory}`,
          `    Authors: ${authors}`,
          `    Date: ${paper.published.toISOString().split('T')[0]}`,
        ].join('\n')
      })

      return {
        content: [
          {
            type: 'text',
            text: [`Found ${results.length} papers:\n`, ...formatted].join('\n'),
          },
        ],
      }
    }

    // ── arxiv_extract_figures ────────────────────────────────────────────────
    if (toolName === 'arxiv_extract_figures') {
      const sourceDir = args.source_dir as string
      const outputDir = args.output_dir as string | undefined
      const organize = args.organize !== false // Default true

      if (!sourceDir) {
        throw new Error('source_dir is required')
      }

      const result = await extractFigures(sourceDir, { outputDir, organize })

      return {
        content: [
          {
            type: 'text',
            text: [
              summarizeFigures(result),
              '',
              outputDir ? `Figures copied to: ${result.figuresDir}` : '',
            ].join('\n'),
          },
        ],
      }
    }

    throw new Error(`Unknown tool: ${toolName}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    }
  }
})

// ────────────────────────────────────────────────────────────────────────────
// Server Startup
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('arXiv Paper Fetcher MCP Server v1.0 running on stdio')
  console.error(`  Output directory: ${defaultOutputDir}`)
  console.error(`  Tools available: ${TOOLS.length}`)
}

// Only run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Server error:', error)
    process.exit(1)
  })
}

export { server }
