/**
 * Extracts plan JSON (with nodes/edges) from streaming text output.
 * Tries code-fenced JSON first, then falls back to raw JSON detection with brace balancing.
 */
export function extractPlanJsonFromText(text: string): { projectName?: string; nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null {
  // Try to find JSON in a code fence
  const fenceMatch = text.match(/```json\s*\n([\s\S]*?)\n```/)
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1])
      if (parsed.nodes && Array.isArray(parsed.nodes)) return parsed
    } catch { /* try next method */ }
  }

  // Try to find a raw JSON object with projectName and nodes
  const jsonMatch = text.match(/\{[\s\S]*"projectName"[\s\S]*"nodes"[\s\S]*\}/)
  if (jsonMatch) {
    // Find the balanced braces
    const startIdx = text.indexOf(jsonMatch[0])
    let depth = 0
    let endIdx = startIdx
    for (let i = startIdx; i < text.length; i++) {
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
      const parsed = JSON.parse(text.slice(startIdx, endIdx))
      if (parsed.nodes && Array.isArray(parsed.nodes)) return parsed
    } catch { /* no valid JSON found */ }
  }

  return null
}
