/**
 * CrossRef abstract enrichment.
 *
 * For references that have a DOI but no abstract, fetch metadata from
 * CrossRef (public API, no auth required) and return the abstract.
 */

/** Strip JATS XML tags from CrossRef abstract strings. */
function stripJats(html: string): string {
  return html
    .replace(/<jats:[^>]+>/g, '')
    .replace(/<\/jats:[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fetch the abstract for a DOI from CrossRef. Returns null on any failure. */
export async function fetchAbstractFromCrossRef(doi: string): Promise<string | null> {
  try {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Astro/1.0 (https://astroanywhere.com; mailto:hi@astroanywhere.com)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json() as { message?: { abstract?: string } }
    const raw = data?.message?.abstract
    if (!raw) return null
    return stripJats(raw)
  } catch {
    return null
  }
}

/** Enrich a batch of references: fetch missing abstracts in parallel. */
export async function enrichAbstracts<T extends { doi?: string; abstract?: string }>(
  refs: T[],
): Promise<T[]> {
  const needsAbstract = refs.filter(r => r.doi && !r.abstract)
  if (needsAbstract.length === 0) return refs

  // Fetch in parallel, cap at 5 concurrent requests
  const chunks: (typeof needsAbstract)[] = []
  for (let i = 0; i < needsAbstract.length; i += 5) {
    chunks.push(needsAbstract.slice(i, i + 5))
  }

  const abstracts = new Map<string, string>()
  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (r) => {
        const abstract = await fetchAbstractFromCrossRef(r.doi!)
        if (abstract) abstracts.set(r.doi!, abstract)
      }),
    )
  }

  return refs.map(r => {
    if (!r.doi || r.abstract || !abstracts.has(r.doi)) return r
    return { ...r, abstract: abstracts.get(r.doi) }
  })
}
