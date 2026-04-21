/** Extract [@key] cite keys from text — mirrors src/lib/citation/parser.ts */
export function extractCiteKeys(text: string): string[] {
  const keys: string[] = []
  const re = /\[(@[\w-]+(?:\s*;\s*@[\w-]+)*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    for (const part of m[1].split(';')) {
      const k = part.trim().replace(/^@/, '')
      if (k) keys.push(k)
    }
  }
  return keys
}
