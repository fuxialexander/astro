/**
 * Strip tool use blocks, code fences, JSON objects, and other noise from
 * stream text, keeping only natural-language reasoning/thinking text.
 */
export function filterStreamText(text: string): string {
  let result = text

  // Remove XML-style tool use blocks
  result = result.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, "")
  result = result.replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
  result = result.replace(/<tool_use>[\s\S]*?<\/antml:tool_use>/g, "")
  result = result.replace(/<tool_result>[\s\S]*?<\/antml:tool_result>/g, "")

  // Remove fenced code blocks: ```...```
  result = result.replace(/```[\s\S]*?```/g, "")

  // Remove balanced JSON objects/arrays (brace-matched, greedy on multiline)
  // This catches the plan JSON and any other inline JSON blobs
  result = removeBalancedJson(result)

  // Remove leftover lines that look like JSON fragments (keys, brackets, etc.)
  result = result
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      // Skip empty lines (will collapse later)
      if (!trimmed) return true
      // Skip lines that are just JSON punctuation
      if (/^[{}[\],]+$/.test(trimmed)) return false
      // Skip lines that look like JSON key-value pairs: "key": value
      if (/^"[^"]+"\s*:/.test(trimmed)) return false
      return true
    })
    .join("\n")

  // Collapse multiple blank lines into one
  result = result.replace(/\n{3,}/g, "\n\n")

  return result.trim()
}

/**
 * Remove balanced JSON objects and arrays from text.
 * Handles nested structures by tracking brace/bracket depth.
 * Only removes blocks that are 3+ lines (to preserve short inline references).
 */
function removeBalancedJson(text: string): string {
  const result: string[] = []
  let i = 0

  while (i < text.length) {
    if (text[i] === "{" || text[i] === "[") {
      const open = text[i]
      const close = open === "{" ? "}" : "]"
      let depth = 1
      let j = i + 1

      while (j < text.length && depth > 0) {
        if (text[j] === open) depth++
        else if (text[j] === close) depth--
        j++
      }

      if (depth === 0) {
        const block = text.slice(i, j)
        const lineCount = block.split("\n").length
        // Only strip multi-line JSON blocks (3+ lines)
        if (lineCount >= 3) {
          i = j
          continue
        }
      }
    }

    result.push(text[i])
    i++
  }

  return result.join("")
}
