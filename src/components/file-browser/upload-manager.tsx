/**
 * UploadManager — Upload progress overlay panel
 *
 * Displays per-file progress bars with status indicators,
 * cancel/retry/dismiss actions, and overwrite confirmation dialogs.
 */

import { X, Check, AlertCircle, RotateCcw, Loader2, Ban, ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import type {
  UploadFileEntry,
  OverwritePendingEntry,
  ValidationError,
} from "./use-file-upload"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UploadManagerProps {
  uploads: UploadFileEntry[]
  overwritePending: OverwritePendingEntry[]
  validationErrors: ValidationError[]
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onDismiss: (id: string) => void
  onClearCompleted: () => void
  onConfirmOverwrite: (id: string) => void
  onRejectOverwrite: (id: string) => void
  onDismissValidationError: (index: number) => void
}

// ---------------------------------------------------------------------------
// Upload item row
// ---------------------------------------------------------------------------

function UploadItem({
  entry,
  onCancel,
  onRetry,
  onDismiss,
}: {
  entry: UploadFileEntry
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onDismiss: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      {/* Status icon */}
      <div className="shrink-0 w-4 h-4 flex items-center justify-center">
        {entry.status === "uploading" && (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        )}
        {entry.status === "pending" && (
          <div className="h-2 w-2 rounded-full bg-muted-foreground/50" />
        )}
        {entry.status === "complete" && (
          <Check className="h-3 w-3 text-green-500" />
        )}
        {entry.status === "error" && (
          <AlertCircle className="h-3 w-3 text-destructive" />
        )}
        {entry.status === "cancelled" && (
          <Ban className="h-3 w-3 text-muted-foreground" />
        )}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{entry.name}</span>
          <span className="text-muted-foreground shrink-0">
            {formatFileSize(entry.size)}
          </span>
        </div>

        {/* Progress bar */}
        {(entry.status === "uploading" || entry.status === "pending") && (
          <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${entry.progress}%` }}
            />
          </div>
        )}

        {/* Error message */}
        {entry.status === "error" && entry.error && (
          <p className="mt-0.5 text-destructive truncate">{entry.error}</p>
        )}
      </div>

      {/* Progress % */}
      {entry.status === "uploading" && (
        <span className="text-muted-foreground shrink-0 tabular-nums w-8 text-right">
          {entry.progress}%
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {(entry.status === "uploading" || entry.status === "pending") && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => onCancel(entry.id)}
            title="Cancel upload"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
        {entry.status === "error" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => onRetry(entry.id)}
            title="Retry upload"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
        {(entry.status === "complete" || entry.status === "error" || entry.status === "cancelled") && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => onDismiss(entry.id)}
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overwrite confirmation dialog
// ---------------------------------------------------------------------------

function OverwriteDialog({
  entry,
  onConfirm,
  onReject,
}: {
  entry: OverwritePendingEntry
  onConfirm: (id: string) => void
  onReject: (id: string) => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onReject(entry.id)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Overwrite file?</DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-mono bg-muted px-1 py-0.5 rounded">
              {entry.existingName}
            </span>{" "}
            already exists in this directory. Do you want to replace it?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReject(entry.id)}
          >
            Skip
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => onConfirm(entry.id)}
          >
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UploadManager({
  uploads,
  overwritePending,
  validationErrors,
  onCancel,
  onRetry,
  onDismiss,
  onClearCompleted,
  onConfirmOverwrite,
  onRejectOverwrite,
  onDismissValidationError,
}: UploadManagerProps) {
  const [collapsed, setCollapsed] = useState(false)

  const hasUploads = uploads.length > 0
  const hasValidationErrors = validationErrors.length > 0
  const hasOverwritePending = overwritePending.length > 0
  const hasCompletedOrErrored = uploads.some(
    (u) => u.status === "complete" || u.status === "error" || u.status === "cancelled"
  )
  const activeCount = uploads.filter(
    (u) => u.status === "uploading" || u.status === "pending"
  ).length

  if (!hasUploads && !hasValidationErrors && !hasOverwritePending) return null

  return (
    <>
      {/* Overwrite confirmation dialogs (one at a time) */}
      {overwritePending[0] && (
        <OverwriteDialog
          entry={overwritePending[0]}
          onConfirm={onConfirmOverwrite}
          onReject={onRejectOverwrite}
        />
      )}

      {/* Upload panel */}
      <div className="absolute bottom-0 left-0 right-0 z-40 bg-background border-t border-border shadow-lg">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-foreground/80"
          >
            {collapsed ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {activeCount > 0
              ? `Uploading ${activeCount} file${activeCount > 1 ? "s" : ""}...`
              : "Uploads"}
          </button>
          <div className="flex-1" />
          {hasCompletedOrErrored && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] px-1.5"
              onClick={onClearCompleted}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Content */}
        {!collapsed && (
          <div className="max-h-[200px] overflow-y-auto">
            {/* Validation errors */}
            {validationErrors.map((err, index) => (
              <div
                key={`val-${index}`}
                className="flex items-center gap-2 px-3 py-1.5 text-xs bg-destructive/5"
              >
                <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate">{err.fileName}</span>
                  <p className="text-destructive mt-0.5">{err.message}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => onDismissValidationError(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {/* Upload entries */}
            {uploads.map((entry) => (
              <UploadItem
                key={entry.id}
                entry={entry}
                onCancel={onCancel}
                onRetry={onRetry}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
