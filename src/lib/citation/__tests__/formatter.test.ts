import { describe, it, expect } from 'vitest'
import { formatReference, formatInlineCitation, formatBibliography } from '../formatter'
import type { Reference } from '../types'

const sampleRef: Reference = {
  id: 'smith2024',
  title: 'Deep Learning for Genomics',
  authors: ['Smith, J.', 'Jones, A. B.'],
  year: 2024,
  venue: 'Nature Methods',
  volume: '21',
  issue: '3',
  pages: '145-158',
  doi: '10.1038/nmeth.2024.001',
}

const singleAuthorRef: Reference = {
  id: 'doe2023',
  title: 'A Single Author Paper',
  authors: ['Doe, J.'],
  year: 2023,
}

describe('formatReference', () => {
  it('formats APA style', () => {
    const result = formatReference(sampleRef, 'apa')
    expect(result).toContain('Smith, J. & Jones, A. B.')
    expect(result).toContain('(2024)')
    expect(result).toContain('Deep Learning for Genomics')
    expect(result).toContain('*Nature Methods*')
    expect(result).toContain('doi.org')
  })

  it('formats Chicago style', () => {
    const result = formatReference(sampleRef, 'chicago')
    expect(result).toContain('Smith, J. and Jones, A. B.')
    expect(result).toContain('2024')
    expect(result).toContain('"Deep Learning for Genomics."')
  })

  it('formats Nature style', () => {
    const result = formatReference(sampleRef, 'nature')
    expect(result).toContain('Smith, J., Jones, A. B.')
    expect(result).toContain('(2024)')
    expect(result).toContain('*Nature Methods*')
  })

  it('formats IEEE style', () => {
    const result = formatReference(sampleRef, 'ieee')
    expect(result).toContain('Smith, J. and Jones, A. B.')
    expect(result).toContain('"Deep Learning for Genomics,"')
    expect(result).toContain('2024')
  })
})

describe('formatInlineCitation', () => {
  it('APA style: (Author, Year)', () => {
    const result = formatInlineCitation(sampleRef, 'apa')
    expect(result).toContain('Smith')
    expect(result).toContain('2024')
  })

  it('Nature style: bracketed number (no raw HTML)', () => {
    const result = formatInlineCitation(sampleRef, 'nature', 0)
    expect(result).toBe('[1]')
  })

  it('IEEE style: bracketed number', () => {
    const result = formatInlineCitation(sampleRef, 'ieee', 2)
    expect(result).toBe('[3]')
  })

  it('single author — no et al.', () => {
    const result = formatInlineCitation(singleAuthorRef, 'apa')
    expect(result).not.toContain('et al.')
  })
})

describe('formatBibliography', () => {
  it('returns empty string for no refs', () => {
    expect(formatBibliography([], 'apa')).toBe('')
  })

  it('formats APA as bullet list', () => {
    const result = formatBibliography([sampleRef], 'apa')
    expect(result).toMatch(/^- /)
  })

  it('formats IEEE as numbered list', () => {
    const result = formatBibliography([sampleRef, singleAuthorRef], 'ieee')
    expect(result).toMatch(/^1\./)
    expect(result).toContain('2.')
  })
})
