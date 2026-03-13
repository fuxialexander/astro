/**
 * Tests for visualise-utils.ts
 *
 * Covers isVisualizerFence() and extractVisualizerCode() for detecting
 * and extracting code from ```visualizer fences in markdown content.
 */

import { describe, it, expect } from 'vitest'
import { isVisualizerFence, extractVisualizerCode } from '../visualise-utils'

describe('isVisualizerFence', () => {
  it('returns true for a string containing a visualizer fence', () => {
    const text = 'Some text\n```visualizer\n<div>Hello</div>\n```\nMore text'
    expect(isVisualizerFence(text)).toBe(true)
  })

  it('returns false for regular code fences', () => {
    expect(isVisualizerFence('```javascript\nconsole.log("hi")\n```')).toBe(false)
    expect(isVisualizerFence('```python\nprint("hi")\n```')).toBe(false)
    expect(isVisualizerFence('```html\n<div></div>\n```')).toBe(false)
    expect(isVisualizerFence('```\nplain code\n```')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isVisualizerFence('')).toBe(false)
  })

  it('returns false for text without any code fences', () => {
    expect(isVisualizerFence('Just some plain text')).toBe(false)
  })

  it('returns true when visualizer fence is among other fences', () => {
    const text = '```javascript\nvar x = 1;\n```\n\n```visualizer\n<svg></svg>\n```\n\n```python\npass\n```'
    expect(isVisualizerFence(text)).toBe(true)
  })

  it('returns false for "visualizer" appearing outside a code fence', () => {
    expect(isVisualizerFence('the word visualizer is not a fence')).toBe(false)
  })

  it('matches visualizer with trailing text on the fence line', () => {
    // e.g. ```visualizer title="My Chart"
    expect(isVisualizerFence('```visualizer title="chart"\n<div></div>\n```')).toBe(true)
  })
})

describe('extractVisualizerCode', () => {
  it('extracts code from a single visualizer fence', () => {
    const text = '```visualizer\n<div>Hello</div>\n```'
    const result = extractVisualizerCode(text)
    expect(result).toEqual(['<div>Hello</div>\n'])
  })

  it('extracts code from multiple visualizer fences', () => {
    const text = '```visualizer\n<svg>1</svg>\n```\n\nsome text\n\n```visualizer\n<svg>2</svg>\n```'
    const result = extractVisualizerCode(text)
    expect(result).toEqual(['<svg>1</svg>\n', '<svg>2</svg>\n'])
  })

  it('returns empty array for empty string', () => {
    expect(extractVisualizerCode('')).toEqual([])
  })

  it('returns empty array when no visualizer fences exist', () => {
    const text = '```javascript\nconsole.log("hi")\n```'
    expect(extractVisualizerCode(text)).toEqual([])
  })

  it('ignores unclosed visualizer fences', () => {
    const text = '```visualizer\n<div>unclosed'
    expect(extractVisualizerCode(text)).toEqual([])
  })

  it('handles multiline code content', () => {
    const text = '```visualizer\n<div>\n  <h1>Title</h1>\n  <p>Content</p>\n</div>\n```'
    const result = extractVisualizerCode(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('<h1>Title</h1>')
    expect(result[0]).toContain('<p>Content</p>')
  })

  it('only extracts visualizer fences, not other code fences', () => {
    const text = '```javascript\nvar x = 1;\n```\n\n```visualizer\n<div>viz</div>\n```\n\n```python\npass\n```'
    const result = extractVisualizerCode(text)
    expect(result).toEqual(['<div>viz</div>\n'])
  })

  it('handles nested backticks inside the fence content', () => {
    const text = '```visualizer\n<code>`inline code`</code>\n```'
    const result = extractVisualizerCode(text)
    expect(result).toEqual(['<code>`inline code`</code>\n'])
  })
})
