/**
 * Reference store — manages bibliographic references per project.
 *
 * References are stored in the project's `references` JSONB field.
 * This store provides CRUD + search for inline citation workflows.
 */

import { create } from 'zustand'
import { useProjectStore } from '@/stores/project-store'
import type { Reference, CitationStyle } from '@/lib/citation/types'

interface ReferenceState {
  /** References indexed by project ID */
  referencesByProject: Map<string, Reference[]>
  /** Loading state per project */
  loading: Map<string, boolean>
  /** Currently selected citation style (persisted in localStorage) */
  citationStyle: CitationStyle

  // Actions
  /** Load references for a project from the project store */
  loadReferences: (projectId: string) => void
  /** Search references by query (title, author, year) */
  searchReferences: (projectId: string, query: string) => Reference[]
  /** Get all references for a project */
  getReferences: (projectId: string) => Reference[]
  /** Get a single reference by cite key */
  getReference: (projectId: string, citeKey: string) => Reference | undefined
  /** Add a reference to a project */
  addReference: (projectId: string, ref: Reference) => Promise<void>
  /** Update a reference */
  updateReference: (projectId: string, ref: Reference) => Promise<void>
  /** Remove a reference by cite key */
  removeReference: (projectId: string, citeKey: string) => Promise<void>
  /** Import references from BibTeX string */
  importBibTeX: (projectId: string, bibtex: string) => Promise<number>
  /** Set the citation style */
  setCitationStyle: (style: CitationStyle) => void
}

/** Generate a cite key from author + year: "Smith2024", "SmithJones2023" */
function generateCiteKey(ref: Omit<Reference, 'id'>): string {
  const firstAuthor = ref.authors[0]?.split(',')[0]?.split(' ').pop() || 'unknown'
  const base = `${firstAuthor.toLowerCase()}${ref.year}`
  return base.replace(/[^a-z0-9-]/gi, '')
}

/** Simple BibTeX parser — handles common entry types */
function parseBibTeX(bibtex: string): Omit<Reference, 'id'>[] {
  const results: Omit<Reference, 'id'>[] = []
  // Match @type{key, ... }
  const entryRegex = /@(\w+)\s*\{([^,]*),([^@]*)\}/g
  let match: RegExpExecArray | null

  while ((match = entryRegex.exec(bibtex)) !== null) {
    const entryType = match[1].toLowerCase()
    if (entryType === 'string' || entryType === 'comment' || entryType === 'preamble') continue

    const fieldsStr = match[3]
    const fields: Record<string, string> = {}

    // Parse field = {value} or field = "value"
    const fieldRegex = /(\w+)\s*=\s*[{"]([^}"]*)[}"]/g
    let fieldMatch: RegExpExecArray | null
    while ((fieldMatch = fieldRegex.exec(fieldsStr)) !== null) {
      fields[fieldMatch[1].toLowerCase()] = fieldMatch[2].trim()
    }

    const authors = (fields.author || 'Unknown')
      .split(/\s+and\s+/)
      .map(a => a.trim())
      .filter(Boolean)

    results.push({
      title: fields.title || 'Untitled',
      authors,
      year: parseInt(fields.year || '0', 10),
      venue: fields.journal || fields.booktitle || fields.publisher,
      doi: fields.doi,
      url: fields.url,
      abstract: fields.abstract,
      entryType,
      volume: fields.volume,
      issue: fields.number,
      pages: fields.pages,
      publisher: fields.publisher,
    })
  }

  return results
}

/** Persist references back to the project store (via JSONB field) */
async function persistReferences(projectId: string, refs: Reference[]) {
  try {
    // Use the project store's update method to persist via dataClient
    const { updateProject } = useProjectStore.getState()
    await updateProject(projectId, { references: refs })
  } catch (err) {
    console.error('[reference-store] Failed to persist references:', err)
    throw err
  }
}

export const useReferenceStore = create<ReferenceState>((set, get) => ({
  referencesByProject: new Map(),
  loading: new Map(),
  citationStyle: (typeof localStorage !== 'undefined'
    ? (localStorage.getItem('astro:citation-style') as CitationStyle) || 'apa'
    : 'apa') as CitationStyle,

  loadReferences: (projectId) => {
    const projects = useProjectStore.getState().projects
    const project = projects.find(p => p.id === projectId)
    if (!project) return

    set(state => {
      const loading = new Map(state.loading)
      loading.set(projectId, true)
      return { loading }
    })

    // References are stored in the project's JSONB `references` field
    const refs = Array.isArray(project.references) ? project.references : []

    set(state => {
      const referencesByProject = new Map(state.referencesByProject)
      const loading = new Map(state.loading)
      referencesByProject.set(projectId, refs)
      loading.set(projectId, false)
      return { referencesByProject, loading }
    })
  },

  searchReferences: (projectId, query) => {
    const refs = get().referencesByProject.get(projectId) || []
    if (!query.trim()) return refs.slice(0, 20)

    const q = query.toLowerCase()
    return refs.filter(ref =>
      ref.title.toLowerCase().includes(q) ||
      ref.authors?.some(a => a.toLowerCase().includes(q)) ||
      String(ref.year).includes(q) ||
      ref.id.toLowerCase().includes(q) ||
      (ref.venue?.toLowerCase().includes(q)) ||
      (ref.tags?.some(t => t.toLowerCase().includes(q)))
    ).slice(0, 20)
  },

  getReferences: (projectId) => {
    return get().referencesByProject.get(projectId) || []
  },

  getReference: (projectId, citeKey) => {
    const refs = get().referencesByProject.get(projectId) || []
    return refs.find(r => r.id === citeKey)
  },

  addReference: async (projectId, ref) => {
    const refs = [...(get().referencesByProject.get(projectId) || [])]
    // Prevent duplicates
    if (refs.some(r => r.id === ref.id)) {
      throw new Error(`Reference with key "${ref.id}" already exists`)
    }
    refs.push(ref)

    set(state => {
      const referencesByProject = new Map(state.referencesByProject)
      referencesByProject.set(projectId, refs)
      return { referencesByProject }
    })

    await persistReferences(projectId, refs)
  },

  updateReference: async (projectId, ref) => {
    const refs = (get().referencesByProject.get(projectId) || []).map(r =>
      r.id === ref.id ? ref : r
    )

    set(state => {
      const referencesByProject = new Map(state.referencesByProject)
      referencesByProject.set(projectId, refs)
      return { referencesByProject }
    })

    await persistReferences(projectId, refs)
  },

  removeReference: async (projectId, citeKey) => {
    const refs = (get().referencesByProject.get(projectId) || []).filter(r => r.id !== citeKey)

    set(state => {
      const referencesByProject = new Map(state.referencesByProject)
      referencesByProject.set(projectId, refs)
      return { referencesByProject }
    })

    await persistReferences(projectId, refs)
  },

  importBibTeX: async (projectId, bibtex) => {
    const parsed = parseBibTeX(bibtex)
    const existing = get().referencesByProject.get(projectId) || []
    const existingKeys = new Set(existing.map(r => r.id))

    let count = 0
    const newRefs = [...existing]

    for (const entry of parsed) {
      const key = generateCiteKey(entry)
      // Deduplicate keys
      let suffix = 0
      let uniqueKey = key
      while (existingKeys.has(uniqueKey)) {
        suffix++
        uniqueKey = `${key}${String.fromCharCode(96 + suffix)}` // a, b, c...
      }
      existingKeys.add(uniqueKey)
      newRefs.push({ ...entry, id: uniqueKey })
      count++
    }

    set(state => {
      const referencesByProject = new Map(state.referencesByProject)
      referencesByProject.set(projectId, newRefs)
      return { referencesByProject }
    })

    await persistReferences(projectId, newRefs)
    return count
  },

  setCitationStyle: (style) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('astro:citation-style', style)
    }
    set({ citationStyle: style })
  },
}))
