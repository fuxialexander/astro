/**
 * Native dialog channel handlers. Wraps Electron's dialog module. Dialogs
 * are anchored to the focused BrowserWindow when one exists so they appear
 * as sheets on macOS rather than free-floating.
 */

import { BrowserWindow, dialog } from 'electron'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/dialog.js'

function focusedWin(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? null
}

export function registerDialogChannels(): void {
  defineHandler('dialog:open', schema.showOpen, async (req) => {
    const win = focusedWin()
    const opts = {
      title: req.title,
      defaultPath: req.defaultPath,
      filters: req.filters,
      properties: req.properties as Electron.OpenDialogOptions['properties'],
    }
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    return { canceled: res.canceled, filePaths: res.filePaths }
  })

  defineHandler('dialog:save', schema.showSave, async (req) => {
    const win = focusedWin()
    const opts = {
      title: req.title,
      defaultPath: req.defaultPath,
      filters: req.filters,
    }
    const res = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    return { canceled: res.canceled, filePath: res.filePath ?? null }
  })

  defineHandler('dialog:message', schema.showMessage, async (req) => {
    const win = focusedWin()
    const opts: Electron.MessageBoxOptions = {
      type: req.type,
      title: req.title,
      message: req.message,
      detail: req.detail,
      buttons: req.buttons,
    }
    const res = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts)
    return { response: res.response }
  })
}
