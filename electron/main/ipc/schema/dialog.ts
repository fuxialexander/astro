/**
 * Native dialog channel schemas. Thin wrappers over Electron's
 * dialog.showOpenDialog / showSaveDialog / showMessageBox.
 */

import { z } from 'zod'

const filter = z.object({
  name: z.string(),
  extensions: z.array(z.string()),
})

export const showOpen = {
  req: z.object({
    title: z.string().optional(),
    defaultPath: z.string().optional(),
    filters: z.array(filter).optional(),
    properties: z
      .array(z.enum(['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles']))
      .optional(),
  }),
  res: z.object({
    canceled: z.boolean(),
    filePaths: z.array(z.string()),
  }),
}

export const showSave = {
  req: z.object({
    title: z.string().optional(),
    defaultPath: z.string().optional(),
    filters: z.array(filter).optional(),
  }),
  res: z.object({
    canceled: z.boolean(),
    filePath: z.string().nullable(),
  }),
}

export const showMessage = {
  req: z.object({
    type: z.enum(['none', 'info', 'error', 'question', 'warning']).default('info'),
    title: z.string().optional(),
    message: z.string(),
    detail: z.string().optional(),
    buttons: z.array(z.string()).optional(),
  }),
  res: z.object({ response: z.number() }),
}

export const channels = {
  'dialog:open': showOpen,
  'dialog:save': showSave,
  'dialog:message': showMessage,
} as const
