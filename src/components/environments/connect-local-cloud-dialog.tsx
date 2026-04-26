import { useEffect, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useRemoteComputeStore } from '@/stores/remote-compute-store'
import { useToastStore } from '@/stores/toast-store'

interface Props {
  provider: 'aws' | 'gcp'
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectLocalCloudDialog({ provider, open, onOpenChange }: Props) {
  const localCloudCreds = useRemoteComputeStore((s) => s.localCloudCreds)
  const saveLocalConfig = useRemoteComputeStore((s) => s.saveLocalConfig)
  const addToast = useToastStore((s) => s.add)

  const awsCreds = localCloudCreds?.aws
  const gcpCreds = localCloudCreds?.gcp

  // AWS form state
  const [profile, setProfile] = useState<string>('')
  const [region, setRegion] = useState<string>('')

  // GCP form state
  const [project, setProject] = useState<string>('')
  const [adcPath, setAdcPath] = useState<string>('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize defaults whenever the dialog opens or detected creds change.
  useEffect(() => {
    if (!open) return
    if (provider === 'aws') {
      const profiles = awsCreds?.profiles ?? []
      setProfile(profiles[0] ?? 'default')
      setRegion(awsCreds?.defaultRegion ?? 'us-east-1')
    } else {
      setProject(gcpCreds?.project ?? '')
      setAdcPath('')
    }
    setError(null)
  }, [open, provider, awsCreds, gcpCreds])

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      if (provider === 'aws') {
        if (!profile.trim()) throw new Error('Profile is required')
        if (!region.trim()) throw new Error('Region is required')
        await saveLocalConfig('aws', { profile: profile.trim(), region: region.trim() })
      } else {
        if (!project.trim()) throw new Error('Project is required')
        await saveLocalConfig('gcp', {
          project: project.trim(),
          adcPath: adcPath.trim() ? adcPath.trim() : undefined,
        })
      }
      addToast({
        type: 'success',
        title: `${provider.toUpperCase()} connected`,
        description: 'Local credentials configured for this machine.',
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  const profiles = awsCreds?.profiles ?? []
  const title = provider === 'aws' ? 'Connect AWS' : 'Connect GCP'
  const description =
    provider === 'aws'
      ? 'Pick the AWS profile and region to use when launching pools on this machine.'
      : 'Pick the GCP project to use when launching pools on this machine.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {provider === 'aws' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="aws-profile" className="text-xs">Profile</Label>
                {profiles.length > 0 ? (
                  <select
                    id="aws-profile"
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {profiles.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="aws-profile"
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                    placeholder="default"
                    className="h-8 text-sm"
                  />
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="aws-region" className="text-xs">Region</Label>
                <Input
                  id="aws-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="us-east-1"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gcp-project" className="text-xs">Project ID</Label>
                <Input
                  id="gcp-project"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="my-gcp-project"
                  className="h-8 text-sm font-mono"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gcp-adc" className="text-xs">ADC path (optional)</Label>
                <Input
                  id="gcp-adc"
                  value={adcPath}
                  onChange={(e) => setAdcPath(e.target.value)}
                  placeholder="~/.config/gcloud/application_default_credentials.json"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>Stored on this machine only — never sent to Astro.</span>
          </div>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
