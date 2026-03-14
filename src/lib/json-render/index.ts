import type { Spec } from '@json-render/core'

export { astroCatalog, type AstroCatalog } from './catalog'
export { registry } from './registry'

/**
 * Check if an unknown value has the shape of a json-render Spec.
 * Requires a non-empty string `root` and a plain object `elements` (not an array).
 */
export function isJsonRenderSpec(data: unknown): data is Spec {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return false
  const d = data as Record<string, unknown>
  return (
    typeof d.root === 'string' &&
    d.root.length > 0 &&
    d.elements != null &&
    typeof d.elements === 'object' &&
    !Array.isArray(d.elements)
  )
}
