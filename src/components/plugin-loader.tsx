import { useEffect, useRef, type ReactNode } from "react"
import { usePluginStore } from "@/stores/plugin-store"
import { createPluginContext } from "@/lib/plugin-context"

interface Props {
  children: ReactNode
}

/**
 * PluginLoader activates enabled plugins after stores are loaded.
 * Renders children only after all plugins have been activated (or errored).
 */
export function PluginLoader({ children }: Props) {
  const plugins = usePluginStore((s) => s.plugins)
  const setPluginInstance = usePluginStore((s) => s.setPluginInstance)
  const setPluginError = usePluginStore((s) => s.setPluginError)
  const updatePluginConfig = usePluginStore((s) => s.updatePluginConfig)
  const activatedRef = useRef(new Set<string>())

  useEffect(() => {
    const activated = activatedRef.current

    // Activate each enabled plugin that has an instance available but not yet activated
    for (const [id, entry] of plugins) {
      if (!entry.enabled) continue
      if (activated.has(id)) continue
      if (!entry.instance) continue
      if (entry.contributions) continue // Already activated

      activated.add(id)

      const context = createPluginContext(
        id,
        entry.config,
        (config) => updatePluginConfig(id, config)
      )

      entry.instance
        .activate(context)
        .then((contributions) => {
          setPluginInstance(id, entry.instance!, contributions)
        })
        .catch((error) => {
          console.error(`[PluginLoader] Failed to activate plugin "${id}":`, error)
          setPluginError(id, error instanceof Error ? error.message : String(error))
        })
    }

    // Cleanup: deactivate plugins on unmount
    return () => {
      for (const [id, entry] of plugins) {
        if (entry.instance && activated.has(id)) {
          entry.instance.deactivate().catch((err) => {
            console.error(`[PluginLoader] Failed to deactivate plugin "${id}":`, err)
          })
        }
      }
      activated.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins])

  return <>{children}</>
}
