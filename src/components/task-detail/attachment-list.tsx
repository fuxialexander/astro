import { useState, useCallback, useRef } from 'react'
import {
  Paperclip,
  Upload,
  X,
  Image as ImageIcon,
  FileText,
  File,
  Download,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TaskAttachment } from '@/types'

interface AttachmentListProps {
  attachments: TaskAttachment[]
  onAdd: (attachment: TaskAttachment) => void
  onRemove: (attachmentId: string) => void
  readOnly?: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return ImageIcon
  if (mimeType.includes('pdf') || mimeType.includes('document')) return FileText
  return File
}

export function AttachmentList({
  attachments,
  onAdd,
  onRemove,
  readOnly = false,
}: AttachmentListProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return

      setIsUploading(true)
      try {
        for (const file of Array.from(files)) {
          // For now, we'll create a local blob URL
          // In production, this would upload to a file storage service
          const url = URL.createObjectURL(file)

          // Generate thumbnail for images
          let thumbnailUrl: string | undefined
          if (file.type.startsWith('image/')) {
            thumbnailUrl = url // Use same URL for now
          }

          const attachment: TaskAttachment = {
            id: crypto.randomUUID(),
            name: file.name,
            url,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            uploadedAt: new Date(),
            thumbnailUrl,
          }

          onAdd(attachment)
        }
      } finally {
        setIsUploading(false)
      }
    },
    [onAdd]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      handleFileSelect(e.dataTransfer.files)
    },
    [handleFileSelect]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleUrlAdd = useCallback(() => {
    if (!urlInput.trim()) return

    // Try to extract filename from URL
    const urlParts = urlInput.split('/')
    const name = urlParts[urlParts.length - 1] || 'Linked file'

    // Guess mime type from extension
    const ext = name.split('.').pop()?.toLowerCase()
    let mimeType = 'application/octet-stream'
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) {
      mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
    } else if (ext === 'pdf') {
      mimeType = 'application/pdf'
    }

    const attachment: TaskAttachment = {
      id: crypto.randomUUID(),
      name,
      url: urlInput,
      mimeType,
      size: 0, // Unknown for URL attachments
      uploadedAt: new Date(),
      thumbnailUrl: mimeType.startsWith('image/') ? urlInput : undefined,
    }

    onAdd(attachment)
    setUrlInput('')
    setShowUrlInput(false)
  }, [urlInput, onAdd])

  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith('image/'))
  const otherAttachments = attachments.filter((a) => !a.mimeType.startsWith('image/'))

  return (
    <div className="space-y-4">
      {/* Upload area */}
      {!readOnly && (
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
            isDragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />

          <Paperclip className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            Drag and drop files here, or
          </p>

          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Upload className="h-4 w-4 mr-1.5" />
              )}
              Browse files
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUrlInput(!showUrlInput)}
            >
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Add URL
            </Button>
          </div>

          {showUrlInput && (
            <div className="flex items-center gap-2 mt-3 max-w-md mx-auto">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://..."
                className="flex-1 h-8 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => e.key === 'Enter' && handleUrlAdd()}
              />
              <Button size="sm" onClick={handleUrlAdd} disabled={!urlInput.trim()}>
                Add
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Image gallery */}
      {imageAttachments.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Images ({imageAttachments.length})
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {imageAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted"
              >
                <img
                  src={attachment.thumbnailUrl || attachment.url}
                  alt={attachment.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    title="Open"
                  >
                    <ExternalLink className="h-4 w-4 text-white" />
                  </a>
                  {!readOnly && (
                    <button
                      onClick={() => onRemove(attachment.id)}
                      className="p-2 rounded-full bg-white/20 hover:bg-destructive/80 transition-colors"
                      title="Remove"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  )}
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
                  <p className="text-xs text-white truncate">{attachment.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other files */}
      {otherAttachments.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Files ({otherAttachments.length})
          </h4>
          <div className="space-y-2">
            {otherAttachments.map((attachment) => {
              const FileIcon = getFileIcon(attachment.mimeType)
              return (
                <div
                  key={attachment.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <FileIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{attachment.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {attachment.size > 0 && formatFileSize(attachment.size)}
                      {attachment.size > 0 && ' • '}
                      {new Date(attachment.uploadedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <a
                      href={attachment.url}
                      download={attachment.name}
                      className="p-2 rounded-md hover:bg-accent transition-colors"
                      title="Download"
                    >
                      <Download className="h-4 w-4 text-muted-foreground" />
                    </a>
                    {!readOnly && (
                      <button
                        onClick={() => onRemove(attachment.id)}
                        className="p-2 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title="Remove"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {attachments.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Paperclip className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No attachments yet</p>
          {!readOnly && (
            <p className="text-xs mt-1">
              Upload files or images to add context to this task
            </p>
          )}
        </div>
      )}
    </div>
  )
}
