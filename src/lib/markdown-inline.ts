import { createElement } from "react"

/**
 * Render inline markdown as styled elements.
 *
 * Supported syntax:
 * - `code` → <code> with muted background
 * - {{path}} → <code> with distinct path styling (amber/orange tint)
 */
export function renderMarkdownInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Find the next marker: either {{ or `
    const pathStart = remaining.indexOf("{{")
    const codeStart = remaining.indexOf("`")

    // No markers left — push remaining text and done
    if (pathStart === -1 && codeStart === -1) {
      parts.push(remaining)
      break
    }

    // Pick the earlier marker
    const usePathMarker = pathStart !== -1 && (codeStart === -1 || pathStart < codeStart)

    if (usePathMarker) {
      const end = remaining.indexOf("}}", pathStart + 2)
      if (end === -1) {
        parts.push(remaining)
        break
      }
      if (pathStart > 0) {
        parts.push(remaining.slice(0, pathStart))
      }
      parts.push(
        createElement(
          "code",
          { key: key++, className: "rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 px-1 py-0.5 text-[11px] font-mono" },
          remaining.slice(pathStart + 2, end),
        )
      )
      remaining = remaining.slice(end + 2)
    } else {
      const end = remaining.indexOf("`", codeStart + 1)
      if (end === -1) {
        parts.push(remaining)
        break
      }
      if (codeStart > 0) {
        parts.push(remaining.slice(0, codeStart))
      }
      parts.push(
        createElement(
          "code",
          { key: key++, className: "rounded bg-muted px-1 py-0.5 text-[11px] font-mono" },
          remaining.slice(codeStart + 1, end),
        )
      )
      remaining = remaining.slice(end + 1)
    }
  }

  return parts
}
