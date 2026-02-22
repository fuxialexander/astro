import { useState, useEffect } from "react"
import { Link } from "react-router"
import {
  ChevronLeft,
  SlidersHorizontal,
  User,
  Bell,
  Shield,
  Link as LinkIcon,
  Server,
  Keyboard,
  Puzzle,
  Zap,
  Camera,
  Plus,
  Trash2,
  Key,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Github,
  MessageSquare,
  Send,
  Eye,
  EyeOff,
  Lock,
  Users,
  Mail,
  Clock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useGitHubStore } from "@/stores/github-store"
import { useApiKeysStore } from "@/stores/api-keys-store"
import { getSupabase } from "@/lib/supabase-client"
import { apiUrl } from "@/lib/api-url"
import { isServerMode } from "@/lib/app-mode"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GitHubConnectButton, GitHubSyncButton } from "@/components/github-connect-button"
import { PluginSettingsContent } from "@/components/plugin-settings"
import { SkillSettingsContent } from "@/components/skill-settings"
import { ChannelAccountCard } from "@/components/channel-account-card"
import { useConnectedAccountsStore } from "@/stores/connected-accounts-store"
import type { DomainExpertise, ExperienceLevel } from "@/types"
import { dataClient } from "@/lib/data-client"

const domainOptions: { value: DomainExpertise; label: string; description: string }[] = [
  { value: "computational-biology", label: "Computational Biology", description: "Bioinformatics, genomics, protein analysis" },
  { value: "web-development", label: "Web Development", description: "Frontend, backend, full-stack applications" },
  { value: "data-engineering", label: "Data Engineering", description: "Pipelines, ETL, data infrastructure" },
  { value: "ml-ai", label: "ML / AI", description: "Machine learning, deep learning, LLMs" },
  { value: "devops-infrastructure", label: "DevOps & Infrastructure", description: "CI/CD, cloud, containerization" },
  { value: "mobile-development", label: "Mobile Development", description: "iOS, Android, cross-platform apps" },
  { value: "systems-programming", label: "Systems Programming", description: "Low-level, embedded, operating systems" },
  { value: "scientific-computing", label: "Scientific Computing", description: "HPC, simulations, numerical methods" },
  { value: "security", label: "Security", description: "Application security, penetration testing" },
  { value: "other", label: "Other", description: "General software development" },
]

const experienceLevelOptions: { value: ExperienceLevel; label: string; description: string }[] = [
  { value: "beginner", label: "Beginner", description: "Learning fundamentals, needs detailed guidance" },
  { value: "intermediate", label: "Intermediate", description: "Comfortable with basics, growing expertise" },
  { value: "advanced", label: "Advanced", description: "Strong skills, can work independently" },
  { value: "expert", label: "Expert", description: "Deep expertise, can lead complex projects" },
]

// Removed: environmentOptions - replaced with dynamic machine list from useMachinesStore

type SettingsTab =
  | "preferences"
  | "profile"
  | "notifications"
  | "security"
  | "teams"
  | "connected-accounts"
  | "environments"
  | "keyboard-shortcuts"
  | "plugins"
  | "skills"

const personalItems: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security & access", icon: Shield },
  { id: "teams", label: "Teams", icon: Users },
  { id: "connected-accounts", label: "Connected accounts", icon: LinkIcon },
]

const workspaceItems: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "environments", label: "Environments", icon: Server },
  { id: "plugins", label: "Plugins", icon: Puzzle },
  { id: "skills", label: "Skills", icon: Zap },
  { id: "keyboard-shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
]

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        )}
      />
    </button>
  )
}

function SettingsRow({
  label,
  description,
  children,
  last = false,
}: {
  label: string
  description: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3.5",
        !last && "border-b border-border"
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SelectDropdown({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-border bg-card px-2.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

function PreferencesContent() {
  const [homeView, setHomeView] = useState("dashboard")
  const [displayNames, setDisplayNames] = useState("username")
  const [firstDay, setFirstDay] = useState("sunday")
  const [keyboardShortcuts, setKeyboardShortcuts] = useState(true)
  const [fontSize, setFontSize] = useState("default")
  const [pointerCursors, setPointerCursors] = useState(false)
  const [interfaceTheme, setInterfaceTheme] = useState("system")
  const [lightTheme, setLightTheme] = useState("default-light")
  const [darkTheme, setDarkTheme] = useState("default-dark")

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">Preferences</h1>

      {/* General */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">General</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label="Default home view"
            description="Select which view to display when launching Astro"
          >
            <SelectDropdown
              value={homeView}
              onChange={setHomeView}
              options={[
                { value: "dashboard", label: "Dashboard" },
                { value: "projects", label: "Projects" },
                { value: "issues", label: "Issues" },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label="Display names"
            description="Select how names are displayed in the interface"
          >
            <SelectDropdown
              value={displayNames}
              onChange={setDisplayNames}
              options={[
                { value: "username", label: "Username" },
                { value: "full-name", label: "Full name" },
                { value: "first-name", label: "First name" },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label="First day of the week"
            description="Used for date pickers"
          >
            <SelectDropdown
              value={firstDay}
              onChange={setFirstDay}
              options={[
                { value: "sunday", label: "Sunday" },
                { value: "monday", label: "Monday" },
                { value: "saturday", label: "Saturday" },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label="Enable keyboard shortcuts"
            description="Use keyboard shortcuts for common actions"
            last
          >
            <Toggle checked={keyboardShortcuts} onChange={setKeyboardShortcuts} />
          </SettingsRow>
        </div>
      </section>

      {/* Interface and theme */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Interface and theme</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label="App sidebar"
            description="Customize sidebar item visibility and order"
          >
            <button className="text-sm text-primary hover:underline">Customize</button>
          </SettingsRow>
          <SettingsRow
            label="Font size"
            description="Adjust the size of text across the app"
          >
            <SelectDropdown
              value={fontSize}
              onChange={setFontSize}
              options={[
                { value: "small", label: "Small" },
                { value: "default", label: "Default" },
                { value: "large", label: "Large" },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label="Use pointer cursors"
            description="Change cursor to pointer when hovering on interactive elements"
          >
            <Toggle checked={pointerCursors} onChange={setPointerCursors} />
          </SettingsRow>
          <SettingsRow
            label="Interface theme"
            description="Select or customize your interface color scheme"
          >
            <SelectDropdown
              value={interfaceTheme}
              onChange={setInterfaceTheme}
              options={[
                { value: "system", label: "System preference" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label="Light"
            description="Theme to use for light system appearance"
          >
            <SelectDropdown
              value={lightTheme}
              onChange={setLightTheme}
              options={[
                { value: "default-light", label: "Default" },
                { value: "warm-light", label: "Warm" },
                { value: "cool-light", label: "Cool" },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label="Dark"
            description="Theme to use for dark system appearance"
            last
          >
            <SelectDropdown
              value={darkTheme}
              onChange={setDarkTheme}
              options={[
                { value: "default-dark", label: "Default" },
                { value: "warm-dark", label: "Warm" },
                { value: "cool-dark", label: "Cool" },
              ]}
            />
          </SettingsRow>
        </div>
      </section>
    </div>
  )
}

function DomainChip({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm transition-colors",
        selected
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}

function ProfileContent() {
  const {
    profile,
    setName,
    setEmail,
    setBio,
    toggleDomain,
    setExperienceLevel,
    togglePreferredMachine,
    setNotificationsEnabled,
    setEmailNotifications,
    setDefaultMachineId,
    setDefaultProvider,
  } = useUserProfileStore()

  const {
    encryptedKeys,
    loaded: keysLoaded,
    loading: keysLoading,
    load: loadKeys,
    addKey: addEncryptedKey,
    removeKey: removeEncryptedKey,
    getDecryptedKey,
  } = useApiKeysStore()

  const { machines } = useMachinesStore()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)

  // Encrypted API keys state
  const [showAddEncryptedKey, setShowAddEncryptedKey] = useState(false)
  const [newService, setNewService] = useState("")
  const [newApiKey, setNewApiKey] = useState("")
  const [addingKey, setAddingKey] = useState(false)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [decryptedKeyValues, setDecryptedKeyValues] = useState<Map<string, string>>(new Map())

  // Load encrypted keys on mount
  useEffect(() => {
    if (isServerMode() && !keysLoaded && !keysLoading) {
      loadKeys()
    }
  }, [keysLoaded, keysLoading, loadKeys])

  // Load execution machines and providers for default selection
  const execMachines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)

  useEffect(() => {
    if (!machinesLoaded) loadMachines()
    if (!providersLoaded) loadProviders()
  }, [machinesLoaded, loadMachines, providersLoaded, loadProviders])

  const onlineMachines = execMachines.filter((m) => m.status !== 'offline')
  const availableProviders = providers.filter((p) => p.available)

  const handleAddEncryptedKey = async () => {
    if (!newService || !newApiKey) return

    setAddingKey(true)
    try {
      await addEncryptedKey(newService, newApiKey)
      setNewService("")
      setNewApiKey("")
      setShowAddEncryptedKey(false)
    } catch (error) {
      console.error("[settings] Failed to add encrypted key:", error)
      alert(`Failed to add API key: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setAddingKey(false)
    }
  }

  const handleRemoveEncryptedKey = async (serviceName: string) => {
    setRemovingKey(serviceName)
    try {
      await removeEncryptedKey(serviceName)
      // Remove from revealed keys
      setRevealedKeys((prev) => {
        const next = new Set(prev)
        next.delete(serviceName)
        return next
      })
      // Remove from decrypted cache
      setDecryptedKeyValues((prev) => {
        const next = new Map(prev)
        next.delete(serviceName)
        return next
      })
    } catch (error) {
      console.error("[settings] Failed to remove encrypted key:", error)
      alert(`Failed to remove API key: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setRemovingKey(null)
    }
  }

  const toggleRevealKey = async (serviceName: string) => {
    const isRevealed = revealedKeys.has(serviceName)

    if (isRevealed) {
      // Hide key
      setRevealedKeys((prev) => {
        const next = new Set(prev)
        next.delete(serviceName)
        return next
      })
    } else {
      // Decrypt and reveal key
      if (!decryptedKeyValues.has(serviceName)) {
        try {
          const plainKey = await getDecryptedKey(serviceName)
          if (plainKey) {
            setDecryptedKeyValues((prev) => new Map(prev).set(serviceName, plainKey))
          }
        } catch (error) {
          console.error("[settings] Failed to decrypt key:", error)
          alert("Failed to decrypt API key")
          return
        }
      }

      setRevealedKeys((prev) => new Set(prev).add(serviceName))
    }
  }

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true)
    try {
      if (isServerMode()) {
        // Supabase mode: Call backend to delete account
        const supabase = getSupabase()
        if (!supabase) {
          throw new Error('Supabase not configured')
        }

        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          throw new Error('Not authenticated')
        }

        const response = await fetch(apiUrl('/api/auth/delete-account'), {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to delete account')
        }

        // Sign out from Supabase
        await supabase.auth.signOut()
      }

      // No local data to clear — PGlite data lives on server/disk

      // Force a full page reload to clear all state and redirect to welcome
      window.location.href = '/welcome'
    } catch (error) {
      console.error('[settings] Failed to delete account:', error)
      alert(`Failed to delete account: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setIsDeletingAccount(false)
      setShowDeleteConfirm(false)
    }
  }

  const getInitials = (name: string) => {
    if (!name) return "U"
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">Profile</h1>

      {/* User Identity */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Identity</h2>
        <div className="rounded-xl border border-border bg-card">
          {/* Avatar */}
          <div className="flex items-center gap-4 border-b border-border px-4 py-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={profile.avatarUrl} />
              <AvatarFallback className="text-lg">{getInitials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Profile photo</span>
              <Button variant="outline" size="sm" className="w-fit">
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                Change photo
              </Button>
            </div>
          </div>
          {/* Name */}
          <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Name</span>
              <span className="text-[13px] text-muted-foreground">Your display name</span>
            </div>
            <Input
              value={profile.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-[240px]"
            />
          </div>
          {/* Email */}
          <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Email</span>
              <span className="text-[13px] text-muted-foreground">Your email address</span>
            </div>
            <Input
              type="email"
              value={profile.email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-[240px]"
            />
          </div>
          {/* Bio */}
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Bio</span>
              <span className="text-[13px] text-muted-foreground">
                Brief description of your work (helps personalize planning)
              </span>
            </div>
            <textarea
              value={profile.bio || ""}
              onChange={(e) => setBio(e.target.value)}
              placeholder="e.g., Computational biologist working on single-cell analysis pipelines..."
              className="h-[80px] w-full resize-none rounded-md border border-border bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </section>

      {/* Domain Expertise */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Domain Expertise</h2>
        <p className="text-[13px] text-muted-foreground">
          Select your areas of expertise. This helps the planning system provide more relevant
          context and suggestions.
        </p>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            {domainOptions.map((option) => (
              <DomainChip
                key={option.value}
                label={option.label}
                selected={profile.domains.includes(option.value)}
                onClick={() => toggleDomain(option.value)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Experience Level */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Experience Level</h2>
        <p className="text-[13px] text-muted-foreground">
          This helps calibrate plan granularity and the level of detail in guidance.
        </p>
        <div className="rounded-xl border border-border bg-card">
          {experienceLevelOptions.map((option, idx) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-4 py-3",
                idx !== experienceLevelOptions.length - 1 && "border-b border-border"
              )}
            >
              <input
                type="radio"
                name="experienceLevel"
                value={option.value}
                checked={profile.experienceLevel === option.value}
                onChange={() => setExperienceLevel(option.value)}
                className="h-4 w-4 accent-primary"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{option.label}</span>
                <span className="text-[13px] text-muted-foreground">{option.description}</span>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Preferred Machines */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Preferred Machines</h2>
        <p className="text-[13px] text-muted-foreground">
          Select your preferred machines for task dispatch. Tasks will prioritize these machines when available.
        </p>
        {machines.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">No registered machines found.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Register machines from the{" "}
              <Link to="/environments" className="text-primary hover:underline">
                Environments
              </Link>{" "}
              page to set preferences.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            {machines.map((machine, idx) => (
              <label
                key={machine.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-3",
                  idx !== machines.length - 1 && "border-b border-border",
                  machine.isRevoked && "opacity-50"
                )}
              >
                <input
                  type="checkbox"
                  checked={profile.preferredMachines.includes(machine.id)}
                  onChange={() => togglePreferredMachine(machine.id)}
                  disabled={machine.isRevoked}
                  className="h-4 w-4 rounded accent-primary disabled:cursor-not-allowed"
                />
                <div className="flex flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{machine.name}</span>
                    {machine.isConnected && (
                      <Badge variant="outline" className="h-5 text-[10px] uppercase">
                        Online
                      </Badge>
                    )}
                    {machine.isRevoked && (
                      <Badge variant="outline" className="h-5 text-[10px] uppercase text-muted-foreground">
                        Revoked
                      </Badge>
                    )}
                  </div>
                  <span className="text-[13px] text-muted-foreground">
                    {machine.hostname} • {machine.environmentType} • {machine.platform}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Default Execution Settings */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Default Execution Settings</h2>
        <p className="text-[13px] text-muted-foreground">
          Set default machine and agent for the node inspector. These will be pre-selected when creating or editing tasks.
        </p>
        <div className="rounded-xl border border-border bg-card">
          {/* Default Machine */}
          <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Default machine</span>
              <span className="text-[13px] text-muted-foreground">
                Machine to pre-select in the node inspector
              </span>
            </div>
            <select
              value={profile.defaultMachineId || ""}
              onChange={(e) => setDefaultMachineId(e.target.value || undefined)}
              className="h-8 rounded-md border border-border bg-card px-2.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-w-[180px]"
            >
              <option value="">Auto (first available)</option>
              {onlineMachines.map((m) => (
                <option key={m.machineId} value={m.machineId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Default Agent Provider */}
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Default agent</span>
              <span className="text-[13px] text-muted-foreground">
                Agent provider to pre-select in the node inspector
              </span>
            </div>
            <select
              value={profile.defaultProvider || ""}
              onChange={(e) => setDefaultProvider(e.target.value || undefined)}
              className="h-8 rounded-md border border-border bg-card px-2.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-w-[180px]"
            >
              <option value="">Auto (first available)</option>
              {availableProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Notification Preferences */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label="Enable notifications"
            description="Receive in-app notifications for task updates and decisions"
          >
            <Toggle
              checked={profile.notificationsEnabled}
              onChange={setNotificationsEnabled}
            />
          </SettingsRow>
          <SettingsRow
            label="Email notifications"
            description="Receive email digests for important updates"
            last
          >
            <Toggle
              checked={profile.emailNotifications}
              onChange={setEmailNotifications}
            />
          </SettingsRow>
        </div>
      </section>

      {/* Encrypted API Keys (Server Mode Only) */}
      {isServerMode() && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">API Keys</h2>
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Lock className="h-2.5 w-2.5" />
                Encrypted
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddEncryptedKey(true)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Key
            </Button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Manage API keys for external services (OpenAI Whisper, etc.). Keys are encrypted
            client-side before storage using Web Crypto API.
          </p>

          <div className="rounded-xl border border-border bg-card">
            {keysLoading ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mb-2 h-5 w-5 animate-spin" />
                <span className="text-sm">Loading API keys...</span>
              </div>
            ) : encryptedKeys.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Key className="mb-2 h-8 w-8" />
                <span className="text-sm">No API keys configured</span>
              </div>
            ) : (
              encryptedKeys.map((key, idx) => {
                const isRevealed = revealedKeys.has(key.serviceName)
                const decryptedValue = decryptedKeyValues.get(key.serviceName)
                const displayValue = isRevealed && decryptedValue
                  ? decryptedValue
                  : "••••••••••••••••"

                return (
                  <div
                    key={key.id}
                    className={cn(
                      "flex items-center justify-between px-4 py-3",
                      idx !== encryptedKeys.length - 1 && "border-b border-border"
                    )}
                  >
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <span className="text-sm font-medium">{key.serviceName}</span>
                      <div className="flex items-center gap-2">
                        <code className="text-[12px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {displayValue}
                        </code>
                        <button
                          onClick={() => toggleRevealKey(key.serviceName)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title={isRevealed ? "Hide key" : "Reveal key"}
                        >
                          {isRevealed ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        Added {key.createdAt.toLocaleDateString()}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveEncryptedKey(key.serviceName)}
                      disabled={removingKey === key.serviceName}
                      className="text-destructive hover:text-destructive"
                    >
                      {removingKey === key.serviceName ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        </section>
      )}

      {/* Add Encrypted API Key Dialog */}
      <Dialog open={showAddEncryptedKey} onOpenChange={setShowAddEncryptedKey}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add API Key</DialogTitle>
            <DialogDescription>
              Add an encrypted API key for an external service. Your key will be encrypted
              client-side before being stored.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Service Name</label>
              <Input
                value={newService}
                onChange={(e) => setNewService(e.target.value)}
                placeholder="e.g., openai-whisper, anthropic"
              />
              <p className="text-xs text-muted-foreground">
                Use a unique identifier for the service (e.g., openai-whisper, openai-gpt4)
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">API Key</label>
              <Input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="sk-..."
              />
              <p className="text-xs text-muted-foreground">
                Your key will be encrypted using AES-GCM before storage
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddEncryptedKey(false)
                setNewService("")
                setNewApiKey("")
              }}
              disabled={addingKey}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddEncryptedKey}
              disabled={!newService || !newApiKey || addingKey}
            >
              {addingKey ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  Add Key
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account Actions */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Account</h2>
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Change password</span>
              <span className="text-[13px] text-muted-foreground">Update your account password</span>
            </div>
            <Button variant="outline" size="sm">
              Change password
            </Button>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-destructive">Delete account</span>
              <span className="text-[13px] text-muted-foreground">
                Permanently delete your account and all data
              </span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete account
            </Button>
          </div>
        </div>

        {showDeleteConfirm && (
          <div className="rounded-xl border border-destructive bg-destructive/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-destructive">
                    Are you sure you want to delete your account?
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    This action cannot be undone. All your projects, plans, and data will be
                    permanently deleted.
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeletingAccount}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteAccount}
                    disabled={isDeletingAccount}
                  >
                    {isDeletingAccount ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Deleting...
                      </>
                    ) : (
                      "Yes, delete my account"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function ConnectedAccountsContent() {
  const { connected, user, repos, selectedRepoIds, fetchStatus, disconnect } = useGitHubStore()
  const { load: loadAccounts, loaded: accountsLoaded } = useConnectedAccountsStore()

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    if (!accountsLoaded) {
      loadAccounts()
    }
  }, [accountsLoaded, loadAccounts])

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">Connected accounts</h1>

      {/* GitHub Integration */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">GitHub</h2>
        <p className="text-[13px] text-muted-foreground">
          Connect your GitHub account to browse and select repositories when creating projects.
        </p>

        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg",
                connected ? "bg-primary/10" : "bg-muted"
              )}>
                <Github className={cn("h-5 w-5", connected ? "text-primary" : "text-muted-foreground")} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">GitHub</span>
                {connected ? (
                  <span className="text-[13px] text-muted-foreground">
                    Connected as @{user?.login}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">
                    Not connected
                  </span>
                )}
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
              <div className="px-4 py-3.5 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm">Repositories</span>
                    <span className="text-[13px] text-muted-foreground">
                      {repos.length} repositories • {selectedRepoIds.length} selected
                    </span>
                  </div>
                  <GitHubSyncButton />
                </div>
              </div>
              <div className="px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm">Disconnect</span>
                    <span className="text-[13px] text-muted-foreground">
                      Remove GitHub integration and clear repository cache
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={disconnect}>
                    Disconnect
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="px-4 py-4">
              <GitHubConnectButton />
            </div>
          )}
        </div>
      </section>

      {/* Slack */}
      <ChannelAccountCard
        channel="slack"
        icon={MessageSquare}
        title="Slack"
        description="Connect your Slack workspace to receive notifications and interact with Astro."
        fields={[
          { key: 'botToken', label: 'Bot Token', placeholder: 'xoxb-...', type: 'password', required: true },
          { key: 'signingSecret', label: 'Signing Secret', placeholder: 'Enter signing secret', type: 'password', required: true },
        ]}
        mappingLabel="Channel ID → Project"
        mappingKeyPlaceholder="C01ABC23DEF"
      />

      {/* Telegram */}
      <ChannelAccountCard
        channel="telegram"
        icon={Send}
        title="Telegram"
        description="Connect a Telegram bot to interact with Astro from Telegram chats."
        fields={[
          { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...', type: 'password', required: true },
          { key: 'webhookSecret', label: 'Webhook Secret (Optional)', placeholder: 'Enter webhook secret for additional security', type: 'password', required: false },
        ]}
        mappingLabel="Chat ID → Project"
        mappingKeyPlaceholder="-1001234567890"
      />

      {/* GitHub Webhooks */}
      <ChannelAccountCard
        channel="github_webhook"
        icon={Github}
        title="GitHub Webhooks"
        description="Receive GitHub webhook events (issues, PRs, pushes) and route them to Astro projects."
        fields={[
          { key: 'authToken', label: 'Auth Token', placeholder: 'ghp_...', type: 'password', required: true },
          { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Enter webhook secret', type: 'password', required: true },
        ]}
        mappingLabel="owner/repo → Project"
        mappingKeyPlaceholder="owner/repo-name"
      />

      {/* Linear */}
      <ChannelAccountCard
        channel="linear"
        icon={LinkIcon}
        title="Linear"
        description="Connect Linear to sync issues and receive webhook events for your Astro projects."
        fields={[
          { key: 'apiToken', label: 'API Token', placeholder: 'lin_api_...', type: 'password', required: true },
          { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Enter webhook secret', type: 'password', required: true },
        ]}
        mappingLabel="Team ID → Project"
        mappingKeyPlaceholder="TEAM-123"
      />
    </div>
  )
}

function TeamsContent() {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [teams, setTeams] = useState<Array<{ id: string; name: string; role: string }>>([])
  const [members, setMembers] = useState<Array<{ user_id: string; role: string; joined_at: string; user: { name: string; email: string } }>>([])
  const [pendingInvites, setPendingInvites] = useState<Array<{ id: string; email: string; role: string; expires_at: string; created_at: string }>>([])
  const [loading, setLoading] = useState(true)
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'owner' | 'admin' | 'member'>('member')
  const [inviting, setInviting] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [, setCopiedToken] = useState(false)

  // Fetch user's teams
  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const { teams: loaded } = await dataClient.listTeams()
        setTeams(loaded.map((t) => ({
          id: t.id,
          name: t.name,
          role: (t as unknown as Record<string, unknown>).memberRole as string ?? 'member',
        })))
        // Auto-select first team
        if (loaded.length > 0 && !selectedTeamId) {
          setSelectedTeamId(loaded[0]!.id)
        }
        setLoading(false)
      } catch (error) {
        console.error('[settings] Failed to fetch teams:', error)
        setLoading(false)
      }
    }
    fetchTeams()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch team members and invites when a team is selected
  useEffect(() => {
    if (!selectedTeamId) {
      setMembers([])
      setPendingInvites([])
      return
    }

    const fetchTeamData = async () => {
      try {
        const membersData = await dataClient.getTeamMembers(selectedTeamId)
        setMembers(membersData.map((m) => ({
          user_id: m.userId,
          role: m.role,
          joined_at: m.joinedAt instanceof Date ? m.joinedAt.toISOString() : String(m.joinedAt),
          user: {
            name: m.userName ?? 'Unknown',
            email: m.userEmail ?? '',
          },
        })))
        const invitesData = await dataClient.getPendingInvites(selectedTeamId)
        setPendingInvites(invitesData.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          expires_at: inv.expiresAt instanceof Date ? inv.expiresAt.toISOString() : String(inv.expiresAt),
          created_at: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : String(inv.createdAt),
        })))
      } catch (error) {
        console.error('[settings] Failed to fetch team data:', error)
      }
    }
    fetchTeamData()
  }, [selectedTeamId])

  const handleSendInvite = async () => {
    if (!inviteEmail || !selectedTeamId) return

    setInviting(true)
    try {
      await dataClient.sendTeamInvite(selectedTeamId, inviteEmail, inviteRole)
      setShowInviteDialog(false)
      setInviteEmail('')
      setInviteRole('member')
      // Refresh invites list
      const invitesData = await dataClient.getPendingInvites(selectedTeamId)
      setPendingInvites(invitesData.map((inv) => ({
        id: inv.id, email: inv.email, role: inv.role,
        expires_at: inv.expiresAt instanceof Date ? inv.expiresAt.toISOString() : String(inv.expiresAt),
        created_at: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : String(inv.createdAt),
      })))
    } catch (error) {
      console.error('[settings] Failed to send invite:', error)
      alert(`Failed to send invitation: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setInviting(false)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    setRevoking(inviteId)
    try {
      await dataClient.revokeInvite(inviteId)
      setPendingInvites((prev) => prev.filter((inv) => inv.id !== inviteId))
    } catch (error) {
      console.error('[settings] Failed to revoke invite:', error)
      alert(`Failed to revoke invitation: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setRevoking(null)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!selectedTeamId) return

    setRemoving(userId)
    try {
      await dataClient.removeTeamMember(selectedTeamId, userId)
      setMembers((prev) => prev.filter((m) => m.user_id !== userId))
    } catch (error) {
      console.error('[settings] Failed to remove member:', error)
      alert(`Failed to remove member: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setRemoving(null)
    }
  }

  const copyInviteLink = (token: string) => {
    const inviteUrl = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(inviteUrl)
    setCopiedToken(true)
    setTimeout(() => setCopiedToken(false), 2000)
  }
  // Ensure copyInviteLink is available for future template usage
  void copyInviteLink

  if (!isServerMode()) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-[28px] font-semibold">Teams</h1>
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
          <Users className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Teams are only available in server mode</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run Astro with Supabase to enable team collaboration
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-[28px] font-semibold">Teams</h1>
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const selectedTeam = teams.find((t) => t.id === selectedTeamId)
  const canInvite = selectedTeam && ['owner', 'admin'].includes(selectedTeam.role)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">Teams</h1>

      {teams.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
          <Users className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">You're not a member of any teams yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ask a team admin to send you an invitation
          </p>
        </div>
      ) : (
        <>
          {/* Team Selector */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Select Team</h2>
            <div className="rounded-xl border border-border bg-card">
              {teams.map((team, idx) => (
                <button
                  key={team.id}
                  onClick={() => setSelectedTeamId(team.id)}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    idx !== teams.length - 1 && "border-b border-border",
                    selectedTeamId === team.id && "bg-muted"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{team.name}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {team.role}
                  </Badge>
                </button>
              ))}
            </div>
          </section>

          {selectedTeamId && (
            <>
              {/* Team Members */}
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Members</h2>
                  {canInvite && (
                    <Button variant="outline" size="sm" onClick={() => setShowInviteDialog(true)}>
                      <Mail className="mr-1.5 h-3.5 w-3.5" />
                      Invite Member
                    </Button>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-card">
                  {members.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <Users className="mb-2 h-8 w-8" />
                      <span className="text-sm">No members yet</span>
                    </div>
                  ) : (
                    members.map((member, idx) => (
                      <div
                        key={member.user_id}
                        className={cn(
                          "flex items-center justify-between px-4 py-3",
                          idx !== members.length - 1 && "border-b border-border"
                        )}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{member.user.name}</span>
                          <span className="text-xs text-muted-foreground">{member.user.email}</span>
                          <span className="text-xs text-muted-foreground">
                            Joined {new Date(member.joined_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {member.role}
                          </Badge>
                          {canInvite && member.role !== 'owner' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveMember(member.user_id)}
                              disabled={removing === member.user_id}
                              className="text-destructive hover:text-destructive"
                            >
                              {removing === member.user_id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Pending Invitations */}
              {canInvite && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold">Pending Invitations</h2>
                  <div className="rounded-xl border border-border bg-card">
                    {pendingInvites.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <Mail className="mb-2 h-8 w-8" />
                        <span className="text-sm">No pending invitations</span>
                      </div>
                    ) : (
                      pendingInvites.map((invite, idx) => (
                        <div
                          key={invite.id}
                          className={cn(
                            "flex items-center justify-between px-4 py-3",
                            idx !== pendingInvites.length - 1 && "border-b border-border"
                          )}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">{invite.email}</span>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              Expires {new Date(invite.expires_at).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {invite.role}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevokeInvite(invite.id)}
                              disabled={revoking === invite.id}
                              className="text-destructive hover:text-destructive"
                            >
                              {revoking === invite.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {/* Invite Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an email invitation to join {selectedTeam?.name}. The invitation will be valid for 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Email Address</label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'owner' | 'admin' | 'member')}
                className="h-9 rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="member">Member — Can view and participate</option>
                <option value="admin">Admin — Can manage members and settings</option>
                <option value="owner">Owner — Full control</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowInviteDialog(false)
                setInviteEmail('')
                setInviteRole('member')
              }}
              disabled={inviting}
            >
              Cancel
            </Button>
            <Button onClick={handleSendInvite} disabled={!inviteEmail || inviting}>
              {inviting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Invitation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PlaceholderContent({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">{title}</h1>
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
        <p className="text-sm text-muted-foreground">Coming soon</p>
      </div>
    </div>
  )
}

const tabTitles: Record<SettingsTab, string> = {
  preferences: "Preferences",
  profile: "Profile",
  notifications: "Notifications",
  security: "Security & access",
  teams: "Teams",
  "connected-accounts": "Connected accounts",
  environments: "Environments",
  plugins: "Plugins",
  skills: "Skills",
  "keyboard-shortcuts": "Keyboard shortcuts",
}

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("preferences")

  function renderContent() {
    switch (activeTab) {
      case "preferences":
        return <PreferencesContent />
      case "profile":
        return <ProfileContent />
      case "teams":
        return <TeamsContent />
      case "connected-accounts":
        return <ConnectedAccountsContent />
      case "plugins":
        return <PluginSettingsContent />
      case "skills":
        return <SkillSettingsContent />
      default:
        return <PlaceholderContent title={tabTitles[activeTab]} />
    }
  }

  return (
    <div className="flex h-full">
      {/* Settings Sidebar */}
      <div className="flex w-[240px] shrink-0 flex-col border-r border-border bg-card">
        <div className="px-3 pt-4 pb-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to app
          </Link>
        </div>

        {/* Personal section */}
        <div className="flex flex-col gap-0.5 px-2 py-2">
          {personalItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-left transition-colors",
                  activeTab === item.id
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            )
          })}
        </div>

        {/* Workspace section */}
        <div className="px-2 py-2">
          <span className="px-2.5 text-[11px] font-semibold uppercase text-muted-foreground">
            Workspace
          </span>
          <div className="mt-2 flex flex-col gap-0.5">
            {workspaceItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-left transition-colors",
                    activeTab === item.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-12 px-20">{renderContent()}</div>
    </div>
  )
}
