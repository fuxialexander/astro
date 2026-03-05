/**
 * useFileUpload — Hook for file upload with validation, chunked upload, and progress tracking
 *
 * Features:
 * - Client-side validation (50MB limit)
 * - Overwrite detection against current directory entries
 * - Chunked upload (~1MB chunks) via POST to /api/fs/content
 * - Per-file progress tracking
 * - Sequential multi-file upload
 * - Post-upload directory refresh
 * - Error handling with retry
 */

import { useState, useCallback, useRef } from "react"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import type { DirectoryEntry } from "./use-file-browser"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadFileStatus = "pending" | "uploading" | "complete" | "error" | "cancelled"

export interface UploadFileEntry {
  id: string
  file: File
  name: string
  size: number
  progress: number // 0-100
  status: UploadFileStatus
  error?: string
}

export interface UseFileUploadOptions {
  machineId: string
  currentPath: string
  currentEntries: DirectoryEntry[]
  onRefresh: () => void
}

export interface UseFileUploadReturn {
  /** Currently tracked upload entries */
  uploads: UploadFileEntry[]
  /** Whether any upload is in progress */
  isUploading: boolean
  /** Start uploading files (from picker or drop) */
  startUpload: (files: File[]) => void
  /** Cancel a specific file upload */
  cancelUpload: (id: string) => void
  /** Retry a failed upload */
  retryUpload: (id: string) => void
  /** Dismiss completed/errored uploads from the list */
  dismissUpload: (id: string) => void
  /** Clear all completed/errored uploads */
  clearCompleted: () => void
  /** Files pending overwrite confirmation: { file, existingName } */
  overwritePending: OverwritePendingEntry[]
  /** Confirm overwrite for a pending file */
  confirmOverwrite: (id: string) => void
  /** Reject overwrite (skip file) */
  rejectOverwrite: (id: string) => void
  /** Validation errors (files over 50MB) */
  validationErrors: ValidationError[]
  /** Dismiss a validation error */
  dismissValidationError: (index: number) => void
}

export interface OverwritePendingEntry {
  id: string
  file: File
  existingName: string
}

export interface ValidationError {
  fileName: string
  message: string
}

// ---------------------------------------------------------------------------
// Upload API — single POST with XHR for progress tracking
// ---------------------------------------------------------------------------

async function uploadWithProgress(
  machineId: string,
  destinationPath: string,
  file: File,
  overwrite: boolean,
  onProgress: (progress: number) => void,
  abortSignal: AbortSignal
): Promise<{ success: boolean; path?: string; error?: string }> {
  const token = await getAccessToken()

  const formData = new FormData()
  formData.append("machineId", machineId)
  formData.append("destinationPath", destinationPath)
  formData.append("file", file)
  formData.append("overwrite", overwrite ? "true" : "false")

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    // Track upload progress
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        // Upload progress = data sent to server (0-90%)
        // Reserve 10% for server-side relay processing
        onProgress(Math.round((e.loaded / e.total) * 90))
      }
    })

    xhr.addEventListener("load", () => {
      onProgress(100)
      try {
        const body = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body)
        } else {
          reject(new Error(body.error || `Upload failed: ${xhr.statusText}`))
        }
      } catch {
        reject(new Error(`Upload failed: ${xhr.statusText}`))
      }
    })

    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed: network error"))
    })

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"))
    })

    // Handle abort signal
    const onAbort = () => xhr.abort()
    abortSignal.addEventListener("abort", onAbort)
    xhr.addEventListener("loadend", () => {
      abortSignal.removeEventListener("abort", onAbort)
    })

    xhr.open("POST", apiUrl("/api/fs/content"))
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    }
    xhr.send(formData)
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileUpload({
  machineId,
  currentPath,
  currentEntries,
  onRefresh,
}: UseFileUploadOptions): UseFileUploadReturn {
  const [uploads, setUploads] = useState<UploadFileEntry[]>([])
  const [overwritePending, setOverwritePending] = useState<OverwritePendingEntry[]>([])
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])

  // Track abort controllers per upload id
  const abortControllers = useRef<Map<string, AbortController>>(new Map())
  // Track whether we're currently processing the queue
  const isProcessing = useRef(false)
  // Mirror uploads state in a ref so processQueue can read current values
  const uploadsRef = useRef<UploadFileEntry[]>([])
  uploadsRef.current = uploads

  const isUploading = uploads.some((u) => u.status === "uploading" || u.status === "pending")

  // Generate unique ID
  const makeId = () => Math.random().toString(36).slice(2, 11)

  // Process upload queue sequentially
  const processQueue = useCallback(async () => {
    if (isProcessing.current) return
    isProcessing.current = true

    try {
      // Keep processing while there are pending uploads
      while (true) {
        // Read current uploads from ref to avoid stale closure
        const nextUpload = uploadsRef.current.find((u) => u.status === "pending")
        if (!nextUpload) break

        // Mark as uploading
        setUploads((prev) =>
          prev.map((u) =>
            u.id === nextUpload.id ? { ...u, status: "uploading" as const } : u
          )
        )

        const uploadId = nextUpload.id
        const file = nextUpload.file
        const destinationPath = `${currentPath.replace(/\/$/, "")}/${file.name}`

        const abortController = new AbortController()
        abortControllers.current.set(uploadId, abortController)

        try {
          await uploadWithProgress(
            machineId,
            destinationPath,
            file,
            true, // overwrite confirmed by this point
            (progress) => {
              setUploads((prev) =>
                prev.map((u) => (u.id === uploadId ? { ...u, progress } : u))
              )
            },
            abortController.signal
          )

          setUploads((prev) =>
            prev.map((u) =>
              u.id === uploadId
                ? { ...u, status: "complete" as const, progress: 100 }
                : u
            )
          )
        } catch (err) {
          if (abortController.signal.aborted) {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId
                  ? { ...u, status: "cancelled" as const }
                  : u
              )
            )
          } else {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId
                  ? {
                      ...u,
                      status: "error" as const,
                      error: err instanceof Error ? err.message : "Upload failed",
                    }
                  : u
              )
            )
          }
        } finally {
          abortControllers.current.delete(uploadId)
        }
      }
    } finally {
      isProcessing.current = false
      // Refresh directory after all uploads complete
      onRefresh()
    }
  }, [machineId, currentPath, onRefresh])

  const enqueueFiles = useCallback(
    (files: File[]) => {
      const newUploads: UploadFileEntry[] = files.map((file) => ({
        id: makeId(),
        file,
        name: file.name,
        size: file.size,
        progress: 0,
        status: "pending" as const,
      }))

      if (newUploads.length === 0) return

      setUploads((prev) => [...prev, ...newUploads])

      // Kick off processing (no-op if already running)
      // Use setTimeout to ensure state is updated first
      setTimeout(() => processQueue(), 0)
    },
    [processQueue]
  )

  const startUpload = useCallback(
    (files: File[]) => {
      const valid: File[] = []
      const newValidationErrors: ValidationError[] = []
      const newOverwritePending: OverwritePendingEntry[] = []

      for (const file of files) {
        // Size validation
        if (file.size > MAX_FILE_SIZE) {
          newValidationErrors.push({
            fileName: file.name,
            message:
              "Files over 50MB should be downloaded directly by the agent. Provide a URL in the chat instead.",
          })
          continue
        }

        // Overwrite detection
        const existingEntry = currentEntries.find(
          (e) => !e.isDirectory && e.name === file.name
        )
        if (existingEntry) {
          newOverwritePending.push({
            id: makeId(),
            file,
            existingName: file.name,
          })
          continue
        }

        valid.push(file)
      }

      if (newValidationErrors.length > 0) {
        setValidationErrors((prev) => [...prev, ...newValidationErrors])
      }

      if (newOverwritePending.length > 0) {
        setOverwritePending((prev) => [...prev, ...newOverwritePending])
      }

      if (valid.length > 0) {
        enqueueFiles(valid)
      }
    },
    [currentEntries, enqueueFiles]
  )

  const confirmOverwrite = useCallback(
    (id: string) => {
      const entry = overwritePending.find((e) => e.id === id)
      if (!entry) return

      setOverwritePending((prev) => prev.filter((e) => e.id !== id))
      enqueueFiles([entry.file])
    },
    [overwritePending, enqueueFiles]
  )

  const rejectOverwrite = useCallback(
    (id: string) => {
      setOverwritePending((prev) => prev.filter((e) => e.id !== id))
    },
    []
  )

  const cancelUpload = useCallback((id: string) => {
    const controller = abortControllers.current.get(id)
    if (controller) {
      controller.abort()
    }
    // Also remove pending uploads
    setUploads((prev) =>
      prev.map((u) =>
        u.id === id && u.status === "pending"
          ? { ...u, status: "cancelled" as const }
          : u
      )
    )
  }, [])

  const retryUpload = useCallback(
    (id: string) => {
      setUploads((prev) => {
        const entry = prev.find((u) => u.id === id)
        if (!entry || entry.status !== "error") return prev
        return prev.map((u) =>
          u.id === id
            ? { ...u, status: "pending" as const, progress: 0, error: undefined }
            : u
        )
      })
      // Kick off processing
      setTimeout(() => processQueue(), 0)
    },
    [processQueue]
  )

  const dismissUpload = useCallback((id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id))
  }, [])

  const clearCompleted = useCallback(() => {
    setUploads((prev) =>
      prev.filter((u) => u.status !== "complete" && u.status !== "error" && u.status !== "cancelled")
    )
  }, [])

  const dismissValidationError = useCallback((index: number) => {
    setValidationErrors((prev) => prev.filter((_, i) => i !== index))
  }, [])

  return {
    uploads,
    isUploading,
    startUpload,
    cancelUpload,
    retryUpload,
    dismissUpload,
    clearCompleted,
    overwritePending,
    confirmOverwrite,
    rejectOverwrite,
    validationErrors,
    dismissValidationError,
  }
}
