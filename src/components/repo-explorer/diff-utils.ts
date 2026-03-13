export interface DiffLine {
  type: "add" | "remove" | "context" | "header"
  content: string
  oldLineNum?: number
  newLineNum?: number
}

export function parsePatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      lines.push({ type: "header", content: raw })
    } else if (raw.startsWith("+")) {
      lines.push({ type: "add", content: raw.slice(1), newLineNum: newLine })
      newLine++
    } else if (raw.startsWith("-")) {
      lines.push({ type: "remove", content: raw.slice(1), oldLineNum: oldLine })
      oldLine++
    } else {
      const content = raw.startsWith(" ") ? raw.slice(1) : raw
      lines.push({ type: "context", content, oldLineNum: oldLine, newLineNum: newLine })
      oldLine++
      newLine++
    }
  }

  return lines
}
