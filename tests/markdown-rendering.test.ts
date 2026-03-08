/**
 * Tests for content rendering pipeline (issue #743)
 *
 * Covers the full chain from template interpolation through format detection
 * to HTML conversion, including image/blob handling and XSS prevention.
 *
 * 1. interpolatePrompt() — placeholder substitution + empty line stripping
 * 2. looksLikeMarkdown() — markdown pattern detection
 * 3. markdownToHtml() — markdown → HTML conversion
 * 4. resolveEditorContent() — 3-way routing: HTML passthrough / markdown→HTML / plain→<p>
 * 5. extractBlobUrls() — image blob ID extraction from HTML
 * 6. stripHtml() — HTML → plain text (used for previews, search, clipboard)
 * 7. escapeHtml() — XSS prevention for plain text → HTML embedding
 */

import { describe, it, expect } from 'vitest'
import { interpolatePrompt } from '../packages/core/src/templates/interpolate.js'
import {
  looksLikeMarkdown,
  markdownToHtml,
  resolveEditorContent,
  extractBlobUrls,
  stripHtml,
  escapeHtml,
} from '../src/lib/html-utils.js'

// ═══════════════════════════════════════════════════════════════════════
// 1. interpolatePrompt — placeholder substitution + empty line stripping
// ═══════════════════════════════════════════════════════════════════════

describe('interpolatePrompt', () => {
  describe('basic substitution', () => {
    it('replaces a single placeholder', () => {
      expect(interpolatePrompt('Hello {{name}}!', { name: 'World' }))
        .toBe('Hello World!')
    })

    it('replaces multiple different placeholders', () => {
      expect(interpolatePrompt('{{greeting}} {{name}}!', { greeting: 'Hi', name: 'Alice' }))
        .toBe('Hi Alice!')
    })

    it('replaces repeated occurrences of the same placeholder', () => {
      expect(interpolatePrompt('{{x}} and {{x}}', { x: 'ok' }))
        .toBe('ok and ok')
    })

    it('joins array values with comma-space', () => {
      expect(interpolatePrompt('Tools: {{tools}}', { tools: ['Python', 'R', 'Julia'] }))
        .toBe('Tools: Python, R, Julia')
    })

    it('converts number values to string', () => {
      expect(interpolatePrompt('Count: {{n}}', { n: 42 }))
        .toBe('Count: 42')
    })

    it('converts boolean values to string', () => {
      expect(interpolatePrompt('Active: {{flag}}', { flag: true }))
        .toBe('Active: true')
    })

    it('leaves text unchanged when no parameters match', () => {
      expect(interpolatePrompt('No placeholders here', { name: 'test' }))
        .toBe('No placeholders here')
    })

    it('preserves unmatched placeholders', () => {
      expect(interpolatePrompt('{{known}} and {{unknown}}', { known: 'yes' }))
        .toBe('yes and {{unknown}}')
    })
  })

  describe('empty value line stripping', () => {
    it('removes line with empty string parameter', () => {
      const prompt = '- Name: {{name}}\n- Email: {{email}}\n- Bio: {{bio}}'
      expect(interpolatePrompt(prompt, { name: 'Alice', email: '', bio: 'Developer' }))
        .toBe('- Name: Alice\n- Bio: Developer')
    })

    it('removes line with whitespace-only parameter', () => {
      expect(interpolatePrompt('- Link: {{paperLink}}\n- Title: {{title}}', { paperLink: '   ', title: 'My Paper' }))
        .toBe('- Title: My Paper')
    })

    it('removes line with empty array parameter', () => {
      expect(interpolatePrompt('- Tags: {{tags}}\n- Name: {{name}}', { tags: [], name: 'Test' }))
        .toBe('- Name: Test')
    })

    it('removes multiple empty lines', () => {
      const prompt = '## Config\n- A: {{a}}\n- B: {{b}}\n- C: {{c}}\n## End'
      expect(interpolatePrompt(prompt, { a: '', b: '', c: '' }))
        .toBe('## Config\n## End')
    })

    it('collapses 3+ consecutive newlines to 2', () => {
      const prompt = 'Start\n\n- A: {{a}}\n\n- B: {{b}}\n\nEnd'
      expect(interpolatePrompt(prompt, { a: '', b: '' }))
        .toBe('Start\n\nEnd')
    })

    it('handles template-style multi-line prompts with mixed empty/filled', () => {
      const prompt = [
        '## Research Parameters',
        '- Paper Link: {{paperLink}}',
        '- Research Area: {{researchArea}}',
        '- Methodology: {{methodology}}',
        '- Additional Notes: {{notes}}',
        '',
        '## Goals',
        'Analyze the paper.',
      ].join('\n')

      expect(interpolatePrompt(prompt, {
        paperLink: '',
        researchArea: 'ML',
        methodology: '',
        notes: '',
      })).toBe([
        '## Research Parameters',
        '- Research Area: ML',
        '',
        '## Goals',
        'Analyze the paper.',
      ].join('\n'))
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 2. looksLikeMarkdown — markdown pattern detection
// ═══════════════════════════════════════════════════════════════════════

describe('looksLikeMarkdown', () => {
  describe('detects markdown patterns', () => {
    it('detects headings', () => {
      expect(looksLikeMarkdown('## My Title')).toBe(true)
      expect(looksLikeMarkdown('# H1')).toBe(true)
      expect(looksLikeMarkdown('### H3 heading')).toBe(true)
    })

    it('detects unordered lists', () => {
      expect(looksLikeMarkdown('- item one')).toBe(true)
      expect(looksLikeMarkdown('* item two')).toBe(true)
      expect(looksLikeMarkdown('+ item three')).toBe(true)
    })

    it('detects ordered lists', () => {
      expect(looksLikeMarkdown('1. First item')).toBe(true)
      expect(looksLikeMarkdown('42. Item')).toBe(true)
    })

    it('detects bold', () => {
      expect(looksLikeMarkdown('This is **bold** text')).toBe(true)
      expect(looksLikeMarkdown('This is __also bold__')).toBe(true)
    })

    it('detects code blocks', () => {
      expect(looksLikeMarkdown('```python\ncode\n```')).toBe(true)
    })

    it('detects blockquotes', () => {
      expect(looksLikeMarkdown('> This is a quote')).toBe(true)
    })

    it('detects links', () => {
      expect(looksLikeMarkdown('See [docs](https://example.com)')).toBe(true)
    })

    it('detects strikethrough', () => {
      expect(looksLikeMarkdown('This is ~~deleted~~ text')).toBe(true)
    })
  })

  describe('rejects non-markdown', () => {
    it('returns false for empty string', () => {
      expect(looksLikeMarkdown('')).toBe(false)
    })

    it('returns false for plain text', () => {
      expect(looksLikeMarkdown('Just a simple sentence.')).toBe(false)
    })

    it('returns false for HTML content from TipTap', () => {
      expect(looksLikeMarkdown('<p>Hello world</p>')).toBe(false)
      expect(looksLikeMarkdown('<h2>Title</h2><p>Body</p>')).toBe(false)
    })

    it('returns false for HTML with lists', () => {
      expect(looksLikeMarkdown('<ul><li>Item</li></ul>')).toBe(false)
    })
  })

  describe('real-world template content', () => {
    it('detects typical template-generated description as markdown', () => {
      const template = [
        '## Research Analysis',
        '',
        '**Objective:** Analyze the given paper',
        '',
        '- Research Area: Machine Learning',
        '- Methodology: Systematic Review',
        '',
        '### Steps',
        '1. Read the paper thoroughly',
        '2. Extract key findings',
        '3. Write a summary',
      ].join('\n')
      expect(looksLikeMarkdown(template)).toBe(true)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 3. markdownToHtml — basic conversion
// ═══════════════════════════════════════════════════════════════════════

describe('markdownToHtml', () => {
  it('converts heading to <h2>', () => {
    const html = markdownToHtml('## Title')
    expect(html).toContain('<h2')
    expect(html).toContain('Title')
  })

  it('converts list items to <li>', () => {
    const html = markdownToHtml('- Item one\n- Item two')
    expect(html).toContain('<li>')
    expect(html).toContain('Item one')
    expect(html).toContain('Item two')
  })

  it('converts bold to <strong>', () => {
    const html = markdownToHtml('**bold text**')
    expect(html).toContain('<strong>')
    expect(html).toContain('bold text')
  })

  it('converts code blocks', () => {
    const html = markdownToHtml('```python\nprint("hi")\n```')
    expect(html).toContain('<code')
    expect(html).toContain('print')
  })

  it('returns empty string for empty input', () => {
    expect(markdownToHtml('')).toBe('')
  })

  it('converts links to <a>', () => {
    const html = markdownToHtml('[link](https://example.com)')
    expect(html).toContain('<a')
    expect(html).toContain('href="https://example.com"')
  })

  it('converts markdown images to <img>', () => {
    const html = markdownToHtml('![alt text](https://example.com/photo.png)')
    expect(html).toContain('<img')
    expect(html).toContain('src="https://example.com/photo.png"')
    expect(html).toContain('alt="alt text"')
  })

  it('converts inline code to <code>', () => {
    const html = markdownToHtml('Use `npm install` to install')
    expect(html).toContain('<code>')
    expect(html).toContain('npm install')
  })

  it('converts tables (GFM)', () => {
    const md = '| Col A | Col B |\n|---|---|\n| 1 | 2 |'
    const html = markdownToHtml(md)
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('Col A')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 4. resolveEditorContent — 3-way routing for TipTap initialization
// ═══════════════════════════════════════════════════════════════════════

describe('resolveEditorContent', () => {
  describe('null/empty handling', () => {
    it('returns empty string for null', () => {
      expect(resolveEditorContent(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(resolveEditorContent(undefined)).toBe('')
    })

    it('returns empty string for empty string', () => {
      expect(resolveEditorContent('')).toBe('')
    })
  })

  describe('HTML passthrough', () => {
    it('passes through TipTap HTML unchanged', () => {
      const html = '<h2>Title</h2><p>Body text</p>'
      expect(resolveEditorContent(html)).toBe(html)
    })

    it('passes through HTML with images (blob URLs)', () => {
      const html = '<p>See this:</p><img src="/api/data/blobs/abc-123">'
      expect(resolveEditorContent(html)).toBe(html)
    })

    it('passes through HTML with lists', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul>'
      expect(resolveEditorContent(html)).toBe(html)
    })

    it('passes through HTML with styled content', () => {
      const html = '<p><strong>Bold</strong> and <em>italic</em></p>'
      expect(resolveEditorContent(html)).toBe(html)
    })
  })

  describe('markdown → HTML conversion', () => {
    it('converts markdown headings', () => {
      const result = resolveEditorContent('## Research Analysis')
      expect(result).toContain('<h2')
      expect(result).toContain('Research Analysis')
    })

    it('converts markdown lists', () => {
      const result = resolveEditorContent('- Item 1\n- Item 2')
      expect(result).toContain('<li>')
      expect(result).toContain('Item 1')
    })

    it('converts markdown bold', () => {
      const result = resolveEditorContent('**important**')
      expect(result).toContain('<strong>')
    })

    it('converts full template-generated markdown', () => {
      const md = [
        '## Research Parameters',
        '',
        '- Research Area: ML',
        '- Focus: Transformers',
        '',
        '### Goals',
        '1. Analyze architecture',
        '2. Compare benchmarks',
      ].join('\n')
      const result = resolveEditorContent(md)
      expect(result).toContain('<h2')
      expect(result).toContain('<h3')
      expect(result).toContain('<li>')
      expect(result).toContain('ML')
    })

    it('converts GitHub issue markdown', () => {
      const issue = '## Bug\n\nSteps:\n1. Open app\n2. Click button\n\n**Expected:** works'
      const result = resolveEditorContent(issue)
      expect(result).toContain('<h2')
      expect(result).toContain('<strong>')
      expect(result).toContain('Expected:')
    })
  })

  describe('plain text → <p> wrapping', () => {
    it('wraps plain text in <p> tag', () => {
      expect(resolveEditorContent('Just a simple description.'))
        .toBe('<p>Just a simple description.</p>')
    })

    it('escapes HTML entities in plain text', () => {
      const result = resolveEditorContent('Use x < 5 & y > 3')
      expect(result).toContain('&lt;')
      expect(result).toContain('&amp;')
      expect(result).toContain('&gt;')
      expect(result).not.toContain('<5')
    })

    it('escapes quotes in plain text', () => {
      const result = resolveEditorContent('He said "hello"')
      expect(result).toContain('&quot;')
    })
  })

  describe('format decision boundary', () => {
    it('treats content with only <br> as HTML', () => {
      // TipTap uses <br> for line breaks
      expect(resolveEditorContent('Line 1<br>Line 2')).toBe('Line 1<br>Line 2')
    })

    it('treats content with <p> wrapper as HTML', () => {
      expect(resolveEditorContent('<p>Simple text</p>')).toBe('<p>Simple text</p>')
    })

    it('markdown with markdown image syntax gets converted', () => {
      // ![alt](url) is markdown, not HTML
      const md = '## Title\n\n![diagram](https://example.com/img.png)'
      const result = resolveEditorContent(md)
      expect(result).toContain('<img')
      expect(result).toContain('<h2')
    })

    it('markdown with HTML <img> tag is treated as HTML (passthrough)', () => {
      // Mixed content with HTML tags → passthrough (avoid double-rendering)
      const mixed = '## Title\n\n<img src="photo.png" alt="photo">'
      expect(resolveEditorContent(mixed)).toBe(mixed)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 5. extractBlobUrls — image blob ID extraction
// ═══════════════════════════════════════════════════════════════════════

describe('extractBlobUrls', () => {
  it('extracts a single blob UUID from <img> tag', () => {
    const html = '<p>Here is an image:</p><img src="/api/data/blobs/a1b2c3d4-e5f6-7890-abcd-ef1234567890">'
    const ids = extractBlobUrls(html)
    expect(ids).toEqual(['a1b2c3d4-e5f6-7890-abcd-ef1234567890'])
  })

  it('extracts multiple blob UUIDs', () => {
    const html = [
      '<img src="/api/data/blobs/11111111-2222-3333-4444-555555555555">',
      '<p>Some text</p>',
      '<img src="/api/data/blobs/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">',
    ].join('')
    const ids = extractBlobUrls(html)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('11111111-2222-3333-4444-555555555555')
    expect(ids[1]).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('returns empty array for null', () => {
    expect(extractBlobUrls(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(extractBlobUrls(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(extractBlobUrls('')).toEqual([])
  })

  it('returns empty array for HTML without blob URLs', () => {
    expect(extractBlobUrls('<p>No images here</p>')).toEqual([])
  })

  it('returns empty array for external image URLs', () => {
    const html = '<img src="https://example.com/photo.png">'
    expect(extractBlobUrls(html)).toEqual([])
  })

  it('extracts blob IDs from inline style references too', () => {
    // The regex matches the URL pattern anywhere in the string
    const html = '<div style="background: url(/api/data/blobs/12345678-1234-1234-1234-123456789abc)"></div>'
    const ids = extractBlobUrls(html)
    expect(ids).toEqual(['12345678-1234-1234-1234-123456789abc'])
  })

  it('handles uppercase hex digits in UUIDs', () => {
    const html = '<img src="/api/data/blobs/AABBCCDD-1122-3344-5566-778899AABBCC">'
    const ids = extractBlobUrls(html)
    expect(ids).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 6. stripHtml — HTML to plain text
// ═══════════════════════════════════════════════════════════════════════

describe('stripHtml', () => {
  it('strips basic HTML tags', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toContain('Hello')
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toContain('world')
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).not.toContain('<')
  })

  it('converts block elements to newlines', () => {
    const result = stripHtml('<h2>Title</h2><p>Body</p>')
    expect(result).toContain('Title')
    expect(result).toContain('Body')
  })

  it('converts list items to newlines', () => {
    const result = stripHtml('<ul><li>Item 1</li><li>Item 2</li></ul>')
    expect(result).toContain('Item 1')
    expect(result).toContain('Item 2')
  })

  it('removes images entirely', () => {
    const html = '<p>Before</p><img src="/api/data/blobs/abc-123"><p>After</p>'
    const result = stripHtml(html)
    expect(result).toContain('Before')
    expect(result).toContain('After')
    expect(result).not.toContain('img')
    expect(result).not.toContain('blob')
  })

  it('decodes HTML entities', () => {
    // &nbsp; at end becomes space, then .trim() removes it
    expect(stripHtml('&amp; &lt; &gt; &quot; &#39;')).toBe('& < > " \'')
    // &nbsp; in middle is preserved
    expect(stripHtml('a&nbsp;b')).toBe('a b')
  })

  it('collapses 3+ newlines to 2', () => {
    const result = stripHtml('<p>A</p><p></p><p></p><p></p><p>B</p>')
    expect(result).not.toMatch(/\n{3,}/)
  })

  it('returns empty string for null', () => {
    expect(stripHtml(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(stripHtml(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(stripHtml('')).toBe('')
  })

  it('handles content with blob images (description preview use case)', () => {
    const html = [
      '<h2>Design Review</h2>',
      '<p>Here are the mockups:</p>',
      '<img src="/api/data/blobs/12345678-1234-1234-1234-123456789abc" alt="mockup">',
      '<p>Please review the above designs.</p>',
    ].join('')
    const result = stripHtml(html)
    expect(result).toContain('Design Review')
    expect(result).toContain('mockups')
    expect(result).toContain('review the above designs')
    expect(result).not.toContain('img')
    expect(result).not.toContain('12345678')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 7. escapeHtml — XSS prevention
// ═══════════════════════════════════════════════════════════════════════

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('He said "hello"')).toBe('He said &quot;hello&quot;')
  })

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })

  it('handles all special characters together', () => {
    const input = '<div class="test" data-x=\'y\'>&</div>'
    const result = escapeHtml(input)
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).toContain('&lt;')
    expect(result).toContain('&gt;')
    expect(result).toContain('&quot;')
    expect(result).toContain('&#39;')
    expect(result).toContain('&amp;')
  })

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 8. Integration: content format lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe('content format lifecycle', () => {
  describe('project description: template → editor → save → preview', () => {
    it('template markdown flows through resolveEditorContent to HTML for TipTap', () => {
      // 1. Template generates markdown
      const templateMd = interpolatePrompt(
        '## {{projectName}}\n\n- Area: {{area}}\n- Link: {{paperLink}}\n\n### Goals\nAnalyze the paper.',
        { projectName: 'My Research', area: 'ML', paperLink: '' }
      )

      // 2. resolveEditorContent converts for TipTap
      const editorHtml = resolveEditorContent(templateMd)
      expect(editorHtml).toContain('<h2')
      expect(editorHtml).toContain('My Research')
      expect(editorHtml).toContain('ML')
      expect(editorHtml).not.toContain('paperLink')

      // 3. After TipTap saves HTML, it passes through unchanged
      expect(resolveEditorContent(editorHtml)).toBe(editorHtml)

      // 4. stripHtml produces a preview string
      const preview = stripHtml(editorHtml)
      expect(preview).toContain('My Research')
      expect(preview).toContain('ML')
    })
  })

  describe('project description with images: editor → save → blob extraction', () => {
    it('HTML with embedded images preserves blob URLs through the pipeline', () => {
      // Simulated TipTap HTML output after user pastes an image
      const html = [
        '<h2>Design Spec</h2>',
        '<p>Architecture diagram:</p>',
        '<img src="/api/data/blobs/a1b2c3d4-e5f6-7890-abcd-ef1234567890" alt="arch diagram">',
        '<p>Implementation plan:</p>',
        '<img src="/api/data/blobs/11111111-2222-3333-4444-555555555555" alt="plan">',
      ].join('')

      // resolveEditorContent passes HTML through unchanged
      expect(resolveEditorContent(html)).toBe(html)

      // extractBlobUrls finds both image references
      const blobIds = extractBlobUrls(html)
      expect(blobIds).toHaveLength(2)
      expect(blobIds).toContain('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      expect(blobIds).toContain('11111111-2222-3333-4444-555555555555')

      // stripHtml removes images for plain text preview
      const preview = stripHtml(html)
      expect(preview).toContain('Design Spec')
      expect(preview).toContain('Architecture diagram')
      expect(preview).not.toContain('blob')
    })
  })

  describe('vision doc: markdown round-trip (no images)', () => {
    it('vision doc stays as markdown — no HTML conversion needed', () => {
      const visionMd = [
        '# Product Vision',
        '',
        '## Goals',
        '- Ship v2 by Q3',
        '- Support 10K users',
        '',
        '## Non-Goals',
        '- Mobile app (defer to v3)',
      ].join('\n')

      // looksLikeMarkdown correctly identifies it
      expect(looksLikeMarkdown(visionMd)).toBe(true)

      // resolveEditorContent converts for TipTap display
      const html = resolveEditorContent(visionMd)
      expect(html).toContain('<h1')
      expect(html).toContain('<h2')
      expect(html).toContain('<li>')

      // No blob URLs in vision doc (no image support)
      expect(extractBlobUrls(html)).toEqual([])
    })
  })

  describe('task content: dual storage (description + content)', () => {
    it('when node.content (HTML) exists, it takes priority', () => {
      const nodeContent = '<p>Edited in TipTap with <strong>formatting</strong></p>'
      // task-content-tab checks: if (node.content) return node.content
      // So resolveEditorContent is only called when content is absent
      expect(resolveEditorContent(nodeContent)).toBe(nodeContent)
    })

    it('when only node.description (markdown) exists, it gets converted', () => {
      const nodeDescription = '## Task Notes\n\n- Step 1: Setup\n- Step 2: Implement'
      const html = resolveEditorContent(nodeDescription)
      expect(html).toContain('<h2')
      expect(html).toContain('<li>')
      expect(html).toContain('Setup')
    })

    it('when only node.description (plain text) exists, it gets wrapped', () => {
      const nodeDescription = 'Fix the login button click handler'
      const html = resolveEditorContent(nodeDescription)
      expect(html).toBe('<p>Fix the login button click handler</p>')
    })
  })

  describe('format detection: why description saves HTML but visionDoc saves markdown', () => {
    it('description with blob images requires HTML format', () => {
      // HTML is the right format when you need <img> tags with blob URLs
      const descriptionWithImage = '<p>See this mockup:</p><img src="/api/data/blobs/abc-def-123">'

      // HTML passes through (no conversion needed)
      expect(resolveEditorContent(descriptionWithImage)).toBe(descriptionWithImage)

      // Blob URLs can be extracted for cleanup/export
      // (Note: this particular UUID format won't match the strict regex)
      const validHtml = '<img src="/api/data/blobs/12345678-1234-1234-1234-123456789abc">'
      expect(extractBlobUrls(validHtml)).toHaveLength(1)
    })

    it('visionDoc without images can use markdown (injected into agent prompts)', () => {
      const visionMd = '## Context\n\nThis project builds a REST API for...'
      // Markdown is the right format for agent-facing content
      expect(looksLikeMarkdown(visionMd)).toBe(true)
      // No image support needed
      expect(extractBlobUrls(visionMd)).toEqual([])
    })
  })

  describe('image edge cases', () => {
    it('data URL images (clipboard paste before upload) are treated as HTML', () => {
      // When a user pastes an image, TipTap may temporarily embed it as a data URL
      // before the upload handler converts it to a blob URL
      const html = '<p>Pasted:</p><img src="data:image/png;base64,iVBORw0KGgo...">'
      expect(resolveEditorContent(html)).toBe(html)
      // data URLs are NOT blob URLs — extractBlobUrls ignores them
      expect(extractBlobUrls(html)).toEqual([])
    })

    it('mixed blob and external images — only blob IDs extracted', () => {
      const html = [
        '<img src="/api/data/blobs/12345678-1234-1234-1234-123456789abc">',
        '<img src="https://example.com/external.png">',
        '<img src="data:image/jpeg;base64,/9j/4AAQ...">',
        '<img src="/api/data/blobs/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">',
      ].join('')
      const blobIds = extractBlobUrls(html)
      expect(blobIds).toHaveLength(2)
      expect(blobIds[0]).toBe('12345678-1234-1234-1234-123456789abc')
      expect(blobIds[1]).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    })

    it('stripHtml removes all image types in plain text preview', () => {
      const html = [
        '<p>Text A</p>',
        '<img src="/api/data/blobs/12345678-1234-1234-1234-123456789abc">',
        '<p>Text B</p>',
        '<img src="https://example.com/photo.png">',
        '<p>Text C</p>',
      ].join('')
      const text = stripHtml(html)
      expect(text).toContain('Text A')
      expect(text).toContain('Text B')
      expect(text).toContain('Text C')
      // Image tags and their src URLs are removed
      expect(text).not.toContain('<img')
      expect(text).not.toContain('/api/data/')
      expect(text).not.toContain('example.com')
    })

    it('markdown images get converted to HTML <img> by resolveEditorContent', () => {
      const md = '## Screenshots\n\n![screenshot 1](https://example.com/s1.png)\n\n![screenshot 2](https://example.com/s2.png)'
      const html = resolveEditorContent(md)
      // Both images should be converted to <img> tags
      expect(html).toContain('<img')
      expect(html).toContain('src="https://example.com/s1.png"')
      expect(html).toContain('src="https://example.com/s2.png"')
    })
  })

  describe('PDFs are not inline content', () => {
    it('PDF links in markdown are converted to <a> tags, not embedded', () => {
      const md = '## Resources\n\n[Research Paper](https://example.com/paper.pdf)'
      const html = resolveEditorContent(md)
      expect(html).toContain('<a')
      expect(html).toContain('href="https://example.com/paper.pdf"')
      // No <object> or <embed> — PDFs are not inline
      expect(html).not.toContain('<object')
      expect(html).not.toContain('<embed')
    })

    it('extractBlobUrls does not match PDF attachment URLs', () => {
      // PDFs are stored as task attachments, not inline blob images
      // Even if a URL contains /api/data/blobs/, the UUID must be valid
      const html = '<a href="/api/attachments/some-pdf-id">paper.pdf</a>'
      expect(extractBlobUrls(html)).toEqual([])
    })
  })
})
