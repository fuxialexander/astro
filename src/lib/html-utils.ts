/**
 * Strip HTML tags and return plain text.
 * Handles list items with newlines and removes images.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return ''

  return html
    // Replace block elements with newlines
    .replace(/<\/?(p|div|br|h[1-6]|blockquote|pre)[^>]*>/gi, '\n')
    // Replace list items with newlines
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/li>/gi, '')
    // Remove images entirely
    .replace(/<img[^>]*>/gi, '')
    // Remove all remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extract blob IDs from <img src="/api/data/blobs/{id}"> tags in HTML content.
 */
export function extractBlobUrls(html: string | null | undefined): string[] {
  if (!html) return []

  const regex = /\/api\/data\/blobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  const ids: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(html)) !== null) {
    ids.push(match[1])
  }

  return ids
}

/**
 * Convert a File object to a base64 string.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
