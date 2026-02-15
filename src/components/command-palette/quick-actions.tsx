interface QuickActionsProps {
  selectedCount: number
  onClearSelection?: () => void
}

export function QuickActions({ selectedCount, onClearSelection }: QuickActionsProps) {
  if (selectedCount === 0) {
    return (
      <div className="keyboard-hints">
        <div className="keyboard-hint">
          <kbd>↑↓</kbd>
          <span>Navigate</span>
        </div>
        <div className="keyboard-hint">
          <kbd>↵</kbd>
          <span>Open</span>
        </div>
        <div className="keyboard-hint">
          <kbd>esc</kbd>
          <span>Close</span>
        </div>
      </div>
    )
  }

  return (
    <div className="keyboard-hints">
      <div className="keyboard-hint">
        <span>{selectedCount} selected</span>
      </div>
      {onClearSelection && (
        <button
          onClick={onClearSelection}
          className="breadcrumb-item"
        >
          Clear selection
        </button>
      )}
    </div>
  )
}
