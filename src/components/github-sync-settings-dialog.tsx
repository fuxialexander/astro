/**
 * GitHub Sync Settings Dialog
 *
 * Configures per-project sync settings: direction, enabled fields,
 * auto-create behavior, and label mapping.
 */

import { useState, useCallback } from 'react'
import { Settings2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useToastStore } from '@/stores/toast-store'
import { useProjectStore } from '@/stores/project-store'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import type { Project, GitHubSyncSettings, GitHubSyncDirection } from '@astro/core/types'
import { DEFAULT_GITHUB_SYNC_SETTINGS } from '@astro/core/types'

const SYNCABLE_FIELDS = [
  { id: 'title', label: 'Title' },
  { id: 'description', label: 'Description' },
  { id: 'status', label: 'Status (open/closed)' },
  { id: 'priority', label: 'Priority (as labels)' },
  { id: 'estimate', label: 'Estimate (as labels)' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'labels', label: 'Labels' },
] as const

const DIRECTION_OPTIONS: Array<{ value: GitHubSyncDirection; label: string; description: string }> = [
  { value: 'bidirectional', label: 'Bi-directional', description: 'Changes sync both ways' },
  { value: 'github_to_astro', label: 'GitHub to Astro only', description: 'GitHub is the source of truth' },
  { value: 'astro_to_github', label: 'Astro to GitHub only', description: 'Astro is the source of truth' },
]

const AUTO_CREATE_OPTIONS = [
  { value: 'github_to_astro', label: 'New GitHub issues create Astro tasks' },
  { value: 'astro_to_github', label: 'New Astro tasks create GitHub issues' },
  { value: 'bidirectional', label: 'Both directions' },
  { value: 'none', label: 'Disabled' },
] as const

interface GitHubSyncSettingsDialogProps {
  project: Project
  /** Render the trigger button (gear icon by default) */
  trigger?: React.ReactNode
}

export function GitHubSyncSettingsDialog({ project, trigger }: GitHubSyncSettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const updateProject = useProjectStore((s) => s.updateProject)

  // Merge project settings with defaults
  const initial: GitHubSyncSettings = {
    ...DEFAULT_GITHUB_SYNC_SETTINGS,
    ...(project.githubSyncSettings ?? {}),
  }

  const [settings, setSettings] = useState<GitHubSyncSettings>(initial)

  // Reset when dialog opens
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setSettings({
        ...DEFAULT_GITHUB_SYNC_SETTINGS,
        ...(project.githubSyncSettings ?? {}),
      })
    }
    setOpen(isOpen)
  }, [project.githubSyncSettings])

  const toggleField = useCallback((fieldId: string) => {
    setSettings((prev) => ({
      ...prev,
      enabledFields: prev.enabledFields.includes(fieldId)
        ? prev.enabledFields.filter((f) => f !== fieldId)
        : [...prev.enabledFields, fieldId],
    }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(apiUrl(`/api/github/projects/${project.id}/sync-settings`), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ settings }),
      })

      if (!res.ok) throw new Error('Failed to save settings')

      // Optimistically update the store
      updateProject(project.id, { githubSyncSettings: settings })
      useToastStore.getState().add({ type: 'success', title: 'Sync settings saved' })
      setOpen(false)
    } catch (err) {
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }, [project.id, settings, updateProject])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>GitHub Sync Settings</TooltipContent>
          </Tooltip>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>GitHub Sync Settings</DialogTitle>
          <DialogDescription>
            Configure how tasks sync between Astro and{' '}
            <span className="font-medium">{project.githubOwner}/{project.githubRepo}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Enable/Disable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Auto-sync</Label>
              <p className="text-xs text-muted-foreground">Automatically sync changes via webhooks</p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, enabled: checked }))}
            />
          </div>

          {/* Direction */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Sync direction</Label>
            <Select
              value={settings.direction}
              onValueChange={(value) => setSettings((prev) => ({ ...prev, direction: value as GitHubSyncDirection }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIRECTION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Field toggles */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Fields to sync</Label>
            <div className="space-y-2">
              {SYNCABLE_FIELDS.map((field) => (
                <div key={field.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`field-${field.id}`}
                    checked={settings.enabledFields.includes(field.id)}
                    onCheckedChange={() => toggleField(field.id)}
                  />
                  <Label htmlFor={`field-${field.id}`} className="text-sm font-normal cursor-pointer">
                    {field.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Auto-create */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Auto-create tasks</Label>
            <p className="text-xs text-muted-foreground">
              Automatically create tasks when new issues or tasks appear
            </p>
            <Select
              value={settings.autoCreateDirection}
              onValueChange={(value) => setSettings((prev) => ({ ...prev, autoCreateDirection: value as GitHubSyncSettings['autoCreateDirection'] }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTO_CREATE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
