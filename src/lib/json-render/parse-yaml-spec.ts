import { createYamlStreamCompiler } from '@json-render/yaml'

type TextSegment = { type: 'text'; content: string }
type SpecSegment = {
  type: 'spec'
  spec: { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> }
  /** Custom component definitions (from ```component fences) to merge into registry at render time */
  componentDefs?: Record<string, string>
}
type Segment = TextSegment | SpecSegment

const YAML_SPEC_FENCE = '```yaml-spec'
const COMPONENT_FENCE = '```component'
const FENCE_CLOSE = '```'

/**
 * Parse a message string containing ```yaml-spec and ```component fences.
 *
 * Returns segments: text, spec (with optional componentDefs).
 * Component definitions (```component Name) are collected and attached
 * to the next spec segment that follows them.
 */
export function parseYamlSpecFromText(text: string): Segment[] {
  const segments: Segment[] = []
  let remaining = text
  let pendingComponents: Record<string, string> = {}

  while (remaining.length > 0) {
    // Find next fence of either type
    const yamlIdx = remaining.indexOf(YAML_SPEC_FENCE)
    const compIdx = remaining.indexOf(COMPONENT_FENCE)

    // No more fences
    if (yamlIdx === -1 && compIdx === -1) {
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining })
      }
      break
    }

    // Pick the nearest fence
    const isComponent = compIdx !== -1 && (yamlIdx === -1 || compIdx < yamlIdx)
    const fenceIdx = isComponent ? compIdx : yamlIdx

    // Text before fence
    if (fenceIdx > 0) {
      const textBefore = remaining.slice(0, fenceIdx)
      if (textBefore.trim()) {
        segments.push({ type: 'text', content: textBefore })
      }
    }

    // Extract the fence header line (for component: ```component ScatterPlot)
    const headerEnd = remaining.indexOf('\n', fenceIdx)
    if (headerEnd === -1) {
      segments.push({ type: 'text', content: remaining.slice(fenceIdx) })
      break
    }
    const headerLine = remaining.slice(fenceIdx, headerEnd)

    // Find closing fence
    const contentStart = headerEnd + 1
    const closeIdx = remaining.indexOf(FENCE_CLOSE, contentStart)
    if (closeIdx === -1) {
      segments.push({ type: 'text', content: remaining.slice(fenceIdx) })
      break
    }

    const content = remaining.slice(contentStart, closeIdx)

    if (isComponent) {
      // Extract component name from header: ```component ScatterPlot
      const name = headerLine.slice(COMPONENT_FENCE.length).trim()
      if (name) {
        pendingComponents[name] = content.trim()
      }
    } else {
      // Parse YAML spec
      const spec = parseYamlToSpec(content)
      if (spec && spec.root) {
        const segment: SpecSegment = { type: 'spec', spec }
        if (Object.keys(pendingComponents).length > 0) {
          segment.componentDefs = pendingComponents
          pendingComponents = {}
        }
        segments.push(segment)
      }
    }

    // Advance past closing fence
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
