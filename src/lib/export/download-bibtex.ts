import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const teamId = localStorage.getItem('activeTeamId')
  const h: HeadersInit = {}
  if (token) h['Authorization'] = `Bearer ${token}`
  if (teamId) h['X-Team-Id'] = teamId
  return h
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadBibTeX(projectId?: string): Promise<void> {
  const params = new URLSearchParams({ format: 'bibtex' })
  if (projectId) params.set('projectId', projectId)
  const res = await fetch(apiUrl(`/api/references/export?${params}`), {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  const blob = await res.blob()
  const filename = projectId ? 'project-references.bib' : 'references.bib'
  triggerDownload(blob, filename)
}
