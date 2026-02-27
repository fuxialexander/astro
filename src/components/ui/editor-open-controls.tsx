/**
 * Editor Open Controls
 *
 * Shared toggle badges for Local/Remote and Cursor/VSCode selection,
 * plus an "Open in Editor" link. Used in project overview and file sidebar.
 */

import { useState } from "react"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { buildFileUrlSync } from "@/lib/path-utils"

export type EditorType = 'cursor' | 'vscode'

interface EditorOpenControlsProps {
  /** Path to open in editor */
  path: string
  /** Machine info for remote SSH URLs */
  machine?: { name?: string; hostname?: string }
  /** Initial editor type */
  defaultEditor?: EditorType
  /** Initial local/remote mode */
  defaultLocal?: boolean
  /** Callback when editor type changes */
  onEditorChange?: (editor: EditorType) => void
  /** Callback when local/remote changes */
  onLocalChange?: (local: boolean) => void
  /** Hide the "Open in Editor" link */
  hideOpenLink?: boolean
  /** Additional class name for the container */
  className?: string
}

export function EditorOpenControls({
  path,
  machine,
  defaultEditor = 'cursor',
  defaultLocal = true,
  onEditorChange,
  onLocalChange,
  hideOpenLink = false,
  className,
}: EditorOpenControlsProps) {
  const [useLocal, setUseLocal] = useState(defaultLocal)
  const [editor, setEditor] = useState<EditorType>(defaultEditor)

  const handleToggleLocal = () => {
    const next = !useLocal
    setUseLocal(next)
    onLocalChange?.(next)
  }

  const handleToggleEditor = () => {
    const next: EditorType = editor === 'cursor' ? 'vscode' : 'cursor'
    setEditor(next)
    onEditorChange?.(next)
  }

  const forceLocal = useLocal ? true : 'remote' as const
  const editorUrl = buildFileUrlSync(path, undefined, machine as Parameters<typeof buildFileUrlSync>[2], forceLocal, editor)

  return (
    <div className={className ?? "flex items-center gap-1.5"} onClick={(e) => e.stopPropagation()}>
      <Badge
        variant="outline"
        className="cursor-pointer hover:bg-muted transition-colors text-[10px] h-6 px-2"
        onClick={handleToggleLocal}
      >
        {useLocal ? "Local" : "Remote"}
      </Badge>
      <Badge
        variant="outline"
        className="cursor-pointer hover:bg-muted transition-colors text-[10px] h-6 px-2"
        onClick={handleToggleEditor}
      >
        {editor === 'vscode' ? "VSCode" : "Cursor"}
      </Badge>
      {!hideOpenLink && editorUrl && (
        <a
          href={editorUrl}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors h-6"
        >
          <ExternalLink className="h-3 w-3 text-primary" />
          <span className="text-[10px] font-medium text-primary">Open</span>
        </a>
      )}
    </div>
  )
}
