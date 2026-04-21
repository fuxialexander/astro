import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const teamId = localStorage.getItem('activeTeamId')
  const h: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = `Bearer ${token}`
  if (teamId) h['X-Team-Id'] = teamId
  return h
}

export async function downloadDocx(
  projectId: string,
  citationStyle: string = 'apa',
  projectTitle: string = 'document',
): Promise<void> {
  const res = await fetch(apiUrl('/api/export/docx'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ projectId, citationStyle }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`DOCX export failed: ${text}`)
  }

  const safeName = projectTitle.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'document'
  const filename = `${safeName}.docx`

  if (isDesktop()) {
    const arrayBuffer = await res.arrayBuffer()
    const result = await desktopBridge.dialog.showSave({
      title: 'Save Word Document',
      defaultPath: filename,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    })
    if (!result.canceled && result.filePath) {
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      await desktopBridge.fs.writeFile(result.filePath, base64, 'base64')
    }
  } else {
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}
