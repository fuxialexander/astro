import type { Reference } from './types.js'

function stripLatex(s: string): string {
  return s
    .replace(/\{\\[^}]*\}/g, m => {
      const ch = m.match(/[a-zA-Z](?=[^a-zA-Z]*\})$/)
      return ch ? ch[0] : ''
    })
    .replace(/\{([^{}]*)\}/g, '$1')
    .trim()
}

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

function parseBibFields(fieldsStr: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let i = 0
  while (i < fieldsStr.length) {
    while (i < fieldsStr.length && /[\s,]/.test(fieldsStr[i])) i++
    if (i >= fieldsStr.length) break
    const nameMatch = fieldsStr.slice(i).match(/^(\w+)\s*=\s*/)
    if (!nameMatch) break
    const fieldName = nameMatch[1].toLowerCase()
    i += nameMatch[0].length
    if (i >= fieldsStr.length) break
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
      const bare = fieldsStr.slice(i).match(/^([^\s,}]+)/)
      if (bare) { value = bare[1]; i += bare[0].length }
    }
    fields[fieldName] = value.trim()
  }
  return fields
}

/** Parse BibTeX text into Reference objects */
export function parseBibTeX(bibtex: string): Array<Omit<Reference, 'id'> & { citeKey: string }> {
  const results: Array<Omit<Reference, 'id'> & { citeKey: string }> = []
  let i = 0
  while (i < bibtex.length) {
    const atIdx = bibtex.indexOf('@', i)
    if (atIdx === -1) break
    const typeMatch = bibtex.slice(atIdx).match(/^@(\w+)\s*\{/)
    if (!typeMatch) { i = atIdx + 1; continue }
    const entryType = typeMatch[1].toLowerCase()
    const openBrace = atIdx + typeMatch[0].length - 1
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
