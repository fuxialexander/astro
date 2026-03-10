import { useState } from "react"
import { useTranslation } from "react-i18next"
import { usePluginStore } from "@/stores/plugin-store"
import { loadPluginFromUrl } from "@/lib/plugin-loader"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Puzzle,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react"
import type { PluginEntry } from "@/types/plugin"

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        )}
      />
    </button>
  )
}

function PluginCard({ entry, pluginId }: { entry: PluginEntry; pluginId: string }) {
  const enablePlugin = usePluginStore((s) => s.enablePlugin)
  const disablePlugin = usePluginStore((s) => s.disablePlugin)
  const unregisterPlugin = usePluginStore((s) => s.unregisterPlugin)

  const { manifest } = entry

  return (
    <div className="flex items-center justify-between px-4 py-3.5 border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
            entry.enabled ? "bg-primary/10" : "bg-muted"
          )}
        >
          <Puzzle
            className={cn(
              "h-4.5 w-4.5",
              entry.enabled ? "text-primary" : "text-muted-foreground"
            )}
          />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{manifest.name}</span>
            <span className="text-[11px] text-muted-foreground">v{manifest.version}</span>
            {entry.error ? (
              <Badge variant="destructive" className="gap-1 text-[10px]">
                <XCircle className="h-2.5 w-2.5" />
                Error
              </Badge>
            ) : entry.enabled ? (
              <Badge variant="success" className="gap-1 text-[10px]">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Active
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                Disabled
              </Badge>
            )}
          </div>
          {manifest.description && (
            <span className="text-[12px] text-muted-foreground truncate">
              {manifest.description}
            </span>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            {manifest.capabilities.map((cap) => (
              <Badge key={cap} variant="outline" className="text-[10px] py-0 h-4">
                {cap}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <Toggle
          checked={entry.enabled}
          onChange={(checked) =>
            checked ? enablePlugin(pluginId) : disablePlugin(pluginId)
          }
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => unregisterPlugin(pluginId)}
          className="text-destructive hover:text-destructive h-8 w-8 p-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {entry.error && (
        <div className="flex items-start gap-2 mt-2 px-4 py-2 rounded-md bg-destructive/5 border border-destructive/20">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
          <span className="text-xs text-destructive">{entry.error}</span>
        </div>
      )}
    </div>
  )
}

export function PluginSettingsContent() {
  const { t } = useTranslation('common')
  const plugins = usePluginStore((s) => s.plugins)
  const registerPlugin = usePluginStore((s) => s.registerPlugin)
  const [showAddPlugin, setShowAddPlugin] = useState(false)
  const [pluginUrl, setPluginUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState("")

  const pluginEntries = Array.from(plugins.entries())

  const handleLoadPlugin = async () => {
    if (!pluginUrl.trim()) return
    setLoading(true)
    setLoadError("")
    try {
      const plugin = await loadPluginFromUrl(pluginUrl.trim())
      registerPlugin(plugin.manifest, {}, pluginUrl.trim())
      setPluginUrl("")
      setShowAddPlugin(false)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">Plugins</h1>

      {/* Add Plugin */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Install Plugin</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddPlugin(!showAddPlugin)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Plugin
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Load plugins from a URL to extend Astro with custom pages, themes, commands, and more.
        </p>

        {showAddPlugin && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm">Plugin URL</label>
                <Input
                  value={pluginUrl}
                  onChange={(e) => setPluginUrl(e.target.value)}
                  placeholder="https://example.com/my-plugin.js"
                />
              </div>
              {loadError && (
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {loadError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowAddPlugin(false)
                    setLoadError("")
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleLoadPlugin}
                  disabled={!pluginUrl.trim() || loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {t('loading')}
                    </>
                  ) : (
                    "Load Plugin"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Installed Plugins */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Installed Plugins</h2>
        <div className="rounded-xl border border-border bg-card">
          {pluginEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Puzzle className="mb-2 h-8 w-8" />
              <span className="text-sm">No plugins installed</span>
              <span className="mt-1 text-xs">
                Add a plugin URL above to get started
              </span>
            </div>
          ) : (
            pluginEntries.map(([id, entry]) => (
              <PluginCard key={id} entry={entry} pluginId={id} />
            ))
          )}
        </div>
      </section>
    </div>
  )
}
