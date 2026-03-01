/**
 * Tests for arXiv paper fetcher — pure parsing utilities.
 *
 * Covers: parseArxivId, isArxivReference, buildMetadataUrl, buildSourceUrl,
 *         buildPdfUrl, buildAbstractUrl, parseArxivAtomResponse,
 *         parseLatexFigures, extractLatexText
 */
import { describe, it, expect } from 'vitest'
import {
  parseArxivId,
  isArxivReference,
  buildMetadataUrl,
  buildSourceUrl,
  buildPdfUrl,
  buildAbstractUrl,
  parseArxivAtomResponse,
  parseLatexFigures,
  extractLatexText,
} from '../packages/core/src/arxiv'

// ─── parseArxivId ──────────────────────────────────────────────────

describe('parseArxivId', () => {
  describe('new format IDs (post-2007)', () => {
    it('parses bare ID without version', () => {
      const result = parseArxivId('2301.07041')
      expect(result.baseId).toBe('2301.07041')
      expect(result.version).toBeNull()
      expect(result.id).toBe('2301.07041')
    })

    it('parses bare ID with version', () => {
      const result = parseArxivId('2301.07041v2')
      expect(result.baseId).toBe('2301.07041')
      expect(result.version).toBe(2)
      expect(result.id).toBe('2301.07041v2')
    })

    it('parses 5-digit IDs', () => {
      const result = parseArxivId('2301.12345')
      expect(result.baseId).toBe('2301.12345')
      expect(result.version).toBeNull()
    })
  })

  describe('old format IDs (pre-2007)', () => {
    it('parses old-style IDs', () => {
      const result = parseArxivId('cs/0601078')
      expect(result.baseId).toBe('cs/0601078')
      expect(result.version).toBeNull()
    })

    it('parses old-style IDs with version', () => {
      const result = parseArxivId('hep-th/9901001v3')
      expect(result.baseId).toBe('hep-th/9901001')
      expect(result.version).toBe(3)
    })
  })

  describe('URL parsing', () => {
    it('parses abs URL', () => {
      const result = parseArxivId('https://arxiv.org/abs/2301.07041')
      expect(result.baseId).toBe('2301.07041')
      expect(result.version).toBeNull()
    })

    it('parses abs URL with version', () => {
      const result = parseArxivId('https://arxiv.org/abs/2301.07041v2')
      expect(result.baseId).toBe('2301.07041')
      expect(result.version).toBe(2)
    })

    it('parses pdf URL', () => {
      const result = parseArxivId('https://arxiv.org/pdf/2301.07041.pdf')
      expect(result.baseId).toBe('2301.07041')
    })

    it('parses pdf URL without .pdf extension', () => {
      const result = parseArxivId('https://arxiv.org/pdf/2301.07041v2')
      expect(result.baseId).toBe('2301.07041')
      expect(result.version).toBe(2)
    })

    it('parses e-print URL', () => {
      const result = parseArxivId('https://arxiv.org/e-print/2301.07041')
      expect(result.baseId).toBe('2301.07041')
    })

    it('parses export.arxiv.org URL', () => {
      const result = parseArxivId('https://export.arxiv.org/abs/2301.07041')
      expect(result.baseId).toBe('2301.07041')
    })

    it('parses ar5iv URL', () => {
      const result = parseArxivId('https://ar5iv.labs.arxiv.org/html/2301.07041')
      expect(result.baseId).toBe('2301.07041')
    })

    it('parses http (non-https) URL', () => {
      const result = parseArxivId('http://arxiv.org/abs/2301.07041')
      expect(result.baseId).toBe('2301.07041')
    })

    it('parses old-format URL', () => {
      const result = parseArxivId('https://arxiv.org/abs/cs/0601078')
      expect(result.baseId).toBe('cs/0601078')
    })
  })

  describe('edge cases', () => {
    it('trims whitespace', () => {
      const result = parseArxivId('  2301.07041  ')
      expect(result.baseId).toBe('2301.07041')
    })

    it('throws for invalid input', () => {
      expect(() => parseArxivId('not-an-id')).toThrow('Cannot parse arXiv ID')
    })

    it('throws for empty string', () => {
      expect(() => parseArxivId('')).toThrow('Cannot parse arXiv ID')
    })

    it('throws for random URL', () => {
      expect(() => parseArxivId('https://google.com/2301.07041')).toThrow('Cannot parse arXiv ID')
    })
  })
})

// ─── isArxivReference ──────────────────────────────────────────────

describe('isArxivReference', () => {
  it('returns true for valid IDs', () => {
    expect(isArxivReference('2301.07041')).toBe(true)
    expect(isArxivReference('2301.07041v2')).toBe(true)
    expect(isArxivReference('https://arxiv.org/abs/2301.07041')).toBe(true)
  })

  it('returns false for invalid inputs', () => {
    expect(isArxivReference('not-an-id')).toBe(false)
    expect(isArxivReference('')).toBe(false)
    expect(isArxivReference('https://google.com')).toBe(false)
  })
})

// ─── URL builders ──────────────────────────────────────────────────

describe('URL builders', () => {
  const paperId = parseArxivId('2301.07041v2')
  const paperIdNoVersion = parseArxivId('2301.07041')

  it('buildMetadataUrl returns API query URL', () => {
    expect(buildMetadataUrl(paperId)).toBe('https://export.arxiv.org/api/query?id_list=2301.07041')
  })

  it('buildSourceUrl includes version', () => {
    expect(buildSourceUrl(paperId)).toBe('https://arxiv.org/e-print/2301.07041v2')
  })

  it('buildSourceUrl without version', () => {
    expect(buildSourceUrl(paperIdNoVersion)).toBe('https://arxiv.org/e-print/2301.07041')
  })

  it('buildPdfUrl includes version', () => {
    expect(buildPdfUrl(paperId)).toBe('https://arxiv.org/pdf/2301.07041v2')
  })

  it('buildAbstractUrl includes version', () => {
    expect(buildAbstractUrl(paperId)).toBe('https://arxiv.org/abs/2301.07041v2')
  })
})

// ─── parseArxivAtomResponse ────────────────────────────────────────

describe('parseArxivAtomResponse', () => {
  // Realistic arXiv Atom API response
  const SAMPLE_ATOM_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link href="http://arxiv.org/api/query?search_query=&amp;id_list=2301.07041" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=&amp;id_list=2301.07041</title>
  <id>http://arxiv.org/api/query?search_query=&amp;id_list=2301.07041</id>
  <updated>2023-01-17T00:00:00-05:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2301.07041v1</id>
    <updated>2023-01-17T18:58:29Z</updated>
    <published>2023-01-17T18:58:29Z</published>
    <title>Understanding Large Language Models: A Comprehensive Survey</title>
    <summary>  This paper provides a comprehensive survey of large language models (LLMs),
covering their architecture, training methods, and applications.
We review the key developments from GPT to modern instruction-tuned models
and discuss their implications for AI research.</summary>
    <author>
      <name>Alice Smith</name>
      <arxiv:affiliation xmlns:arxiv="http://arxiv.org/schemas/atom">Stanford University</arxiv:affiliation>
    </author>
    <author>
      <name>Bob Johnson</name>
    </author>
    <author>
      <name>Charlie Brown</name>
    </author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1234/example.2023</arxiv:doi>
    <link href="http://arxiv.org/abs/2301.07041v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2301.07041v1" rel="related" type="application/pdf"/>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">42 pages, 15 figures</arxiv:comment>
    <arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">Nature Machine Intelligence, 2023</arxiv:journal_ref>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`

  it('parses basic metadata correctly', () => {
    const result = parseArxivAtomResponse(SAMPLE_ATOM_RESPONSE)
    expect(result.baseId).toBe('2301.07041')
    expect(result.version).toBe(1)
    expect(result.id).toBe('2301.07041v1')
  })

  it('parses title correctly (collapses whitespace)', () => {
    const result = parseArxivAtomResponse(SAMPLE_ATOM_RESPONSE)
    expect(result.title).toBe('Understanding Large Language Models: A Comprehensive Survey')
  })

  it('parses abstract correctly', () => {
    const result = parseArxivAtomResponse(SAMPLE_ATOM_RESPONSE)
    expect(result.abstract).toContain('comprehensive survey of large language models')
    expect(result.abstract).not.toContain('\n') // Newlines should be collapsed
  })

  it('parses authors correctly', () => {
    const result = parseArxivAtomResponse(SAMPLE_ATOM_RESPONSE)
    expect(result.authors).toHaveLength(3)
    expect(result.authors[0]).toEqual({ name: 'Alice Smith', affiliation: 'Stanford University' })
    expect(result.authors[1]).toEqual({ name: 'Bob Johnson', affiliation: undefined })
    expect(result.authors[2]).toEqual({ name: 'Charlie Brown', affiliation: undefined })
  })

  it('parses categories correctly', () => {
    const result = parseArxivAtomResponse(SAMPLE_ATOM_RESPONSE)
    expect(result.categories.length).toBeGreaterThanOrEqual(3)
    expect(result.primaryCategory).toBe('cs.CL')

    const primaryCat = result.categories.find((c) => c.term === 'cs.CL')
    expect(primaryCat?.isPrimary).toBe(true)
  })

  it('parses optional fields correctly', () => {
    const result = parseArxivAtomResponse(SAMPLE_ATOM_RESPONSE)
    expect(result.doi).toBe('10.1234/example.2023')
    expect(result.journalRef).toBe('Nature Machine Intelligence, 2023')
    expect(result.comment).toBe('42 pages, 15 figures')
  })

  it('parses dates correctly', () => {
    const result = parseArxivAtomResponse(SAMPLE_ATOM_RESPONSE)
    expect(result.published).toBe('2023-01-17T18:58:29Z')
    expect(result.updated).toBe('2023-01-17T18:58:29Z')
  })

  it('generates correct URLs', () => {
    const result = parseArxivAtomResponse(SAMPLE_ATOM_RESPONSE)
    expect(result.abstractUrl).toBe('https://arxiv.org/abs/2301.07041v1')
    expect(result.pdfUrl).toBe('https://arxiv.org/pdf/2301.07041v1')
  })

  it('throws for empty results', () => {
    const emptyResponse = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults>
</feed>`

    expect(() => parseArxivAtomResponse(emptyResponse)).toThrow('Paper not found')
  })

  it('throws for response without entry', () => {
    const noEntryResponse = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:totalResults>
</feed>`

    expect(() => parseArxivAtomResponse(noEntryResponse)).toThrow('No entry found')
  })
})

// ─── parseLatexFigures ─────────────────────────────────────────────

describe('parseLatexFigures', () => {
  it('parses simple \\includegraphics', () => {
    const tex = `\\includegraphics{fig1.png}`
    const result = parseLatexFigures(tex)
    expect(result).toHaveLength(1)
    expect(result[0].includePath).toBe('fig1.png')
  })

  it('parses \\includegraphics with options', () => {
    const tex = `\\includegraphics[width=0.5\\textwidth]{figures/overview.pdf}`
    const result = parseLatexFigures(tex)
    expect(result).toHaveLength(1)
    expect(result[0].includePath).toBe('figures/overview.pdf')
    expect(result[0].options).toBe('width=0.5\\textwidth')
  })

  it('extracts caption and label from figure environment', () => {
    const tex = `
\\begin{figure}[t]
  \\centering
  \\includegraphics[width=\\linewidth]{architecture.png}
  \\caption{System architecture overview showing the main components.}
  \\label{fig:architecture}
\\end{figure}`

    const result = parseLatexFigures(tex)
    expect(result).toHaveLength(1)
    expect(result[0].includePath).toBe('architecture.png')
    expect(result[0].caption).toContain('System architecture overview')
    expect(result[0].label).toBe('fig:architecture')
  })

  it('handles multiple figures', () => {
    const tex = `
\\begin{figure}
  \\includegraphics{fig1.png}
  \\caption{First figure}
  \\label{fig:one}
\\end{figure}

\\begin{figure}
  \\includegraphics{fig2.png}
  \\caption{Second figure}
  \\label{fig:two}
\\end{figure}`

    const result = parseLatexFigures(tex)
    expect(result).toHaveLength(2)
    expect(result[0].includePath).toBe('fig1.png')
    expect(result[1].includePath).toBe('fig2.png')
  })

  it('handles includegraphics without figure environment', () => {
    const tex = `Some text \\includegraphics{inline.png} more text`
    const result = parseLatexFigures(tex)
    expect(result).toHaveLength(1)
    expect(result[0].includePath).toBe('inline.png')
    expect(result[0].caption).toBeUndefined()
    expect(result[0].label).toBeUndefined()
  })

  it('handles paths without extensions', () => {
    const tex = `\\includegraphics{figures/plot}`
    const result = parseLatexFigures(tex)
    expect(result).toHaveLength(1)
    expect(result[0].includePath).toBe('figures/plot')
  })

  it('returns empty for tex without figures', () => {
    const tex = `\\section{Introduction}\nThis paper discusses...\n`
    const result = parseLatexFigures(tex)
    expect(result).toHaveLength(0)
  })
})

// ─── extractLatexText ──────────────────────────────────────────────

describe('extractLatexText', () => {
  it('strips comments', () => {
    const tex = `Hello world % this is a comment\nMore text`
    const result = extractLatexText(tex)
    expect(result).toContain('Hello world')
    expect(result).not.toContain('this is a comment')
  })

  it('preserves section titles', () => {
    const tex = `\\section{Introduction}\nSome content here.`
    const result = extractLatexText(tex)
    expect(result).toContain('Introduction')
    expect(result).toContain('Some content here')
  })

  it('strips formatting commands but keeps content', () => {
    const tex = `This is \\textbf{bold} and \\textit{italic} text.`
    const result = extractLatexText(tex)
    expect(result).toContain('bold')
    expect(result).toContain('italic')
    expect(result).not.toContain('\\textbf')
    expect(result).not.toContain('\\textit')
  })

  it('removes figure environments', () => {
    const tex = `Text before.
\\begin{figure}[h]
\\includegraphics{fig.png}
\\caption{A figure}
\\end{figure}
Text after.`
    const result = extractLatexText(tex)
    expect(result).toContain('Text before')
    expect(result).toContain('Text after')
    expect(result).not.toContain('includegraphics')
    expect(result).not.toContain('A figure')
  })

  it('replaces math with placeholders', () => {
    const tex = `The equation $E = mc^2$ is famous. And also: $$\\int_0^1 f(x) dx$$`
    const result = extractLatexText(tex)
    expect(result).toContain('[math]')
    expect(result).toContain('[equation]')
  })

  it('removes preamble commands', () => {
    const tex = `\\documentclass{article}
\\usepackage{amsmath}
\\begin{document}
Hello
\\end{document}`
    const result = extractLatexText(tex)
    expect(result).toContain('Hello')
    expect(result).not.toContain('documentclass')
    expect(result).not.toContain('usepackage')
  })
})
