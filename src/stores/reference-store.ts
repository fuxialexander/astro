/**
 * Reference store — manages the global team-level reference library.
 *
 * References are stored in the `team_references` table (not per-project).
 * Per-project "ownership" is derived dynamically by scanning citation
 * markers ([@key]) in project content and plan node descriptions.
 */

import { create } from 'zustand'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import { extractCiteKeys } from '@/lib/citation/parser'
import { getCiteKey } from '@/lib/citation/cite-key'
import type { Reference, CitationStyle } from '@/lib/citation/types'
import type { PlanNode, Project } from '@/types'

// ── Internal fetch helpers ────────────────────────────────────────────

function getActiveTeamId(): string | null {
  return localStorage.getItem('activeTeamId')
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = teamId
  return headers
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders()
  const res = await fetch(apiUrl(url), { ...init, headers: { ...headers, ...init?.headers } })
  if (!res.ok) {
    try {
      const body = await res.json() as { error?: string }
      if (body?.error) throw new Error(body.error)
    } catch (e) {
      if (e instanceof Error && e.message !== `${res.status} ${res.statusText}`) throw e
    }
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

const MAX_IMPORT_BATCH_SIZE = 500
const MAX_IMPORT_PAYLOAD_BYTES = 4_500_000

function mergeImportedReferences(library: Reference[], references: Reference[]): Reference[] {
  const updatedMap = new Map(references.map(r => [r.id, r]))
  const merged = library.map(r => updatedMap.get(r.id) ?? r)
  const existingIds = new Set(library.map(r => r.id))
  const newRefs = references.filter(r => !existingIds.has(r.id))
  return [...merged, ...newRefs]
}

async function importReferenceBatches(references: Reference[]): Promise<{ imported: number; updated: number; references: Reference[] }> {
  let imported = 0
  let updated = 0
  const mergedById = new Map<string, Reference>()

  let index = 0
  while (index < references.length) {
    const batch: Reference[] = []
    while (index < references.length && batch.length < MAX_IMPORT_BATCH_SIZE) {
      const next = references[index]
      const nextBatch = [...batch, next]
      const payload = JSON.stringify({ references: nextBatch, mode: 'upsert' })
      if (batch.length > 0 && payload.length > MAX_IMPORT_PAYLOAD_BYTES) break
      batch.push(next)
      index++
      if (payload.length > MAX_IMPORT_PAYLOAD_BYTES) break
    }

    const data = await fetchJson<{ references: Reference[]; imported: number; updated: number }>(
      '/api/references/import',
      { method: 'POST', body: JSON.stringify({ references: batch, mode: 'upsert' }) },
    )

    imported += data.imported
    updated += data.updated
    for (const ref of data.references) mergedById.set(ref.id, ref)
  }

  return { imported, updated, references: Array.from(mergedById.values()) }
}

// ── BibTeX / NBIB parsers ─────────────────────────────────────────────

/** Generate a cite key from author + year: "smith2024" */
function generateCiteKey(ref: Omit<Reference, 'id'>): string {
  const firstAuthor = ref.authors[0]?.split(',')[0]?.split(' ').pop() || 'unknown'
  const base = `${firstAuthor.toLowerCase()}${ref.year}`
  return base.replace(/[^a-z0-9-]/gi, '')
}

/** Strip LaTeX commands from a string (e.g. {\'o} → o, {\v Z} → Z) */
function stripLatex(s: string): string {
  return s
    .replace(/\{\\[^}]*\}/g, m => {
      // Extract the last alphabetical character in the command as best-effort
      const ch = m.match(/[a-zA-Z](?=[^a-zA-Z]*\})$/)
      return ch ? ch[0] : ''
    })
    .replace(/\{([^{}]*)\}/g, '$1') // remove remaining brace groups
    .trim()
}

/** Extract a brace-balanced value from str starting at index i (i points at '{') */
function extractBraceValue(str: string, i: number): { value: string; end: number } {
  let depth = 0
  let start = -1
  let j = i
  while (j < str.length) {
    if (str[j] === '{') { if (depth === 0) start = j + 1; depth++ }
    else if (str[j] === '}') { depth--; if (depth === 0) return { value: str.slice(start, j), end: j + 1 } }
    j++
  }
  return { value: str.slice(start === -1 ? i : start), end: str.length }
}

/** Parse BibTeX field string into key→value map, handling nested braces and bare values */
function parseBibFields(fieldsStr: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let i = 0
  while (i < fieldsStr.length) {
    // Skip whitespace and commas
    while (i < fieldsStr.length && /[\s,]/.test(fieldsStr[i])) i++
    if (i >= fieldsStr.length) break
    // Field name
    const nameMatch = fieldsStr.slice(i).match(/^(\w+)\s*=\s*/)
    if (!nameMatch) break
    const fieldName = nameMatch[1].toLowerCase()
    i += nameMatch[0].length
    if (i >= fieldsStr.length) break
    // Field value
    let value = ''
    if (fieldsStr[i] === '{') {
      const result = extractBraceValue(fieldsStr, i)
      value = result.value
      i = result.end
    } else if (fieldsStr[i] === '"') {
      const end = fieldsStr.indexOf('"', i + 1)
      value = end === -1 ? fieldsStr.slice(i + 1) : fieldsStr.slice(i + 1, end)
      i = end === -1 ? fieldsStr.length : end + 1
    } else {
      // Bare value (number or macro like `jan`)
      const bare = fieldsStr.slice(i).match(/^([^\s,}]+)/)
      if (bare) { value = bare[1]; i += bare[0].length }
    }
    fields[fieldName] = value.trim()
  }
  return fields
}

type ParsedRef = Omit<Reference, 'id'> & { citeKey: string }

/** Parse BibTeX into Reference objects, preserving Better BibTeX cite keys */
function parseBibTeX(bibtex: string): ParsedRef[] {
  const results: ParsedRef[] = []
  let i = 0
  while (i < bibtex.length) {
    const atIdx = bibtex.indexOf('@', i)
    if (atIdx === -1) break
    const typeMatch = bibtex.slice(atIdx).match(/^@(\w+)\s*\{/)
    if (!typeMatch) { i = atIdx + 1; continue }
    const entryType = typeMatch[1].toLowerCase()
    const openBrace = atIdx + typeMatch[0].length - 1
    // Find matching close brace
    let depth = 1, j = openBrace + 1
    while (j < bibtex.length && depth > 0) {
      if (bibtex[j] === '{') depth++
      else if (bibtex[j] === '}') depth--
      j++
    }
    const entryContent = bibtex.slice(openBrace + 1, j - 1)
    i = j
    if (entryType === 'string' || entryType === 'comment' || entryType === 'preamble') continue
    const commaIdx = entryContent.indexOf(',')
    if (commaIdx === -1) continue
    const citeKey = entryContent.slice(0, commaIdx).trim()
    if (!citeKey) continue
    const fields = parseBibFields(entryContent.slice(commaIdx + 1))
    const authors = (fields.author || 'Unknown')
      .split(/\s+and\s+/)
      .map(a => stripLatex(a).trim())
      .filter(Boolean)
    results.push({
      citeKey,
      title: stripLatex(fields.title || 'Untitled'),
      authors,
      year: parseInt(fields.year || '0', 10),
      venue: fields.journal || fields.booktitle || fields.publisher,
      doi: fields.doi,
      url: fields.url,
      abstract: fields.abstract ? stripLatex(fields.abstract) : undefined,
      entryType,
      volume: fields.volume,
      issue: fields.number,
      pages: fields.pages,
      publisher: fields.publisher,
      source: 'bibtex',
    })
  }
  return results
}

/** Parse NBIB/MEDLINE format */
function parseNBIB(text: string): Omit<Reference, 'id'>[] {
  const results: Omit<Reference, 'id'>[] = []
  const records = text.split(/^ER\s*-/m).filter(r => r.trim())

  for (const record of records) {
    const fields: Record<string, string[]> = {}
    for (const line of record.split('\n')) {
      const m = line.match(/^([A-Z]{2,4})\s*-\s*(.+)/)
      if (!m) continue
      const tag = m[1].trim()
      if (!fields[tag]) fields[tag] = []
      fields[tag].push(m[2].trim())
    }

    const title = fields['TI']?.[0] || fields['BTI']?.[0]
    if (!title) continue

    const authors = (fields['AU'] || fields['FAU'] || []).filter(Boolean)
    const dpRaw = fields['DP']?.[0] || fields['PDAT']?.[0] || ''
    const yearMatch = dpRaw.match(/(\d{4})/)
    const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear()
    const doiLine = [...(fields['LID'] || []), ...(fields['AID'] || [])].find(l => l.toLowerCase().includes('doi'))
    const doi = doiLine ? doiLine.replace(/\s*\[doi\]/i, '').trim() : undefined
    const pmid = fields['PMID']?.[0]

    results.push({
      title,
      authors: authors.length > 0 ? authors : ['Unknown'],
      year,
      venue: fields['JT']?.[0] || fields['TA']?.[0],
      volume: fields['VI']?.[0],
      issue: fields['IP']?.[0],
      pages: fields['PG']?.[0],
      doi,
      pmid,
      abstract: fields['AB']?.join(' ').trim() || undefined,
      url: doi ? `https://doi.org/${doi}` : pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined,
      source: 'bibtex',
      entryType: 'article',
    })
  }

  return results
}

// ── Store interface ───────────────────────────────────────────────────

interface ReferenceState {
  /** Accepted references in the active team's library */
  library: Reference[]
  /** Pending references awaiting human review */
  inbox: Reference[]
  /** Whether the library has been loaded */
  loaded: boolean
  /** Whether the inbox has been loaded */
  inboxLoaded: boolean
  /** Loading in progress */
  loading: boolean
  /** Currently selected citation style (persisted in localStorage) */
  citationStyle: CitationStyle

  // Actions
  /** Load the accepted library from the server */
  loadLibrary: () => Promise<void>
  /** Load pending inbox references from the server */
  loadInbox: () => Promise<void>
  /** Get all references (global library) — projectId ignored, kept for call-site compat */
  getReferences: (projectId?: string) => Reference[]
  /** Search the global library */
  searchReferences: (query: string) => Reference[]
  /** Get a single reference by cite key or id */
  getReference: (citeKey: string) => Reference | undefined
  /** Add a reference to the global library */
  addReference: (ref: Reference) => Promise<void>
  /** Update a reference */
  updateReference: (ref: Reference) => Promise<void>
  /** Remove a reference by id */
  removeReference: (id: string) => Promise<void>
  /** Accept a pending inbox reference into the library */
  acceptReference: (id: string) => Promise<void>
  /** Accept all pending inbox references */
  acceptAllInbox: () => Promise<void>
  /** Import references from BibTeX string */
  importBibTeX: (bibtex: string) => Promise<number>
  /** Import references from NBIB string */
  importNBIB: (nbib: string) => Promise<number>
  /** Import a list of pre-parsed references */
  importReferences: (refs: Omit<Reference, 'id'>[]) => Promise<number>
  /** Get cite keys used in a project's content (plan nodes + project description) */
  getCitedKeysForProject: (projectId: string, nodes: PlanNode[], project: Project) => Set<string>
  /** Get references cited in a project */
  getReferencesForProject: (projectId: string, nodes: PlanNode[], project: Project) => Reference[]
  /** Set the citation style */
  setCitationStyle: (style: CitationStyle) => void
}

export const useReferenceStore = create<ReferenceState>((set, get) => ({
  library: [],
  inbox: [],
  loaded: false,
  inboxLoaded: false,
  loading: false,
  citationStyle: (typeof localStorage !== 'undefined'
    ? (localStorage.getItem('astro:citation-style') as CitationStyle) || 'apa'
    : 'apa') as CitationStyle,

  loadLibrary: async () => {
    if (get().loading || get().loaded) return
    set({ loading: true })
    try {
      const data = await fetchJson<{ references: Reference[] }>('/api/references')
      set({ library: data.references || [], loaded: true, loading: false })
    } catch (err) {
      console.error('[reference-store] Failed to load library:', err)
      set({ loading: false })
    }
  },

  loadInbox: async () => {
    try {
      const data = await fetchJson<{ references: Reference[] }>('/api/references/inbox')
      set({ inbox: data.references || [], inboxLoaded: true })
    } catch (err) {
      console.error('[reference-store] Failed to load inbox:', err)
    }
  },

  getReferences: (_projectId?: string) => {
    // projectId param kept for call-site compatibility; returns full global library.
    // Use getReferencesForProject() for a filtered per-project view.
    return get().library
  },

  searchReferences: (query) => {
    const refs = get().library
    if (!query.trim()) return refs.slice(0, 20)
    const q = query.toLowerCase()
    return refs.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.authors?.some(a => a.toLowerCase().includes(q)) ||
      String(r.year).includes(q) ||
      r.id?.toLowerCase().includes(q) ||
      r.venue?.toLowerCase().includes(q) ||
      r.tags?.some(t => t.toLowerCase().includes(q))
    ).slice(0, 20)
  },

  getReference: (citeKey) => {
    const refs = get().library
    return refs.find(r => r.id === citeKey || getCiteKey(r) === citeKey)
  },

  addReference: async (ref) => {
    const data = await fetchJson<{ reference: Reference }>('/api/references', {
      method: 'POST',
      body: JSON.stringify(ref),
    })
    set(s => ({ library: [...s.library, data.reference] }))
  },

  updateReference: async (ref) => {
    const data = await fetchJson<{ reference: Reference }>(`/api/references/${ref.id}`, {
      method: 'PUT',
      body: JSON.stringify(ref),
    })
    set(s => ({ library: s.library.map(r => r.id === ref.id ? data.reference : r) }))
  },

  removeReference: async (id) => {
    await fetchJson<{ ok: boolean }>(`/api/references/${id}`, { method: 'DELETE' })
    set(s => ({ library: s.library.filter(r => r.id !== id), inbox: s.inbox.filter(r => r.id !== id) }))
  },

  acceptReference: async (id) => {
    const data = await fetchJson<{ reference: Reference }>(`/api/references/${id}/accept`, { method: 'POST' })
    set(s => ({
      inbox: s.inbox.filter(r => r.id !== id),
      library: [...s.library, { ...data.reference, status: 'accepted' }],
    }))
  },

  acceptAllInbox: async () => {
    const data = await fetchJson<{ accepted: number }>('/api/references/inbox/accept-all', { method: 'POST' })
    if (data.accepted > 0) {
      const moved = get().inbox
      set(s => ({
        inbox: [],
        library: [...s.library, ...moved.map(r => ({ ...r, status: 'accepted' as const }))],
      }))
    }
  },

  importBibTeX: async (bibtex) => {
    const parsed = parseBibTeX(bibtex)
    if (parsed.length === 0) return 0
    // Pass cite keys straight through — server handles upsert and dedup
    const withKeys = parsed.map(({ citeKey, ...ref }) => ({
      ...ref,
      id: (citeKey || generateCiteKey(ref)).replace(/[^a-z0-9_:-]/gi, ''),
    } as Reference))
    const data = await importReferenceBatches(withKeys)
    set(s => ({ library: mergeImportedReferences(s.library, data.references) }))
    return data.imported
  },

  importNBIB: async (nbib) => {
    const parsed = parseNBIB(nbib)
    return get().importReferences(parsed)
  },

  importReferences: async (refs) => {
    if (refs.length === 0) return 0
    const withKeys = refs.map(ref => ({ ...ref, id: generateCiteKey(ref) } as Reference))
    const data = await importReferenceBatches(withKeys)
    set(s => ({ library: mergeImportedReferences(s.library, data.references) }))
    return data.imported
  },

  getCitedKeysForProject: (projectId, nodes, project) => {
    const keys = new Set<string>()
    // Scan project description
    for (const k of extractCiteKeys(project.description || '')) keys.add(k)
    // Scan plan nodes belonging to this project
    for (const node of nodes) {
      if (node.projectId !== projectId) continue
      const content = [node.description || '', ((node as unknown) as Record<string, unknown>).content as string || ''].join(' ')
      for (const k of extractCiteKeys(content)) keys.add(k)
    }
    return keys
  },

  getReferencesForProject: (projectId, nodes, project) => {
    const keys = get().getCitedKeysForProject(projectId, nodes, project)
    if (keys.size === 0) return []
    const lib = get().library
    return lib.filter(r => keys.has(r.id) || keys.has(getCiteKey(r)))
  },

  setCitationStyle: (style) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('astro:citation-style', style)
    }
    set({ citationStyle: style })
  },
}))
