import { create } from "zustand"
import type { Reference, ReferenceCollection, ParsedReference } from "@/types/reference"

function generateId(): string {
  return crypto.randomUUID()
}

function nowISO(): string {
  return new Date().toISOString()
}

interface ReferenceStore {
  references: Reference[]
  collections: ReferenceCollection[]
  loaded: boolean
  loading: boolean

  // CRUD
  load: (projectId: string) => void
  addReference: (ref: Omit<Reference, 'id' | 'dateAdded' | 'dateModified'>) => Reference
  addReferences: (refs: Omit<Reference, 'id' | 'dateAdded' | 'dateModified'>[]) => Reference[]
  updateReference: (id: string, updates: Partial<Reference>) => void
  deleteReference: (id: string) => void

  // Collections
  addCollection: (collection: Omit<ReferenceCollection, 'id'>) => ReferenceCollection
  deleteCollection: (id: string) => void

  // Bulk import from parsed references
  importParsed: (projectId: string, parsed: ParsedReference[]) => Reference[]

  // Query helpers
  getByProject: (projectId: string) => Reference[]
  getByCollection: (collectionName: string) => Reference[]
  getById: (id: string) => Reference | undefined
}

export const useReferenceStore = create<ReferenceStore>((set, get) => ({
  references: [],
  collections: [],
  loaded: false,
  loading: false,

  load: (/* projectId */) => {
    // For now, references are stored in-memory per session.
    // Future: persist via dataClient → /api/data/references
    set({ loaded: true, loading: false })
  },

  addReference: (ref) => {
    const newRef: Reference = {
      ...ref,
      id: generateId(),
      dateAdded: nowISO(),
      dateModified: nowISO(),
    }
    set((s) => ({ references: [...s.references, newRef] }))
    return newRef
  },

  addReferences: (refs) => {
    const now = nowISO()
    const newRefs: Reference[] = refs.map((ref) => ({
      ...ref,
      id: generateId(),
      dateAdded: now,
      dateModified: now,
    }))
    set((s) => ({ references: [...s.references, ...newRefs] }))
    return newRefs
  },

  updateReference: (id, updates) => {
    set((s) => ({
      references: s.references.map((r) =>
        r.id === id ? { ...r, ...updates, dateModified: nowISO() } : r
      ),
    }))
  },

  deleteReference: (id) => {
    set((s) => ({
      references: s.references.filter((r) => r.id !== id),
    }))
  },

  addCollection: (collection) => {
    const newCollection: ReferenceCollection = {
      ...collection,
      id: generateId(),
    }
    set((s) => ({ collections: [...s.collections, newCollection] }))
    return newCollection
  },

  deleteCollection: (id) => {
    set((s) => ({
      collections: s.collections.filter((c) => c.id !== id),
    }))
  },

  importParsed: (projectId, parsed) => {
    const selected = parsed.filter((p) => p.selected)
    const now = nowISO()
    const newRefs: Reference[] = selected.map((p) => ({
      id: generateId(),
      projectId,
      title: p.title,
      authors: p.authors,
      year: p.year,
      doi: p.doi,
      pmid: p.pmid,
      arxivId: p.arxivId,
      isbn: p.isbn,
      url: p.url,
      abstract: p.abstract,
      journal: p.journal,
      volume: p.volume,
      issue: p.issue,
      pages: p.pages,
      publisher: p.publisher,
      publicationType: p.publicationType,
      source: p.bibtex ? 'bibtex' as const : 'manual' as const,
      tags: [],
      collections: [],
      pdfUrl: undefined,
      bibtex: p.bibtex,
      citationKey: p.citationKey,
      dateAdded: now,
      dateModified: now,
    }))
    set((s) => ({ references: [...s.references, ...newRefs] }))
    return newRefs
  },

  getByProject: (projectId) => {
    return get().references.filter((r) => r.projectId === projectId)
  },

  getByCollection: (collectionName) => {
    return get().references.filter((r) => r.collections.includes(collectionName))
  },

  getById: (id) => {
    return get().references.find((r) => r.id === id)
  },
}))
