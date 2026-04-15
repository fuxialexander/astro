/**
 * Channel Formatter
 *
 * Converts standard markdown to channel-specific markup formats.
 * - Slack: mrkdwn format
 * - Telegram: HTML mode (simpler than MarkdownV2 escaping)
 * - OpenClaw: plain text (stripped markdown, suitable for any downstream messaging channel)
 * - GitHub/Linear: passthrough (already GFM/markdown)
 */

import type { ChannelFormat } from './channel-types.js'
import { toMarkdownV2 } from './adapters/telegram-markdown-v2.js'

/**
 * Convert standard markdown to a channel-specific format.
 */
export function formatForChannel(markdown: string, format: ChannelFormat): string {
  switch (format) {
    case 'slack_mrkdwn':
      return toSlackMrkdwn(markdown)
    case 'telegram_html':
      return toTelegramHtml(markdown)
    case 'telegram_markdown_v2':
      return toMarkdownV2(markdown)
    case 'openclaw':
      return toOpenClaw(markdown)
    case 'github_gfm':
    case 'linear_markdown':
      return markdown
    default:
      return markdown
  }
}

/**
 * Convert markdown → Slack mrkdwn
 * - **bold** → *bold*
 * - *italic* / _italic_ → _italic_
 * - `code` stays `code`
 * - ```code block``` stays ```code block```
 * - [text](url) → <url|text>
 * - # Header → *Header*
 */
function toSlackMrkdwn(md: string): string {
  let result = md

  // Preserve code blocks first (replace with placeholders)
  const codeBlocks: string[] = []
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`
  })

  // Preserve inline code
  const inlineCode: string[] = []
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCode.push(match)
    return `__INLINE_CODE_${inlineCode.length - 1}__`
  })

  // Convert links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')

  // Convert headers: # Header → *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')

  // Convert bold: **text** → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*')

  // Convert italic: *text* that's not already bold → _text_
  // Only match single asterisks not preceded/followed by another asterisk
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_')

  // Restore inline code
  for (let i = 0; i < inlineCode.length; i++) {
    result = result.replace(`__INLINE_CODE_${i}__`, inlineCode[i])
  }

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    result = result.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i])
  }

  return result
}

/**
 * Convert markdown → Telegram HTML
 * - **bold** → <b>bold</b>
 * - *italic* → <i>italic</i>
 * - `code` → <code>code</code>
 * - ```code``` → <pre>code</pre>
 * - [text](url) → <a href="url">text</a>
 * - # Header → <b>Header</b>
 */
function toTelegramHtml(md: string): string {
  let result = md

  // Escape HTML entities first
  result = result.replace(/&/g, '&amp;')
  result = result.replace(/</g, '&lt;')
  result = result.replace(/>/g, '&gt;')

  // Convert code blocks: ```...``` → <pre>...</pre>
  result = result.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '<pre>$1</pre>')

  // Convert inline code: `code` → <code>code</code>
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Convert links: [text](url) → <a href="url">text</a>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Convert headers: # Header → <b>Header</b>
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')

  // Convert bold: **text** → <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

  // Convert italic: *text* → <i>text</i>
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>')

  return result
}

/**
 * Convert markdown → OpenClaw plain text
 *
 * OpenClaw routes messages to the user's preferred messaging channel
 * (could be SMS, WhatsApp, Discord, etc.), so we strip markdown to
 * plain text for maximum compatibility. The gateway handles any
 * further formatting for the downstream channel.
 *
 * - **bold** / *italic* → just the text
 * - `code` / ```blocks``` → text (with newlines preserved)
 * - [text](url) → text (url)
 * - # Header → HEADER (uppercased)
 */
function toOpenClaw(md: string): string {
  let result = md

  // Convert code blocks: ```...``` → contents only
  result = result.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '$1')

  // Convert inline code: `code` → code
  result = result.replace(/`([^`]+)`/g, '$1')

  // Convert links: [text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')

  // Convert headers: # Header → HEADER
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_match, heading: string) => heading.toUpperCase())

  // Strip bold: **text** → text
  result = result.replace(/\*\*(.+?)\*\*/g, '$1')

  // Strip italic: *text* → text
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')

  // Strip underscores used for emphasis: _text_ → text
  result = result.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '$1')

  return result.trim()
}
