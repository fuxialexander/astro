import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Typography from '@tiptap/extension-typography'
import Mention from '@tiptap/extension-mention'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import React, { useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react'
import tippy, { type Instance } from 'tippy.js'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Link2,
  Image as ImageIcon,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
  Link2Off,
} from 'lucide-react'
import { cn, getShortId } from '@/lib/utils'
import { MentionSuggestion, type MentionSuggestionItem, type MentionSuggestionRef } from './mention-suggestion'
import { CitationSuggestion, type CitationSuggestionRef } from './citation-suggestion'
import { stripHtml } from '@/lib/html-utils'
import { prosemirrorToMarkdown, fragmentToMarkdown } from '@/lib/prosemirror-markdown'
import type { Reference } from '@/lib/citation/types'
import { getCiteKey } from '@/lib/citation/cite-key'
import { useReferenceStore } from '@/stores/reference-store'

const getReferenceLibraryState = useReferenceStore.getState

export interface RichTextEditorRef {
  focus: () => void
  getHTML: () => string
  getMarkdown: () => string
  getPlainText: () => string
  setContent: (content: string) => void
  insertImage: (url: string, alt?: string) => void
}

interface RichTextEditorProps {
  content?: string
  onChange?: (html: string) => void
  placeholder?: string
  className?: string
  editable?: boolean
  autofocus?: boolean
  onBlur?: () => void
  /** Items for @mention suggestions */
  mentionItems?: MentionSuggestionItem[]
  /** References for [@citation suggestions */
  references?: Reference[]
  /** Called when an image is pasted/dropped - should upload and return URL */
  onImageUpload?: (file: File) => Promise<string | null>
  /** Extra content rendered in the toolbar (e.g. save status indicator) */
  toolbarExtra?: React.ReactNode
}

// Citation inline node — a Mention variant that triggers on [@ and serializes to [@key]
const CitationNode = Mention.extend({
  name: 'citation',
  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      {
        ...HTMLAttributes,
        'data-citation': node.attrs.id as string,
        class: 'citation-badge inline-flex items-center rounded px-1 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-700 no-underline mx-0.5',
      },
      `[@${node.attrs.label as string}]`,
    ]
  },
  parseHTML() {
    return [{ tag: 'span[data-citation]' }]
  },
})

export const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  ({ content = '', onChange, placeholder = 'Start writing...', className, editable = true, autofocus = false, onBlur, mentionItems, references, onImageUpload, toolbarExtra }, ref) => {
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Use a ref for mentionItems so the suggestion closure always reads the latest value
    const mentionItemsRef = useRef(mentionItems)
    useEffect(() => {
      mentionItemsRef.current = mentionItems
    }, [mentionItems])

    // Ref for references so citation suggestion closure stays current
    const referencesRef = useRef(references)
    useEffect(() => {
      referencesRef.current = references
    }, [references])
    const mentionExtension = useMemo(() => {
      if (!mentionItems) return null
      return Mention.configure({
        HTMLAttributes: {
          class: 'mention bg-primary/10 text-primary rounded px-1 py-0.5 font-medium',
        },
        suggestion: {
          items: ({ query }: { query: string }) => {
            const items = mentionItemsRef.current
            if (!items) return []
            const q = query.toLowerCase()
            return items
              .filter((item) =>
                item.label.toLowerCase().includes(q) ||
                getShortId(item.id).includes(q)
              )
              .slice(0, 15)
          },
          render: () => {
            let component: ReactRenderer<MentionSuggestionRef> | null = null
            let popup: Instance[] | null = null

            return {
              onStart: (props: SuggestionProps) => {
                component = new ReactRenderer(MentionSuggestion, {
                  props: {
                    items: props.items,
                    command: props.command,
                  },
                  editor: props.editor,
                })

                if (!props.clientRect) return

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                })
              },
              onUpdate: (props: SuggestionProps) => {
                component?.updateProps({
                  items: props.items,
                  command: props.command,
                })

                if (popup?.[0] && props.clientRect) {
                  popup[0].setProps({
                    getReferenceClientRect: props.clientRect as () => DOMRect,
                  })
                }
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide()
                  return true
                }
                return component?.ref?.onKeyDown({ event: props.event }) ?? false
              },
              onExit: () => {
                popup?.[0]?.destroy()
                component?.destroy()
              },
            }
          },
        },
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const citationExtension = useMemo(() => {
      return CitationNode.configure({
        suggestion: {
          char: '[@',
          allowSpaces: false,
          items: ({ query }: { query: string }) => {
            const refs = (referencesRef.current?.length ? referencesRef.current : null) ?? getReferenceLibraryState().library
            const q = query.toLowerCase()
            return refs
              .filter(r =>
                getCiteKey(r).includes(q) ||
                r.title.toLowerCase().includes(q) ||
                r.authors.some(a => a.toLowerCase().includes(q))
              )
              .slice(0, 10)
              .map(r => ({ id: getCiteKey(r), label: getCiteKey(r), ref: r }))
          },
          render: () => {
            let component: ReactRenderer<CitationSuggestionRef> | null = null
            let popup: Instance[] | null = null

            return {
              onStart: (props: SuggestionProps) => {
                component = new ReactRenderer(CitationSuggestion, {
                  props: { items: props.items, command: props.command },
                  editor: props.editor,
                })
                if (!props.clientRect) return
                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                })
              },
              onUpdate: (props: SuggestionProps) => {
                component?.updateProps({ items: props.items, command: props.command })
                if (popup?.[0] && props.clientRect) {
                  popup[0].setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
                }
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') { popup?.[0]?.hide(); return true }
                return component?.ref?.onKeyDown({ event: props.event }) ?? false
              },
              onExit: () => { popup?.[0]?.destroy(); component?.destroy() },
            }
          },
        },
      })
    }, [])

    const extensions = useMemo(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exts: any[] = [
        StarterKit.configure({
          heading: {
            levels: [1, 2, 3],
          },
          // Disable StarterKit's built-in link to avoid duplicate with our custom Link config
          link: false,
        }),
        Image.configure({
          HTMLAttributes: {
            class: 'rounded-lg max-w-full h-auto',
          },
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            class: 'text-primary underline underline-offset-2 hover:text-primary/80',
          },
        }),
        Placeholder.configure({
          placeholder,
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Typography,
      ]
      if (mentionExtension) {
        exts.push(mentionExtension)
      }
      exts.push(citationExtension)
      return exts
    }, [placeholder, mentionExtension, citationExtension])

    // Use a ref to avoid the circular dependency between handleImageFile and editor
    const editorInstanceRef = useRef<ReturnType<typeof useEditor>>(null)

    const handleImageFile = useCallback(async (file: File) => {
      if (!onImageUpload) return false
      if (!file.type.startsWith('image/')) return false

      const url = await onImageUpload(file)
      if (url) {
        editorInstanceRef.current?.chain().focus().setImage({ src: url }).run()
      }
      return true
    }, [onImageUpload])

    const editor = useEditor({
      extensions,
      content,
      editable,
      autofocus,
      onUpdate: ({ editor }) => {
        onChange?.(editor.getHTML())
      },
      onBlur: () => {
        onBlur?.()
      },
      editorProps: {
        attributes: {
          class: cn(
            'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[180px] px-4 py-3',
            '[&_ul[data-type="taskList"]]:list-none [&_ul[data-type="taskList"]]:pl-0',
            '[&_ul[data-type="taskList"]_li]:flex [&_ul[data-type="taskList"]_li]:items-start [&_ul[data-type="taskList"]_li]:gap-2',
            '[&_ul[data-type="taskList"]_li>label]:mt-0.5 [&_ul[data-type="taskList"]_li>div]:flex-1',
          ),
        },
        // Export as markdown when copying (text/plain clipboard flavor)
        clipboardTextSerializer: (slice) => {
          try {
            const schema = editorInstanceRef.current?.schema
            if (!schema || !slice.content.childCount) {
              return slice.content.textBetween(0, slice.content.size, '\n\n')
            }
            return fragmentToMarkdown(slice.content, schema)
          } catch {
            // Fallback: let TipTap handle it normally
            return slice.content.textBetween(0, slice.content.size, '\n\n')
          }
        },
        handlePaste: (_view, event) => {
          const items = event.clipboardData?.items
          if (!items) return false

          for (const item of items) {
            if (item.type.startsWith('image/')) {
              event.preventDefault()
              const file = item.getAsFile()
              if (file) handleImageFile(file)
              return true
            }
          }
          return false
        },
        handleDrop: (_view, event) => {
          const files = event.dataTransfer?.files
          if (!files?.length) return false

          for (const file of files) {
            if (file.type.startsWith('image/')) {
              event.preventDefault()
              handleImageFile(file)
              return true
            }
          }
          return false
        },
      },
    })

    // Keep the editor ref in sync
    useEffect(() => {
      editorInstanceRef.current = editor
    }, [editor])

    // Sync external content changes
    useEffect(() => {
      if (editor && content !== editor.getHTML()) {
        editor.commands.setContent(content)
      }
    }, [content, editor])

    useImperativeHandle(ref, () => ({
      focus: () => editor?.commands.focus(),
      getHTML: () => editor?.getHTML() || '',
      getMarkdown: () => {
        if (!editor) return ''
        try {
          return prosemirrorToMarkdown(editor.state.doc)
        } catch {
          // Fallback to plain text if serialization fails
          return stripHtml(editor.getHTML())
        }
      },
      getPlainText: () => stripHtml(editor?.getHTML() || ''),
      setContent: (newContent: string) => editor?.commands.setContent(newContent),
      insertImage: (url: string, alt?: string) => {
        editor?.chain().focus().setImage({ src: url, alt: alt || '' }).run()
      },
    }), [editor])

    const setLink = useCallback(() => {
      if (!editor) return

      const previousUrl = editor.getAttributes('link').href
      const url = window.prompt('URL', previousUrl)

      if (url === null) return

      if (url === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
        return
      }

      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }, [editor])

    const addImage = useCallback(() => {
      if (!editor) return

      if (onImageUpload) {
        // Use file picker instead of URL prompt
        fileInputRef.current?.click()
      } else {
        const url = window.prompt('Image URL')
        if (url) {
          editor.chain().focus().setImage({ src: url }).run()
        }
      }
    }, [editor, onImageUpload])

    const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        await handleImageFile(file)
      }
      // Reset input so same file can be selected again
      e.target.value = ''
    }, [handleImageFile])

    if (!editor) return null

    return (
      <div className={cn('relative rounded-lg border border-input bg-background overflow-hidden', className)}>
        {/* Hidden file input for image upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* Toolbar */}
        {editable && (
          <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5">
            {/* Text formatting group */}
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                active={editor.isActive('bold')}
                title="Bold"
              >
                <Bold className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                active={editor.isActive('italic')}
                title="Italic"
              >
                <Italic className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                active={editor.isActive('strike')}
                title="Strikethrough"
              >
                <Strikethrough className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleCode().run()}
                active={editor.isActive('code')}
                title="Inline code"
              >
                <Code className="h-3.5 w-3.5" />
              </ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Heading group */}
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                active={editor.isActive('heading', { level: 1 })}
                title="Heading 1"
              >
                <Heading1 className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                active={editor.isActive('heading', { level: 2 })}
                title="Heading 2"
              >
                <Heading2 className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                active={editor.isActive('heading', { level: 3 })}
                title="Heading 3"
              >
                <Heading3 className="h-3.5 w-3.5" />
              </ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* List & structure group */}
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                active={editor.isActive('bulletList')}
                title="Bullet list"
              >
                <List className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                active={editor.isActive('orderedList')}
                title="Numbered list"
              >
                <ListOrdered className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleTaskList().run()}
                active={editor.isActive('taskList')}
                title="Task list"
              >
                <CheckSquare className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                active={editor.isActive('blockquote')}
                title="Quote"
              >
                <Quote className="h-3.5 w-3.5" />
              </ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Insert group */}
            <ToolbarGroup>
              <ToolbarButton
                onClick={setLink}
                active={editor.isActive('link')}
                title="Add link"
              >
                <Link2 className="h-3.5 w-3.5" />
              </ToolbarButton>
              {editor.isActive('link') && (
                <ToolbarButton
                  onClick={() => editor.chain().focus().unsetLink().run()}
                  title="Remove link"
                >
                  <Link2Off className="h-3.5 w-3.5" />
                </ToolbarButton>
              )}
              <ToolbarButton onClick={addImage} title="Add image">
                <ImageIcon className="h-3.5 w-3.5" />
              </ToolbarButton>
            </ToolbarGroup>

            <div className="flex-1" />

            {/* Extra toolbar content (e.g. save status) + Undo/redo — kept on same line */}
            <div className="flex items-center gap-1">
              {toolbarExtra}
              <ToolbarGroup>
                <ToolbarButton
                  onClick={() => editor.chain().focus().undo().run()}
                  disabled={!editor.can().undo()}
                  title="Undo"
                >
                  <Undo className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ToolbarButton
                  onClick={() => editor.chain().focus().redo().run()}
                  disabled={!editor.can().redo()}
                  title="Redo"
                >
                  <Redo className="h-3.5 w-3.5" />
                </ToolbarButton>
              </ToolbarGroup>
            </div>
          </div>
        )}

        {/* Bubble menu for quick formatting */}
        {editable && (
          <BubbleMenu editor={editor}>
            <div className="flex items-center gap-px rounded-lg border border-border bg-popover p-0.5 shadow-xl shadow-black/10 dark:shadow-black/30">
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                active={editor.isActive('bold')}
                compact
              >
                <Bold className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                active={editor.isActive('italic')}
                compact
              >
                <Italic className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                active={editor.isActive('strike')}
                compact
              >
                <Strikethrough className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleCode().run()}
                active={editor.isActive('code')}
                compact
              >
                <Code className="h-3.5 w-3.5" />
              </ToolbarButton>
              <div className="w-px h-4 bg-border mx-0.5" />
              <ToolbarButton onClick={setLink} active={editor.isActive('link')} compact>
                <Link2 className="h-3.5 w-3.5" />
              </ToolbarButton>
            </div>
          </BubbleMenu>
        )}

        {/* Editor content */}
        <EditorContent editor={editor} />
      </div>
    )
  }
)

RichTextEditor.displayName = 'RichTextEditor'

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-px rounded-md bg-background border border-border/50 p-px">
      {children}
    </div>
  )
}

function ToolbarDivider() {
  return <div className="w-px h-5 mx-0.5" />
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
  compact,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title?: string
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center rounded-[5px] transition-colors duration-100 cursor-pointer',
        'text-muted-foreground hover:text-foreground hover:bg-accent',
        'disabled:opacity-30 disabled:pointer-events-none',
        compact ? 'h-7 w-7' : 'h-7 w-7',
        active && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  )
}
