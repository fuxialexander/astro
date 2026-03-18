import type { Spec } from '@json-render/core'
import { isJsonRenderSpec } from '@/lib/json-render'
import { dataToSpec } from '@/lib/json-render/auto-spec'
import { JsonRenderView } from './json-render-view'
import { isPlanTreeData } from '@/components/activity-blocks'

/** Flatten a plan tree (from `astro-cli plan tree --json`) into a PlanNodeList spec */
function planTreeToSpec(roots: ReturnType<typeof isPlanTreeData extends (d: unknown) => d is infer T ? () => T : never>): Spec {
  const flatNodes: Record<string, unknown>[] = []
  const seen = new Set<string>()
  function walk(nodes: Array<{ id: string; title: string; status: string; type: string; children: unknown[] } & Record<string, unknown>>) {
    for (const n of nodes) {
      if (!seen.has(n.id)) {
        seen.add(n.id)
        const { children: _children, ...rest } = n
        flatNodes.push(rest)
      }
      if (Array.isArray(n.children) && n.children.length > 0) {
        walk(n.children as typeof nodes)
      }
    }
  }
  walk(roots as Parameters<typeof walk>[0])
  return {
    root: 'list',
    elements: { list: { type: 'PlanNodeList', props: { nodes: flatNodes }, children: [] } },
  }
}

interface StructuredDataViewProps {
  data: unknown
  maxHeight?: string
  /** Maximum characters before truncating raw text (default: no limit) */
  maxChars?: number
}

/**
 * Smart data renderer that tries to display structured data as rich components.
 *
 * Priority:
 * 1. If data is a json-render Spec → render via JsonRenderView
 * 2. If data is a string → render as-is in <pre>
 * 3. If data is an array of objects → auto-convert to Table spec
 * 4. If data is a flat object → auto-convert to KeyValue spec
 * 5. Fallback → JSON.stringify in <pre>
 */
export function StructuredDataView({ data, maxHeight = '150px', maxChars }: StructuredDataViewProps) {
  // 1. Already a json-render spec
  if (isJsonRenderSpec(data)) {
    return <JsonRenderView spec={data as unknown as Spec} maxHeight={maxHeight} />
  }

  // 1b. Plan tree JSON (astro-cli plan tree --json output) → PlanNodeList spec
  if (isPlanTreeData(data)) {
    const planSpec = planTreeToSpec(data)
    return <JsonRenderView spec={planSpec} maxHeight={maxHeight} />
  }

  // 2. String → try to parse as JSON for rich rendering, else raw text
  if (typeof data === 'string') {
    const trimmed = data.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      let parsed: unknown
      try { parsed = JSON.parse(trimmed) } catch { /* not valid JSON */ }
      if (parsed !== undefined) {
        if (isPlanTreeData(parsed)) {
          return <JsonRenderView spec={planTreeToSpec(parsed)} maxHeight={maxHeight} />
        }
        if (isJsonRenderSpec(parsed)) {
          return <JsonRenderView spec={parsed as unknown as Spec} maxHeight={maxHeight} />
        }
      }
    }
    const text = maxChars ? data.slice(0, maxChars) : data
    return (
      <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80 overflow-auto" style={{ maxHeight }}>
        {text}
      </pre>
    )
  }

  // 3/4. Try auto-converting to a spec
  const autoSpec = dataToSpec(data)
  if (autoSpec) {
    return <JsonRenderView spec={autoSpec} maxHeight={maxHeight} />
  }

  // 5. Fallback: JSON.stringify
  let text = JSON.stringify(data, null, 2)
  if (maxChars) text = text.slice(0, maxChars)
  return (
    <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80 overflow-auto" style={{ maxHeight }}>
      {text}
    </pre>
  )
}
