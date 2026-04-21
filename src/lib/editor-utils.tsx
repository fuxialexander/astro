import type { JSX } from "react"
import { cn } from "@/lib/utils"
import { isDesktop } from "@/lib/desktop-detect"
import { desktopBridge } from "@/lib/desktop-bridge"

export const EDITOR_APPS = [
  { id: 'cursor', label: 'Cursor', scheme: 'cursor', desktopOnly: false },
  { id: 'vscode', label: 'VS Code', scheme: 'vscode', desktopOnly: false },
  { id: 'vscode-insiders', label: 'VS Code Insiders', scheme: 'vscode-insiders', desktopOnly: false },
  { id: 'finder', label: 'Finder', scheme: 'finder', desktopOnly: true },
  { id: 'terminal', label: 'Terminal', scheme: 'terminal', desktopOnly: true },
  { id: 'iterm', label: 'iTerm2', scheme: 'iterm', desktopOnly: true },
  { id: 'ghostty', label: 'Ghostty', scheme: 'ghostty', desktopOnly: true },
  { id: 'xcode', label: 'Xcode', scheme: 'xcode', desktopOnly: true },
] as const

export type EditorAppId = (typeof EDITOR_APPS)[number]['id']

export function buildEditorUrl(appId: EditorAppId, path: string, isRemote: boolean, machineName?: string): string | null {
  const app = EDITOR_APPS.find((a) => a.id === appId)
  if (!app || !path) return null
  if (appId === 'finder') return `file://${path}`
  if (appId === 'terminal') return `terminal://open?path=${encodeURIComponent(path)}`
  if (appId === 'iterm') return `iterm2://open?path=${encodeURIComponent(path)}`
  if (appId === 'ghostty') return `ghostty://open?path=${encodeURIComponent(path)}`
  if (appId === 'xcode') return `xcode://open?path=${encodeURIComponent(path)}`
  if (isRemote && machineName) {
    return `${app.scheme}://vscode-remote/ssh-remote+${machineName}${path.startsWith('/') ? '' : '/'}${path}`
  }
  return `${app.scheme}://file${path}`
}

export function openWithEditor(appId: EditorAppId, path: string, isRemote: boolean, machineName?: string) {
  if (!path) return
  if (appId === 'finder') {
    if (isDesktop()) void desktopBridge.shell.openPath(path)
    return
  }
  const url = buildEditorUrl(appId, path, isRemote, machineName)
  if (!url) return
  if (isDesktop()) {
    void desktopBridge.editor.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

export function AppIcon({ appId, className }: { appId: string; className?: string }): JSX.Element {
  return <img src={`/app-icons/${appId}.png`} alt="" className={cn("rounded-[3px]", className)} draggable={false} />
}
