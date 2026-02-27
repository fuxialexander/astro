/**
 * Tests for arXiv API client
 *
 * Note: These tests make real API calls to arXiv.
 * They are marked with timeout to handle slow API responses.
 */

import { describe, it, expect } from 'vitest'
import { fetchArxivMetadata, searchArxiv } from '../api.js'

describe('fetchArxivMetadata', () => {
  it('fetches metadata for a known paper', { timeout: 30000 }, async () => {
    // Use "Attention Is All You Need" - a famous, stable paper
    const metadata = await fetchArxivMetadata('1706.03762')

    expect(metadata).not.toBeNull()
    expect(metadata!.id).toBe('1706.03762')
    expect(metadata!.title).toContain('Attention')
    expect(metadata!.authors.length).toBeGreaterThan(0)
    expect(metadata!.abstract.length).toBeGreaterThan(100)
    expect(metadata!.primaryCategory).toBe('cs.CL')
  })

  it('fetches metadata from URL', { timeout: 30000 }, async () => {
    const metadata = await fetchArxivMetadata('https://arxiv.org/abs/1706.03762')

    expect(metadata).not.toBeNull()
    expect(metadata!.id).toBe('1706.03762')
  })

  it('returns null for non-existent paper', { timeout: 30000 }, async () => {
    const metadata = await fetchArxivMetadata('9999.99999')
    expect(metadata).toBeNull()
  })

  it('throws for invalid input', async () => {
    await expect(fetchArxivMetadata('not-a-valid-id')).rejects.toThrow()
  })

  it('includes URLs in metadata', { timeout: 30000 }, async () => {
    const metadata = await fetchArxivMetadata('1706.03762')

    expect(metadata).not.toBeNull()
    expect(metadata!.urls.abstract).toContain('arxiv.org/abs/1706.03762')
    expect(metadata!.urls.pdf).toContain('arxiv.org/pdf/1706.03762')
    expect(metadata!.urls.source).toContain('arxiv.org/e-print/1706.03762')
  })
})

describe('searchArxiv', () => {
  it('searches for papers', { timeout: 30000 }, async () => {
    const results = await searchArxiv('transformer attention', { maxResults: 5 })

    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(5)

    const first = results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(first.authors.length).toBeGreaterThan(0)
  })

  it('respects maxResults', { timeout: 30000 }, async () => {
    const results = await searchArxiv('machine learning', { maxResults: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('supports author search', { timeout: 30000 }, async () => {
    const results = await searchArxiv('au:vaswani', { maxResults: 5 })

    expect(results.length).toBeGreaterThan(0)
    // At least one result should have Vaswani as author
    const hasVaswani = results.some((r) =>
      r.authors.some((a) => a.name.toLowerCase().includes('vaswani'))
    )
    expect(hasVaswani).toBe(true)
  })

  it('supports category search', { timeout: 30000 }, async () => {
    const results = await searchArxiv('cat:cs.AI', { maxResults: 5 })

    expect(results.length).toBeGreaterThan(0)
    // Results should be in cs.AI or related category
    const allRelevant = results.every(
      (r) => r.primaryCategory.startsWith('cs.') || r.categories.some((c) => c.term.startsWith('cs.'))
    )
    expect(allRelevant).toBe(true)
  })

  it('returns empty array for no results', { timeout: 30000 }, async () => {
    const results = await searchArxiv('xyzzy_very_unlikely_search_term_12345', { maxResults: 5 })
    expect(results).toEqual([])
  })
})
