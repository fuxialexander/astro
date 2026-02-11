import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

interface FileCompletionTextareaProps {
  projectId: string
  machineId?: string
  workingDirectory?: string
  fileTree?: string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit?: () => void
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
  value,
  onChange,
  placeholder,
  rows = 1,
  className,
  onKeyDown,
  onSubmit,
}: FileCompletionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const abortRef = useRef<AbortController>(undefined)

  // Completion state: track if we're actively completing and the '@' position
  const [atIndex, setAtIndex] = useState(-1)
  const [files, setFiles] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null)

  const isActive = atIndex >= 0
  const hasFileTree = !!(fileTree && fileTree.length > 0)
  const canComplete = hasFileTree || !!(workingDirectory || machineId)

  // Compute dropdown position from textarea bounding rect
  const updateDropdownPosition = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const rect = textarea.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    })
  }, [])

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

        const res = await fetch(`/api/fs/files?${params}`, {
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

  // Dismiss the completion
  const dismiss = useCallback(() => {
    setAtIndex(-1)
    setFiles([])
    setLoading(false)
    setDropdownPos(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()
  }, [])

  // Detect @-trigger on value change
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const cursorPos = e.target.selectionStart

      onChange(newValue)

      if (cursorPos > 0) {
        const beforeCursor = newValue.slice(0, cursorPos)
        const lastAt = beforeCursor.lastIndexOf("@")

        if (lastAt >= 0) {
          const charBefore = lastAt > 0 ? newValue[lastAt - 1] : " "
          if (charBefore === " " || charBefore === "\n" || lastAt === 0) {
            const q = beforeCursor.slice(lastAt + 1)
            if (!q.includes(" ")) {
              setAtIndex(lastAt)
              updateDropdownPosition()
              if (canComplete) {
                // Prefer client-side filtering when fileTree is cached and no remote machine
                if (hasFileTree && !machineId) {
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
    [onChange, debouncedFetch, filterFileTree, updateDropdownPosition, dismiss, canComplete, hasFileTree, machineId],
  )

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

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isActive && files.length > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault()
            setSelectedIndex((prev) => (prev + 1) % files.length)
            return
          case "ArrowUp":
            e.preventDefault()
            setSelectedIndex((prev) => (prev - 1 + files.length) % files.length)
            return
          case "Tab":
          case "Enter":
            if (files[selectedIndex]) {
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

      // Submit on Enter without Shift (only when dropdown is not active)
      if (e.key === "Enter" && !e.shiftKey && !isActive && onSubmit) {
        e.preventDefault()
        onSubmit()
        return
      }

      onKeyDown?.(e)
    },
    [isActive, files, selectedIndex, insertFile, dismiss, onSubmit, onKeyDown],
  )

  // Close dropdown on blur with delay (allows click on dropdown items)
  const handleBlur = useCallback(() => {
    setTimeout(dismiss, 150)
  }, [dismiss])

  // Scroll selected item into view
  useEffect(() => {
    if (!dropdownRef.current) return
    const item = dropdownRef.current.children[selectedIndex] as HTMLElement
    item?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  // Reposition dropdown on scroll/resize while active
  useEffect(() => {
    if (!isActive) return
    const update = () => updateDropdownPosition()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [isActive, updateDropdownPosition])

  const showDropdown = isActive && dropdownPos && (files.length > 0 || loading || !canComplete)

  return (
    <>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={rows}
        className={className}
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
              "z-[9999] max-h-[240px] overflow-y-auto",
              "rounded-md border border-border bg-popover shadow-md",
            )}
          >
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
                  e.preventDefault() // prevent textarea blur
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
          </div>,
          document.body,
        )}
    </>
  )
}
