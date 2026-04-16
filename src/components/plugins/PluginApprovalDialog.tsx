/* eslint-disable react-refresh/only-export-components */
/**
 * PluginApprovalDialog — surfaces a plugin's requested permissions to the
 * user before the plugin-store actually calls `desktopBridge.plugins.enable`.
 *
 * Usage:
 *
 *   const ok = await requestPluginApproval(manifest)
 *   if (!ok) return
 *   await desktopBridge.plugins.enable(manifest.id)
 *
 * The helper mounts a short-lived React root so the caller doesn't need to
 * thread the dialog through component state. Modals that need to *stay* in
 * the tree (e.g. a settings panel) can import the `<PluginApprovalDialog>`
 * component directly and control it with `open` / `onOpenChange`.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { PluginManifest, PluginPermission } from '@/types/plugin'

const PERMISSION_DESCRIPTIONS: Record<PluginPermission, string> = {
  storage: 'Read and write its own persisted key-value storage.',
  'projects:read': 'Read the list of projects in this workspace.',
  'plans:read': 'Read plan graphs, nodes, and metadata.',
  'plans:write': 'Create, modify, or delete plan nodes and edges.',
  'tasks:dispatch': 'Dispatch tasks to machines on your behalf.',
  'fs:read': 'Read files from your local filesystem.',
  'fs:write': 'Create or modify files on your local filesystem.',
  'http:fetch': 'Make outbound network requests to third-party services.',
  'ui:contribute': 'Contribute commands, sidebar items, or panes to the UI.',
}

function describe(p: string): string {
  return PERMISSION_DESCRIPTIONS[p as PluginPermission] ?? `Unknown permission: ${p}`
}

interface Props {
  manifest: PluginManifest
  open: boolean
  onOpenChange: (open: boolean) => void
  onApprove: () => void
  onCancel: () => void
}

export function PluginApprovalDialog({
  manifest,
  open,
  onOpenChange,
  onApprove,
  onCancel,
}: Props) {
  const permissions = manifest.permissions ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enable &ldquo;{manifest.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            Version {manifest.version}
            {manifest.author ? ` — by ${manifest.author}` : ''}
          </DialogDescription>
        </DialogHeader>

        {manifest.description ? (
          <p className="text-sm text-muted-foreground">{manifest.description}</p>
        ) : null}

        <div className="mt-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Requested permissions
          </div>
          {permissions.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              This plugin requests no permissions.
            </div>
          ) : (
            <ul className="space-y-2">
              {permissions.map((perm) => (
                <li key={perm} className="text-sm">
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{perm}</code>
                  <span className="ml-2 text-muted-foreground">{describe(perm)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onApprove}>Enable plugin</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Imperative helper — mounts a transient dialog and resolves with the user's
 * choice. Unmounts itself on close so it leaves no DOM residue.
 */
export function requestPluginApproval(manifest: PluginManifest): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false)

  return new Promise((resolve) => {
    const container = document.createElement('div')
    container.setAttribute('data-plugin-approval-root', manifest.id)
    document.body.appendChild(container)
    const root = createRoot(container)

    let resolved = false
    const finish = (ok: boolean) => {
      if (resolved) return
      resolved = true
      resolve(ok)
      // Defer unmount so the close animation has a chance to run.
      setTimeout(() => {
        root.unmount()
        container.remove()
      }, 150)
    }

    function Host() {
      const [open, setOpen] = useState(true)
      useEffect(() => {
        if (!open && !resolved) finish(false)
      }, [open])

      return (
        <PluginApprovalDialog
          manifest={manifest}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) finish(false)
          }}
          onApprove={() => {
            setOpen(false)
            finish(true)
          }}
          onCancel={() => {
            setOpen(false)
            finish(false)
          }}
        />
      )
    }

    root.render(<Host />)
  })
}
