import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
  type ChangeEvent,
} from "react"
import { createPortal } from "react-dom"
import { FileCode2, Hash } from "lucide-react"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/api-url"

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

interface FileCompletionTextareaProps {
  projectId: string
  machineId?: string
  workingDirectory?: string
  fileTree?: string[]
  slashCommands?: SlashCommand[]
  mentionItems?: MentionItem[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
  disabled?: boolean
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit?: (opts?: { interrupt?: boolean }) => void
}

interface DropdownPosition {
  top: number
  left: number
  width: number
}

const DEBOUNCE_MS = 150

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
  value,
  onChange,
  placeholder,
  rows = 1,
  className,
  disabled,
  onKeyDown,
  onSubmit,
}: FileCompletionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const slashDropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const abortRef = useRef<AbortController>(undefined)
  const hiddenDivRef = useRef<HTMLDivElement>(null)

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
  const canComplete = hasMentionItems || hasFileTree || !!(workingDirectory || machineId)

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
    return {
      top: showAbove ? rect.top - maxDropdownHeight - 4 : rect.bottom + 4,
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
            const queryValid = hasMentionItems ? q.length <= 60 : !q.includes(" ")
            if (queryValid) {
              setAtIndex(lastAt)
              updateDropdownPosition()
              if (hasMentionItems) {
                setMentionQuery(q)
              } else if (canComplete) {
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
    },
    [onChange, slashCommands, debouncedFetch, filterFileTree, updateDropdownPosition, updateSlashDropdownPosition, dismiss, dismissSlash, canComplete, hasFileTree, hasMentionItems, autoResize],
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

      // @ completion navigation (mentions or files)
      const atItems = hasMentionItems ? filteredMentions : files
      if (isActive && atItems.length > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault()
            setSelectedIndex((prev) => (prev + 1) % atItems.length)
            return
          case "ArrowUp":
            e.preventDefault()
            setSelectedIndex((prev) => (prev - 1 + atItems.length) % atItems.length)
            return
          case "Tab":
          case "Enter":
            if (hasMentionItems && filteredMentions[selectedIndex]) {
              e.preventDefault()
              insertMention(filteredMentions[selectedIndex])
              return
            } else if (!hasMentionItems && files[selectedIndex]) {
              e.preventDefault()
              insertFile(files[selectedIndex])
              return
            }
            break
          case "Escape":
            e.preventDefault()
            dismiss()
            return
        }
      }

      // Submit on Enter (only when no dropdown is active)
      // Enter = queue (default), Shift+Enter = interrupt+send
      if (e.key === "Enter" && !isActive && !slashActive && onSubmit) {
        e.preventDefault()
        onSubmit({ interrupt: e.shiftKey })
        return
      }

      onKeyDown?.(e)
    },
    [slashActive, filteredSlashCommands, slashSelectedIndex, insertSlashCommand, dismissSlash, isActive, files, filteredMentions, hasMentionItems, selectedIndex, insertFile, insertMention, dismiss, onSubmit, onKeyDown],
  )

  // Close dropdown on blur with delay (allows click on dropdown items)
  const handleBlur = useCallback(() => {
    setTimeout(() => { dismiss(); dismissSlash() }, 150)
  }, [dismiss, dismissSlash])

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

  // Reposition dropdown on scroll/resize while active
  useEffect(() => {
    if (!isActive && !slashActive) return
    const update = () => {
      if (isActive) updateDropdownPosition()
      if (slashActive) updateSlashDropdownPosition()
    }
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [isActive, slashActive, updateDropdownPosition, updateSlashDropdownPosition])

  const showDropdown = isActive && dropdownPos && (
    hasMentionItems
      ? filteredMentions.length > 0
      : (files.length > 0 || loading || !canComplete)
  )
  const showSlashDropdown = slashActive && slashDropdownPos && filteredSlashCommands.length > 0

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
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={cn(className, "overflow-y-auto")}
        style={{
          maxHeight: "50vh",
          minHeight: `${rows * 1.5}em`, // Preserve initial rows as min-height
        }}
      />
      {showDropdown &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
            }}
            className={cn(
              "z-[9999] overflow-y-auto",
              hasMentionItems ? "max-h-[280px] py-1" : "max-h-[240px]",
              "rounded-md border border-border bg-popover shadow-md",
            )}
          >
            {hasMentionItems ? (
              filteredMentions.map((item, i) => (
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
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
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
              ))
            ) : (
              <>
                {files.map((file, i) => (
                  <button
                    key={file}
                    type="button"
                    className={cn(
                      "flex w-full items-center px-3 py-1.5 text-left text-xs font-mono",
                      "hover:bg-accent hover:text-accent-foreground cursor-pointer",
                      i === selectedIndex && "bg-accent text-accent-foreground",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertFile(file)
                    }}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <span className="truncate">{file}</span>
                  </button>
                ))}
                {!canComplete && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Set a working directory in project settings to enable file references
                  </div>
                )}
                {canComplete && loading && files.length === 0 && (
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
    </>
  )
}
