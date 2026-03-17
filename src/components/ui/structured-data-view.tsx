import type { Spec } from '@json-render/core'
import { isJsonRenderSpec } from '@/lib/json-render'
import { dataToSpec } from '@/lib/json-render/auto-spec'
import { JsonRenderView } from './json-render-view'

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

  // 2. String → raw text
  if (typeof data === 'string') {
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
