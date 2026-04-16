/**
 * Plugin pane — renders a plugin-contributed UI inside a sandboxed <webview>.
 *
 * The webview src uses a custom `astro-plugin://` protocol that Phase 5 will
 * register in the main process. For now:
 *   - If the plugin's manifest declares `ui.webviewPath`, we point the
 *     webview at `astro-plugin://<id>/<webviewPath>`.
 *   - Otherwise we render a placeholder explaining that this plugin doesn't
 *     contribute a UI panel.
 *
 * The `<webview>` tag is isolated from the renderer — it cannot access
 * `window.astro` or any parent state; it can only communicate via the
 * postMessage bridge that Phase 5 will wire through the plugin host.
 */
import { useRef } from 'react'

import { usePluginStore } from '@/stores/plugin-store'
import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

export function PluginPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)

  const entry = usePluginStore((s) =>
    paneState.pluginId ? s.plugins.get(paneState.pluginId) : undefined,
  )

  const webviewPath = entry?.manifest.ui?.webviewPath
  const src = entry && webviewPath
    ? `astro-plugin://${entry.manifest.id}/${webviewPath.replace(/^\//, '')}`
    : null

  return (
    <div
      ref={ref}
      className="h-full w-full flex flex-col bg-background"
      data-density={size.density}
    >
      {!paneState.pluginId ? (
        <Placeholder text="No plugin selected" />
      ) : !entry ? (
        <Placeholder text={`Plugin "${paneState.pluginId}" is not installed`} />
      ) : !src ? (
        <Placeholder
          text={`Plugin "${entry.manifest.name}" does not contribute a UI panel yet`}
        />
      ) : (
        // The webview tag is a built-in Electron element — not in React's
        // JSX.IntrinsicElements type. Cast through unknown to keep this
        // file usable under the renderer tsconfig.
        <WebviewFrame src={src} title={entry.manifest.name} />
      )}
    </div>
  )
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
      {text}
    </div>
  )
}

function WebviewFrame({ src, title }: { src: string; title: string }) {
  // Electron's <webview> is not in React's type definitions; render via
  // createElement to bypass JSX typing without touching global declarations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Tag = 'webview' as unknown as any
  return (
    <Tag
      src={src}
      // `partition` prefixed with `persist:` shares storage across sessions;
      // keep plugins in isolated, non-persistent partitions for now.
      partition={`plugin-${title}`}
      allowpopups={false}
      className="flex-1 w-full border-0"
      style={{ display: 'flex' }}
    />
  )
}
