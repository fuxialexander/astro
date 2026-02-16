import { Check, ChevronRight } from "lucide-react"
import type { CommandItem as CommandItemType } from "@/types"
import { formatShortcut } from "@/lib/commands"

interface CommandItemProps {
  item: CommandItemType
  isSelected: boolean
  isMultiSelected: boolean
  matchScore?: number
  searchQuery?: string
  onSelect: () => void
  onMultiSelect?: () => void
  multiSelectEnabled?: boolean
  itemIndex: number
  numberShortcut?: number
}

export function CommandItem({
  item,
  isSelected,
  isMultiSelected,
  matchScore,
  searchQuery,
  onSelect,
  onMultiSelect,
  multiSelectEnabled,
  itemIndex,
  numberShortcut,
}: CommandItemProps) {
  const Icon = item.icon
  const hasChildren = item.children && item.children.length > 0

  const handleClick = (e: React.MouseEvent) => {
    if (multiSelectEnabled && (e.metaKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault()
      onMultiSelect?.()
    } else {
      onSelect()
    }
  }

  return (
    <div
      className="command-item"
      data-selected={isSelected}
      data-multi-selected={isMultiSelected}
      onClick={handleClick}
      style={{ '--item-index': itemIndex } as React.CSSProperties}
    >
      {/* Match score indicator */}
      {matchScore !== undefined && (
        <div
          className="match-score-bar"
          style={{ opacity: matchScore / 100 }}
        />
      )}

      {/* Multi-select checkbox */}
      {multiSelectEnabled && (
        <div
          className="command-checkbox"
          data-checked={isMultiSelected}
        >
          {isMultiSelected && <Check className="w-3 h-3" />}
        </div>
      )}

      {/* Icon */}
      {Icon && (
        <div className="command-item-icon">
          <Icon className="w-4 h-4" />
        </div>
      )}

      {/* Content */}
      <div className="command-item-content">
        <div className="command-item-label">
          <HighlightedText text={item.label} query={searchQuery} />
        </div>
        {item.description && (
          <div className="command-item-description">{item.description}</div>
        )}
      </div>

      {/* Number shortcut */}
      {numberShortcut && (
        <kbd className="shortcut-badge number-shortcut">{numberShortcut}</kbd>
      )}

      {/* Keyboard shortcut */}
      {!numberShortcut && item.shortcut && (
        <kbd className="shortcut-badge">{formatShortcut(item.shortcut)}</kbd>
      )}

      {/* Nested indicator */}
      {hasChildren && (
        <ChevronRight className="w-3 h-3" style={{ color: 'var(--cp-text-tertiary)' }} />
      )}
    </div>
  )
}

/**
 * Highlight matching text in search query
 */
function HighlightedText({ text, query }: { text: string; query?: string }) {
  if (!query || query.length < 2) {
    return <span>{text}</span>
  }

  const regex = new RegExp(`(${escapeRegex(query)})`, "gi")
  const parts = text.split(regex)

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} className="command-highlight">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
