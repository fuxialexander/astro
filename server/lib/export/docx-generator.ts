import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  NumberFormat,
  UnderlineType,
} from 'docx'
import type { Reference } from '@astro/core/types'

export interface DocxExportOptions {
  title: string
  description?: string
  citationStyle?: string
  references: Reference[]
}

/** Strip HTML tags and decode common entities */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** Format a reference as plain text bibliography entry */
function formatRef(ref: Reference, style: string, index: number): string {
  const authors = (ref.authors ?? []).join(', ')
  const year = ref.year ?? ''
  const title = ref.title ?? ''
  const venue = ref.venue ?? ''

  switch (style) {
    case 'ieee':
      return `[${index}] ${authors}, "${title}," ${venue ? `*${venue}*, ` : ''}${year}.${ref.doi ? ` doi: ${ref.doi}.` : ''}`
    case 'nature':
      return `${authors}. ${title}. ${venue ? `*${venue}* ` : ''}(${year}).${ref.doi ? ` https://doi.org/${ref.doi}` : ''}`
    case 'chicago':
      return `${authors}. ${year}. "${title}." ${venue ? `*${venue}*.` : ''}${ref.doi ? ` https://doi.org/${ref.doi}.` : ''}`
    case 'apa':
    default:
      return `${authors} (${year}). ${title}. ${venue ? `*${venue}*.` : ''}${ref.doi ? ` https://doi.org/${ref.doi}` : ''}`
  }
}

/** Replace [@key] markers with inline citation text */
function resolveInlineCitations(
  text: string,
  refs: Reference[],
  style: string,
): string {
  const byKey = new Map(refs.map(r => [r.id, r]))
  return text.replace(/\[(@[\w-]+(?:\s*;\s*@[\w-]+)*)\]/g, (_, inner: string) => {
    const keys = inner.split(';').map((k: string) => k.trim().replace(/^@/, ''))
    if (style === 'ieee' || style === 'nature') {
      // numeric style: [1,2]
      const nums = keys.map(k => {
        const idx = refs.findIndex(r => r.id === k)
        return idx >= 0 ? String(idx + 1) : '?'
      })
      return `[${nums.join(',')}]`
    }
    // author-date style: (Smith, 2024; Jones, 2023)
    const parts = keys.map(k => {
      const ref = byKey.get(k)
      if (!ref) return `?`
      const first = ref.authors?.[0]?.split(',')[0] ?? 'Unknown'
      return `${first}, ${ref.year}`
    })
    return `(${parts.join('; ')})`
  })
}

/** Build docx Paragraph nodes from a plain-text block */
function textToParagraphs(text: string): Paragraph[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => new Paragraph({
      children: [new TextRun({ text: line, size: 24, font: 'Times New Roman' })],
      spacing: { after: 160 },
    }))
}

export async function generateDocx(opts: DocxExportOptions): Promise<Buffer> {
  const style = opts.citationStyle ?? 'apa'
  const refs = opts.references

  const children: Paragraph[] = []

  // Title
  children.push(new Paragraph({
    text: opts.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }))

  // Description / body
  if (opts.description) {
    const plain = stripHtml(opts.description)
    const resolved = resolveInlineCitations(plain, refs, style)
    children.push(...textToParagraphs(resolved))
  }

  // Bibliography section
  if (refs.length > 0) {
    children.push(new Paragraph({
      text: '',
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC', space: 1 } },
    }))
    children.push(new Paragraph({
      text: 'References',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    }))

    refs.forEach((ref, i) => {
      const entry = formatRef(ref, style, i + 1)
      children.push(new Paragraph({
        children: [new TextRun({ text: entry, size: 22, font: 'Times New Roman' })],
        spacing: { after: 120 },
        indent: { left: 720, hanging: 720 },
      }))
    })
  }

  const doc = new Document({
    sections: [{ children }],
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 24 },
        },
      },
    },
  })

  return Packer.toBuffer(doc)
}
