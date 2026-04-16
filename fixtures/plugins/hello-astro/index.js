/**
 * Hello Astro — reference plugin.
 *
 * Runs inside the plugin-runtime utilityProcess. The `ctx` argument is the
 * PluginContext proxy built in electron/plugin-runtime/host.ts. Every call
 * on `ctx.storage.*` / `ctx.ui.*` round-trips through a MessagePort to the
 * main process, where it's permission-gated against manifest.json.
 */

export async function activate(ctx) {
  console.log('[hello-astro] activate()')

  // storage — requires the "storage" permission declared in manifest.json.
  await ctx.storage.set('greeted', true)
  const greeted = await ctx.storage.get('greeted')
  console.log(`[hello-astro] storage.greeted = ${greeted}`)

  // ui.registerCommand — requires "ui:contribute".
  await ctx.ui.registerCommand({
    id: 'hello-astro.greet',
    title: 'Say hello',
  })

  console.log('[hello-astro] ready — hello from the plugin sandbox!')
}

export async function deactivate() {
  console.log('[hello-astro] deactivate() — goodbye!')
}
