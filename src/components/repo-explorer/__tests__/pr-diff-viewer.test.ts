import { describe, expect, it } from 'vitest'
import { parsePatch } from '../diff-utils'
import type { DiffLine } from '../diff-utils'

describe('parsePatch', () => {
  it('parses a simple add/remove/context patch', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' line one',
      '-line two',
      '+line two modified',
      '+line two point five',
      ' line three',
    ].join('\n')

    const lines = parsePatch(patch)

    // First line is the hunk header
    expect(lines[0]).toEqual<DiffLine>({ type: 'header', content: '@@ -1,3 +1,4 @@' })

    // Context line
    expect(lines[1]).toEqual<DiffLine>({ type: 'context', content: 'line one', oldLineNum: 1, newLineNum: 1 })

    // Removed line
    expect(lines[2]).toEqual<DiffLine>({ type: 'remove', content: 'line two', oldLineNum: 2 })

    // Added lines
    expect(lines[3]).toEqual<DiffLine>({ type: 'add', content: 'line two modified', newLineNum: 2 })
    expect(lines[4]).toEqual<DiffLine>({ type: 'add', content: 'line two point five', newLineNum: 3 })

    // Trailing context
    expect(lines[5]).toEqual<DiffLine>({ type: 'context', content: 'line three', oldLineNum: 3, newLineNum: 4 })
  })

  it('handles multiple hunk headers', () => {
    const patch = [
      '@@ -10,2 +10,2 @@',
      '-old line',
      '+new line',
      '@@ -30,1 +30,1 @@',
      '-another old',
      '+another new',
    ].join('\n')

    const lines = parsePatch(patch)

    expect(lines.filter((l) => l.type === 'header')).toHaveLength(2)
    expect(lines[0].content).toBe('@@ -10,2 +10,2 @@')
    expect(lines[3].content).toBe('@@ -30,1 +30,1 @@')

    // Check line numbers reset at second hunk
    expect(lines[4]).toEqual<DiffLine>({ type: 'remove', content: 'another old', oldLineNum: 30 })
    expect(lines[5]).toEqual<DiffLine>({ type: 'add', content: 'another new', newLineNum: 30 })
  })

  it('handles additions-only patch', () => {
    const patch = [
      '@@ -0,0 +1,3 @@',
      '+new file line 1',
      '+new file line 2',
      '+new file line 3',
    ].join('\n')

    const lines = parsePatch(patch)
    const adds = lines.filter((l) => l.type === 'add')

    expect(adds).toHaveLength(3)
    expect(adds[0].newLineNum).toBe(1)
    expect(adds[1].newLineNum).toBe(2)
    expect(adds[2].newLineNum).toBe(3)
  })

  it('handles removals-only patch', () => {
    const patch = [
      '@@ -1,2 +0,0 @@',
      '-deleted line 1',
      '-deleted line 2',
    ].join('\n')

    const lines = parsePatch(patch)
    const removes = lines.filter((l) => l.type === 'remove')

    expect(removes).toHaveLength(2)
    expect(removes[0].oldLineNum).toBe(1)
    expect(removes[1].oldLineNum).toBe(2)
  })

  it('handles empty patch', () => {
    const lines = parsePatch('')
    expect(lines).toHaveLength(0)
  })

  it('correctly tracks line numbers through mixed changes', () => {
    const patch = [
      '@@ -5,5 +5,6 @@',
      ' context A',        // old=5 new=5
      '-removed B',        // old=6
      '+added C',          // new=6
      '+added D',          // new=7
      ' context E',        // old=7 new=8
      '-removed F',        // old=8
      ' context G',        // old=9 new=9
    ].join('\n')

    const lines = parsePatch(patch)

    // Skip header
    const body = lines.slice(1)

    expect(body[0]).toMatchObject({ type: 'context', oldLineNum: 5, newLineNum: 5 })
    expect(body[1]).toMatchObject({ type: 'remove', oldLineNum: 6 })
    expect(body[2]).toMatchObject({ type: 'add', newLineNum: 6 })
    expect(body[3]).toMatchObject({ type: 'add', newLineNum: 7 })
    expect(body[4]).toMatchObject({ type: 'context', oldLineNum: 7, newLineNum: 8 })
    expect(body[5]).toMatchObject({ type: 'remove', oldLineNum: 8 })
    expect(body[6]).toMatchObject({ type: 'context', oldLineNum: 9, newLineNum: 9 })
  })

  it('handles hunk header with function context', () => {
    const patch = '@@ -10,2 +10,2 @@ function foo() {\n-old\n+new'
    const lines = parsePatch(patch)

    expect(lines[0].type).toBe('header')
    expect(lines[0].content).toContain('function foo()')
  })
})
