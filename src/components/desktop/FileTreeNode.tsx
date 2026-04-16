/**
 * FileTreeNode — single node in the desktop file tree.
 * Ported from the legacy Tauri shell.
 *
 * Space key on a focused node triggers Quick Look.
 */
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Eye,
} from 'lucide-react'
import { useRef } from 'react'

import { cn } from '@/lib/utils'
import type { FileNode, GitFileStatus } from '@/stores/desktop-file-store'

interface FileTreeNodeProps {
  node: FileNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  /** Called when the user presses Space or clicks the eye icon on a file. */
  onQuickLook?: (path: string) => void
}

const GIT_STATUS_COLORS: Record<GitFileStatus, string> = {
  modified: 'text-yellow-400',
  staged: 'text-green-400',
  untracked: 'text-emerald-300',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
  conflict: 'text-red-500',
  clean: '',
}

const GIT_STATUS_LABELS: Record<GitFileStatus, string> = {
  modified: 'M',
  staged: 'S',
  untracked: 'U',
  deleted: 'D',
  renamed: 'R',
  conflict: '!',
  clean: '',
}

export function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  onToggle,
  onQuickLook,
}: FileTreeNodeProps) {
  const isSelected = node.path === selectedPath
  const isExpanded = node.expanded ?? false
  const gitStatus = node.gitStatus
  const hasGitStatus = gitStatus && gitStatus !== 'clean'
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleClick = () => {
    if (node.isDir) {
      onToggle(node.path)
    } else {
      onSelect(node.path)
    }
  }

  const handleDoubleClick = () => {
    if (!node.isDir && onQuickLook) {
      onQuickLook(node.path)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' && !node.isDir && onQuickLook) {
      e.preventDefault()
      e.stopPropagation()
      onQuickLook(node.path)
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'group flex items-center gap-1 w-full text-left text-xs py-[3px] px-1 rounded-sm',
          'hover:bg-muted/60 transition-colors duration-75',
          isSelected && 'bg-muted text-foreground',
          !isSelected && 'text-muted-foreground',
          hasGitStatus && GIT_STATUS_COLORS[gitStatus],
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        title={node.path}
      >
        {node.isDir ? (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        ) : (
          <span className="w-3.5 h-3.5 flex-shrink-0" />
        )}

        {node.isDir ? (
          isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-primary/70" />
          ) : (
            <Folder className="w-3.5 h-3.5 flex-shrink-0 text-primary/70" />
          )
        ) : (
          <File className="w-3.5 h-3.5 flex-shrink-0" />
        )}

        <span className="truncate flex-1">{node.name}</span>

        {hasGitStatus && (
          <span
            className={cn(
              'text-[10px] font-mono flex-shrink-0 ml-1',
              GIT_STATUS_COLORS[gitStatus],
            )}
            title={gitStatus}
          >
            {GIT_STATUS_LABELS[gitStatus]}
          </span>
        )}

        {/* Quick Look trigger — only for files, visible on hover/focus */}
        {!node.isDir && onQuickLook && (
          <span
            role="button"
            tabIndex={-1}
            title="Quick Look (Space)"
            onClick={(e) => {
              e.stopPropagation()
              onQuickLook(node.path)
            }}
            className={cn(
              'flex-shrink-0 ml-0.5 rounded p-0.5',
              'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
              'transition-opacity duration-75',
              'text-muted-foreground/60 hover:text-muted-foreground',
            )}
          >
            <Eye className="w-2.5 h-2.5" />
          </span>
        )}
      </button>

      {node.isDir && isExpanded && node.children && (
        <>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onToggle={onToggle}
              onQuickLook={onQuickLook}
            />
          ))}
        </>
      )}
    </>
  )
}
