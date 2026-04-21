/**
 * Channel registration barrel. Call `registerAllChannels()` once during
 * app.whenReady, after the supervisor has started but before the main
 * window loads — handlers must be live before the renderer can call
 * `window.astro.invoke(...)`.
 *
 * Order doesn't matter (registry deduplicates by channel name and throws
 * on collisions), but we group them logically here for readability.
 */

import { registerFsChannels } from './fs.js'
import { registerGitChannels } from './git.js'
import { registerWatcherChannels } from './watcher.js'
import { registerTerminalChannels } from './terminal.js'
import { registerPdfChannels } from './pdf.js'
import { registerEditorChannels } from './editor.js'
import { registerDialogChannels } from './dialog.js'
import { registerWindowsChannels } from './windows.js'
import { registerServerChannels } from './server.js'
import { registerPluginChannels } from './plugin.js'
import { registerLayoutChannels } from './layout.js'
import { registerUpdaterChannels } from './updater.js'
import { registerZoteroChannels } from './zotero.js'

export function registerAllChannels(): void {
  // Filesystem & native services
  registerFsChannels()
  registerDialogChannels()
  registerEditorChannels()
  registerPdfChannels()

  // Worker-backed services
  registerGitChannels()
  registerWatcherChannels()
  registerTerminalChannels()

  // App control
  registerWindowsChannels()
  registerServerChannels()
  registerPluginChannels() // stub until Phase 4
  registerLayoutChannels()
  registerUpdaterChannels()
  registerZoteroChannels()
}
