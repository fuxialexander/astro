/**
 * Deterministic plan JSON to Mermaid flowchart converter.
 *
 * Converts plan nodes and edges into a Mermaid graph definition string.
 * Pure function — no AI, no network, no side effects.
 */

export interface MermaidNode {
  id: string
  title: string
  type: 'task' | 'milestone' | 'branch' | 'decision'
  status?: string
}

export interface MermaidEdge {
  source: string
  target: string
}

/** Escape special Mermaid characters in labels.
 *  `;` and `|` are safe inside quoted labels ("...") — only dangerous at top level.
 *  Newlines break the line-based graph definition and must be replaced. */
function escapeLabel(text: string): string {
  return text
    .replace(/\n/g, ' ')      // Newlines break graph line structure
    .replace(/#/g, '#num;')   // Must be before entity refs — prevents accidental refs
    .replace(/"/g, '#quot;')
    .replace(/\[/g, '#lsqb;')
    .replace(/\]/g, '#rsqb;')
    .replace(/\(/g, '#lpar;')
    .replace(/\)/g, '#rpar;')
    .replace(/\{/g, '#lbrace;')
    .replace(/\}/g, '#rbrace;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
}

/** Truncate long titles for readability in the graph */
function truncate(text: string, max = 40): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '\u2026'
}

/**
 * Convert plan nodes and edges into a Mermaid flowchart definition.
 *
 * Milestones render as double-bordered hexagons ({{...}}).
 * Tasks render as rounded rectangles ("...").
 * Edges render as arrows.
 */
export function planToMermaid(
  nodes: MermaidNode[],
  edges: MermaidEdge[],
): string {
  if (nodes.length === 0) return ''

  const lines: string[] = ['graph TD']

  // Build a set of valid node IDs for edge filtering
  const nodeIds = new Set(nodes.map((n) => n.id))

  // Sanitize node IDs for Mermaid (replace non-alphanumeric chars with underscores)
  const idMap = new Map<string, string>()
  nodes.forEach((n, i) => {
    // Use a stable short ID based on index to avoid Mermaid parsing issues
    idMap.set(n.id, `n${i}`)
  })

  // Render nodes
  for (const node of nodes) {
    const mid = idMap.get(node.id)!
    const label = escapeLabel(truncate(node.title))
    if (node.type === 'milestone') {
      lines.push(`    ${mid}{{"${label}"}}`)
    } else {
      lines.push(`    ${mid}("${label}")`)
    }
  }

  // Render edges (only between valid nodes)
  for (const edge of edges) {
    const src = idMap.get(edge.source)
    const tgt = idMap.get(edge.target)
    if (src && tgt && nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      lines.push(`    ${src} --> ${tgt}`)
    }
  }

  // Add style classes
  lines.push('')
  lines.push('    classDef task fill:#dbeafe,stroke:#93c5fd,color:#1e293b')
  lines.push('    classDef milestone fill:#fef3c7,stroke:#fcd34b,color:#1e293b')
  lines.push('    classDef completed fill:#dcfce7,stroke:#86efac,color:#1e293b')
  lines.push('    classDef inprogress fill:#ede9fe,stroke:#c4b5fd,color:#1e293b')
  lines.push('    classDef pruned fill:#f1f5f9,stroke:#cbd5e1,color:#94a3b8')

  // Apply classes based on type and status
  for (const node of nodes) {
    const mid = idMap.get(node.id)!
    if (node.status === 'completed' || node.status === 'auto_verified') {
      lines.push(`    class ${mid} completed`)
    } else if (node.status === 'in_progress' || node.status === 'dispatched') {
      lines.push(`    class ${mid} inprogress`)
    } else if (node.status === 'pruned') {
      lines.push(`    class ${mid} pruned`)
    } else if (node.type === 'milestone') {
      lines.push(`    class ${mid} milestone`)
    } else {
      lines.push(`    class ${mid} task`)
    }
  }

  return lines.join('\n')
}
