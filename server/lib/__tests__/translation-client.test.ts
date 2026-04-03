import { describe, it, expect } from 'vitest'
import { parseIdentifier } from '../references/translation-client.js'

describe('parseIdentifier', () => {
  // DOI
  it('parses a bare DOI', () => {
    const result = parseIdentifier('10.1038/nature12373')
    expect(result).toEqual({ type: 'doi', value: '10.1038/nature12373' })
  })

  it('parses a DOI with doi: prefix', () => {
    const result = parseIdentifier('doi:10.1038/nature12373')
    expect(result).toEqual({ type: 'doi', value: '10.1038/nature12373' })
  })

  it('parses a DOI URL from doi.org', () => {
    const result = parseIdentifier('https://doi.org/10.1038/nature12373')
    expect(result).toEqual({ type: 'doi', value: '10.1038/nature12373' })
  })

  it('parses a DOI URL from dx.doi.org', () => {
    const result = parseIdentifier('https://dx.doi.org/10.1038/nature12373')
    expect(result).toEqual({ type: 'doi', value: '10.1038/nature12373' })
  })

  it('strips trailing punctuation from DOI', () => {
    const result = parseIdentifier('10.1038/nature12373.')
    expect(result).toEqual({ type: 'doi', value: '10.1038/nature12373' })
  })

  // PMID
  it('parses PMID with prefix', () => {
    const result = parseIdentifier('PMID:12345678')
    expect(result).toEqual({ type: 'pmid', value: '12345678' })
  })

  it('parses PMID with prefix and space', () => {
    const result = parseIdentifier('pmid 12345678')
    expect(result).toEqual({ type: 'pmid', value: '12345678' })
  })

  it('parses bare numeric PMID (≥5 digits)', () => {
    const result = parseIdentifier('12345678')
    expect(result).toEqual({ type: 'pmid', value: '12345678' })
  })

  it('does not parse short numbers as PMID', () => {
    const result = parseIdentifier('1234')
    expect(result).toBeNull()
  })

  // arXiv
  it('parses new-style arXiv ID', () => {
    const result = parseIdentifier('2301.07041')
    expect(result).toEqual({ type: 'arxiv', value: '2301.07041' })
  })

  it('parses arXiv ID with version', () => {
    const result = parseIdentifier('2301.07041v2')
    expect(result).toEqual({ type: 'arxiv', value: '2301.07041v2' })
  })

  it('parses arXiv ID with arxiv: prefix', () => {
    const result = parseIdentifier('arxiv:2301.07041')
    expect(result).toEqual({ type: 'arxiv', value: '2301.07041' })
  })

  it('parses arXiv URL', () => {
    const result = parseIdentifier('https://arxiv.org/abs/2301.07041')
    expect(result).toEqual({ type: 'arxiv', value: '2301.07041' })
  })

  it('parses old-style arXiv ID', () => {
    const result = parseIdentifier('hep-th/0401032')
    expect(result).toEqual({ type: 'arxiv', value: 'hep-th/0401032' })
  })

  // ISBN
  it('parses ISBN-13', () => {
    const result = parseIdentifier('978-0-13-468599-1')
    expect(result).toEqual({ type: 'isbn', value: '9780134685991' })
  })

  it('parses ISBN with prefix', () => {
    const result = parseIdentifier('ISBN:978-0-13-468599-1')
    expect(result).toEqual({ type: 'isbn', value: '9780134685991' })
  })

  // URL
  it('parses a generic URL', () => {
    const result = parseIdentifier('https://example.com/paper')
    expect(result).toEqual({ type: 'url', value: 'https://example.com/paper' })
  })

  // Edge cases
  it('returns null for empty string', () => {
    expect(parseIdentifier('')).toBeNull()
  })

  it('returns null for whitespace', () => {
    expect(parseIdentifier('   ')).toBeNull()
  })

  it('trims whitespace', () => {
    const result = parseIdentifier('  10.1038/nature12373  ')
    expect(result).toEqual({ type: 'doi', value: '10.1038/nature12373' })
  })
})
