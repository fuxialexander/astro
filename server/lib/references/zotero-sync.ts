/**
 * Zotero Web API v3 client and sync engine.
 *
 * Connects to a user's Zotero library, fetches items with incremental sync
 * (using the ?since=<version> parameter), converts Zotero JSON to CSL-JSON,
 * and upserts into the `references` table.
 *
 * API docs: https://www.zotero.org/support/dev/web_api/v3/start
 */

import { db } from '../db/index.js'
import { references, zoteroSyncState, connectedAccounts } from '../db/schema.js'
import { eq, and, sql } from 'drizzle-orm'

// ── Types ──────────────────────────────────────────────────────────

export interface ZoteroCredentials {
  apiKey: string
  userId: string // Zotero user ID (numeric string)
}

export interface ZoteroLibrary {
  id: string
  type: 'user' | 'group'
  name: string
  version: number
  access?: {
    library: boolean
    files: boolean
    notes: boolean
    write: boolean
  }
}

export interface ZoteroItem {
  key: string
  version: number
  library: {
    type: string
    id: number
    name: string
  }
  data: {
    key: string
    version: number
    itemType: string
    title?: string
    creators?: Array<{
      creatorType: string
      firstName?: string
      lastName?: string
      name?: string // for single-field names
    }>
    abstractNote?: string
    date?: string
    DOI?: string
    url?: string
    tags?: Array<{ tag: string; type?: number }>
    relations?: Record<string, unknown>
    [key: string]: unknown
  }
  csljson?: Record<string, unknown>
}

export interface ZoteroSyncResult {
  libraryId: string
  libraryType: 'user' | 'group'
  newVersion: number
  itemsSynced: number
  itemsCreated: number
  itemsUpdated: number
  errors: string[]
}

// ── Constants ──────────────────────────────────────────────────────

const ZOTERO_API_BASE = 'https://api.zotero.org'
const ITEMS_PER_PAGE = 100

// ── API Client ─────────────────────────────────────────────────────

async function zoteroFetch(
  path: string,
  apiKey: string,
  params?: Record<string, string>,
): Promise<{ data: unknown; headers: Headers; status: number }> {
  const url = new URL(`${ZOTERO_API_BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      'Zotero-API-Key': apiKey,
      'Zotero-API-Version': '3',
      'Accept': 'application/json',
    },
  })

  if (res.status === 403) {
    throw new Error('Zotero API key is invalid or does not have access to this library')
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After')
    throw new Error(`Zotero rate limit exceeded. Retry after ${retryAfter || '?'} seconds.`)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Zotero API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  return { data, headers: res.headers, status: res.status }
}

// ── Library Discovery ──────────────────────────────────────────────

/**
 * List all libraries the user has access to (personal + groups).
 */
export async function listZoteroLibraries(creds: ZoteroCredentials): Promise<ZoteroLibrary[]> {
  const libraries: ZoteroLibrary[] = []

  // Personal library — fetch key permissions to verify access
  const { data: keyData } = await zoteroFetch(`/keys/${creds.apiKey}`, creds.apiKey)
  const keyInfo = keyData as {
    userID: number
    username?: string
    access?: {
      user?: { library?: boolean; files?: boolean; notes?: boolean; write?: boolean }
      groups?: Record<string, { library?: boolean; write?: boolean }> | 'all'
    }
  }

  if (keyInfo.access?.user?.library) {
    // Get library version
    const { headers } = await zoteroFetch(
      `/users/${creds.userId}/items`,
      creds.apiKey,
      { limit: '1', format: 'json' },
    )
    const version = parseInt(headers.get('Last-Modified-Version') || '0', 10)

    libraries.push({
      id: creds.userId,
      type: 'user',
      name: keyInfo.username ? `${keyInfo.username}'s Library` : 'My Library',
      version,
      access: {
        library: true,
        files: !!keyInfo.access.user.files,
        notes: !!keyInfo.access.user.notes,
        write: !!keyInfo.access.user.write,
      },
    })
  }

  // Group libraries
  try {
    const { data: groups } = await zoteroFetch(
      `/users/${creds.userId}/groups`,
      creds.apiKey,
    )

    for (const group of groups as Array<{ id: number; data: { name: string }; version: number }>) {
      libraries.push({
        id: String(group.id),
        type: 'group',
        name: group.data.name,
        version: group.version,
      })
    }
  } catch {
    // Group access might be restricted — continue with personal library only
  }

  return libraries
}

// ── Zotero JSON → CSL-JSON Converter ──────────────────────────────

/**
 * Convert a Zotero item to CSL-JSON format.
 * Uses the Zotero API's built-in CSL export when available,
 * falls back to manual conversion.
 */
function zoteroItemToCslJson(item: ZoteroItem): Record<string, unknown> {
  const d = item.data

  // Map Zotero item types to CSL types
  const typeMap: Record<string, string> = {
    journalArticle: 'article-journal',
    book: 'book',
    bookSection: 'chapter',
    conferencePaper: 'paper-conference',
    thesis: 'thesis',
    report: 'report',
    webpage: 'webpage',
    newspaperArticle: 'article-newspaper',
    magazineArticle: 'article-magazine',
    patent: 'patent',
    letter: 'personal_communication',
    manuscript: 'manuscript',
    presentation: 'speech',
    document: 'document',
    note: 'article', // fallback
    attachment: 'article', // fallback
    preprint: 'article',
    dataset: 'dataset',
    software: 'software',
    standard: 'standard',
    videoRecording: 'motion_picture',
    audioRecording: 'song',
    podcast: 'song',
    map: 'map',
    statute: 'legislation',
    bill: 'bill',
    case: 'legal_case',
    blogPost: 'post-weblog',
    forumPost: 'post',
    encyclopediaArticle: 'entry-encyclopedia',
    dictionaryEntry: 'entry-dictionary',
    interview: 'interview',
    film: 'motion_picture',
    tvBroadcast: 'broadcast',
    radioBroadcast: 'broadcast',
  }

  const csl: Record<string, unknown> = {
    id: item.key,
    type: typeMap[d.itemType] || 'article',
    title: d.title || '',
  }

  // Authors / creators
  if (d.creators && d.creators.length > 0) {
    const authors: Array<Record<string, string>> = []
    const editors: Array<Record<string, string>> = []

    for (const creator of d.creators) {
      const person: Record<string, string> = {}
      if (creator.name) {
        person.literal = creator.name
      } else {
        if (creator.firstName) person.given = creator.firstName
        if (creator.lastName) person.family = creator.lastName
      }

      if (creator.creatorType === 'editor') {
        editors.push(person)
      } else {
        authors.push(person)
      }
    }

    if (authors.length > 0) csl.author = authors
    if (editors.length > 0) csl.editor = editors
  }

  // Date parsing (Zotero stores dates as strings like "2024-01-15" or "January 2024")
  if (d.date) {
    const yearMatch = d.date.match(/(\d{4})/)
    if (yearMatch) {
      const parts: number[][] = [[parseInt(yearMatch[1], 10)]]
      const monthMatch = d.date.match(/(\d{4})-(\d{1,2})/)
      if (monthMatch) {
        parts[0].push(parseInt(monthMatch[2], 10))
        const dayMatch = d.date.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
        if (dayMatch) {
          parts[0].push(parseInt(dayMatch[3], 10))
        }
      }
      csl.issued = { 'date-parts': parts }
    }
  }

  // Standard fields
  if (d.DOI) csl.DOI = d.DOI
  if (d.url) csl.URL = d.url
  if (d.abstractNote) csl.abstract = d.abstractNote

  // Journal / container fields
  const pubTitle = (d as Record<string, unknown>).publicationTitle as string | undefined
  if (pubTitle) csl['container-title'] = pubTitle
  const vol = (d as Record<string, unknown>).volume as string | undefined
  if (vol) csl.volume = vol
  const issue = (d as Record<string, unknown>).issue as string | undefined
  if (issue) csl.issue = issue
  const pages = (d as Record<string, unknown>).pages as string | undefined
  if (pages) csl.page = pages
  const pub = (d as Record<string, unknown>).publisher as string | undefined
  if (pub) csl.publisher = pub
  const isbn = (d as Record<string, unknown>).ISBN as string | undefined
  if (isbn) csl.ISBN = isbn
  const issn = (d as Record<string, unknown>).ISSN as string | undefined
  if (issn) csl.ISSN = issn

  return csl
}

/**
 * Extract a formatted author string for display purposes.
 */
function formatAuthors(item: ZoteroItem): string {
  const creators = item.data.creators || []
  const authorNames = creators
    .filter((c) => c.creatorType === 'author' || creators.length === 1)
    .map((c) => {
      if (c.name) return c.name
      return [c.lastName, c.firstName].filter(Boolean).join(', ')
    })

  if (authorNames.length === 0) return ''
  if (authorNames.length === 1) return authorNames[0]
  if (authorNames.length === 2) return authorNames.join(' & ')
  return `${authorNames[0]} et al.`
}

/**
 * Extract year from a Zotero date string.
 */
function extractYear(dateStr?: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/(\d{4})/)
  return match ? match[1] : null
}

// ── Sync Engine ────────────────────────────────────────────────────

/**
 * Fetch all items from a Zotero library (with pagination and incremental sync).
 */
async function fetchZoteroItems(
  creds: ZoteroCredentials,
  libraryType: 'user' | 'group',
  libraryId: string,
  sinceVersion?: number,
): Promise<{ items: ZoteroItem[]; newVersion: number }> {
  const prefix = libraryType === 'user'
    ? `/users/${libraryId}`
    : `/groups/${libraryId}`

  const allItems: ZoteroItem[] = []
  let start = 0
  let newVersion = 0

  for (;;) {
    const params: Record<string, string> = {
      format: 'json',
      limit: String(ITEMS_PER_PAGE),
      start: String(start),
      itemType: '-attachment || note', // Exclude standalone attachments/notes
    }

    if (sinceVersion !== undefined && sinceVersion > 0) {
      params.since = String(sinceVersion)
    }

    const { data, headers } = await zoteroFetch(
      `${prefix}/items`,
      creds.apiKey,
      params,
    )

    const items = data as ZoteroItem[]
    allItems.push(...items)

    // Track library version from response header
    const headerVersion = parseInt(headers.get('Last-Modified-Version') || '0', 10)
    if (headerVersion > newVersion) {
      newVersion = headerVersion
    }

    // Check total results for pagination
    const totalResults = parseInt(headers.get('Total-Results') || '0', 10)
    start += ITEMS_PER_PAGE

    if (start >= totalResults || items.length < ITEMS_PER_PAGE) {
      break
    }
  }

  return { items: allItems, newVersion }
}

/**
 * Get Zotero credentials for a user from connected_accounts.
 */
export async function getZoteroCredentials(userId: string): Promise<ZoteroCredentials | null> {
  const [account] = await db
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.channel, 'zotero'),
        eq(connectedAccounts.enabled, true),
      ),
    )
    .limit(1)

  if (!account) return null

  const creds = account.credentials as Record<string, string>
  if (!creds.apiKey || !creds.userId) return null

  return { apiKey: creds.apiKey, userId: creds.userId }
}

/**
 * Sync items from a Zotero library into the references table.
 * Uses incremental sync via the `since` parameter.
 */
export async function syncZoteroLibrary(
  userId: string,
  creds: ZoteroCredentials,
  libraryType: 'user' | 'group',
  libraryId: string,
  teamId?: string,
): Promise<ZoteroSyncResult> {
  const result: ZoteroSyncResult = {
    libraryId,
    libraryType,
    newVersion: 0,
    itemsSynced: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    errors: [],
  }

  // Get current sync state
  const [syncState] = await db
    .select()
    .from(zoteroSyncState)
    .where(
      and(
        eq(zoteroSyncState.userId, userId),
        eq(zoteroSyncState.libraryType, libraryType),
        eq(zoteroSyncState.libraryId, libraryId),
      ),
    )
    .limit(1)

  const sinceVersion = syncState?.lastSyncVersion ?? 0

  // Fetch items from Zotero API
  const { items, newVersion } = await fetchZoteroItems(
    creds,
    libraryType,
    libraryId,
    sinceVersion,
  )

  result.newVersion = newVersion

  // Skip if nothing changed
  if (items.length === 0 && newVersion <= sinceVersion) {
    return result
  }

  // Filter out attachments and notes (standalone only)
  const validItems = items.filter(
    (item) => item.data.itemType !== 'attachment' && item.data.itemType !== 'note',
  )

  // Upsert each item
  for (const item of validItems) {
    try {
      const cslJson = zoteroItemToCslJson(item)
      const authors = formatAuthors(item)
      const year = extractYear(item.data.date)
      const tags = (item.data.tags || []).map((t) => t.tag)
      const zoteroLibId = `${libraryType}:${libraryId}`

      const [existing] = await db
        .select({ id: references.id })
        .from(references)
        .where(
          and(
            eq(references.userId, userId),
            eq(references.zoteroKey, item.key),
            eq(references.zoteroLibraryId, zoteroLibId),
          ),
        )
        .limit(1)

      if (existing) {
        // Update existing reference
        await db
          .update(references)
          .set({
            cslJson,
            title: item.data.title || '',
            authors,
            year,
            doi: item.data.DOI || null,
            abstract: item.data.abstractNote || null,
            itemType: item.data.itemType,
            tags,
            zoteroVersion: item.version,
            updatedAt: new Date(),
          })
          .where(eq(references.id, existing.id))
        result.itemsUpdated++
      } else {
        // Insert new reference
        await db
          .insert(references)
          .values({
            userId,
            teamId: teamId || null,
            source: 'zotero',
            zoteroKey: item.key,
            zoteroLibraryId: zoteroLibId,
            zoteroVersion: item.version,
            cslJson,
            title: item.data.title || '',
            authors,
            year,
            doi: item.data.DOI || null,
            abstract: item.data.abstractNote || null,
            itemType: item.data.itemType,
            tags,
          })
        result.itemsCreated++
      }

      result.itemsSynced++
    } catch (err) {
      result.errors.push(`Item ${item.key}: ${(err as Error).message}`)
    }
  }

  // Update sync state
  const libraryName = validItems[0]?.library?.name || syncState?.libraryName || ''
  await db
    .insert(zoteroSyncState)
    .values({
      userId,
      libraryType,
      libraryId,
      libraryName,
      lastSyncVersion: newVersion,
      lastSyncedAt: new Date(),
      itemCount: sql`${result.itemsSynced}`,
    })
    .onConflictDoUpdate({
      target: [zoteroSyncState.userId, zoteroSyncState.libraryType, zoteroSyncState.libraryId],
      set: {
        lastSyncVersion: newVersion,
        lastSyncedAt: new Date(),
        libraryName,
        itemCount: sql`${zoteroSyncState.itemCount} + ${result.itemsCreated}`,
        updatedAt: new Date(),
      },
    })

  return result
}

/**
 * Test Zotero API credentials by fetching key info.
 */
export async function testZoteroConnection(creds: ZoteroCredentials): Promise<{
  success: boolean
  message: string
  username?: string
}> {
  try {
    const { data } = await zoteroFetch(`/keys/${creds.apiKey}`, creds.apiKey)
    const keyInfo = data as { userID: number; username?: string }

    if (String(keyInfo.userID) !== creds.userId) {
      return {
        success: false,
        message: `API key belongs to user ${keyInfo.userID}, but provided user ID is ${creds.userId}`,
      }
    }

    return {
      success: true,
      message: `Connected as ${keyInfo.username || `user ${keyInfo.userID}`}`,
      username: keyInfo.username,
    }
  } catch (err) {
    return {
      success: false,
      message: `Connection failed: ${(err as Error).message}`,
    }
  }
}
