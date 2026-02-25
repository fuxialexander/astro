/**
 * Unit tests for multimodal image dispatch support
 *
 * Verifies:
 * - extractBlobUrls extracts UUIDs from <img> tags
 * - stripHtml removes images but preserves surrounding text
 * - dispatch schema accepts imageRefs field
 */

import { describe, it, expect } from 'vitest'
import { extractBlobUrls, stripHtml } from '../src/lib/html-utils'
import { z } from 'zod'

describe('extractBlobUrls', () => {
  it('extracts single blob ID from img tag', () => {
    const html = '<p>Look at this:</p><img src="/api/data/blobs/550e8400-e29b-41d4-a716-446655440000">'
    const ids = extractBlobUrls(html)
    expect(ids).toEqual(['550e8400-e29b-41d4-a716-446655440000'])
  })

  it('extracts multiple blob IDs', () => {
    const html = '<img src="/api/data/blobs/550e8400-e29b-41d4-a716-446655440000"><p>and</p><img src="/api/data/blobs/660e8400-e29b-41d4-a716-446655440001">'
    const ids = extractBlobUrls(html)
    expect(ids).toEqual([
      '550e8400-e29b-41d4-a716-446655440000',
      '660e8400-e29b-41d4-a716-446655440001',
    ])
  })

  it('returns empty array for content without images', () => {
    const html = '<p>no images here</p>'
    expect(extractBlobUrls(html)).toEqual([])
  })

  it('returns empty array for null/undefined', () => {
    expect(extractBlobUrls(null)).toEqual([])
    expect(extractBlobUrls(undefined)).toEqual([])
    expect(extractBlobUrls('')).toEqual([])
  })

  it('ignores non-blob image URLs', () => {
    const html = '<img src="https://example.com/image.png"><img src="/api/data/blobs/550e8400-e29b-41d4-a716-446655440000">'
    const ids = extractBlobUrls(html)
    expect(ids).toEqual(['550e8400-e29b-41d4-a716-446655440000'])
  })
})

describe('stripHtml with images', () => {
  it('removes img tags but preserves surrounding text', () => {
    const html = '<p>Analyze this chart:</p><img src="/api/data/blobs/550e8400-e29b-41d4-a716-446655440000">'
    const text = stripHtml(html)
    expect(text).toBe('Analyze this chart:')
  })

  it('preserves text between images', () => {
    const html = '<p>First image:</p><img src="/api/data/blobs/aaa"><p>Second image:</p><img src="/api/data/blobs/bbb">'
    const text = stripHtml(html)
    expect(text).toContain('First image:')
    expect(text).toContain('Second image:')
    expect(text).not.toContain('<img')
  })
})

describe('dispatch schema imageRefs', () => {
  // Recreate the dispatch schema to test independently
  const dispatchTaskSchema = z.object({
    nodeId: z.string().min(1).max(100),
    projectId: z.string().min(1).max(100),
    title: z.string().min(1).max(1000),
    description: z.string().min(1).max(50000),
    workingDirectory: z.string().max(1000).optional(),
    imageRefs: z.array(z.string().uuid()).max(20).optional(),
  })

  it('accepts valid imageRefs', () => {
    const result = dispatchTaskSchema.safeParse({
      nodeId: 'test-node',
      projectId: 'test-project-1',
      title: 'Test',
      description: 'Test task',
      workingDirectory: '/tmp/test',
      imageRefs: ['a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty imageRefs', () => {
    const result = dispatchTaskSchema.safeParse({
      nodeId: 'test-node',
      projectId: 'test-project-1',
      title: 'Test',
      description: 'Test task',
      imageRefs: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts missing imageRefs', () => {
    const result = dispatchTaskSchema.safeParse({
      nodeId: 'test-node',
      projectId: 'test-project-1',
      title: 'Test',
      description: 'Test task',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID imageRefs', () => {
    const result = dispatchTaskSchema.safeParse({
      nodeId: 'test-node',
      projectId: 'test-project-1',
      title: 'Test',
      description: 'Test task',
      imageRefs: ['not-a-uuid'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects more than 20 imageRefs', () => {
    // Generate 21 valid v4 UUIDs
    const uuids = Array.from({ length: 21 }, (_, i) =>
      `a1b2c3d4-e5f6-4a7b-8c9d-${String(i).padStart(12, '0')}`
    )
    const result = dispatchTaskSchema.safeParse({
      nodeId: 'test-node',
      projectId: 'test-project-1',
      title: 'Test',
      description: 'Test task',
      imageRefs: uuids,
    })
    expect(result.success).toBe(false)
  })
})
