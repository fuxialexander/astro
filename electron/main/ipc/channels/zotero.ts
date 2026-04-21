/**
 * Zotero desktop library detection.
 *
 * Strategy:
 * 1. Try Zotero local HTTP API (localhost:23119) — returns BibTeX directly,
 *    including Better BibTeX cite keys when the BBT plugin is installed.
 * 2. Fall back to reading zotero.sqlite via better-sqlite3 and generating
 *    a BibTeX string from the raw item data.
 *
 * Both paths return { found: boolean; bibtex?: string } so the renderer
 * can feed the result straight into importBibTeX() for unified processing.
 */

import { defineHandler } from '../registry.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { toBibTeX } from '@astro/core'
import type { Reference } from '@astro/core/types'

// ── Zotero local API ──────────────────────────────────────────────────

const ZOTERO_LOCAL_API = 'http://127.0.0.1:23119'

/**
 * Try the Better BibTeX export endpoint (BBT plugin must be installed).
 * This is the most reliable way to get BibTeX with proper cite keys.
 * Endpoint: /better-bibtex/export/library?/1/library.bibtex
 */
async function fetchViaBBT(): Promise<string | null> {
  try {
    const url = `${ZOTERO_LOCAL_API}/better-bibtex/export/library?/1/library.bibtex`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const text = await res.text()
    return text.trim() && text.includes('@') ? text : null
  } catch {
    return null
  }
}

/**
 * Fallback: paginate via the Zotero local API with format=bibtex.
 * Only works when Better BibTeX is installed (BBT overrides the format param).
 */
async function fetchViaLocalAPI(): Promise<string | null> {
  const chunks: string[] = []
  let start = 0
  const limit = 100

  try {
    while (true) {
      const url = `${ZOTERO_LOCAL_API}/api/users/0/items?format=bibtex&limit=${limit}&start=${start}`
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return null
      const text = await res.text()
      if (!text.trim() || !text.includes('@')) break
      chunks.push(text)
      const entryCount = (text.match(/@\w+\{/g) ?? []).length
      if (entryCount < limit) break
      start += limit
    }
    return chunks.join('\n') || null
  } catch {
    return null
  }
}

async function fetchZoteroBibTeX(): Promise<string | null> {
  // BBT endpoint is more reliable and returns proper cite keys
  const bbt = await fetchViaBBT()
  if (bbt) return bbt
  return fetchViaLocalAPI()
}

// ── SQLite fallback ───────────────────────────────────────────────────

function findZoteroDb(): string | null {
  const candidates = [
    path.join(os.homedir(), 'Zotero', 'zotero.sqlite'),
    path.join(os.homedir(), 'Documents', 'Zotero', 'zotero.sqlite'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  const profilesDir = path.join(os.homedir(), 'Library', 'Application Support', 'Zotero', 'Profiles')
  if (fs.existsSync(profilesDir)) {
    try {
      for (const profile of fs.readdirSync(profilesDir)) {
        const db = path.join(profilesDir, profile, 'zotero.sqlite')
        if (fs.existsSync(db)) return db
      }
    } catch { /* ignore */ }
  }
  return null
}

// Maps Zotero internal typeName → BibTeX entry type
const ZOTERO_TYPE_TO_BIBTEX: Record<string, string> = {
  journalarticle: 'article',
  conferencepaper: 'inproceedings',
  book: 'book',
  booksection: 'incollection',
  thesis: 'phdthesis',
  report: 'techreport',
  preprint: 'misc',
  document: 'misc',
  webpage: 'misc',
  manuscript: 'unpublished',
  patent: 'misc',
  presentation: 'misc',
  artwork: 'misc',
  film: 'misc',
  interview: 'misc',
  letter: 'misc',
  magazinearticle: 'article',
  newspaperarticle: 'article',
  encyclopediaarticle: 'incollection',
}

function convertZoteroItem(
  item: Record<string, unknown>,
  creators: Record<string, unknown>[],
  fields: Record<string, unknown>[],
): Reference | null {
  const get = (name: string) =>
    fields.find(f => (f as { fieldName: string }).fieldName === name)?.value as string | undefined

  const title = get('title')
  if (!title) return null

  const dateStr = get('date') ?? ''
  const year = parseInt(dateStr.slice(0, 4) || '0', 10)

  // Cite key priority:
  // 1. Zotero 8 native citationKey column on the items table
  // 2. BBT legacy: "Citation Key: foo2024" line in the extra field (Zotero 7)
  // 3. Generated fallback: firstauthorYYYY
  const nativeCiteKey = item.citationKey as string | undefined
  const extra = get('extra') ?? ''
  const bbtKeyMatch = extra.match(/Citation Key:\s*(\S+)/i)
  const bbtKey = bbtKeyMatch?.[1]

  const authors = creators
    .filter(c => (c as { creatorType: string }).creatorType === 'author')
    .map(c => {
      const l = (c as { lastName?: string }).lastName ?? ''
      const f = (c as { firstName?: string }).firstName ?? ''
      return l ? `${l}, ${f}`.trim() : f
    })
    .filter(Boolean)

  const firstAuthor = (authors[0]?.split(',')[0] ?? 'unknown').replace(/[^a-z]/gi, '').toLowerCase()
  const citeKey = (nativeCiteKey?.trim()) || bbtKey || `${firstAuthor}${year || 'nd'}`

  return {
    id: citeKey,
    title,
    authors: authors.length > 0 ? authors : ['Unknown'],
    year: year || 0,
    venue: get('publicationTitle') ?? get('bookTitle'),
    volume: get('volume'),
    issue: get('issue'),
    pages: get('pages'),
    doi: get('DOI'),
    url: get('url'),
    abstract: get('abstractNote'),
    source: 'zotero',
    zoteroKey: String(item.key ?? item.itemID ?? ''),
    entryType: ZOTERO_TYPE_TO_BIBTEX[String(item.typeName ?? '').toLowerCase()] ?? 'misc',
  }
}

async function fetchZoteroSQLite(): Promise<string | null> {
  const dbPath = findZoteroDb()
  if (!dbPath) return null

  try {
    const Database = (await import('better-sqlite3')).default
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })

    try {
      // Zotero 8 added a native citationKey column; Zotero 7 doesn't have it.
      // Try with it first, fall back to without.
      let itemRows: Record<string, unknown>[]
      try {
        itemRows = db.prepare(`
          SELECT i.itemID, i.key, i.citationKey, it.typeName
          FROM items i
          JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
          WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)
            AND it.typeName NOT IN ('attachment', 'note')
          ORDER BY i.dateAdded
          LIMIT 2000
        `).all() as Record<string, unknown>[]
      } catch {
        // Zotero 7 schema — no citationKey column
        itemRows = db.prepare(`
          SELECT i.itemID, i.key, it.typeName
          FROM items i
          JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
          WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)
            AND it.typeName NOT IN ('attachment', 'note')
          ORDER BY i.dateAdded
          LIMIT 2000
        `).all() as Record<string, unknown>[]
      }

      const references: Reference[] = []
      for (const item of itemRows) {
        const creators = db.prepare(`
          SELECT c.lastName, c.firstName, ct.creatorType, ic.orderIndex
          FROM itemCreators ic
          JOIN creators c ON ic.creatorID = c.creatorID
          JOIN creatorTypes ct ON ic.creatorTypeID = ct.creatorTypeID
          WHERE ic.itemID = ? ORDER BY ic.orderIndex
        `).all(item.itemID) as Record<string, unknown>[]

        const fields = db.prepare(`
          SELECT f.fieldName, idv.value
          FROM itemData id
          JOIN fields f ON id.fieldID = f.fieldID
          JOIN itemDataValues idv ON id.valueID = idv.valueID
          WHERE id.itemID = ?
        `).all(item.itemID) as Record<string, unknown>[]

        const ref = convertZoteroItem(item, creators, fields)
        if (ref) references.push(ref)
      }

      return references.length > 0 ? toBibTeX(references) : null
    } finally {
      db.close()
    }
  } catch (err) {
    console.error('[zotero] SQLite fallback failed:', err)
    return null
  }
}

// ── IPC handler ───────────────────────────────────────────────────────

const zoteroScanSchema = {
  req: z.object({}),
  res: z.object({
    found: z.boolean(),
    bibtex: z.string().optional(),
  }),
}

export function registerZoteroChannels(): void {
  defineHandler('zotero:scan', zoteroScanSchema, async () => {
    // 1. Try local API / BBT (Zotero app must be running)
    const apiBibtex = await fetchZoteroBibTeX()
    if (apiBibtex) {
      console.log('[zotero] Retrieved library via local API (BBT or paginated)')
      return { found: true, bibtex: apiBibtex }
    }

    // 2. Fall back to SQLite
    const sqliteBibtex = await fetchZoteroSQLite()
    if (sqliteBibtex) {
      console.log('[zotero] Retrieved library via SQLite fallback')
      return { found: true, bibtex: sqliteBibtex }
    }

    return { found: false }
  })
}
