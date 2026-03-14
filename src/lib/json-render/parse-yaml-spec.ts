import { createYamlStreamCompiler } from '@json-render/yaml'

type TextSegment = { type: 'text'; content: string }
type SpecSegment = { type: 'spec'; spec: { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> } }
type Segment = TextSegment | SpecSegment

const FENCE_OPEN = '```yaml-spec'
const FENCE_CLOSE = '```'

/**
 * Parse a message string containing ```yaml-spec fences into segments.
 * Returns an array of text and spec segments for rendering.
 *
 * Used during session hydration to restore json-render specs from
 * stored message text (which includes the raw yaml-spec fences).
 */
export function parseYamlSpecFromText(text: string): Segment[] {
  const segments: Segment[] = []
  let remaining = text

  while (remaining.length > 0) {
    const fenceIdx = remaining.indexOf(FENCE_OPEN)
    if (fenceIdx === -1) {
      // No more fences — rest is text
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining })
      }
      break
    }

    // Text before fence
    if (fenceIdx > 0) {
      const textBefore = remaining.slice(0, fenceIdx)
      if (textBefore.trim()) {
        segments.push({ type: 'text', content: textBefore })
      }
    }

    // Skip past the fence open + optional newline
    let yamlStart = fenceIdx + FENCE_OPEN.length
    if (remaining[yamlStart] === '\n') yamlStart++

    // Find the closing fence
    const closeIdx = remaining.indexOf(FENCE_CLOSE, yamlStart)
    if (closeIdx === -1) {
      // Unclosed fence — treat rest as text
      segments.push({ type: 'text', content: remaining.slice(fenceIdx) })
      break
    }

    // Extract YAML content and parse
    const yamlContent = remaining.slice(yamlStart, closeIdx)
    const spec = parseYamlToSpec(yamlContent)
    if (spec && spec.root) {
      segments.push({ type: 'spec', spec })
    }

    // Skip past closing fence + optional newline
    let afterClose = closeIdx + FENCE_CLOSE.length
    if (remaining[afterClose] === '\n') afterClose++
    remaining = remaining.slice(afterClose)
  }

  return segments
}

function parseYamlToSpec(yaml: string): { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> } | null {
  try {
    const compiler = createYamlStreamCompiler<Record<string, unknown>>()
    compiler.push(yaml)
    const { result } = compiler.flush()
    if (result.root && result.elements) {
      return {
        root: result.root as string,
        elements: result.elements as Record<string, unknown>,
        state: result.state as Record<string, unknown> | undefined,
      }
    }
    return null
  } catch {
    return null
  }
}
