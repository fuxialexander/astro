/**
 * Reference / citation types for the reference management system.
 */

export type ReferenceType =
  | 'article'
  | 'book'
  | 'chapter'
  | 'conference'
  | 'preprint'
  | 'thesis'
  | 'report'
  | 'webpage'
  | 'dataset'
  | 'software'
  | 'other'

export type ReferenceSource =
  | 'manual'
  | 'doi'
  | 'pmid'
  | 'arxiv'
  | 'url'
  | 'bibtex'
  | 'ris'
  | 'zotero'

export interface Reference {
  id: string
  projectId: string
  title: string
  authors: string[]
  year?: number
  doi?: string
  pmid?: string
  arxivId?: string
  isbn?: string
  url?: string
  abstract?: string
  journal?: string
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  publicationType: ReferenceType
  source: ReferenceSource
  tags: string[]
  collections: string[]
  notes?: string
  pdfUrl?: string
  bibtex?: string
  citationKey?: string
  dateAdded: string // ISO date
  dateModified: string // ISO date
}

export interface ReferenceCollection {
  id: string
  name: string
  color?: string
  projectId: string
}

/** Parsed reference from BibTeX/RIS import before saving */
export interface ParsedReference {
  title: string
  authors: string[]
  year?: number
  doi?: string
  pmid?: string
  arxivId?: string
  isbn?: string
  url?: string
  abstract?: string
  journal?: string
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  publicationType: ReferenceType
  bibtex?: string
  citationKey?: string
  selected: boolean
}

/** Metadata returned from a DOI/PMID/arXiv lookup */
export interface LookupResult {
  found: boolean
  reference?: Omit<Reference, 'id' | 'projectId' | 'tags' | 'collections' | 'dateAdded' | 'dateModified'>
  error?: string
}
