/**
 * Tests for StreamingMarkdown's visualizer integration.
 *
 * Tests the parseMarkdownIntoBlocks logic that routes visualizer fences
 * to VisualWidget and regular content to MarkdownRenderer.
 *
 * Since parseMarkdownIntoBlocks is not directly exported, we test via
 * the marked.lexer() + the same routing logic the component uses.
 */

import { describe, it, expect } from 'vitest'
import { marked } from 'marked'

// Replicate the ParsedBlock type and parsing logic from streaming-markdown.tsx
// This tests the exact same algorithm the component uses.
type ParsedBlock =
  | { type: 'markdown'; content: string }
  | { type: 'visualizer'; code: string }

function parseMarkdownIntoBlocks(markdown: string): ParsedBlock[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => {
    if (token.type === 'code' && token.lang === 'visualizer') {
      return { type: 'visualizer' as const, code: token.text }
    }
    return { type: 'markdown' as const, content: token.raw }
  })
}

describe('StreamingMarkdown visualizer integration', () => {
  describe('parseMarkdownIntoBlocks', () => {
    it('parses a visualizer fence as a visualizer block', () => {
      const md = '```visualizer\n<div>Hello</div>\n```'
      const blocks = parseMarkdownIntoBlocks(md)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('visualizer')
      expect((blocks[0] as { type: 'visualizer'; code: string }).code).toBe('<div>Hello</div>')
    })

    it('parses regular code fences as markdown blocks', () => {
      const md = '```javascript\nconsole.log("hi")\n```'
      const blocks = parseMarkdownIntoBlocks(md)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('markdown')
    })

    it('parses plain text as markdown blocks', () => {
      const md = 'Hello, world!'
      const blocks = parseMarkdownIntoBlocks(md)

      expect(blocks.length).toBeGreaterThanOrEqual(1)
      expect(blocks.every(b => b.type === 'markdown')).toBe(true)
    })

    it('handles mixed content: text + visualizer + text', () => {
      const md = 'Some introduction text.\n\n```visualizer\n<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>\n```\n\nSome conclusion text.'
      const blocks = parseMarkdownIntoBlocks(md)

      // Should have at least 3 blocks: text, visualizer, text
      const types = blocks.map(b => b.type)
      expect(types).toContain('markdown')
      expect(types).toContain('visualizer')

      const vizBlocks = blocks.filter(b => b.type === 'visualizer')
      expect(vizBlocks).toHaveLength(1)
      expect((vizBlocks[0] as { type: 'visualizer'; code: string }).code).toContain('<svg')
    })

    it('handles multiple visualizer fences', () => {
      const md = '```visualizer\n<div>First</div>\n```\n\n```visualizer\n<div>Second</div>\n```'
      const blocks = parseMarkdownIntoBlocks(md)

      const vizBlocks = blocks.filter(b => b.type === 'visualizer')
      expect(vizBlocks).toHaveLength(2)
      expect((vizBlocks[0] as { type: 'visualizer'; code: string }).code).toBe('<div>First</div>')
      expect((vizBlocks[1] as { type: 'visualizer'; code: string }).code).toBe('<div>Second</div>')
    })

    it('handles mixed code fences: javascript + visualizer + python', () => {
      const md = '```javascript\nvar x = 1;\n```\n\n```visualizer\n<canvas></canvas>\n```\n\n```python\nprint("hi")\n```'
      const blocks = parseMarkdownIntoBlocks(md)

      const types = blocks.map(b => b.type)
      // javascript and python are markdown blocks, visualizer is separate
      const vizBlocks = blocks.filter(b => b.type === 'visualizer')
      expect(vizBlocks).toHaveLength(1)
      expect((vizBlocks[0] as { type: 'visualizer'; code: string }).code).toBe('<canvas></canvas>')

      // Other code fences should be markdown
      const mdBlocks = blocks.filter(b => b.type === 'markdown')
      expect(mdBlocks.length).toBeGreaterThanOrEqual(2)
    })

    it('empty string produces no blocks', () => {
      const blocks = parseMarkdownIntoBlocks('')
      expect(blocks).toEqual([])
    })

    it('handles headings and lists as markdown blocks', () => {
      const md = '# Title\n\n- Item 1\n- Item 2\n\n```visualizer\n<div></div>\n```'
      const blocks = parseMarkdownIntoBlocks(md)

      const vizBlocks = blocks.filter(b => b.type === 'visualizer')
      const mdBlocks = blocks.filter(b => b.type === 'markdown')

      expect(vizBlocks).toHaveLength(1)
      expect(mdBlocks.length).toBeGreaterThanOrEqual(2) // heading + list
    })

    it('preserves full HTML content inside visualizer fences', () => {
      const htmlContent = `<div class="chart-container">
  <canvas id="myChart"></canvas>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    new Chart(document.getElementById('myChart'), {
      type: 'bar',
      data: { labels: ['A', 'B'], datasets: [{ data: [1, 2] }] }
    });
  </script>
</div>`
      const md = '```visualizer\n' + htmlContent + '\n```'
      const blocks = parseMarkdownIntoBlocks(md)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('visualizer')
      expect((blocks[0] as { type: 'visualizer'; code: string }).code).toBe(htmlContent)
    })
  })
})
