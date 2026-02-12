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

export interface MentionItem {
  id: string
  label: string
  /** Secondary text shown in the dropdown */
  detail?: string
  /** Icon category for styling */
  kind: "task" | "milestone" | "special"
}

interface MentionTextareaProps {
  value: string
  onChange: (value: string) => void
  items: MentionItem[]
  placeholder?: string
  rows?: number
  className?: string
  disabled?: boolean
  onSubmit?: () => void
}

interface DropdownPosition {
  top: number
  left: number
  width: number
}

/**
 * A textarea with @-triggered mention autocomplete.
 * Renders a portal dropdown listing tasks, milestones, and special items.
 */
export function MentionTextarea({
  value,
  onChange,
  items,
  placeholder,
  rows = 1,
  className,
  disabled,
  onSubmit,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [atIndex, setAtIndex] = useState(-1)
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null)

  const isActive = atIndex >= 0

  // Filter items by query
  const filtered = useMemo(() => {
    if (!isActive) return []
    const q = query.toLowerCase()
    return items.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.detail?.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [items, query, isActive])

  const updateDropdownPosition = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const rect = textarea.getBoundingClientRect()
    // Position dropdown above the textarea if closer to bottom of viewport
    const spaceBelow = window.innerHeight - rect.bottom
    const dropdownHeight = Math.min(filtered.length * 36 + 8, 280)
    const showAbove = spaceBelow < dropdownHeight + 8

    setDropdownPos({
      top: showAbove ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 300),
    })
  }, [filtered.length])

  const dismiss = useCallback(() => {
    setAtIndex(-1)
    setQuery("")
    setSelectedIndex(0)
    setDropdownPos(null)
  }, [])

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
            // Allow spaces in task names but cap at 60 chars
            if (q.length <= 60) {
              setAtIndex(lastAt)
              setQuery(q)
              setSelectedIndex(0)
              updateDropdownPosition()
              return
            }
          }
        }
      }

      dismiss()
    },
    [onChange, updateDropdownPosition, dismiss],
  )

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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isActive && filtered.length > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault()
            setSelectedIndex((prev) => (prev + 1) % filtered.length)
            return
          case "ArrowUp":
            e.preventDefault()
            setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
            return
          case "Tab":
          case "Enter":
            if (filtered[selectedIndex]) {
              e.preventDefault()
              insertMention(filtered[selectedIndex])
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
    },
    [isActive, filtered, selectedIndex, insertMention, dismiss, onSubmit],
  )

  const handleBlur = useCallback(() => {
    setTimeout(dismiss, 150)
  }, [dismiss])

  // Scroll selected item into view
  useEffect(() => {
    if (!dropdownRef.current) return
    const item = dropdownRef.current.children[selectedIndex] as HTMLElement
    item?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  // Reposition on scroll/resize
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

  const showDropdown = isActive && dropdownPos && filtered.length > 0

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
        disabled={disabled}
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
              "z-[9999] max-h-[280px] overflow-y-auto py-1",
              "rounded-md border border-border bg-popover shadow-md",
            )}
          >
            {filtered.map((item, i) => (
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
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
