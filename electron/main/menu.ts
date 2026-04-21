import { app, Menu, shell, dialog } from 'electron'
import { checkForUpdatesManual } from './updater.js'
import { windowRegistry } from './windows/registry.js'

async function handleCheckForUpdate(): Promise<void> {
  const win = windowRegistry.get('main')
  const version = app.getVersion()

  const result = await checkForUpdatesManual()

  switch (result.status) {
    case 'up-to-date':
      await dialog.showMessageBox({
        type: 'info',
        title: 'No Updates Available',
        message: `Astro is up to date`,
        detail: `Version ${version} is the latest release.`,
        buttons: ['OK'],
      })
      break
    case 'available':
      await dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `Astro ${result.version} is available`,
        detail: 'Downloading the update in the background. You\'ll be notified when it\'s ready to install.',
        buttons: ['OK'],
      })
      break
    case 'downloaded': {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `Astro ${result.version} is ready to install`,
        detail: 'Restart Astro now to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      })
      if (response === 0 && win) {
        win.webContents.send('updater:install')
      }
      break
    }
    case 'unavailable':
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Update Check Failed',
        message: 'Could not check for updates',
        detail: result.reason,
        buttons: ['OK'],
      })
      break
  }
}

export function buildApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu (Astro)
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),

    // Edit
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? ([
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ] as Electron.MenuItemConstructorOptions[])
          : ([
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ] as Electron.MenuItemConstructorOptions[])),
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? ([
              { type: 'separator' as const },
              { role: 'front' as const },
            ] as Electron.MenuItemConstructorOptions[])
          : ([{ role: 'close' as const }] as Electron.MenuItemConstructorOptions[])),
      ],
    },

    // Help — use label (not role:'help') so macOS doesn't suppress custom items
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Update…',
          click: () => { void handleCheckForUpdate() },
        },
        { type: 'separator' as const },
        {
          label: 'Learn More',
          click: () => { void shell.openExternal('https://astroanywhere.com') },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
