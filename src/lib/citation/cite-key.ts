import type { Reference } from './types'

/** Derive a readable cite key from a reference: "smith2024", "smithjones2023" */
export function getCiteKey(ref: Reference): string {
  const firstAuthor = ref.authors[0]?.split(',')[0]?.split(' ').pop() || 'unknown'
  const base = `${firstAuthor.toLowerCase()}${ref.year}`
  return base.replace(/[^a-z0-9-]/gi, '')
}

/** Build a map from cite key → Reference for fast lookup */
export function buildCiteKeyMap(refs: Reference[]): Map<string, Reference> {
  const map = new Map<string, Reference>()
  for (const ref of refs) {
    // Primary: UUID id
    map.set(ref.id, ref)
    // Secondary: readable cite key
    map.set(getCiteKey(ref), ref)
  }
  return map
}
