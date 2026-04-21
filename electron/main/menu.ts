import { app, Menu, shell } from 'electron'
import { checkForUpdates } from './updater.js'
import { windowRegistry } from './windows/registry.js'

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

    // Help
    {
      role: 'help' as const,
      submenu: [
        {
          label: 'Check for Update',
          click: () => {
            checkForUpdates()
            // Briefly focus the main window so the user sees any update banner
            const win = windowRegistry.get('main')
            if (win) win.focus()
          },
        },
        { type: 'separator' as const },
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://astroanywhere.com')
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
