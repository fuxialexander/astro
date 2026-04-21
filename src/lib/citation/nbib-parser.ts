import type { Reference } from './types'

/**
 * Parse NBIB (MEDLINE/PubMed) format into Reference objects.
 *
 * NBIB format: each field is "TAG - value", records end with "ER  -"
 * Common tags: PMID, TI (title), AU (author), DP (date), JT (journal),
 *   VI (volume), IP (issue), PG (pages), LID (DOI), AB (abstract)
 */
export function parseNBIB(text: string): Omit<Reference, 'id'>[] {
  const results: Omit<Reference, 'id'>[] = []
  // Split into records by "ER  -" or blank line separating records
  const records = text.split(/^ER\s*-/m).filter(r => r.trim())

  for (const record of records) {
    const fields: Record<string, string[]> = {}
    const lines = record.split('\n')

    for (const line of lines) {
      // NBIB format: "FIELD- value" or "FIELD  - value"
      const m = line.match(/^([A-Z]{2,4})\s*-\s*(.+)/)
      if (!m) continue
      const tag = m[1].trim()
      const value = m[2].trim()
      if (!fields[tag]) fields[tag] = []
      fields[tag].push(value)
    }

    const title = fields['TI']?.[0] || fields['BTI']?.[0]
    if (!title) continue

    // Authors: "Last, First" format
    const authors = (fields['AU'] || fields['FAU'] || []).map(a => a.trim()).filter(Boolean)

    // Year: from DP "2024 Jan" or "2024/01/15" or PDAT
    const dpRaw = fields['DP']?.[0] || fields['PDAT']?.[0] || ''
    const yearMatch = dpRaw.match(/(\d{4})/)
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 0

    // DOI: from LID field ending in [doi], or AID
    const doiLine = [...(fields['LID'] || []), ...(fields['AID'] || [])].find(l => l.includes('[doi]') || l.toLowerCase().includes('doi'))
    const doi = doiLine ? doiLine.replace(/\s*\[doi\]/i, '').trim() : undefined

    // PMID
    const pmid = fields['PMID']?.[0]

    const ref: Omit<Reference, 'id'> = {
      title,
      authors: authors.length > 0 ? authors : ['Unknown'],
      year: year || new Date().getFullYear(),
      venue: fields['JT']?.[0] || fields['TA']?.[0] || fields['BTI']?.[0],
      volume: fields['VI']?.[0],
      issue: fields['IP']?.[0],
      pages: fields['PG']?.[0],
      doi,
      pmid,
      abstract: fields['AB']?.join(' ').trim() || undefined,
      url: doi ? `https://doi.org/${doi}` : pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined,
      source: 'bibtex' as const,
      entryType: 'article',
    }

    results.push(ref)
  }

  return results
}
