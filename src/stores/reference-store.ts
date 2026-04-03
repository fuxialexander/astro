/**
 * Reference Store
 *
 * Zustand store for academic/literature references using CSL-JSON as the
 * canonical data model. Supports CRUD for both references and collections,
 * with optimistic updates and server sync.
 */

import { create } from 'zustand'
import { dataClient } from '@/lib/data-client'
import { useToastStore } from '@/stores/toast-store'
import { useTeamStore } from '@/stores/team-store'

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * CSL-JSON author/contributor entry.
 * See https://docs.citationstyles.org/en/stable/specification.html
 */
export interface CslName {
  family?: string
  given?: string
  literal?: string
  'non-dropping-particle'?: string
  'dropping-particle'?: string
  suffix?: string
}

/**
 * Minimal CSL-JSON shape. The full cslJson blob can contain any valid CSL fields.
 */
export interface CslJson {
  type: string
  title?: string
  author?: CslName[]
  editor?: CslName[]
  issued?: { 'date-parts'?: number[][] }
  DOI?: string
  PMID?: string
  URL?: string
  publisher?: string
  'container-title'?: string
  volume?: string
  issue?: string
  page?: string
  abstract?: string
  [key: string]: unknown
}

/** A reference row as returned by the API (slim mode — no cslJson). */
export interface ReferenceRow {
  id: string
  teamId: string
  projectId: string | null
  cslType: string
  title: string
  doi: string | null
  pmid: string | null
  arxivId: string | null
  pdfPath: string | null
  pdfUrl: string | null
  source: string
  zoteroKey: string | null
  createdAt: Date
  updatedAt: Date
  /** Only present in full (detail) mode */
  cslJson?: CslJson
}

/** A reference collection. */
export interface ReferenceCollection {
  id: string
  teamId: string
  name: string
  parentId: string | null
  createdAt: Date
  updatedAt: Date
}

/** Input for creating a new reference. */
export interface CreateReferenceInput {
  cslJson: CslJson
  cslType: string
  title: string
  doi?: string
  pmid?: string
  arxivId?: string
  pdfPath?: string
  pdfUrl?: string
  source?: string
  zoteroKey?: string
  projectId?: string
  teamId?: string
}

/** Input for creating a collection. */
export interface CreateCollectionInput {
  name: string
  parentId?: string
  teamId?: string
}

// ── Store interface ────────────────────────────────────────────────────────────

interface ReferenceStore {
  /** References keyed by id */
  references: Map<string, ReferenceRow>
  /** Collections list */
  collections: ReferenceCollection[]

  loaded: boolean
  loading: boolean
  collectionsLoaded: boolean
  error: string | null

  // Lifecycle
  load: (projectId?: string) => Promise<void>
  loadCollections: () => Promise<void>

  // Reference CRUD
  addReference: (input: CreateReferenceInput) => void
  updateReference: (id: string, updates: Partial<CreateReferenceInput>) => void
  removeReference: (id: string) => void

  // Collection CRUD
  addCollection: (input: CreateCollectionInput) => void
  updateCollection: (id: string, updates: Partial<CreateCollectionInput>) => void
  removeCollection: (id: string) => void

  // Collection membership
  addToCollection: (collectionId: string, referenceId: string) => Promise<void>
  removeFromCollection: (collectionId: string, referenceId: string) => Promise<void>

  // Search
  searchReferences: (query: string) => Promise<ReferenceRow[]>
  findByDoi: (doi: string) => ReferenceRow | undefined
  findByArxivId: (arxivId: string) => ReferenceRow | undefined
}

// ── Helper: returns true if the id is a temp placeholder ──────────────────────

function isTempId(id: string): boolean {
  return id.startsWith('temp-')
}

// ── Store implementation ───────────────────────────────────────────────────────

export const useReferenceStore = create<ReferenceStore>((set, get) => ({
  references: new Map(),
  collections: [],
  loaded: false,
  loading: false,
  collectionsLoaded: false,
  error: null,

  // ── Load references ──────────────────────────────────────────────────────────

  load: async (projectId?: string) => {
    set({ loading: true, error: null })
    try {
      const rows = await dataClient.listReferences(projectId)
      const references = new Map<string, ReferenceRow>()
      for (const row of rows) {
        references.set(row.id, row)
      }
      set({ references, loaded: true, loading: false })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load references'
      set({ loaded: true, loading: false, error: errorMsg })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to load references',
        description: errorMsg,
      })
    }
  },

  // ── Load collections ─────────────────────────────────────────────────────────

  loadCollections: async () => {
    try {
      const collections = await dataClient.listReferenceCollections()
      set({ collections, collectionsLoaded: true })
    } catch (err) {
      console.error('[reference-store] Failed to load collections:', err)
      set({ collectionsLoaded: true })
    }
  },

  // ── Add reference (optimistic) ───────────────────────────────────────────────

  addReference: (input) => {
    const tempId = `temp-${crypto.randomUUID()}`
    const now = new Date()
    const tempRow: ReferenceRow = {
      id: tempId,
      teamId: useTeamStore.getState().getDefaultTeamId() ?? '',
      projectId: input.projectId ?? null,
      cslType: input.cslType,
      title: input.title,
      doi: input.doi ?? null,
      pmid: input.pmid ?? null,
      arxivId: input.arxivId ?? null,
      pdfPath: input.pdfPath ?? null,
      pdfUrl: input.pdfUrl ?? null,
      source: input.source ?? 'manual',
      zoteroKey: input.zoteroKey ?? null,
      createdAt: now,
      updatedAt: now,
      cslJson: input.cslJson,
    }

    // Optimistic insert
    const refs = new Map(get().references)
    refs.set(tempId, tempRow)
    set({ references: refs })

    const teamId = useTeamStore.getState().getDefaultTeamId()
    dataClient.createReference({ ...input, teamId }).then((created) => {
      const current = new Map(get().references)
      current.delete(tempId)
      // Clean up any other orphaned temp entries
      for (const key of [...current.keys()]) {
        if (key.startsWith('temp-')) current.delete(key)
      }
      current.set(created.id, created)
      set({ references: current })
    }).catch((err) => {
      console.error('[reference-store] Failed to sync addReference:', err)
      const current = new Map(get().references)
      current.delete(tempId)
      set({ references: current, error: err instanceof Error ? err.message : 'Failed to save reference' })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save reference',
        description: 'The reference may be lost on refresh.',
      })
    })
  },

  // ── Update reference (optimistic) ────────────────────────────────────────────

  updateReference: (id, updates) => {
    if (isTempId(id)) return
    const refs = new Map(get().references)
    const existing = refs.get(id)
    if (!existing) return

    const originalRef = { ...existing }
    const updated: ReferenceRow = { ...existing, ...updates, updatedAt: new Date() }
    refs.set(id, updated)
    set({ references: refs })

    dataClient.updateReference(id, updates).then((serverRow) => {
      const current = new Map(get().references)
      current.set(serverRow.id, serverRow)
      set({ references: current })
    }).catch((err) => {
      console.error('[reference-store] Failed to sync updateReference:', err)
      const current = new Map(get().references)
      current.set(id, originalRef)
      set({ references: current, error: err instanceof Error ? err.message : 'Failed to update reference' })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to update reference',
        description: 'Changes have been reverted.',
      })
    })
  },

  // ── Remove reference (optimistic) ────────────────────────────────────────────

  removeReference: (id) => {
    if (isTempId(id)) return
    const refs = new Map(get().references)
    const existing = refs.get(id)
    if (!existing) return

    refs.delete(id)
    set({ references: refs })

    dataClient.deleteReference(id).catch((err) => {
      console.error('[reference-store] Failed to sync removeReference:', err)
      const current = new Map(get().references)
      current.set(id, existing)
      set({ references: current, error: err instanceof Error ? err.message : 'Failed to remove reference' })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to remove reference',
        description: 'The reference has been restored.',
      })
    })
  },

  // ── Add collection (optimistic) ──────────────────────────────────────────────

  addCollection: (input) => {
    const tempId = `temp-${crypto.randomUUID()}`
    const now = new Date()
    const tempCollection: ReferenceCollection = {
      id: tempId,
      teamId: useTeamStore.getState().getDefaultTeamId() ?? '',
      name: input.name,
      parentId: input.parentId ?? null,
      createdAt: now,
      updatedAt: now,
    }

    const collections = [...get().collections, tempCollection]
    set({ collections })

    const teamId = useTeamStore.getState().getDefaultTeamId()
    dataClient.createReferenceCollection({ ...input, teamId }).then((created) => {
      const current = get().collections.filter((c) => c.id !== tempId)
      set({ collections: [...current, created] })
    }).catch((err) => {
      console.error('[reference-store] Failed to sync addCollection:', err)
      set({ collections: get().collections.filter((c) => c.id !== tempId) })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to create collection',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    })
  },

  // ── Update collection (optimistic) ───────────────────────────────────────────

  updateCollection: (id, updates) => {
    if (isTempId(id)) return
    const existing = get().collections.find((c) => c.id === id)
    if (!existing) return

    const updated = { ...existing, ...updates, updatedAt: new Date() }
    set({ collections: get().collections.map((c) => c.id === id ? updated : c) })

    dataClient.updateReferenceCollection(id, updates).then((serverRow) => {
      set({ collections: get().collections.map((c) => c.id === id ? serverRow : c) })
    }).catch((err) => {
      console.error('[reference-store] Failed to sync updateCollection:', err)
      set({ collections: get().collections.map((c) => c.id === id ? existing : c) })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to update collection',
        description: 'Changes have been reverted.',
      })
    })
  },

  // ── Remove collection (optimistic) ───────────────────────────────────────────

  removeCollection: (id) => {
    if (isTempId(id)) return
    const existing = get().collections.find((c) => c.id === id)
    if (!existing) return

    set({ collections: get().collections.filter((c) => c.id !== id) })

    dataClient.deleteReferenceCollection(id).catch((err) => {
      console.error('[reference-store] Failed to sync removeCollection:', err)
      set({ collections: [...get().collections, existing] })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to remove collection',
        description: 'The collection has been restored.',
      })
    })
  },

  // ── Collection membership ────────────────────────────────────────────────────

  addToCollection: async (collectionId, referenceId) => {
    try {
      await dataClient.addReferenceToCollection(collectionId, referenceId)
    } catch (err) {
      console.error('[reference-store] Failed to add to collection:', err)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to add to collection',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
      throw err
    }
  },

  removeFromCollection: async (collectionId, referenceId) => {
    try {
      await dataClient.removeReferenceFromCollection(collectionId, referenceId)
    } catch (err) {
      console.error('[reference-store] Failed to remove from collection:', err)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to remove from collection',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
      throw err
    }
  },

  // ── Search ───────────────────────────────────────────────────────────────────

  searchReferences: async (query) => {
    if (!query || query.trim().length === 0) {
      return [...get().references.values()]
    }
    try {
      return await dataClient.searchReferences(query)
    } catch (err) {
      console.error('[reference-store] Failed to search references:', err)
      // Fall back to local search on error
      const q = query.toLowerCase()
      return [...get().references.values()].filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.doi?.toLowerCase().includes(q) ?? false) ||
          (r.arxivId?.toLowerCase().includes(q) ?? false) ||
          (r.pmid?.toLowerCase().includes(q) ?? false)
      )
    }
  },

  findByDoi: (doi) => {
    for (const ref of get().references.values()) {
      if (ref.doi === doi) return ref
    }
    return undefined
  },

  findByArxivId: (arxivId) => {
    for (const ref of get().references.values()) {
      if (ref.arxivId === arxivId) return ref
    }
    return undefined
  },
}))
