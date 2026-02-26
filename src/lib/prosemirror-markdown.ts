/**
 * Convert a TipTap/ProseMirror document to Markdown using prosemirror-markdown.
 *
 * This gives a much higher-fidelity conversion than regex-based stripHtml(),
 * preserving headings, lists, bold/italic, links, images, task lists, etc.
 */
import { MarkdownSerializer, type MarkdownSerializerState } from '@tiptap/pm/markdown'
import type { Node as ProseMirrorNode, Mark } from '@tiptap/pm/model'

// ── Node serializers ──────────────────────────────────────────────────

const nodes: Record<string, (state: MarkdownSerializerState, node: ProseMirrorNode, parent: ProseMirrorNode, index: number) => void> = {
  doc(state, node) {
    state.renderContent(node)
  },

  paragraph(state, node) {
    state.renderInline(node)
    state.closeBlock(node)
  },

  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node))
  },

  horizontalRule(state, node) {
    state.write(state.repeat('-', 3))
    state.closeBlock(node)
  },

  heading(state, node) {
    state.write(state.repeat('#', node.attrs.level as number) + ' ')
    state.renderInline(node)
    state.closeBlock(node)
  },

  codeBlock(state, node) {
    const lang = (node.attrs.language as string) || ''
    state.write('```' + lang + '\n')
    state.text(node.textContent, false)
    state.write('\n```')
    state.closeBlock(node)
  },

  orderedList(state, node) {
    const start = (node.attrs.start as number) || 1
    const maxW = String(start + node.childCount - 1).length
    const space = state.repeat(' ', maxW + 2)
    state.renderList(node, space, (i) => {
      const nStr = String(start + i)
      return state.repeat(' ', maxW - nStr.length) + nStr + '. '
    })
  },

  bulletList(state, node) {
    state.renderList(node, '  ', () => '- ')
  },

  listItem(state, node) {
    state.renderContent(node)
  },

  // TipTap task list
  taskList(state, node) {
    state.renderList(node, '  ', () => '')
  },

  taskItem(state, node) {
    const checked = node.attrs.checked as boolean
    state.write(checked ? '[x] ' : '[ ] ')
    state.renderContent(node)
  },

  // Images → ![alt](src)
  image(state, node) {
    const alt = (node.attrs.alt as string) || ''
    const src = (node.attrs.src as string) || ''
    const title = (node.attrs.title as string) || ''
    state.write(`![${state.esc(alt)}](${src}${title ? ` "${state.esc(title)}"` : ''})`)
  },

  hardBreak(state, node, parent, index) {
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type !== node.type) {
        state.write('\\\n')
        return
      }
    }
  },

  text(state, node) {
    state.text(node.text || '')
  },

  // TipTap @mention → plain text label
  mention(state, node) {
    const label = (node.attrs.label as string) || (node.attrs.id as string) || ''
    state.write(`@${label}`)
  },
}

// ── Mark serializers ──────────────────────────────────────────────────

const marks: Record<string, { open: string | ((state: MarkdownSerializerState, mark: Mark, parent: ProseMirrorNode, index: number) => string); close: string | ((state: MarkdownSerializerState, mark: Mark, parent: ProseMirrorNode, index: number) => string); mixable?: boolean; expelEnclosingWhitespace?: boolean; escape?: boolean }> = {
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  code: { open: '`', close: '`', escape: false },
  link: {
    open: '[',
    close(_state, mark) {
      return `](${mark.attrs.href as string}${mark.attrs.title ? ` "${mark.attrs.title as string}"` : ''})`
    },
  },
}

const serializer = new MarkdownSerializer(nodes, marks)

/**
 * Serialize a ProseMirror document node to Markdown.
 */
export function prosemirrorToMarkdown(doc: ProseMirrorNode): string {
  return serializer.serialize(doc)
}
