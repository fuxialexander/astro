/**
 * Sanitize HTML content to prevent XSS attacks.
 * Strips script tags, event handlers, and dangerous protocols.
 * Used for rendering user-generated content like node.content that may
 * originate from external sources (e.g. GitHub issue sync).
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Remove dangerous elements (preserve visualise iframes)
  const dangerousTags = doc.querySelectorAll('script, iframe, object, embed, form, base, meta, link, style')
  dangerousTags.forEach((el) => {
    // Preserve iframes marked as visualise embeds
    if (el.tagName === 'IFRAME' && el.getAttribute('data-visualise') === 'true') {
      return
    }
    el.remove()
  })

  // Remove event handlers and dangerous attributes from all elements
  const allElements = doc.body.querySelectorAll('*')
  allElements.forEach((el) => {
    const attrs = Array.from(el.attributes)
    for (const attr of attrs) {
      // Remove event handlers (onclick, onerror, onload, etc.)
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name)
      }
      // Remove javascript: and data: URLs from href/src/action
      if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(attr.name)) {
        const value = attr.value.trim().toLowerCase()
        if (value.startsWith('javascript:') || value.startsWith('data:text/html') || value.startsWith('vbscript:')) {
          el.removeAttribute(attr.name)
        }
      }
    }
  })

  return doc.body.innerHTML
}
