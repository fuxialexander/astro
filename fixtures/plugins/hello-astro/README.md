# hello-astro

Reference plugin for the Astro Electron plugin host. Demonstrates the minimal
surface shipped in Phase 4: a `manifest.json`, an `activate(ctx)` / `deactivate()`
pair, and two permission-gated host-API calls (`storage.set` and
`ui.registerCommand`).

## Install (from the renderer)

With a desktop build running, open the devtools console and:

```js
const { id } = await window.astro.invoke('plugin:install', {
  sourcePath: '/absolute/path/to/astro/fixtures/plugins/hello-astro',
})

await window.astro.invoke('plugin:enable', { id })
```

Or via the typed bridge:

```ts
import { desktopBridge } from '@/lib/desktop-bridge'

const { id } = await desktopBridge.plugins.install(
  '/absolute/path/to/astro/fixtures/plugins/hello-astro',
)
await desktopBridge.plugins.enable(id)
```

On enable, the renderer will first surface a permission approval dialog
(`PluginApprovalDialog`) listing the declared `storage` and `ui:contribute`
permissions. Approve, and the plugin is forked into its own utilityProcess;
you should see `[plugin:hello-astro] [hello-astro] ready — hello from the
plugin sandbox!` in the main-process log.

## Uninstall

```ts
await desktopBridge.plugins.disable('hello-astro')
await desktopBridge.plugins.uninstall('hello-astro')
```
