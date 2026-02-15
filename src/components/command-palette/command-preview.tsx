import type { CommandItem } from "@/types"

interface CommandPreviewProps {
  item: CommandItem | null
}

export function CommandPreview({ item }: CommandPreviewProps) {
  if (!item || !item.preview) {
    return null
  }

  const { preview } = item

  return (
    <div className="command-preview-container">
      <div className="command-preview">
        <div className="command-preview-title">{preview.title}</div>
        <div className="command-preview-content">{preview.content}</div>

        {preview.metadata && Object.keys(preview.metadata).length > 0 && (
          <div className="command-preview-metadata">
            {Object.entries(preview.metadata).map(([key, value]) => (
              <div key={key} className="command-preview-meta-item">
                <span className="command-preview-meta-label">{key}</span>
                <span className="command-preview-meta-value">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
