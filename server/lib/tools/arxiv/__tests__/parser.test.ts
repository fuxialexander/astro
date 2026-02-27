/**
 * Tests for arXiv URL/ID parser
 */

import { describe, it, expect } from 'vitest'
import {
  parseArxivId,
  normalizeArxivId,
  getArxivUrls,
  isValidArxivInput,
} from '../parser.js'

describe('parseArxivId', () => {
  describe('new format IDs', () => {
    it('parses basic new format ID', () => {
      const result = parseArxivId('2401.12345')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: undefined,
      })
    })

    it('parses new format ID with version', () => {
      const result = parseArxivId('2401.12345v2')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: '2',
      })
    })

    it('parses 5-digit new format ID', () => {
      const result = parseArxivId('2401.00001')
      expect(result).toEqual({
        paperId: '2401.00001',
        isOldFormat: false,
        version: undefined,
      })
    })
  })

  describe('old format IDs', () => {
    it('parses basic old format ID', () => {
      const result = parseArxivId('hep-th/9901001')
      expect(result).toEqual({
        paperId: 'hep-th/9901001',
        isOldFormat: true,
        category: 'hep-th',
        version: undefined,
      })
    })

    it('parses old format ID with version', () => {
      const result = parseArxivId('cs/0001001v1')
      expect(result).toEqual({
        paperId: 'cs/0001001',
        isOldFormat: true,
        category: 'cs',
        version: '1',
      })
    })

    it('parses math category', () => {
      const result = parseArxivId('math/0501001')
      expect(result).toEqual({
        paperId: 'math/0501001',
        isOldFormat: true,
        category: 'math',
        version: undefined,
      })
    })
  })

  describe('URL parsing', () => {
    it('parses abstract URL', () => {
      const result = parseArxivId('https://arxiv.org/abs/2401.12345')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: undefined,
      })
    })

    it('parses PDF URL', () => {
      const result = parseArxivId('https://arxiv.org/pdf/2401.12345.pdf')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: undefined,
      })
    })

    it('parses HTML URL', () => {
      const result = parseArxivId('https://arxiv.org/html/2401.12345')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: undefined,
      })
    })

    it('parses URL with version', () => {
      const result = parseArxivId('https://arxiv.org/abs/2401.12345v3')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: '3',
      })
    })

    it('parses old format URL', () => {
      const result = parseArxivId('https://arxiv.org/abs/hep-th/9901001')
      expect(result).toEqual({
        paperId: 'hep-th/9901001',
        isOldFormat: true,
        category: 'hep-th',
        version: undefined,
      })
    })

    it('parses e-print URL', () => {
      const result = parseArxivId('https://arxiv.org/e-print/2401.12345')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: undefined,
      })
    })

    it('parses format URL', () => {
      const result = parseArxivId('https://arxiv.org/format/2401.12345')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: undefined,
      })
    })
  })

  describe('DOI parsing', () => {
    it('parses arXiv DOI', () => {
      const result = parseArxivId('10.48550/arXiv.2401.12345')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: undefined,
      })
    })

    it('parses arXiv DOI with version', () => {
      const result = parseArxivId('10.48550/arXiv.2401.12345v1')
      expect(result).toEqual({
        paperId: '2401.12345',
        isOldFormat: false,
        version: '1',
      })
    })
  })

  describe('invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(parseArxivId('')).toBeNull()
    })

    it('returns null for random text', () => {
      expect(parseArxivId('not a paper id')).toBeNull()
    })

    it('returns null for invalid ID format', () => {
      expect(parseArxivId('12345')).toBeNull()
    })

    it('returns null for non-arXiv URL', () => {
      expect(parseArxivId('https://example.com/paper.pdf')).toBeNull()
    })
  })

  describe('whitespace handling', () => {
    it('trims leading/trailing whitespace', () => {
      const result = parseArxivId('  2401.12345  ')
      expect(result?.paperId).toBe('2401.12345')
    })
  })
})

describe('normalizeArxivId', () => {
  it('normalizes URL to ID', () => {
    expect(normalizeArxivId('https://arxiv.org/abs/2401.12345')).toBe('2401.12345')
  })

  it('normalizes versioned ID to base ID', () => {
    expect(normalizeArxivId('2401.12345v2')).toBe('2401.12345')
  })

  it('returns input for invalid ID', () => {
    expect(normalizeArxivId('invalid')).toBe('invalid')
  })
})

describe('getArxivUrls', () => {
  it('generates correct URLs for new format', () => {
    const urls = getArxivUrls('2401.12345')
    expect(urls.abstract).toBe('https://arxiv.org/abs/2401.12345')
    expect(urls.pdf).toBe('https://arxiv.org/pdf/2401.12345.pdf')
    expect(urls.html).toBe('https://arxiv.org/html/2401.12345')
    expect(urls.source).toBe('https://arxiv.org/e-print/2401.12345')
    expect(urls.api).toBe('http://export.arxiv.org/api/query?id_list=2401.12345')
  })

  it('generates correct URLs with version', () => {
    const urls = getArxivUrls('2401.12345', '2')
    expect(urls.abstract).toBe('https://arxiv.org/abs/2401.12345v2')
    expect(urls.pdf).toBe('https://arxiv.org/pdf/2401.12345v2.pdf')
  })

  it('generates correct URLs for old format', () => {
    const urls = getArxivUrls('hep-th/9901001')
    expect(urls.abstract).toBe('https://arxiv.org/abs/hep-th/9901001')
    expect(urls.pdf).toBe('https://arxiv.org/pdf/hep-th/9901001.pdf')
  })
})

describe('isValidArxivInput', () => {
  it('returns true for valid new format ID', () => {
    expect(isValidArxivInput('2401.12345')).toBe(true)
  })

  it('returns true for valid URL', () => {
    expect(isValidArxivInput('https://arxiv.org/abs/2401.12345')).toBe(true)
  })

  it('returns true for valid old format ID', () => {
    expect(isValidArxivInput('hep-th/9901001')).toBe(true)
  })

  it('returns false for invalid input', () => {
    expect(isValidArxivInput('not valid')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isValidArxivInput('')).toBe(false)
  })
})
