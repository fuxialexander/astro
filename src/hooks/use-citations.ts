/**
 * Hook for citation-aware text rendering.
 *
 * Provides utilities for rendering inline citations and references
 * sections in markdown content.
 */

import { useMemo, useCallback } from 'react'
import { useReferenceStore } from '@/stores/reference-store'
import { extractCiteKeys, hasCitations } from '@/lib/citation/parser'
import { renderInlineCitations } from '@/lib/citation/formatter'
import type { Reference } from '@/lib/citation/types'

/**
 * Hook to get citation-related utilities for a project.
 *
 * Returns:
 * - `references`: all references for the project
 * - `citationStyle`: the user's selected citation style
 * - `getCitedRefs(text)`: extract cited references from text
 * - `formatText(text)`: replace [@key] markers with formatted inline citations
 * - `hasCitations(text)`: check if text contains citation markers
 */
export function useCitations(projectId: string) {
  const references = useReferenceStore((s) => s.referencesByProject.get(projectId) || [])
  const citationStyle = useReferenceStore((s) => s.citationStyle)

  const refMap = useMemo(
    () => new Map(references.map(r => [r.id, r])),
    [references]
  )

  const getCitedRefs = useCallback((text: string): Reference[] => {
    const keys = extractCiteKeys(text)
    return keys
      .map(key => refMap.get(key))
      .filter((r): r is Reference => r !== undefined)
  }, [refMap])

  const formatText = useCallback((text: string): string => {
    if (references.length === 0) return text
    return renderInlineCitations(text, references, citationStyle)
  }, [references, citationStyle])

  return {
    references,
    citationStyle,
    refMap,
    getCitedRefs,
    formatText,
    hasCitations: (text: string) => hasCitations(text),
  }
}
