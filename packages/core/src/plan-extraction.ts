/**
 * Plan JSON extraction from streaming text output.
 *
 * Shared between frontend (plan-extraction.ts) and server (dispatch routes)
 * for consistent extraction behavior.
 */

export interface PlanJsonResult {
  projectName?: string
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
}

/**
 * Extracts plan JSON (with nodes/edges) from streaming text output.
 * Tries ALL code-fenced JSON blocks (last match first, since the plan is
 * typically the final output), then falls back to raw JSON detection
 * searching backwards from the end of the text.
 */
export function extractPlanJsonFromText(text: string): PlanJsonResult | null {
  // Collect ALL ```json code fences
  const fenceRegex = /```json\s*\n([\s\S]*?)\n```/g
  const fences: { content: string; index: number }[] = []
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(text)) !== null) {
    fences.push({ content: match[1], index: match.index! })
  }

  // Try fences in reverse order (last fence first — plan is typically the last output)
  for (let i = fences.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(fences[i].content)
      if (parsed.nodes && Array.isArray(parsed.nodes)) {
        return parsed
      }
    } catch {
      // Try next fence
    }
  }

  // Fallback: find raw JSON with "nodes" array by searching backwards from end of text.
  // Look for the LAST occurrence of "projectName" to find the plan JSON.
  const lastProjectNameIdx = text.lastIndexOf('"projectName"')
  if (lastProjectNameIdx === -1) {
    return null
  }

  // Walk backwards from "projectName" to find the opening brace
  let openBraceIdx = -1
  for (let i = lastProjectNameIdx - 1; i >= 0; i--) {
    if (text[i] === '{') {
      openBraceIdx = i
      break
    }
  }

  if (openBraceIdx === -1) {
    return null
  }

  // Brace-balance forward from the opening brace to find the complete JSON object
  let depth = 0
  let endIdx = openBraceIdx
  for (let i = openBraceIdx; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        endIdx = i + 1
        break
      }
    }
  }

  try {
    const parsed = JSON.parse(text.slice(openBraceIdx, endIdx))
    if (parsed.nodes && Array.isArray(parsed.nodes)) {
      return parsed
    }
  } catch {
    // Parse failed
  }

  return null
}
