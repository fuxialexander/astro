import { createElement } from "react"

/** Render inline markdown backticks as <code> elements */
export function renderMarkdownInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const start = remaining.indexOf("`")
    if (start === -1) {
      parts.push(remaining)
      break
    }
    const end = remaining.indexOf("`", start + 1)
    if (end === -1) {
      parts.push(remaining)
      break
    }
    if (start > 0) {
      parts.push(remaining.slice(0, start))
    }
    parts.push(
      createElement(
        "code",
        { key: key++, className: "rounded bg-muted px-1 py-0.5 text-[11px] font-mono" },
        remaining.slice(start + 1, end),
      )
    )
    remaining = remaining.slice(end + 1)
  }

  return parts
}
