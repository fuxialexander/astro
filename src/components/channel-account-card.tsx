import { useState } from 'react'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useConnectedAccountsStore, type ChannelType, type TestResult } from '@/stores/connected-accounts-store'

interface ChannelFieldDef {
  key: string
  label: string
  placeholder: string
  type?: 'text' | 'password'
  required?: boolean
}

interface ChannelAccountCardProps {
  channel: ChannelType
  icon: React.ElementType
  title: string
  description: string
  fields: ChannelFieldDef[]
  mappingLabel?: string
  mappingKeyPlaceholder?: string
}

export function ChannelAccountCard({
  channel,
  icon: Icon,
  title,
  description,
  fields,
  mappingLabel,
  mappingKeyPlaceholder,
}: ChannelAccountCardProps) {
  const { addAccount, removeAccount, testConnection, updateAccount, getAccountsForChannel, loading } = useConnectedAccountsStore()
  const accounts = getAccountsForChannel(channel)
  const account = accounts[0] || null
  const connected = account !== null

  // Form state for connecting
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [showFields, setShowFields] = useState<Record<string, boolean>>({})
  const [label, setLabel] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  // Test state
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  // Mapping state
  const [newMappingKey, setNewMappingKey] = useState('')
  const [newMappingValue, setNewMappingValue] = useState('')

  const handleConnect = async () => {
    // Validate required fields
    const missingFields = fields.filter(
      (f) => f.required !== false && !fieldValues[f.key]
    )
    if (missingFields.length > 0) {
      setConnectError(`Missing required fields: ${missingFields.map((f) => f.label).join(', ')}`)
      return
    }

    setConnecting(true)
    setConnectError(null)
    try {
      await addAccount(channel, {
        label: label || title,
        credentials: fieldValues,
      })
      // Reset form
      setFieldValues({})
      setLabel('')
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!account) return
    await removeAccount(account.id)
    setTestResult(null)
  }

  const handleTest = async () => {
    if (!account) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnection(account.id)
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  const handleAddMapping = async () => {
    if (!account || !newMappingKey || !newMappingValue) return
    const updatedMappings = { ...account.mappings, [newMappingKey]: newMappingValue }
    await updateAccount(account.id, { mappings: updatedMappings })
    setNewMappingKey('')
    setNewMappingValue('')
  }

  const handleRemoveMapping = async (key: string) => {
    if (!account) return
    const updatedMappings = { ...account.mappings }
    delete updatedMappings[key]
    await updateAccount(account.id, { mappings: updatedMappings })
  }

  const toggleFieldVisibility = (key: string) => {
    setShowFields((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-[13px] text-muted-foreground">{description}</p>

      <div className="rounded-xl border border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg',
                connected ? 'bg-primary/10' : 'bg-muted'
              )}
            >
              <Icon
                className={cn('h-5 w-5', connected ? 'text-primary' : 'text-muted-foreground')}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{title}</span>
              <span className="text-[13px] text-muted-foreground">
                {connected ? `Connected as "${account.label}"` : 'Not connected'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {connected ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <XCircle className="h-3 w-3" />
                Disconnected
              </Badge>
            )}
          </div>
        </div>

        {connected ? (
          <>
            {/* Credentials display */}
            <div className="px-4 py-3.5 border-b border-border">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Credentials</span>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(account.maskedCredentials).map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-0.5">
                      <span className="text-[12px] text-muted-foreground">{key}</span>
                      <span className="text-[13px] font-mono">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Mappings editor */}
            {mappingLabel && (
              <div className="px-4 py-3.5 border-b border-border">
                <div className="flex flex-col gap-3">
                  <span className="text-sm font-medium">{mappingLabel}</span>
                  {Object.entries(account.mappings).length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {Object.entries(account.mappings).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-[13px] font-mono flex-1 truncate">{key}</span>
                          <span className="text-[13px] text-muted-foreground">&rarr;</span>
                          <span className="text-[13px] flex-1 truncate">{value}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveMapping(key)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      value={newMappingKey}
                      onChange={(e) => setNewMappingKey(e.target.value)}
                      placeholder={mappingKeyPlaceholder || 'Key'}
                      className="h-8 text-[13px]"
                    />
                    <span className="text-muted-foreground">&rarr;</span>
                    <Input
                      value={newMappingValue}
                      onChange={(e) => setNewMappingValue(e.target.value)}
                      placeholder="Project ID"
                      className="h-8 text-[13px]"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={handleAddMapping}
                      disabled={!newMappingKey || !newMappingValue}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="px-4 py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                    {testing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : null}
                    Test Connection
                  </Button>
                  {testResult && (
                    <span
                      className={cn(
                        'text-[13px]',
                        testResult.success ? 'text-green-600' : 'text-destructive'
                      )}
                    >
                      {testResult.message}
                    </span>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={loading}>
                  Disconnect
                </Button>
              </div>
            </div>
          </>
        ) : (
          /* Connect form */
          <div className="px-4 py-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm">Label</label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={`My ${title} integration`}
                  className="h-8"
                />
              </div>
              {fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <label className="text-sm">{field.label}</label>
                  <div className="relative">
                    <Input
                      type={
                        field.type === 'password' && !showFields[field.key]
                          ? 'password'
                          : 'text'
                      }
                      value={fieldValues[field.key] || ''}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      className="h-8 pr-9"
                    />
                    {field.type === 'password' && (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => toggleFieldVisibility(field.key)}
                      >
                        {showFields[field.key] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {connectError && (
                <p className="text-[13px] text-destructive">{connectError}</p>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleConnect}
                  disabled={connecting}
                >
                  {connecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : null}
                  Connect
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
