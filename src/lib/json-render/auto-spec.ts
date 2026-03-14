import type { Spec } from '@json-render/core'

/**
 * Auto-convert structured data into a json-render Spec for rich rendering.
 * Returns null if the data shape is not suitable for structured display.
 */
export function dataToSpec(data: unknown): Spec | null {
  if (data == null || typeof data !== 'object') return null

  // Array of objects → Table
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    return arrayToTableSpec(data as Record<string, unknown>[])
  }

  // Flat object with ≤30 keys → KeyValue
  if (!Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length > 0 && keys.length <= 30 && keys.every(k => isPrimitive(obj[k]))) {
      return objectToKeyValueSpec(obj)
    }
  }

  return null
}

function isPrimitive(v: unknown): boolean {
  return v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

function arrayToTableSpec(data: Record<string, unknown>[]): Spec | null {
  // Collect all unique keys as headers
  const headerSet = new Set<string>()
  for (const item of data) {
    for (const key of Object.keys(item)) {
      headerSet.add(key)
    }
  }
  const headers = Array.from(headerSet)
  if (headers.length === 0 || headers.length > 20) return null

  // Cap at 50 rows
  const rows = data.slice(0, 50).map(item =>
    headers.map(h => stringify(item[h]))
  )

  return {
    root: 'table-1',
    elements: {
      'table-1': {
        type: 'Table',
        props: { headers, rows },
        children: [],
      },
    },
  }
}

function objectToKeyValueSpec(obj: Record<string, unknown>): Spec {
  const pairs = Object.entries(obj).map(([key, value]) => ({
    key,
    value: stringify(value),
  }))

  return {
    root: 'kv-1',
    elements: {
      'kv-1': {
        type: 'KeyValue',
        props: { pairs },
        children: [],
      },
    },
  }
}
