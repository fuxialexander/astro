import { useState, useEffect } from "react"
import { Plus, Trash2, Eye, EyeOff, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { RegisteredMachine, ProviderConfig } from "@/stores/machines-store"
import { useMachinesStore } from "@/stores/machines-store"

const AVAILABLE_PROVIDERS = [
  { id: "anthropic", name: "Anthropic", models: ["claude-sonnet-4-5-20250929", "claude-opus-4-6", "claude-haiku-4-5-20251001"] },
  { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini"] },
  { id: "google", name: "Google", models: ["gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-1.5-flash"] },
]

interface MachineConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  machine: RegisteredMachine | null
}

export function MachineConfigDialog({ open, onOpenChange, machine }: MachineConfigDialogProps) {
  const updateMachineProviderConfigs = useMachinesStore((s) => s.updateMachineProviderConfigs)
  const [configs, setConfigs] = useState<ProviderConfig[]>([])
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})

  // Initialize configs when machine changes
  useEffect(() => {
    if (machine?.providerConfigs) {
      setConfigs(machine.providerConfigs)
    } else {
      setConfigs([])
    }
  }, [machine])

  const handleAddProvider = () => {
    setConfigs([...configs, {
      provider: "",
      apiKey: "",
      defaultModel: "",
      enabled: true,
    }])
  }

  const handleRemoveProvider = (index: number) => {
    setConfigs(configs.filter((_, i) => i !== index))
  }

  const handleUpdateProvider = (index: number, field: keyof ProviderConfig, value: unknown) => {
    setConfigs(configs.map((c, i) => i === index ? { ...c, [field]: value } : c))
  }

  const toggleKeyVisibility = (index: number) => {
    setShowKey((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  const handleSave = async () => {
    if (!machine) return
    setSaving(true)
    try {
      // Filter out incomplete configs (no provider or no key)
      const validConfigs = configs.filter((c) => c.provider && c.apiKey)
      await updateMachineProviderConfigs(machine.id, validConfigs)
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to update provider configs:", error)
      alert(`Failed to update provider configs: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  const getProviderInfo = (providerId: string) => {
    return AVAILABLE_PROVIDERS.find((p) => p.id === providerId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Configure Providers & Models</DialogTitle>
          <DialogDescription>
            Set up API keys and default models for {machine?.name || machine?.hostname || "this machine"}.
            Agents running on this machine will use these credentials.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {configs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">No providers configured</p>
              <p className="text-xs mt-1">Add a provider to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {configs.map((config, index) => {
                const providerInfo = getProviderInfo(config.provider)
                return (
                  <div
                    key={index}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
                  >
                    {/* Provider Selection */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <select
                          value={config.provider}
                          onChange={(e) => {
                            handleUpdateProvider(index, "provider", e.target.value)
                            // Auto-select first model when provider changes
                            const provider = getProviderInfo(e.target.value)
                            if (provider && provider.models.length > 0) {
                              handleUpdateProvider(index, "defaultModel", provider.models[0])
                            }
                          }}
                          className="h-8 rounded-md border border-border bg-background px-2.5 pr-8 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">Select provider...</option>
                          {AVAILABLE_PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={config.enabled}
                            onChange={(e) => handleUpdateProvider(index, "enabled", e.target.checked)}
                            className="h-3.5 w-3.5 rounded accent-primary"
                          />
                          Enabled
                        </label>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveProvider(index)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* API Key */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium">API Key</label>
                      <div className="flex items-center gap-2">
                        <Input
                          type={showKey[index] ? "text" : "password"}
                          value={config.apiKey || ""}
                          onChange={(e) => handleUpdateProvider(index, "apiKey", e.target.value)}
                          placeholder="sk-..."
                          className="flex-1 font-mono text-sm"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleKeyVisibility(index)}
                          className="shrink-0"
                        >
                          {showKey[index] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Default Model */}
                    {providerInfo && (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium">Default Model</label>
                        <select
                          value={config.defaultModel || ""}
                          onChange={(e) => handleUpdateProvider(index, "defaultModel", e.target.value)}
                          className="h-8 rounded-md border border-border bg-background px-2.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">Select model...</option>
                          {providerInfo.models.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddProvider}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Provider
          </Button>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <>Saving...</>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1.5" />
                  Save Configuration
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
