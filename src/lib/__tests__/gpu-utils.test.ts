/**
 * Unit tests for GPU display utilities.
 *
 * Tests compact GPU name formatting used in the Environments page
 * and machine detail dialog to strip vendor prefixes for compact display.
 */

import { describe, it, expect } from 'vitest'
import { compactGpuName } from '../utils'

describe('compactGpuName', () => {
  // NVIDIA cards
  it('strips "NVIDIA" prefix', () => {
    expect(compactGpuName('NVIDIA A100')).toBe('A100')
  })

  it('strips "NVIDIA" prefix (H100)', () => {
    expect(compactGpuName('NVIDIA H100')).toBe('H100')
  })

  it('strips "NVIDIA GeForce" prefix', () => {
    expect(compactGpuName('NVIDIA GeForce RTX 4090')).toBe('RTX 4090')
  })

  it('strips "NVIDIA GeForce" prefix (GTX)', () => {
    expect(compactGpuName('NVIDIA GeForce GTX 1080 Ti')).toBe('GTX 1080 Ti')
  })

  it('handles NVIDIA Tesla', () => {
    expect(compactGpuName('NVIDIA Tesla V100')).toBe('Tesla V100')
  })

  it('is case-insensitive for NVIDIA', () => {
    expect(compactGpuName('nvidia A100')).toBe('A100')
  })

  // AMD cards
  it('strips "AMD" prefix', () => {
    expect(compactGpuName('AMD MI300X')).toBe('MI300X')
  })

  it('strips "AMD Radeon" prefix', () => {
    expect(compactGpuName('AMD Radeon RX 7900 XTX')).toBe('RX 7900 XTX')
  })

  it('strips "AMD Radeon" prefix (Pro)', () => {
    expect(compactGpuName('AMD Radeon Pro W7900')).toBe('Pro W7900')
  })

  // Apple chips
  it('strips "Apple" prefix for M-series', () => {
    expect(compactGpuName('Apple M4 Pro')).toBe('M4 Pro')
  })

  it('strips "Apple" prefix for M4 Max', () => {
    expect(compactGpuName('Apple M4 Max')).toBe('M4 Max')
  })

  it('strips "Apple" prefix for M2 Ultra', () => {
    expect(compactGpuName('Apple M2 Ultra')).toBe('M2 Ultra')
  })

  // Passthrough cases
  it('returns unknown names unchanged', () => {
    expect(compactGpuName('Intel Arc A770')).toBe('Intel Arc A770')
  })

  it('returns short names unchanged', () => {
    expect(compactGpuName('A100')).toBe('A100')
  })

  it('handles empty string', () => {
    expect(compactGpuName('')).toBe('')
  })

  // Multi-GPU deduplication produces comma-separated — verify compact works per-segment
  it('works on comma-separated multi-GPU strings', () => {
    const names = 'NVIDIA A100, NVIDIA H100'
    const compacted = names.split(', ').map(compactGpuName).join(', ')
    expect(compacted).toBe('A100, H100')
  })
})
