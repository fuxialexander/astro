import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"

interface InlineRenameInputProps {
  value: string
  onSave: (newValue: string) => void
  onCancel: () => void
  validate?: (value: string) => string | null // Returns error message or null
  className?: string
  autoFocus?: boolean
}

/**
 * Inline rename input component with validation.
 * Saves on Enter/blur, cancels on Escape.
 */
export function InlineRenameInput({
  value,
  onSave,
  onCancel,
  validate,
  className,
  autoFocus = true,
}: InlineRenameInputProps) {
  const [editValue, setEditValue] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [autoFocus])

  const handleSave = () => {
    const trimmed = editValue.trim()

    // Validate
    if (validate) {
      const validationError = validate(trimmed)
      if (validationError) {
        setError(validationError)
        return
      }
    }

    // No change
    if (trimmed === value) {
      onCancel()
      return
    }

    onSave(trimmed)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSave()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => {
          setEditValue(e.target.value)
          setError(null) // Clear error on change
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        className={cn(
          "px-2 py-1 text-sm border rounded bg-background",
          error ? "border-destructive" : "border-border",
          className
        )}
      />
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  )
}
