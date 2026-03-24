/**
 * FileTreeNode — a single node in the file tree.
 *
 * Shows file/folder icon, name, git status indicator, and handles
 * expand/collapse for directories.
 */
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
} from 'lucide-react'

import { cn } from '@desktop/lib/utils'
import type { FileNode, GitFileStatus } from '@desktop/stores/file-store'

interface FileTreeNodeProps {
  node: FileNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  onToggle: (path: string) => void
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
}: FileTreeNodeProps) {
  const isSelected = node.path === selectedPath
  const isExpanded = node.expanded ?? false
  const gitStatus = node.gitStatus
  const hasGitStatus = gitStatus && gitStatus !== 'clean'

  const handleClick = () => {
    if (node.isDir) {
      onToggle(node.path)
    } else {
      onSelect(node.path)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        className={cn(
          'flex items-center gap-1 w-full text-left text-xs py-[3px] px-1 rounded-sm',
          'hover:bg-muted/60 transition-colors duration-75',
          isSelected && 'bg-muted text-foreground',
          !isSelected && 'text-muted-foreground',
          hasGitStatus && GIT_STATUS_COLORS[gitStatus],
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        title={node.path}
      >
        {/* Expand/collapse arrow for directories */}
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

        {/* File/folder icon */}
        {node.isDir ? (
          isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-primary/70" />
          ) : (
            <Folder className="w-3.5 h-3.5 flex-shrink-0 text-primary/70" />
          )
        ) : (
          <File className="w-3.5 h-3.5 flex-shrink-0" />
        )}

        {/* File name */}
        <span className="truncate flex-1">{node.name}</span>

        {/* Git status badge */}
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
      </button>

      {/* Render children if expanded */}
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
            />
          ))}
        </>
      )}
    </>
  )
}
