import { describe, expect, it } from 'vitest'
import { parsePatch } from '../diff-utils'
import type { DiffLine } from '../diff-utils'

describe('parsePatch – extended edge cases', () => {
  it('handles a real-world GitHub patch with function context in hunk header', () => {
    const patch = [
      '@@ -42,7 +42,8 @@ export function RepoExplorer({ project }: RepoExplorerProps) {',
      '   const [loading, setLoading] = useState(false)',
      '   const [error, setError] = useState<string | null>(null)',
      '-  const [query, setQuery] = useState("")',
      '+  const [query, setQuery] = useState("")  ',
      '+  const [expandedPr, setExpandedPr] = useState<number | null>(null)',
      '   const nodes = usePlanStore((s) => s.nodes.filter(isLive))',
      '   const executions = useExecutionStore((s) => s.executions)',
      '   const addToast = useToastStore((s) => s.add)',
    ].join('\n')

    const lines = parsePatch(patch)

    expect(lines[0].type).toBe('header')
    expect(lines[0].content).toContain('export function RepoExplorer')

    // Context lines have both line numbers
    expect(lines[1]).toMatchObject({ type: 'context', oldLineNum: 42, newLineNum: 42 })
    expect(lines[2]).toMatchObject({ type: 'context', oldLineNum: 43, newLineNum: 43 })

    // Removal then additions
    expect(lines[3]).toMatchObject({ type: 'remove', oldLineNum: 44 })
    expect(lines[4]).toMatchObject({ type: 'add', newLineNum: 44 })
    expect(lines[5]).toMatchObject({ type: 'add', newLineNum: 45 })

    // Following context continues correctly
    expect(lines[6]).toMatchObject({ type: 'context', oldLineNum: 45, newLineNum: 46 })
  })

  it('handles consecutive hunk headers without any lines between them', () => {
    const patch = '@@ -1,0 +1,0 @@\n@@ -5,1 +5,1 @@\n-old\n+new'
    const lines = parsePatch(patch)

    const headers = lines.filter((l) => l.type === 'header')
    expect(headers).toHaveLength(2)
  })

  it('preserves whitespace in content lines', () => {
    const patch = '@@ -1,2 +1,2 @@\n-  indented old\n+  indented new'
    const lines = parsePatch(patch)

    // After stripping the +/- prefix, content should keep leading spaces
    expect(lines[1].content).toBe('  indented old')
    expect(lines[2].content).toBe('  indented new')
  })

  it('handles patch with only context lines (no changes)', () => {
    const patch = '@@ -10,3 +10,3 @@\n line A\n line B\n line C'
    const lines = parsePatch(patch)

    const body = lines.filter((l) => l.type !== 'header')
    expect(body).toHaveLength(3)
    expect(body.every((l) => l.type === 'context')).toBe(true)
    expect(body[0]).toMatchObject({ oldLineNum: 10, newLineNum: 10 })
    expect(body[2]).toMatchObject({ oldLineNum: 12, newLineNum: 12 })
  })

  it('handles large line numbers', () => {
    const patch = '@@ -9999,1 +10001,1 @@\n-old at 9999\n+new at 10001'
    const lines = parsePatch(patch)

    expect(lines[1]).toMatchObject({ type: 'remove', oldLineNum: 9999 })
    expect(lines[2]).toMatchObject({ type: 'add', newLineNum: 10001 })
  })

  it('handles patch with trailing newline', () => {
    const patch = '@@ -1,1 +1,1 @@\n-old\n+new\n'
    const lines = parsePatch(patch)

    // The trailing newline creates an empty context line
    const adds = lines.filter((l) => l.type === 'add')
    const removes = lines.filter((l) => l.type === 'remove')
    expect(adds).toHaveLength(1)
    expect(removes).toHaveLength(1)
  })

  it('handles binary file notice (no standard diff lines)', () => {
    const patch = 'Binary files differ'
    const lines = parsePatch(patch)

    // Should produce a single context line
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('context')
    expect(lines[0].content).toBe('Binary files differ')
  })

  it('correctly handles the +0 start line (new file)', () => {
    const patch = '@@ -0,0 +1,2 @@\n+first\n+second'
    const lines = parsePatch(patch)

    expect(lines[1]).toEqual<DiffLine>({ type: 'add', content: 'first', newLineNum: 1 })
    expect(lines[2]).toEqual<DiffLine>({ type: 'add', content: 'second', newLineNum: 2 })
  })

  it('handles three consecutive hunks', () => {
    const patch = [
      '@@ -1,1 +1,1 @@',
      '-a',
      '+A',
      '@@ -10,1 +10,1 @@',
      '-b',
      '+B',
      '@@ -20,1 +20,1 @@',
      '-c',
      '+C',
    ].join('\n')

    const lines = parsePatch(patch)
    const headers = lines.filter((l) => l.type === 'header')
    const adds = lines.filter((l) => l.type === 'add')
    const removes = lines.filter((l) => l.type === 'remove')

    expect(headers).toHaveLength(3)
    expect(adds).toHaveLength(3)
    expect(removes).toHaveLength(3)

    // Check last hunk's line numbers
    expect(lines[7]).toMatchObject({ type: 'remove', oldLineNum: 20, content: 'c' })
    expect(lines[8]).toMatchObject({ type: 'add', newLineNum: 20, content: 'C' })
  })

  it('handles lines starting with + or - inside context (edge)', () => {
    // A context line that happens to start with "+" after the space prefix
    const patch = '@@ -1,1 +1,1 @@\n +positive number'
    const lines = parsePatch(patch)

    // After stripping the leading space, content is "+positive number"
    expect(lines[1].type).toBe('context')
    expect(lines[1].content).toBe('+positive number')
  })
})
