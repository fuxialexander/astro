import { FileCompletionTextarea } from "./file-completion-textarea"

export type { MentionItem } from "./file-completion-textarea"

interface MentionTextareaProps {
  value: string
  onChange: (value: string) => void
  items: import("./file-completion-textarea").MentionItem[]
  placeholder?: string
  rows?: number
  className?: string
  disabled?: boolean
  onSubmit?: () => void
}

/**
 * A textarea with @-triggered mention autocomplete.
 * Thin wrapper around FileCompletionTextarea with mentionItems mode.
 */
export function MentionTextarea({
  items,
  disabled,
  onSubmit,
  ...rest
}: MentionTextareaProps) {
  return (
    <FileCompletionTextarea
      projectId=""
      mentionItems={items}
      disabled={disabled}
      onSubmit={onSubmit ? () => onSubmit() : undefined}
      {...rest}
    />
  )
}
