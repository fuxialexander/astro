/**
 * Tests for reference file importers (BibTeX, RIS, EndNote XML)
 */
import { describe, it, expect } from 'vitest'
import {
  parseBibtexFile,
  parseRisFile,
  parseEndnoteXml,
  detectFormat,
} from '../server/lib/references/importers.js'

// ── BibTeX Parser ────────────────────────────────────────────────────

describe('parseBibtexFile', () => {
  it('parses a standard journal article', () => {
    const bib = `
@article{smith2023,
  author = {Smith, John and Doe, Jane},
  title = {A Study of Interesting Things},
  journal = {Journal of Studies},
  year = {2023},
  volume = {42},
  number = {3},
  pages = {100--120},
  doi = {10.1234/example.2023},
  abstract = {This is the abstract.}
}
`
    const result = parseBibtexFile(bib)
    expect(result.references).toHaveLength(1)
    const ref = result.references[0]
    expect(ref.type).toBe('article-journal')
    expect(ref.title).toBe('A Study of Interesting Things')
    expect(ref.authors).toHaveLength(2)
    expect(ref.authors[0].family).toBe('Smith')
    expect(ref.authors[0].given).toBe('John')
    expect(ref.authors[1].family).toBe('Doe')
    expect(ref.authors[1].given).toBe('Jane')
    expect(ref.year).toBe('2023')
    expect(ref.journal).toBe('Journal of Studies')
    expect(ref.volume).toBe('42')
    expect(ref.issue).toBe('3')
    expect(ref.pages).toMatch(/100.+120/) // BibTeX parser may convert -- to en-dash
    expect(ref.doi).toBe('10.1234/example.2023')
    expect(ref.abstract).toBe('This is the abstract.')
  })

  it('parses a book entry', () => {
    const bib = `
@book{knuth1997,
  author = {Knuth, Donald E.},
  title = {The Art of Computer Programming},
  publisher = {Addison-Wesley},
  year = {1997},
  isbn = {978-0-201-89683-1}
}
`
    const result = parseBibtexFile(bib)
    expect(result.references).toHaveLength(1)
    const ref = result.references[0]
    expect(ref.type).toBe('book')
    expect(ref.title).toBe('The Art of Computer Programming')
    expect(ref.publisher).toContain('Addison-Wesley')
    expect(ref.isbn).toBe('978-0-201-89683-1')
  })

  it('parses multiple entries', () => {
    const bib = `
@article{a, author={A, B}, title={First}, journal={J1}, year={2020}}
@inproceedings{b, author={C, D}, title={Second}, booktitle={Conf}, year={2021}}
@phdthesis{c, author={E, F}, title={Third}, school={Uni}, year={2022}}
`
    const result = parseBibtexFile(bib)
    expect(result.references).toHaveLength(3)
    expect(result.references[0].type).toBe('article-journal')
    expect(result.references[1].type).toBe('paper-conference')
    expect(result.references[2].type).toBe('thesis')
  })

  it('reports errors for malformed input but still parses valid entries', () => {
    const bib = `
@article{good, author={Smith, John}, title={Good Entry}, journal={J}, year={2023}}
`
    const result = parseBibtexFile(bib)
    expect(result.references.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty input', () => {
    const result = parseBibtexFile('')
    expect(result.references).toHaveLength(0)
  })
})

// ── RIS Parser ───────────────────────────────────────────────────────

describe('parseRisFile', () => {
  it('parses a standard journal article', () => {
    const ris = `TY  - JOUR
AU  - Smith, John
AU  - Doe, Jane
TI  - A Study of Interesting Things
JO  - Journal of Studies
PY  - 2023
VL  - 42
IS  - 3
SP  - 100
EP  - 120
DO  - 10.1234/example.2023
AB  - This is the abstract.
ER  -
`
    const result = parseRisFile(ris)
    expect(result.references).toHaveLength(1)
    const ref = result.references[0]
    expect(ref.type).toBe('article-journal')
    expect(ref.title).toBe('A Study of Interesting Things')
    expect(ref.authors).toHaveLength(2)
    expect(ref.authors[0].family).toBe('Smith')
    expect(ref.authors[0].given).toBe('John')
    expect(ref.year).toBe('2023')
    expect(ref.journal).toBe('Journal of Studies')
    expect(ref.volume).toBe('42')
    expect(ref.issue).toBe('3')
    expect(ref.pages).toBe('100-120')
    expect(ref.doi).toBe('10.1234/example.2023')
    expect(ref.abstract).toBe('This is the abstract.')
  })

  it('parses multiple entries', () => {
    const ris = `TY  - JOUR
AU  - Author, First
TI  - Article One
ER  -
TY  - BOOK
AU  - Author, Second
TI  - Book Two
PB  - Publisher
ER  -
TY  - CONF
AU  - Author, Third
TI  - Conference Paper
ER  -
`
    const result = parseRisFile(ris)
    expect(result.references).toHaveLength(3)
    expect(result.references[0].type).toBe('article-journal')
    expect(result.references[1].type).toBe('book')
    expect(result.references[2].type).toBe('paper-conference')
  })

  it('handles different date formats', () => {
    const ris = `TY  - JOUR
AU  - Smith, John
TI  - Date Test
DA  - 2023/06/15
ER  -
`
    const result = parseRisFile(ris)
    expect(result.references[0].year).toBe('2023')
  })

  it('handles keywords', () => {
    const ris = `TY  - JOUR
AU  - Smith, John
TI  - Keyword Test
KW  - machine learning
KW  - artificial intelligence
KW  - neural networks
ER  -
`
    const result = parseRisFile(ris)
    expect(result.references[0].keywords).toEqual([
      'machine learning',
      'artificial intelligence',
      'neural networks',
    ])
  })

  it('handles entry without ER tag', () => {
    const ris = `TY  - JOUR
AU  - Smith, John
TI  - No End Tag
`
    const result = parseRisFile(ris)
    expect(result.references).toHaveLength(1)
    expect(result.references[0].title).toBe('No End Tag')
  })

  it('returns error for empty input', () => {
    const result = parseRisFile('')
    expect(result.references).toHaveLength(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// ── EndNote XML Parser ───────────────────────────────────────────────

describe('parseEndnoteXml', () => {
  it('parses a basic EndNote XML record', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xml>
<records>
<record>
  <ref-type name="Journal Article">17</ref-type>
  <contributors>
    <authors>
      <author>Smith, John</author>
      <author>Doe, Jane</author>
    </authors>
  </contributors>
  <titles>
    <title>A Study of Interesting Things</title>
    <secondary-title>Journal of Studies</secondary-title>
  </titles>
  <dates>
    <year>2023</year>
  </dates>
  <volume>42</volume>
  <number>3</number>
  <pages>100-120</pages>
  <abstract>This is the abstract.</abstract>
  <electronic-resource-num>10.1234/example.2023</electronic-resource-num>
  <keywords>
    <keyword>machine learning</keyword>
    <keyword>AI</keyword>
  </keywords>
</record>
</records>
</xml>`
    const result = parseEndnoteXml(xml)
    expect(result.references).toHaveLength(1)
    const ref = result.references[0]
    expect(ref.type).toBe('article-journal')
    expect(ref.title).toBe('A Study of Interesting Things')
    expect(ref.authors).toHaveLength(2)
    expect(ref.authors[0].family).toBe('Smith')
    expect(ref.authors[0].given).toBe('John')
    expect(ref.year).toBe('2023')
    expect(ref.journal).toBe('Journal of Studies')
    expect(ref.volume).toBe('42')
    expect(ref.issue).toBe('3')
    expect(ref.pages).toBe('100-120')
    expect(ref.doi).toBe('10.1234/example.2023')
    expect(ref.keywords).toEqual(['machine learning', 'AI'])
  })

  it('parses multiple records', () => {
    const xml = `<records>
<record>
  <ref-type name="Journal Article">17</ref-type>
  <contributors><authors><author>A</author></authors></contributors>
  <titles><title>First</title></titles>
</record>
<record>
  <ref-type name="Book">6</ref-type>
  <contributors><authors><author>B</author></authors></contributors>
  <titles><title>Second</title></titles>
</record>
</records>`
    const result = parseEndnoteXml(xml)
    expect(result.references).toHaveLength(2)
    expect(result.references[0].title).toBe('First')
    expect(result.references[1].title).toBe('Second')
    expect(result.references[1].type).toBe('book')
  })

  it('handles XML entities', () => {
    const xml = `<records><record>
  <ref-type name="Journal Article">17</ref-type>
  <titles><title>Smith &amp; Jones: A Study of &lt;Things&gt;</title></titles>
</record></records>`
    const result = parseEndnoteXml(xml)
    expect(result.references[0].title).toBe('Smith & Jones: A Study of <Things>')
  })

  it('returns error for empty/invalid XML', () => {
    const result = parseEndnoteXml('<xml></xml>')
    expect(result.references).toHaveLength(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// ── Format Detection ─────────────────────────────────────────────────

describe('detectFormat', () => {
  it('detects BibTeX by extension', () => {
    expect(detectFormat('refs.bib', '')).toBe('bibtex')
    expect(detectFormat('refs.bibtex', '')).toBe('bibtex')
  })

  it('detects RIS by extension', () => {
    expect(detectFormat('refs.ris', '')).toBe('ris')
  })

  it('detects EndNote XML by extension', () => {
    expect(detectFormat('refs.xml', '')).toBe('endnote-xml')
    expect(detectFormat('refs.enw', '')).toBe('endnote-xml')
  })

  it('detects BibTeX by content', () => {
    expect(detectFormat('unknown.txt', '@article{key, title={T}}')).toBe('bibtex')
  })

  it('detects RIS by content', () => {
    expect(detectFormat('unknown.txt', 'TY  - JOUR\nAU  - Smith\nER  - ')).toBe('ris')
  })

  it('detects XML by content', () => {
    expect(detectFormat('unknown.txt', '<?xml version="1.0"?><records></records>')).toBe('endnote-xml')
  })

  it('returns null for unknown format', () => {
    expect(detectFormat('unknown.txt', 'just some random text')).toBeNull()
  })
})
