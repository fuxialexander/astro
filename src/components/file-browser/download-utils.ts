/**
 * Download utilities — handles file download with proper auth headers
 */

import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"

/**
 * Download a file from a remote machine via the content API.
 * Uses fetch with auth headers instead of window.open to ensure
 * authentication works in all modes.
 */
export async function downloadFile(machineId: string, filePath: string): Promise<void> {
  const token = await getAccessToken()
  const headers: HeadersInit = {}
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const params = new URLSearchParams({
    machineId,
    path: filePath,
    download: "true",
  })

  const response = await fetch(apiUrl(`/api/fs/content?${params}`), { headers })

  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`)
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const filename = filePath.split("/").pop() || "file"

  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()

  // Delay cleanup so the browser has time to initiate the download
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1000)
}
