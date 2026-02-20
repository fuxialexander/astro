import { Routes, Route } from "react-router"
import { usePluginStore } from "@/stores/plugin-store"
import { PluginErrorBoundary } from "@/components/plugin-error-boundary"

/**
 * Dynamic route renderer for plugin-contributed pages.
 * Renders under the /plugins/* route path.
 */
export function PluginRoutes() {
  const getAllRoutes = usePluginStore((s) => s.getAllRoutes)
  const routes = getAllRoutes()

  if (routes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No plugin pages installed</p>
      </div>
    )
  }

  return (
    <Routes>
      {routes.map((route) => {
        const Component = route.component
        return (
          <Route
            key={route.path}
            path={route.path}
            element={
              <PluginErrorBoundary pluginId={route.path}>
                <Component />
              </PluginErrorBoundary>
            }
          />
        )
      })}
    </Routes>
  )
}
