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
  Bot,
  Brain,
  Keyboard,
  Puzzle,
  Zap,
  RefreshCw,
  Terminal,
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useGitHubStore } from "@/stores/github-store"
import { clearAllData } from "@/lib/db"
import { getSupabase } from "@/lib/supabase-client"
import { isServerMode } from "@/lib/app-mode"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { GitHubConnectButton, GitHubSyncButton } from "@/components/github-connect-button"
import { PluginSettingsContent } from "@/components/plugin-settings"
import { SkillSettingsContent } from "@/components/skill-settings"
import { ChannelAccountCard } from "@/components/channel-account-card"
import { useConnectedAccountsStore } from "@/stores/connected-accounts-store"
import type { DomainExpertise, ExperienceLevel } from "@/types"
import { useMachinesStore } from "@/stores/machines-store"

const models = [
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
]

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
  | "connected-accounts"
  | "environments"
  | "agents"
  | "models"
  | "keyboard-shortcuts"
  | "plugins"
  | "skills"

const personalItems: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security & access", icon: Shield },
  { id: "connected-accounts", label: "Connected accounts", icon: LinkIcon },
]

const workspaceItems: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "environments", label: "Environments", icon: Server },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "models", label: "Models", icon: Brain },
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
    addApiKey,
    removeApiKey,
  } = useUserProfileStore()

  const { machines } = useMachinesStore()

  const [newKeyProvider, setNewKeyProvider] = useState("")
  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyValue, setNewKeyValue] = useState("")
  const [showAddKey, setShowAddKey] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)

  const handleAddApiKey = () => {
    if (newKeyProvider && newKeyName && newKeyValue) {
      // Mask the key for storage (show first 4 and last 4 chars)
      const masked =
        newKeyValue.length > 8
          ? `${newKeyValue.slice(0, 4)}${"*".repeat(newKeyValue.length - 8)}${newKeyValue.slice(-4)}`
          : "*".repeat(newKeyValue.length)
      addApiKey(newKeyProvider, newKeyName, masked)
      setNewKeyProvider("")
      setNewKeyName("")
      setNewKeyValue("")
      setShowAddKey(false)
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

        const response = await fetch('/api/auth/delete-account', {
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

      // Clear all local data (works for both modes)
      await clearAllData()

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

      {/* API Keys */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">API Keys</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddKey(!showAddKey)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Key
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Manage API keys for agent providers. Keys are stored securely and masked for display.
        </p>

        {showAddKey && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm">Provider</label>
                  <Input
                    value={newKeyProvider}
                    onChange={(e) => setNewKeyProvider(e.target.value)}
                    placeholder="e.g., OpenAI, Anthropic"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm">Name</label>
                  <Input
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g., Production Key"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm">API Key</label>
                <Input
                  type="password"
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  placeholder="sk-..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowAddKey(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddApiKey}
                  disabled={!newKeyProvider || !newKeyName || !newKeyValue}
                >
                  Add Key
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card">
          {profile.apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Key className="mb-2 h-8 w-8" />
              <span className="text-sm">No API keys configured</span>
            </div>
          ) : (
            profile.apiKeys.map((key, idx) => (
              <div
                key={key.id}
                className={cn(
                  "flex items-center justify-between px-4 py-3",
                  idx !== profile.apiKeys.length - 1 && "border-b border-border"
                )}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{key.name}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {key.provider} &middot; {key.maskedKey}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeApiKey(key.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

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

function ModelsContent() {
  const { model, setModel, connectionStatus, checkConnection } = useSettingsStore()

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">Models</h1>

      {/* Connection Status */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Claude API Connection</h2>
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  connectionStatus === "connected"
                    ? "bg-success"
                    : connectionStatus === "checking"
                      ? "bg-warning animate-pulse"
                      : "bg-destructive"
                )}
              />
              <span className="text-sm">
                {connectionStatus === "connected"
                  ? "Connected"
                  : connectionStatus === "checking"
                    ? "Checking..."
                    : "Disconnected"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={checkConnection}
              disabled={connectionStatus === "checking"}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", connectionStatus === "checking" && "animate-spin")}
              />
              Retry
            </Button>
          </div>
        </div>
        {connectionStatus === "disconnected" && (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-4">
            <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Authentication required</span>
              <span className="text-xs text-muted-foreground">
                Run{" "}
                <code className="rounded bg-background px-1.5 py-0.5 font-primary text-foreground">
                  claude login
                </code>{" "}
                in your terminal to authenticate with your Max plan or set an API key.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Model Selection */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Model</h2>
        <div className="rounded-xl border border-border bg-card">
          <div className="px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">Default model</span>
                <span className="text-[13px] text-muted-foreground">
                  Model used for plan generation and chat
                </span>
              </div>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-8 rounded-md border border-border bg-card px-2.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Sonnet is recommended for most tasks. Opus provides the highest quality for complex
          planning.
        </p>
      </section>
    </div>
  )
}

function AgentsContent() {
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const redetectProviders = useExecutionStore((s) => s.redetectProviders)
  const { defaultProvider, setDefaultProvider } = useSettingsStore()
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    if (!providersLoaded) {
      loadProviders()
    }
  }, [providersLoaded, loadProviders])

  const handleRedetect = async () => {
    setDetecting(true)
    await redetectProviders()
    setDetecting(false)
  }

  const authStatusConfig: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
    authenticated: { label: "Authenticated", variant: "success" },
    unauthenticated: { label: "Not authenticated", variant: "warning" },
    expired: { label: "Expired", variant: "destructive" },
    unknown: { label: "Unknown", variant: "secondary" },
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">Agents</h1>

      {/* Default Provider */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Default Agent</h2>
        <p className="text-[13px] text-muted-foreground">
          Choose which agent to use by default for task execution and plan generation.
        </p>
        <div className="rounded-xl border border-border bg-card">
          <div className="px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">Default provider</span>
                <span className="text-[13px] text-muted-foreground">
                  Used when no specific provider is selected
                </span>
              </div>
              <select
                value={defaultProvider}
                onChange={(e) => setDefaultProvider(e.target.value)}
                className="h-8 rounded-md border border-border bg-card px-2.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Auto (first available)</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.name}{!p.available ? " (unavailable)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Provider List */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Registered Providers</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRedetect}
            disabled={detecting}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", detecting && "animate-spin")} />
            Re-detect
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Agent providers detected on your system. Re-detect to refresh status.
        </p>

        {!providersLoaded ? (
          <div className="flex items-center justify-center rounded-xl border border-border bg-card py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12">
            <Bot className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No providers detected</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Install Claude Code or Codex CLI, then click Re-detect
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            {providers.map((provider, idx) => {
              const authConfig = authStatusConfig[provider.authStatus] || authStatusConfig.unknown
              return (
                <div
                  key={provider.id}
                  className={cn(
                    "flex items-center justify-between px-4 py-3.5",
                    idx !== providers.length - 1 && "border-b border-border"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg",
                      provider.available ? "bg-primary/10" : "bg-muted"
                    )}>
                      <Bot className={cn("h-4.5 w-4.5", provider.available ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{provider.name}</span>
                        {provider.available ? (
                          <Badge variant="success" className="gap-1 text-[10px]">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Available
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <XCircle className="h-2.5 w-2.5" />
                            Unavailable
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <span>{provider.installed ? "Installed" : "Not installed"}</span>
                        <span>&middot;</span>
                        <Badge variant={authConfig.variant} className="text-[10px] py-0 h-4">
                          {authConfig.label}
                        </Badge>
                        {provider.capabilities?.availableModels && (
                          <>
                            <span>&middot;</span>
                            <span>{provider.capabilities.availableModels.length} models</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {defaultProvider === provider.id && (
                    <Badge variant="outline" className="text-[10px]">Default</Badge>
                  )}
                </div>
              )
            })}
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
          { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Enter webhook secret', type: 'password', required: true },
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
  "connected-accounts": "Connected accounts",
  environments: "Environments",
  agents: "Agents",
  models: "Models",
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
      case "models":
        return <ModelsContent />
      case "agents":
        return <AgentsContent />
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
