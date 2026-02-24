/**
 * Unit tests for GPU-related relay logic.
 *
 * Tests:
 * 1. GPU type deduplication during machine registration
 * 2. Slurm GRES parsing for cluster-wide GPU summary
 * 3. Slurm context string GPU enrichment
 */

import { describe, it, expect } from 'vitest'

// ─── GPU type deduplication (mirrors relay-server.ts registration logic) ──────

/**
 * Extracted from relay-server.ts: given raw GPU info from agent runner,
 * produce a deduplicated gpuType string.
 */
function extractGpuType(gpus: Array<{ name: string }>): string | undefined {
  if (gpus.length === 0) return undefined
  return [...new Set(gpus.map(g => g.name))].join(', ')
}

describe('extractGpuType (relay registration)', () => {
  it('returns undefined for empty GPU list', () => {
    expect(extractGpuType([])).toBeUndefined()
  })

  it('returns single GPU name', () => {
    expect(extractGpuType([{ name: 'NVIDIA A100' }])).toBe('NVIDIA A100')
  })

  it('deduplicates identical GPUs', () => {
    const gpus = [
      { name: 'NVIDIA A100' },
      { name: 'NVIDIA A100' },
      { name: 'NVIDIA A100' },
      { name: 'NVIDIA A100' },
    ]
    expect(extractGpuType(gpus)).toBe('NVIDIA A100')
  })

  it('preserves multiple different GPU types', () => {
    const gpus = [
      { name: 'NVIDIA A100' },
      { name: 'NVIDIA H100' },
    ]
    expect(extractGpuType(gpus)).toBe('NVIDIA A100, NVIDIA H100')
  })

  it('handles Apple Silicon GPU entry', () => {
    expect(extractGpuType([{ name: 'Apple M4 Pro' }])).toBe('Apple M4 Pro')
  })
})

// ─── Slurm GRES parsing (mirrors local-backends.ts logic) ────────────────────

/**
 * Extracted from local-backends.ts: parse `sinfo -h -N -o "%N|%G"` output
 * to count total GPUs and GPU nodes.
 */
function parseGresOutput(sinfoOutput: string): { totalGpus: number; gpuNodeCount: number } {
  let gpuNodeCount = 0
  let totalGpus = 0
  for (const line of sinfoOutput.trim().split('\n')) {
    if (!line.trim()) continue
    const [, gres] = line.split('|')
    if (!gres || gres === '(null)' || !gres.includes('gpu')) continue
    gpuNodeCount++
    const countMatch = gres.match(/gpu(?::[^:]+)?:(\d+)/)
    if (countMatch) totalGpus += parseInt(countMatch[1], 10)
  }
  return { totalGpus, gpuNodeCount }
}

describe('parseGresOutput (Slurm GRES)', () => {
  it('parses simple "gpu:N" format', () => {
    const output = `node001|gpu:4
node002|gpu:4
node003|gpu:4`
    const result = parseGresOutput(output)
    expect(result.totalGpus).toBe(12)
    expect(result.gpuNodeCount).toBe(3)
  })

  it('parses "gpu:type:N" format', () => {
    const output = `gpu-node-01|gpu:a100:4
gpu-node-02|gpu:a100:4
gpu-node-03|gpu:a100:8`
    const result = parseGresOutput(output)
    expect(result.totalGpus).toBe(16)
    expect(result.gpuNodeCount).toBe(3)
  })

  it('parses GRES with socket binding suffix', () => {
    // Format: gpu:type:count(S:socket-range)
    const output = `node01|gpu:a100:4(S:0-1)
node02|gpu:a100:4(S:0-1)`
    const result = parseGresOutput(output)
    expect(result.totalGpus).toBe(8)
    expect(result.gpuNodeCount).toBe(2)
  })

  it('skips nodes without GPUs', () => {
    const output = `cpu-node-01|(null)
cpu-node-02|(null)
gpu-node-01|gpu:v100:2`
    const result = parseGresOutput(output)
    expect(result.totalGpus).toBe(2)
    expect(result.gpuNodeCount).toBe(1)
  })

  it('handles mixed GPU and non-GPU nodes', () => {
    const output = `login01|(null)
compute01|gpu:a100:4
compute02|(null)
compute03|gpu:h100:8`
    const result = parseGresOutput(output)
    expect(result.totalGpus).toBe(12)
    expect(result.gpuNodeCount).toBe(2)
  })

  it('returns zero for cluster with no GPUs', () => {
    const output = `node001|(null)
node002|(null)`
    const result = parseGresOutput(output)
    expect(result.totalGpus).toBe(0)
    expect(result.gpuNodeCount).toBe(0)
  })

  it('handles empty output', () => {
    const result = parseGresOutput('')
    expect(result.totalGpus).toBe(0)
    expect(result.gpuNodeCount).toBe(0)
  })

  it('handles single GPU node', () => {
    const output = `dgx01|gpu:a100:8`
    const result = parseGresOutput(output)
    expect(result.totalGpus).toBe(8)
    expect(result.gpuNodeCount).toBe(1)
  })
})

// ─── Slurm context string GPU enrichment ─────────────────────────────────────

describe('Slurm context string GPU enrichment', () => {
  function buildGpuContextSuffix(
    totalGpus: number | undefined,
    gpuNodeCount: number | undefined,
  ): string {
    if (totalGpus) {
      return ` ${totalGpus} GPUs available across ${gpuNodeCount ?? '?'} nodes.`
    }
    return ''
  }

  it('appends GPU count with node count', () => {
    expect(buildGpuContextSuffix(32, 4)).toBe(' 32 GPUs available across 4 nodes.')
  })

  it('uses ? when gpuNodeCount is undefined', () => {
    expect(buildGpuContextSuffix(16, undefined)).toBe(' 16 GPUs available across ? nodes.')
  })

  it('returns empty string when no GPUs', () => {
    expect(buildGpuContextSuffix(undefined, undefined)).toBe('')
    expect(buildGpuContextSuffix(0, 0)).toBe('')
  })
})
