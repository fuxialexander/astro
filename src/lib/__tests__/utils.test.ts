import { describe, expect, it } from 'vitest'
import { getShortId } from '../utils'

describe('getShortId', () => {
  it('keeps uuid short ids stable', () => {
    expect(getShortId('550e8400-e29b-41d4-a716-446655440000')).toBe('550e84')
  })

  it('uses the unique suffix for generated node ids', () => {
    expect(getShortId('node-1774020409860-9dlx8l')).toBe('9dlx8l')
  })

  it('uses the unique suffix for generated edge ids', () => {
    expect(getShortId('edge-1774020409860-ab12cd')).toBe('ab12cd')
  })

  it('falls back to the normalized prefix for simple ids', () => {
    expect(getShortId('project-abc')).toBe('projec')
  })
})
