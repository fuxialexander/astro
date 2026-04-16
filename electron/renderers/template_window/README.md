# Template Window Scaffold

A minimal, documented scaffold for adding a new auxiliary Electron
window to Astro. Aux windows are small, leaf-like surfaces (find bar,
about box, settings popover, detached pane, etc.) — NOT full app
shells. If you find yourself importing the main app's store, you're
building the wrong thing.

## What ships in this scaffold

- `electron/main/windows/template-window.ts` — main-process factory
  that creates the `BrowserWindow` with the security baseline and
  registers it in `windowRegistry`.
- `electron/preload/template.ts` — sandboxed preload that exposes a
  tiny `window.astro` bridge via `contextBridge`.
- `electron/renderers/template_window/index.html` — HTML shell with a
  strict CSP meta tag and a single `<div id="root">`.
- `electron/renderers/template_window/main.tsx` — React entry. No
  global state, no router.

## Copy-paste recipe: adding `my_window`

1. **Factory** — copy `template-window.ts` to
   `electron/main/windows/my-window.ts`. Rename the exported function,
   the registry ID (`'template'` → `'my-window'`), and the preload
   filename (`template.js` → `my-window.js`). Adjust `width`/`height`
   and any window options you actually need.

2. **Preload** — copy `electron/preload/template.ts` to
   `electron/preload/my-window.ts`. Replace the `api` object with the
   exact IPC channels your window needs. **Do not** re-export the full
   main-window bridge here — aux windows should have the smallest
   possible surface area.

3. **Renderer** — copy `electron/renderers/template_window/` to
   `electron/renderers/my_window/`. Update the `<title>` and the React
   entry.

4. **IPC schema** — add an `openMyWindow` channel to
   `electron/main/ipc/schema/windows.ts` and register it in
   `electron/main/ipc/channels/windows.ts`, calling
   `showMyWindow({ preloadDir: PRELOAD_DIR })`.

5. **Vite input** — add the new `index.html` to the inputs list in
   `electron/vite.renderer.config.ts` so it gets built and shipped.

6. **TypeScript** — no change required; renderers are already covered
   by `electron/tsconfig.electron.json`.

## Security baseline (non-negotiable)

Every aux window MUST set:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- its own preload script via `contextBridge.exposeInMainWorld('astro', ...)`

The CSP meta tag in the HTML shell (`default-src 'self'`) is the second
line of defense and should not be relaxed without explicit review.
