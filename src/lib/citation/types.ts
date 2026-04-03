/**
 * Citation system types for Astro.
 *
 * References are academic/research papers stored per-project.
 * Citations are inline markers ([@key]) that reference them.
 */

// Re-export the core Reference type (shared with backend)
export type { Reference } from '@astro/core/types'

/** A parsed citation marker found in text */
export interface CitationMarker {
  /** The cite key (without brackets), e.g. "smith2024" */
  key: string
  /** Start index in the original text */
  start: number
  /** End index in the original text (exclusive) */
  end: number
}

/** Supported citation styles */
export type CitationStyle = 'apa' | 'chicago' | 'nature' | 'ieee'

/** Citation style metadata */
export interface CitationStyleInfo {
  id: CitationStyle
  name: string
  description: string
}

/** All available citation styles */
export const CITATION_STYLES: CitationStyleInfo[] = [
  { id: 'apa', name: 'APA 7th Edition', description: 'American Psychological Association' },
  { id: 'chicago', name: 'Chicago', description: 'Chicago Manual of Style (Author-Date)' },
  { id: 'nature', name: 'Nature', description: 'Nature journal style (numbered)' },
  { id: 'ieee', name: 'IEEE', description: 'Institute of Electrical and Electronics Engineers' },
]
