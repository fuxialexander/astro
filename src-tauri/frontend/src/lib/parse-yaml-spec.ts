/**
 * Parse text containing ```yaml-spec and ```component fences into segments.
 *
 * Adapted from src/lib/json-render/parse-yaml-spec.ts for the desktop frontend.
 */
import { createYamlStreamCompiler } from '@json-render/yaml'

export type TextSegment = { type: 'text'; content: string }
export type SpecSegment = {
  type: 'spec'
  spec: { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> }
  componentDefs?: Record<string, string>
}
export type Segment = TextSegment | SpecSegment

const YAML_SPEC_FENCE = '```yaml-spec'
const COMPONENT_FENCE = '```component'
const FENCE_CLOSE = '```'

export function parseYamlSpecSegments(text: string): Segment[] {
  const segments: Segment[] = []
  let remaining = text
  let pendingComponents: Record<string, string> = {}

  while (remaining.length > 0) {
    const yamlIdx = remaining.indexOf(YAML_SPEC_FENCE)
    const compIdx = remaining.indexOf(COMPONENT_FENCE)

    if (yamlIdx === -1 && compIdx === -1) {
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining })
      }
      break
    }

    const isComponent = compIdx !== -1 && (yamlIdx === -1 || compIdx < yamlIdx)
    const fenceIdx = isComponent ? compIdx : yamlIdx

    if (fenceIdx > 0) {
      const textBefore = remaining.slice(0, fenceIdx)
      if (textBefore.trim()) {
        segments.push({ type: 'text', content: textBefore })
      }
    }

    const headerEnd = remaining.indexOf('\n', fenceIdx)
    if (headerEnd === -1) {
      segments.push({ type: 'text', content: remaining.slice(fenceIdx) })
      break
    }
    const headerLine = remaining.slice(fenceIdx, headerEnd)

    const contentStart = headerEnd + 1
    const closeIdx = remaining.indexOf(FENCE_CLOSE, contentStart)
    if (closeIdx === -1) {
      segments.push({ type: 'text', content: remaining.slice(fenceIdx) })
      break
    }

    const content = remaining.slice(contentStart, closeIdx)

    if (isComponent) {
      const name = headerLine.slice(COMPONENT_FENCE.length).trim()
      if (name) {
        pendingComponents[name] = content.trim()
      }
    } else {
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

    let afterClose = closeIdx + FENCE_CLOSE.length
    if (remaining[afterClose] === '\n') afterClose++
    remaining = remaining.slice(afterClose)
  }

  return segments
}

function parseYamlToSpec(
  yaml: string,
): { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> } | null {
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
