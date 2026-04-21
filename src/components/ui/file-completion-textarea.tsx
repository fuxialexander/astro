import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react"
import { createPortal } from "react-dom"
import { FileCode2, Hash, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/api-url"
import { dataClient } from "@/lib/data-client"
import { useToastStore } from "@/stores/toast-store"
import type { Reference } from "@/lib/citation/types"
import { getCiteKey } from "@/lib/citation/cite-key"
import { CitationDropdownContent } from "./citation-dropdown-content"

export interface SlashCommand {
  name: string
  description: string
}

export interface MentionItem {
  id: string
  label: string
  /** Secondary text shown in the dropdown */
  detail?: string
  /** Icon category for styling */
  kind: "task" | "milestone" | "special"
}

/** Image attachment tracked by blob ID */
export interface ChatImageAttachment {
  id: string // blob ID
  name: string
  url: string
  mimeType: string
  size: number
}

interface FileCompletionTextareaProps {
  projectId: string
  machineId?: string
  workingDirectory?: string
  fileTree?: string[]
  slashCommands?: SlashCommand[]
  mentionItems?: MentionItem[]
  /** Bibliographic references for [@key] citation autocomplete */
  references?: Reference[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
  disabled?: boolean
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit?: (opts?: { interrupt?: boolean }) => void
  /** Attached images (controlled) */
  images?: ChatImageAttachment[]
  /** Called when images change (add/remove) */
  onImagesChange?: (images: ChatImageAttachment[]) => void
  /** Ref to imperatively trigger the file picker */
  filePickerRef?: React.MutableRefObject<(() => void) | null>
}

interface DropdownPosition {
  top?: number
  bottom?: number
  left: number
  width: number
}

const DEBOUNCE_MS = 150
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * A textarea with @-triggered file path autocomplete.
 * Renders the dropdown in a portal so it doesn't affect parent layout.
 */
export function FileCompletionTextarea({
  projectId,
  machineId,
  workingDirectory,
  fileTree,
  slashCommands,
  mentionItems,
  references,
  value,
  onChange,
  placeholder,
  rows = 1,
  className,
  disabled,
  onKeyDown,
  onSubmit,
  images,
  onImagesChange,
  filePickerRef,
}: FileCompletionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const slashDropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const abortRef = useRef<AbortController>(undefined)
  const hiddenDivRef = useRef<HTMLDivElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  // File completion state: track if we're actively completing and the '@' position
  const [atIndex, setAtIndex] = useState(-1)
  const [files, setFiles] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null)

  // Slash command completion state
  const [slashActive, setSlashActive] = useState(false)
  const [slashFilter, setSlashFilter] = useState("")
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [slashDropdownPos, setSlashDropdownPos] = useState<DropdownPosition | null>(null)

  // Citation completion state (triggered by "[@")
  const [citeActive, setCiteActive] = useState(false)
  const [citeBracketIndex, setCiteBracketIndex] = useState(-1) // position of the '['
  const [citeQuery, setCiteQuery] = useState("")
  const [citeSelectedIndex, setCiteSelectedIndex] = useState(0)
  const [citeDropdownPos, setCiteDropdownPos] = useState<DropdownPosition | null>(null)
  const citeDropdownRef = useRef<HTMLDivElement>(null)
  const hasReferences = !!(references && references.length > 0)

  const dismissCite = useCallback(() => {
    setCiteActive(false)
    setCiteBracketIndex(-1)
    setCiteQuery("")
    setCiteSelectedIndex(0)
  }, [])

  // Filter references by citation query
  const filteredCiteRefs = useMemo(() => {
    if (!hasReferences || !citeActive) return []
    const q = citeQuery.toLowerCase()
    if (!q) return references!.slice(0, 20)
    return references!.filter((ref) =>
      ref.title.toLowerCase().includes(q) ||
      ref.authors.some((a) => a.toLowerCase().includes(q)) ||
      String(ref.year).includes(q) ||
      ref.id.toLowerCase().includes(q) ||
      (ref.venue?.toLowerCase().includes(q))
    ).slice(0, 20)
  }, [references, citeQuery, citeActive, hasReferences])

  // Image upload state
  const [pendingUploads, setPendingUploads] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Ref to read latest images inside async callbacks (avoids stale closure race)
  const imagesRef = useRef(images)
  imagesRef.current = images

  // Expose file picker trigger to parent
  useEffect(() => {
    if (filePickerRef) {
      filePickerRef.current = () => fileInputRef.current?.click()
    }
    return () => { if (filePickerRef) filePickerRef.current = null }
  }, [filePickerRef])

  const uploadImageFiles = useCallback((fileList: File[]) => {
    if (!onImagesChange) return
    const imageFiles = fileList.filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    for (const file of imageFiles) {
      if (file.size > MAX_IMAGE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
        useToastStore.getState().add({
          type: 'error',
          title: 'Image too large',
          description: `${file.name || 'Image'} is ${sizeMB}MB (max 10MB)`,
        })
        continue
      }

      setPendingUploads((prev) => prev + 1)
      const reader = new FileReader()
      const filename = file.name || `pasted-image-${crypto.randomUUID()}.png`
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1]
          const blobId = await dataClient.uploadBlob(
            base64,
            file.type || 'image/png',
            file.size,
            filename,
          )
          const url = dataClient.getBlobUrl(blobId)
          const attachment: ChatImageAttachment = {
            id: blobId,
            name: filename,
            url,
            mimeType: file.type || 'image/png',
            size: file.size,
          }
          onImagesChange([...(imagesRef.current || []), attachment])
        } catch (err) {
          console.error('[file-completion] Failed to upload image:', err)
          useToastStore.getState().add({
            type: 'error',
            title: 'Upload failed',
            description: 'Could not upload image. Check your connection.',
          })
        } finally {
          setPendingUploads((prev) => Math.max(0, prev - 1))
        }
      }
      reader.onerror = () => {
        setPendingUploads((prev) => Math.max(0, prev - 1))
        useToastStore.getState().add({
          type: 'error',
          title: 'Read failed',
          description: `Could not read file: ${filename}`,
        })
      }
      reader.readAsDataURL(file)
    }
  }, [onImagesChange])

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files
    if (!files || files.length === 0 || !onImagesChange) return
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    e.preventDefault()
    uploadImageFiles(imageFiles)
  }, [onImagesChange, uploadImageFiles])

  const handleDragOver = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    if (!onImagesChange) return
    e.preventDefault()
    e.stopPropagation()
  }, [onImagesChange])

  const handleDrop = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    if (!onImagesChange) return
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer?.files || [])
    uploadImageFiles(files)
  }, [onImagesChange, uploadImageFiles])

  const handleRemoveImage = useCallback((imageId: string) => {
    if (!onImagesChange || !images) return
    onImagesChange(images.filter((img) => img.id !== imageId))
  }, [images, onImagesChange])

  const filteredSlashCommands = useMemo(() => {
    if (!slashCommands || !slashActive) return []
    if (!slashFilter) return slashCommands
    const lowerFilter = slashFilter.toLowerCase()
    return slashCommands.filter((cmd) => cmd.name.toLowerCase().includes(lowerFilter))
  }, [slashCommands, slashActive, slashFilter])

  // Mention query (for mentionItems mode)
  const [mentionQuery, setMentionQuery] = useState("")

  const isActive = atIndex >= 0
  const hasMentionItems = !!(mentionItems && mentionItems.length > 0)
  const hasFileTree = !!(fileTree && fileTree.length > 0)
  const canCompleteFiles = hasFileTree || !!(workingDirectory && machineId)
  const canComplete = hasMentionItems || canCompleteFiles

  // Filter mention items by query (client-side, instant)
  const filteredMentions = useMemo(() => {
    if (!hasMentionItems || !isActive) return []
    const q = mentionQuery.toLowerCase()
    return mentionItems!.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.detail?.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [mentionItems, mentionQuery, isActive, hasMentionItems])

  // Compute dropdown position from textarea bounding rect (shared by @ and / menus)
  const computeDropdownPosition = useCallback((opts?: { minWidth?: number }): DropdownPosition | null => {
    const textarea = textareaRef.current
    if (!textarea) return null
    const rect = textarea.getBoundingClientRect()
    const maxDropdownHeight = hasMentionItems ? 280 : 240
    const spaceBelow = window.innerHeight - rect.bottom
    const showAbove = spaceBelow < maxDropdownHeight + 8
    if (showAbove) {
      return {
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: Math.max(rect.width, opts?.minWidth ?? 0),
      }
    }
    return {
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, opts?.minWidth ?? 0),
    }
  }, [hasMentionItems])

  const updateDropdownPosition = useCallback(() => {
    const pos = computeDropdownPosition(hasMentionItems ? { minWidth: 300 } : undefined)
    if (pos) setDropdownPos(pos)
  }, [computeDropdownPosition, hasMentionItems])

  const updateSlashDropdownPosition = useCallback(() => {
    const pos = computeDropdownPosition()
    if (pos) setSlashDropdownPos(pos)
  }, [computeDropdownPosition])

  // Client-side filter for cached file tree (instant, no network)
  const filterFileTree = useCallback(
    (q: string) => {
      if (!fileTree) return
      const lowerQuery = q.toLowerCase()
      const filtered = fileTree
        .filter((f) => f.toLowerCase().includes(lowerQuery))
        .slice(0, 50)
      setFiles(filtered)
      setSelectedIndex(0)
      setLoading(false)
    },
    [fileTree],
  )

  // Fetch files from API
  const fetchFiles = useCallback(
    async (q: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      try {
        const params = new URLSearchParams({ projectId, q })
        if (machineId) params.set("machineId", machineId)
        if (workingDirectory) params.set("workingDirectory", workingDirectory)

        const res = await fetch(apiUrl(`/api/fs/files?${params}`), {
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        if (!controller.signal.aborted) {
          setFiles(data.files || [])
          setSelectedIndex(0)
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setFiles([])
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    },
    [projectId, machineId, workingDirectory],
  )

  // Debounced fetch — sets loading immediately so the dropdown stays visible
  const debouncedFetch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setLoading(true)
      debounceRef.current = setTimeout(() => fetchFiles(q), DEBOUNCE_MS)
    },
    [fetchFiles],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  // Dismiss the @ completion (file or mention)
  const dismiss = useCallback(() => {
    setAtIndex(-1)
    setFiles([])
    setMentionQuery("")
    setLoading(false)
    setDropdownPos(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()
  }, [])

  // Dismiss slash command completion
  const dismissSlash = useCallback(() => {
    setSlashActive(false)
    setSlashFilter("")
    setSlashSelectedIndex(0)
    setSlashDropdownPos(null)
  }, [])

  // Auto-resize textarea to fit content
  const autoResize = useCallback(() => {
    const textarea = textareaRef.current
    const hiddenDiv = hiddenDivRef.current
    if (!textarea || !hiddenDiv) return

    // Copy text content to hidden div to measure height
    hiddenDiv.textContent = textarea.value + "\u200b" // zero-width space to preserve trailing newline height

    // Get computed height from hidden div
    const newHeight = hiddenDiv.scrollHeight

    // Update textarea height (with max-height of 50vh enforced via CSS)
    textarea.style.height = `${newHeight}px`
  }, [])

  // Detect @-trigger and /-trigger on value change
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const cursorPos = e.target.selectionStart

      onChange(newValue)
      autoResize()

      // Check for / slash command trigger
      if (slashCommands && slashCommands.length > 0 && cursorPos > 0) {
        const beforeCursor = newValue.slice(0, cursorPos)
        const lastSlash = beforeCursor.lastIndexOf("/")
        if (lastSlash >= 0) {
          const charBefore = lastSlash > 0 ? newValue[lastSlash - 1] : " "
          if (charBefore === " " || charBefore === "\n" || lastSlash === 0) {
            const q = beforeCursor.slice(lastSlash + 1)
            if (!q.includes(" ")) {
              setSlashActive(true)
              setSlashFilter(q)
              setSlashSelectedIndex(0)
              updateSlashDropdownPosition()
              dismiss() // dismiss file completion if active
              return
            }
          }
        }
      }
      dismissSlash()

      // Check for [@ citation trigger (must come before @ check to prevent overlap)
      if (hasReferences && cursorPos != null && cursorPos >= 2) {
        const beforeCursor = newValue.slice(0, cursorPos)
        const lastBracketAt = beforeCursor.lastIndexOf("[@")
        if (lastBracketAt >= 0) {
          const q = beforeCursor.slice(lastBracketAt + 2) // skip "[@"
          if (q.length <= 80 && !q.includes("]")) {
            setCiteActive(true)
            setCiteBracketIndex(lastBracketAt)
            setCiteQuery(q)
            setCiteSelectedIndex(0)
            setCiteDropdownPos(computeDropdownPosition())
            dismiss()
            return
          }
        }
      }
      dismissCite()

      // Check for @ completion trigger (mentions or files)
      if (cursorPos > 0) {
        const beforeCursor = newValue.slice(0, cursorPos)
        const lastAt = beforeCursor.lastIndexOf("@")

        if (lastAt >= 0) {
          const charBefore = lastAt > 0 ? newValue[lastAt - 1] : " "
          if (charBefore === " " || charBefore === "\n" || lastAt === 0) {
            const q = beforeCursor.slice(lastAt + 1)
            // Mention mode: allow spaces up to 60 chars
            // File mode: no spaces allowed
            const mentionValid = hasMentionItems && q.length <= 60
            const fileValid = canCompleteFiles && !q.includes(" ")
            if (mentionValid || fileValid) {
              setAtIndex(lastAt)
              updateDropdownPosition()
              // Update mention query when mention items exist
              if (mentionValid) {
                setMentionQuery(q)
              }
              // Also fetch/filter files when query has no spaces
              if (fileValid) {
                if (hasFileTree) {
                  filterFileTree(q)
                } else {
                  debouncedFetch(q)
                }
              }
              return
            }
          }
        }
      }

      // No active completion
      dismiss()
      dismissCite()
    },
    [onChange, slashCommands, debouncedFetch, filterFileTree, updateDropdownPosition, updateSlashDropdownPosition, dismiss, dismissSlash, dismissCite, canCompleteFiles, hasFileTree, hasMentionItems, hasReferences, autoResize],
  )

  // Auto-resize on mount and when value changes externally
  useEffect(() => {
    autoResize()
  }, [value, autoResize])

  // Insert the selected file path
  const insertFile = useCallback(
    (file: string) => {
      const textarea = textareaRef.current
      if (atIndex < 0 || !textarea) return

      const cursorPos = textarea.selectionStart
      const before = value.slice(0, atIndex)
      const after = value.slice(cursorPos)
      const newValue = `${before}@${file} ${after}`

      onChange(newValue)
      dismiss()

      requestAnimationFrame(() => {
        const newPos = atIndex + file.length + 2 // @ + file + space
        textarea.setSelectionRange(newPos, newPos)
        textarea.focus()
      })
    },
    [atIndex, value, onChange, dismiss],
  )

  // Insert a selected mention item
  const insertMention = useCallback(
    (item: MentionItem) => {
      const textarea = textareaRef.current
      if (atIndex < 0 || !textarea) return

      const cursorPos = textarea.selectionStart
      const before = value.slice(0, atIndex)
      const after = value.slice(cursorPos)
      const mention = item.kind === "special" ? `@${item.id}` : `@${item.label}`
      const newValue = `${before}${mention} ${after}`

      onChange(newValue)
      dismiss()

      requestAnimationFrame(() => {
        const newPos = before.length + mention.length + 1
        textarea.setSelectionRange(newPos, newPos)
        textarea.focus()
      })
    },
    [atIndex, value, onChange, dismiss],
  )

  // Insert a selected slash command
  const insertSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      const textarea = textareaRef.current
      if (!textarea) return

      const cursorPos = textarea.selectionStart
      const beforeCursor = value.slice(0, cursorPos)
      const lastSlash = beforeCursor.lastIndexOf("/")
      if (lastSlash < 0) return

      const before = value.slice(0, lastSlash)
      const after = value.slice(cursorPos)
      const newValue = `${before}${cmd.name} ${after}`

      onChange(newValue)
      dismissSlash()

      requestAnimationFrame(() => {
        const newPos = lastSlash + cmd.name.length + 1 // command + space
        textarea.setSelectionRange(newPos, newPos)
        textarea.focus()
      })
    },
    [value, onChange, dismissSlash],
  )

  // Insert a citation reference: replaces "[@query" with "[@citekey]"
  const insertCitation = useCallback(
    (ref: Reference) => {
      const textarea = textareaRef.current
      if (citeBracketIndex < 0 || !textarea) return

      const citeKey = getCiteKey(ref)
      const cursorPos = textarea.selectionStart
      const before = value.slice(0, citeBracketIndex)
      const after = value.slice(cursorPos)
      const newValue = `${before}[@${citeKey}]${after}`

      onChange(newValue)
      dismissCite()

      requestAnimationFrame(() => {
        const newPos = citeBracketIndex + citeKey.length + 3 // [@ + key + ]
        textarea.setSelectionRange(newPos, newPos)
        textarea.focus()
      })
    },
    [citeBracketIndex, value, onChange, dismissCite],
  )

  // Combined item count for keyboard navigation (mentions first, then files)
  const totalItems = filteredMentions.length + files.length

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash command navigation
      if (slashActive && filteredSlashCommands.length > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault()
            setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashCommands.length)
            return
          case "ArrowUp":
            e.preventDefault()
            setSlashSelectedIndex((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length)
            return
          case "Tab":
          case "Enter":
            if (filteredSlashCommands[slashSelectedIndex]) {
              e.preventDefault()
              insertSlashCommand(filteredSlashCommands[slashSelectedIndex])
              return
            }
            break
          case "Escape":
            e.preventDefault()
            dismissSlash()
            return
        }
      }

      // [@ citation navigation
      if (citeActive && filteredCiteRefs.length > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault()
            setCiteSelectedIndex((prev) => (prev + 1) % filteredCiteRefs.length)
            return
          case "ArrowUp":
            e.preventDefault()
            setCiteSelectedIndex((prev) => (prev - 1 + filteredCiteRefs.length) % filteredCiteRefs.length)
            return
          case "Tab":
          case "Enter":
            if (filteredCiteRefs[citeSelectedIndex]) {
              e.preventDefault()
              insertCitation(filteredCiteRefs[citeSelectedIndex])
              return
            }
            break
          case "Escape":
            e.preventDefault()
            dismissCite()
            return
        }
      }

      // @ completion navigation (mentions + files combined)
      if (isActive && totalItems > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault()
            setSelectedIndex((prev) => (prev + 1) % totalItems)
            return
          case "ArrowUp":
            e.preventDefault()
            setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems)
            return
          case "Tab":
          case "Enter": {
            e.preventDefault()
            if (selectedIndex < filteredMentions.length) {
              insertMention(filteredMentions[selectedIndex])
            } else {
              const fileIdx = selectedIndex - filteredMentions.length
              if (files[fileIdx]) insertFile(files[fileIdx])
            }
            return
          }
          case "Escape":
            e.preventDefault()
            dismiss()
            return
        }
      }

      // Submit on Cmd+Enter / Ctrl+Enter (only when no dropdown is active)
      // Cmd+Enter = send, Shift+Enter = interrupt+send (steering shortcut)
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isActive && !slashActive && !citeActive && onSubmit) {
        e.preventDefault()
        onSubmit({ interrupt: e.shiftKey })
        return
      }
      if (e.key === "Enter" && e.shiftKey && !isActive && !slashActive && !citeActive && onSubmit) {
        e.preventDefault()
        onSubmit({ interrupt: true })
        return
      }

      onKeyDown?.(e)
    },
    [slashActive, filteredSlashCommands, slashSelectedIndex, insertSlashCommand, dismissSlash, citeActive, filteredCiteRefs, citeSelectedIndex, insertCitation, dismissCite, isActive, totalItems, filteredMentions, selectedIndex, insertFile, insertMention, files, dismiss, onSubmit, onKeyDown],
  )

  // Close dropdown on blur with delay (allows click on dropdown items)
  const handleBlur = useCallback(() => {
    setTimeout(() => { dismiss(); dismissSlash(); dismissCite() }, 150)
  }, [dismiss, dismissSlash, dismissCite])

  // Scroll selected item into view (file dropdown)
  useEffect(() => {
    if (!dropdownRef.current) return
    const item = dropdownRef.current.children[selectedIndex] as HTMLElement
    item?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  // Scroll selected item into view (slash dropdown)
  useEffect(() => {
    if (!slashDropdownRef.current) return
    const item = slashDropdownRef.current.children[slashSelectedIndex] as HTMLElement
    item?.scrollIntoView({ block: "nearest" })
  }, [slashSelectedIndex])

  // Scroll selected citation item into view
  useEffect(() => {
    if (!citeDropdownRef.current) return
    const items = citeDropdownRef.current.querySelectorAll('button')
    items[citeSelectedIndex]?.scrollIntoView({ block: "nearest" })
  }, [citeSelectedIndex])

  // Reposition dropdown on scroll/resize while active
  useEffect(() => {
    if (!isActive && !slashActive && !citeActive) return
    const update = () => {
      if (isActive) updateDropdownPosition()
      if (slashActive) updateSlashDropdownPosition()
      if (citeActive) setCiteDropdownPos(computeDropdownPosition())
    }
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [isActive, slashActive, citeActive, updateDropdownPosition, updateSlashDropdownPosition, computeDropdownPosition])

  const showDropdown = isActive && dropdownPos && (
    totalItems > 0 || loading || !canComplete
  )
  const showSlashDropdown = slashActive && slashDropdownPos && filteredSlashCommands.length > 0
  const showCiteDropdown = citeActive && citeDropdownPos && hasReferences

  const hasImages = (images?.length ?? 0) > 0 || pendingUploads > 0

  // Build mirror HTML: plain text shown in foreground color, [@key] wrapped in amber badge
  const mirrorHtml = useMemo(() => {
    if (!hasReferences) return ''
    const escaped = (value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return escaped.replace(
      /\[(@[^\]]*)\]/g,
      '<span class="citation-badge inline-flex items-center rounded px-1 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-700 mx-0.5 whitespace-nowrap">[$1]</span>'
    )
  }, [value, hasReferences])

  return (
    <>
      {/* Hidden div for measuring content height */}
      <div
        ref={hiddenDivRef}
        className={cn(
          className,
          "invisible absolute top-0 left-0 pointer-events-none",
          "whitespace-pre-wrap break-words overflow-hidden"
        )}
        style={{
          width: textareaRef.current?.offsetWidth || "100%",
        }}
        aria-hidden="true"
      />
      {/* Image thumbnails strip */}
      {hasImages && (
        <div className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-0.5">
          {images?.map((img) => (
            <div
              key={img.id}
              className="group relative h-14 w-14 rounded-md border border-border overflow-hidden bg-muted shrink-0"
            >
              <img
                src={img.url}
                alt={img.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemoveImage(img.id)}
                className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
          {pendingUploads > 0 && (
            <div className="h-14 w-14 rounded-md border border-dashed border-border flex items-center justify-center bg-muted shrink-0">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}
      {/* Hidden file input for paperclip button */}
      {onImagesChange && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            if (files.length) uploadImageFiles(files)
            e.target.value = '' // Reset so same file can be re-selected
          }}
        />
      )}
      <div className="relative flex-1 min-w-0">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onScroll={() => {
            if (mirrorRef.current && textareaRef.current) {
              mirrorRef.current.scrollTop = textareaRef.current.scrollTop
            }
          }}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={cn("w-full", className, "overflow-y-auto", hasReferences && "text-transparent placeholder:text-muted-foreground/60")}
          style={{
            maxHeight: "50vh",
            minHeight: `${rows * 1.5}em`,
            caretColor: "var(--foreground)",
          }}
        />
        {hasReferences && (
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className={cn(className, "absolute inset-0 pointer-events-none overflow-hidden whitespace-pre-wrap break-words bg-transparent border-transparent shadow-none resize-none")}
            style={{
              maxHeight: "50vh",
              minHeight: `${rows * 1.5}em`,
            }}
            dangerouslySetInnerHTML={{ __html: mirrorHtml || '\u00a0' }}
          />
        )}
      </div>
      {showDropdown &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: dropdownPos.top,
              bottom: dropdownPos.bottom,
              left: dropdownPos.left,
              width: dropdownPos.width,
            }}
            className={cn(
              "z-[9999] max-h-[320px] overflow-y-auto py-1",
              "rounded-md border border-border bg-popover shadow-md",
            )}
          >
            {/* Mention items (tasks/milestones) */}
            {filteredMentions.length > 0 && (
              <>
                {filteredMentions.length > 0 && files.length > 0 && (
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tasks</div>
                )}
                {filteredMentions.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                      "hover:bg-accent hover:text-accent-foreground cursor-pointer",
                      i === selectedIndex && "bg-accent text-accent-foreground",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertMention(item)
                    }}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    {item.kind === "special" ? (
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-info" />
                    ) : item.kind === "milestone" ? (
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-primary">◆</span>
                    ) : (
                      <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{item.label}</span>
                    {item.detail && (
                      <span className="ml-auto truncate text-[10px] text-muted-foreground max-w-[120px]">
                        {item.detail}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}
            {/* File completions */}
            {(files.length > 0 || loading || !canCompleteFiles) && (
              <>
                {filteredMentions.length > 0 && (files.length > 0 || loading) && (
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-t border-border mt-1 pt-1">Files</div>
                )}
                {files.map((file, i) => {
                  const combinedIdx = filteredMentions.length + i
                  return (
                    <button
                      key={file}
                      type="button"
                      className={cn(
                        "flex w-full items-center px-3 py-1.5 text-left text-xs font-mono",
                        "hover:bg-accent hover:text-accent-foreground cursor-pointer",
                        combinedIdx === selectedIndex && "bg-accent text-accent-foreground",
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        insertFile(file)
                      }}
                      onMouseEnter={() => setSelectedIndex(combinedIdx)}
                    >
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground mr-2" />
                      <span className="truncate">{file}</span>
                    </button>
                  )
                })}
                {!canCompleteFiles && filteredMentions.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Set a working directory in project settings to enable file references
                  </div>
                )}
                {canCompleteFiles && loading && files.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Searching files...
                  </div>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
      {showSlashDropdown &&
        createPortal(
          <div
            ref={slashDropdownRef}
            style={{
              position: "fixed",
              top: slashDropdownPos.top,
              bottom: slashDropdownPos.bottom,
              left: slashDropdownPos.left,
              width: slashDropdownPos.width,
            }}
            className={cn(
              "z-[9999] max-h-[240px] overflow-y-auto",
              "rounded-md border border-border bg-popover shadow-md",
            )}
          >
            {filteredSlashCommands.map((cmd, i) => (
              <button
                key={cmd.name}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  "hover:bg-accent hover:text-accent-foreground cursor-pointer",
                  i === slashSelectedIndex && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertSlashCommand(cmd)
                }}
                onMouseEnter={() => setSlashSelectedIndex(i)}
              >
                <span className="font-mono text-xs text-primary">{cmd.name}</span>
                <span className="text-xs text-muted-foreground truncate">{cmd.description}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      {showCiteDropdown &&
        createPortal(
          <div
            ref={citeDropdownRef}
            style={{
              position: "fixed",
              top: citeDropdownPos.top,
              bottom: citeDropdownPos.bottom,
              left: citeDropdownPos.left,
              width: citeDropdownPos.width,
            }}
            className="z-[9999] max-h-[320px] overflow-y-auto rounded-md border border-border bg-popover shadow-md"
          >
            <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-popover">
              References
            </div>
            <CitationDropdownContent
              refs={filteredCiteRefs}
              selectedIndex={citeSelectedIndex}
              onSelect={insertCitation}
              onHover={setCiteSelectedIndex}
              useMouseDown
            />
          </div>,
          document.body,
        )}
    </>
  )
}
