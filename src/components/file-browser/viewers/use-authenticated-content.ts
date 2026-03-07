/**
 * Hook to fetch file content from the API with proper auth headers.
 * Returns either a blob URL (for binary content like images/PDFs) or text content.
 */

import { useState, useEffect } from "react"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"

interface AuthenticatedContentResult {
  /** Blob URL for binary content (images, PDFs) */
  blobUrl: string | null
  /** Text content for code/markdown */
  text: string | null
  loading: boolean
  error: string | null
}

export function useAuthenticatedContent(
  machineId: string,
  filePath: string,
  mode: "blob" | "text",
): AuthenticatedContentResult {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    async function fetchContent() {
      setLoading(true)
      setError(null)
      setBlobUrl(null)
      setText(null)

      try {
        const token = await getAccessToken()
        const headers: HeadersInit = {}
        if (token) {
          headers["Authorization"] = `Bearer ${token}`
        }

        const params = new URLSearchParams({ machineId, path: filePath })
        const response = await fetch(apiUrl(`/api/fs/content?${params}`), { headers })

        if (!response.ok) {
          throw new Error(`Failed to load file (${response.status})`)
        }

        if (cancelled) return

        if (mode === "blob") {
          const blob = await response.blob()
          if (!cancelled) {
            objectUrl = URL.createObjectURL(blob)
            setBlobUrl(objectUrl)
          }
        } else {
          const content = await response.text()
          if (!cancelled) {
            setText(content)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load file")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchContent()
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [machineId, filePath, mode])

  return { blobUrl, text, loading, error }
}
