import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router"
import {
  ChevronLeft,
  SlidersHorizontal,
  User,
  Bell,
  Link as LinkIcon,
  Server,
  Keyboard,
  Puzzle,
  Zap,
  Camera,
  Paintbrush,
  Plus,
  Trash2,
  Key,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Github,
  Eye,
  EyeOff,
  Lock,
  Users,
  Mail,
  Clock,
  Copy,
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useTheme } from "@/components/theme-provider"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useGitHubStore } from "@/stores/github-store"
import { useGitHubAppStore } from "@/stores/github-app-store"
import { useApiKeysStore } from "@/stores/api-keys-store"
import { useSettingsStore, defaultModelTierMap, type ModelTier } from "@/stores/settings-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { useToastStore } from "@/stores/toast-store"
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
import { GitHubSyncButton } from "@/components/github-connect-button"
import { GitHubAppInstallationManager } from "@/components/github-app-installation-manager"
import { GitHubIntegrationGuide } from "@/components/github-integration-guide"
import { PluginSettingsContent } from "@/components/plugin-settings"
import { SkillSettingsContent } from "@/components/skill-settings"
import { GitHubProjectLinker } from "@/components/github-project-linker"
import { TelegramConnectCard } from "@/components/telegram-connect-card"
import { useFeatureFlag } from "@/hooks/use-feature-flag"
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
  | "general"
  | "appearance"
  | "profile"
  | "notifications"
  | "teams"
  | "connected-accounts"
  | "environments"
  | "keyboard-shortcuts"
  | "plugins"
  | "skills"

const personalItems: { id: SettingsTab; labelKey: string; icon: React.ElementType }[] = [
  { id: "general", labelKey: "sidebar.general", icon: SlidersHorizontal },
  { id: "appearance", labelKey: "sidebar.appearance", icon: Paintbrush },
  { id: "profile", labelKey: "sidebar.profile", icon: User },
  { id: "notifications", labelKey: "sidebar.notifications", icon: Bell },
  { id: "teams", labelKey: "sidebar.teams", icon: Users },
  { id: "connected-accounts", labelKey: "sidebar.connectedAccounts", icon: LinkIcon },
]

const workspaceItems: { id: SettingsTab; labelKey: string; icon: React.ElementType }[] = [
  { id: "environments", labelKey: "sidebar.environments", icon: Server },
  { id: "plugins", labelKey: "sidebar.plugins", icon: Puzzle },
  { id: "skills", labelKey: "sidebar.skills", icon: Zap },
  { id: "keyboard-shortcuts", labelKey: "sidebar.keyboardShortcuts", icon: Keyboard },
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

function GeneralContent() {
  const { t } = useTranslation("settings")
  const [homeView, setHomeView] = useState("dashboard")
  const [displayNames, setDisplayNames] = useState("username")
  const [firstDay, setFirstDay] = useState("sunday")
  const [keyboardShortcuts, setKeyboardShortcuts] = useState(true)
  const setEditing = useSidebarStore((s) => s.setEditing)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-primary font-semibold">{t("general.title")}</h1>

      <section className="flex flex-col gap-3">
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("general.homeView")}
            description={t("general.homeViewDesc")}
          >
            <SelectDropdown
              value={homeView}
              onChange={setHomeView}
              options={[
                { value: "dashboard", label: t("general.views.dashboard") },
                { value: "projects", label: t("general.views.projects") },
                { value: "issues", label: t("general.views.issues") },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label={t("general.displayNames")}
            description={t("general.displayNamesDesc")}
          >
            <SelectDropdown
              value={displayNames}
              onChange={setDisplayNames}
              options={[
                { value: "username", label: t("general.nameFormats.username") },
                { value: "full-name", label: t("general.nameFormats.fullName") },
                { value: "first-name", label: t("general.nameFormats.firstName") },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label={t("general.firstDay")}
            description={t("general.firstDayDesc")}
          >
            <SelectDropdown
              value={firstDay}
              onChange={setFirstDay}
              options={[
                { value: "sunday", label: t("general.weekdays.sunday") },
                { value: "monday", label: t("general.weekdays.monday") },
                { value: "saturday", label: t("general.weekdays.saturday") },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label={t("general.appSidebar")}
            description={t("general.appSidebarDesc")}
          >
            <button className="text-sm text-primary hover:underline" onClick={() => setEditing(true)}>{t("general.customize")}</button>
          </SettingsRow>
          <SettingsRow
            label={t("general.keyboardShortcuts")}
            description={t("general.keyboardShortcutsDesc")}
            last
          >
            <Toggle checked={keyboardShortcuts} onChange={setKeyboardShortcuts} />
          </SettingsRow>
        </div>
      </section>
    </div>
  )
}

function AppearanceContent() {
  const { t, i18n } = useTranslation("settings")
  const { theme, setTheme, availableThemes } = useTheme()
  const [fontSize, setFontSize] = useState("default")
  const [pointerCursors, setPointerCursors] = useState(false)
  const isChinese = i18n.language.startsWith('zh')

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-primary font-semibold">{t("appearance.title")}</h1>

      {/* Theme */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("appearance.theme")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("appearance.theme")}
            description={t("appearance.themeDesc")}
            last
          >
            <SelectDropdown
              value={theme}
              onChange={setTheme}
              options={availableThemes.map((th) => ({
                value: th.id,
                label: th.name,
              }))}
            />
          </SettingsRow>
        </div>
      </section>

      {/* Language */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("appearance.language")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("appearance.language")}
            description={t("appearance.languageDesc")}
            last={!isChinese}
          >
            <LanguageSwitcher />
          </SettingsRow>
          {isChinese && (
            <SettingsRow
              label={t("appearance.chineseStyle")}
              description={t("appearance.chineseStyleDesc")}
              last
            >
              <div className="flex rounded-md border border-border overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => i18n.changeLanguage('zh-CN')}
                  className={cn(
                    "px-3 py-1 transition-colors",
                    !i18n.language.endsWith('-wy')
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {t("appearance.chineseStyleProfessional")}
                </button>
                <button
                  type="button"
                  onClick={() => i18n.changeLanguage('zh-CN-wy')}
                  className={cn(
                    "px-3 py-1 transition-colors border-l border-border",
                    i18n.language.endsWith('-wy')
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {t("appearance.chineseStyleClassical")}
                </button>
              </div>
            </SettingsRow>
          )}
        </div>
      </section>

      {/* Interface */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("appearance.interface")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("appearance.fontSize")}
            description={t("appearance.fontSizeDesc")}
          >
            <SelectDropdown
              value={fontSize}
              onChange={setFontSize}
              options={[
                { value: "small", label: t("appearance.fontSizes.small") },
                { value: "default", label: t("appearance.fontSizes.default") },
                { value: "large", label: t("appearance.fontSizes.large") },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label={t("appearance.pointerCursors")}
            description={t("appearance.pointerCursorsDesc")}
            last
          >
            <Toggle checked={pointerCursors} onChange={setPointerCursors} />
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
  const { t } = useTranslation("settings")
  const {
    profile,
    setName,
    setEmail,
    setBio,
    toggleDomain,
    setExperienceLevel,
    togglePreferredMachine,
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
      window.location.href = '/plan'
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
      <h1 className="text-xl font-primary font-semibold">{t("profile.title")}</h1>

      {/* User Identity */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("profile.identity")}</h2>
        <div className="rounded-xl border border-border bg-card">
          {/* Avatar */}
          <div className="flex items-center gap-4 border-b border-border px-4 py-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={profile.avatarUrl} />
              <AvatarFallback className="text-lg">{getInitials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t("profile.profilePhoto")}</span>
              <Button variant="outline" size="sm" className="w-fit">
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                {t("profile.changePhoto")}
              </Button>
            </div>
          </div>
          {/* Name */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4 border-b border-border px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">{t("profile.name")}</span>
              <span className="text-[13px] text-muted-foreground">{t("profile.nameDesc")}</span>
            </div>
            <Input
              value={profile.name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("profile.namePlaceholder")}
              className="w-full md:w-[240px]"
            />
          </div>
          {/* Email */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4 border-b border-border px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">{t("profile.email")}</span>
              <span className="text-[13px] text-muted-foreground">{t("profile.emailDesc")}</span>
            </div>
            <Input
              type="email"
              value={profile.email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full md:w-[240px]"
            />
          </div>
          {/* Bio */}
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">{t("profile.bio")}</span>
              <span className="text-[13px] text-muted-foreground">
                {t("profile.bioDesc")}
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
        <h2 className="text-sm font-semibold">{t("profile.domainExpertise")}</h2>
        <p className="text-[13px] text-muted-foreground">
          {t("profile.domainExpertiseDesc")}
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
        <h2 className="text-sm font-semibold">{t("profile.experienceLevel")}</h2>
        <p className="text-[13px] text-muted-foreground">
          {t("profile.experienceLevelDesc")}
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
        <h2 className="text-sm font-semibold">{t("profile.preferredMachines")}</h2>
        <p className="text-[13px] text-muted-foreground">
          {t("profile.preferredMachinesDesc")}
        </p>
        {machines.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">{t("profile.noMachines")}</p>
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
                    {machine.hostname} • {machine.platform}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}
      </section>


      {/* Encrypted API Keys (Server Mode Only) */}
      {isServerMode() && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{t("apiKeys.title")}</h2>
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Lock className="h-2.5 w-2.5" />
                {t("apiKeys.encrypted")}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddEncryptedKey(true)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("apiKeys.addKey")}
            </Button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {t("apiKeys.addKeyDesc")}
          </p>

          <div className="rounded-xl border border-border bg-card">
            {keysLoading ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mb-2 h-5 w-5 animate-spin" />
                <span className="text-sm">{t("apiKeys.loading")}</span>
              </div>
            ) : encryptedKeys.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Key className="mb-2 h-8 w-8" />
                <span className="text-sm">{t("apiKeys.noKeys")}</span>
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
            <DialogTitle>{t("apiKeys.addDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("apiKeys.addDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t("apiKeys.addDialog.serviceName")}</label>
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
              <label className="text-sm font-medium">{t("apiKeys.addDialog.apiKey")}</label>
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
                  {t("apiKeys.addDialog.adding")}
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  {t("apiKeys.addDialog.addKey")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account Actions */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("profile.account")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">{t("profile.changePassword")}</span>
              <span className="text-[13px] text-muted-foreground">{t("profile.changePasswordDesc")}</span>
            </div>
            <Button variant="outline" size="sm">
              {t("profile.changePassword")}
            </Button>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-destructive">{t("profile.deleteAccount")}</span>
              <span className="text-[13px] text-muted-foreground">
                {t("profile.deleteAccountDesc")}
              </span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              {t("profile.deleteAccount")}
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
                    {t("profile.deleteConfirm")}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {t("profile.deleteConfirmDesc")}
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
                        {t("profile.deleting")}
                      </>
                    ) : (
                      t("profile.confirmDelete")
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
  const { t } = useTranslation("settings")
  const { connected, user, repos, selectedRepoIds, fetchStatus, disconnect, connect } = useGitHubStore()
  const { installations, install: installApp } = useGitHubAppStore()
  const { load: loadAccounts, loaded: accountsLoaded } = useConnectedAccountsStore()
  const { add: addToast } = useToastStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const gitHubEnabled = useFeatureFlag('github-integration')

  // Handle OAuth callback
  useEffect(() => {
    const githubParam = searchParams.get('github')
    const githubAppParam = searchParams.get('github-app')
    const reason = searchParams.get('reason')

    if (githubParam === 'connected') {
      addToast({
        title: 'GitHub connected',
        description: 'Your GitHub account has been successfully connected.',
        type: 'success',
        duration: 5000,
      })
      // Clear query params
      setSearchParams({})
    } else if (githubParam === 'error') {
      addToast({
        title: 'Connection failed',
        description: 'Failed to connect your GitHub account. Please try again.',
        type: 'error',
        duration: 5000,
      })
      setSearchParams({})
    }

    if (githubAppParam === 'installed') {
      addToast({
        title: 'GitHub App installed',
        description: 'The GitHub App has been successfully installed. You can now link it to teams or use it for projects.',
        type: 'success',
        duration: 5000,
      })
      setSearchParams({})
    } else if (githubAppParam === 'error') {
      const errorReason = reason === 'app_not_configured'
        ? 'GitHub App is not configured on this server.'
        : reason === 'invalid_state'
        ? 'Installation session expired. Please try again.'
        : 'Failed to install the GitHub App. Please try again.'
      addToast({
        title: 'Installation failed',
        description: errorReason,
        type: 'error',
        duration: 5000,
      })
      setSearchParams({})
    } else if (githubAppParam === 'uninstalled') {
      addToast({
        title: 'GitHub App uninstalled',
        description: 'The GitHub App was uninstalled from your GitHub account.',
        type: 'info',
        duration: 5000,
      })
      setSearchParams({})
    }
  }, [searchParams, addToast, setSearchParams])

  useEffect(() => {
    if (gitHubEnabled) fetchStatus()
  }, [fetchStatus, gitHubEnabled])

  useEffect(() => {
    if (!accountsLoaded) {
      loadAccounts()
    }
  }, [accountsLoaded, loadAccounts])

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-primary font-semibold">{t("connectedAccounts.title")}</h1>

      {/* GitHub sections — gated behind feature flag */}
      {gitHubEnabled && (
        <>
          {/* GitHub Integration Guide — shown only until both integrations are set up */}
          {(!connected || installations.length === 0) && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">GitHub</h2>
              <p className="text-[13px] text-muted-foreground">
                Astro integrates with GitHub in two ways. Choose the option that best fits your workflow—you can use both simultaneously.
              </p>

              <GitHubIntegrationGuide
                onOAuthClick={connect}
                onAppClick={installApp}
                oauthConnected={connected}
                appInstalled={installations.length > 0}
              />
            </section>
          )}

          {/* Personal Account Connection Status */}
          {connected && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Personal Account Status</h3>

              <div className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      "bg-primary/10"
                    )}>
                      <Github className={cn("h-5 w-5", "text-primary")} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">@{user?.login}</span>
                      <span className="text-[13px] text-muted-foreground">
                        Personal account
                      </span>
                    </div>
                  </div>
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </Badge>
                </div>

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
                        Remove personal account integration
                      </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={disconnect}>
                      Disconnect
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* GitHub App Installations */}
          <GitHubAppInstallationManager />

          {/* GitHub Projects */}
          <GitHubProjectLinker />
        </>
      )}

      {/* Telegram */}
      <TelegramConnectCard />

    </div>
  )
}

function TeamsContent() {
  const { t } = useTranslation("settings")
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [teams, setTeams] = useState<Array<{ id: string; name: string; role: string }>>([])
  const [members, setMembers] = useState<Array<{ user_id: string; role: string; joined_at: string; user: { name: string; email: string } }>>([])
  const [pendingInvites, setPendingInvites] = useState<Array<{ id: string; token: string; email: string; role: string; expires_at: string; created_at: string }>>([])
  const [loading, setLoading] = useState(true)
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'owner' | 'admin' | 'member'>('member')
  const [inviting, setInviting] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)

  // Fetch user's teams
  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const { teams: loaded } = await dataClient.listTeams()
        setTeams(loaded.map((team) => ({
          id: team.id,
          name: team.name,
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
          token: inv.token,
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
        id: inv.id, token: inv.token, email: inv.email, role: inv.role,
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

  const copyInviteLink = (inviteId: string, token: string) => {
    const inviteUrl = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(inviteUrl)
    setCopiedInviteId(inviteId)
    setTimeout(() => setCopiedInviteId(null), 2000)
  }

  if (!isServerMode()) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-xl font-primary font-semibold">{t("teams.title")}</h1>
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
          <Users className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("teams.serverModeOnly")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("teams.serverModeDesc")}
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-xl font-primary font-semibold">{t("teams.title")}</h1>
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const selectedTeam = teams.find((tm) => tm.id === selectedTeamId)
  const canInvite = selectedTeam && ['owner', 'admin'].includes(selectedTeam.role)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-primary font-semibold">{t("teams.title")}</h1>

      {teams.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
          <Users className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("teams.notMember")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("teams.notMemberDesc")}
          </p>
        </div>
      ) : (
        <>
          {/* Team Selector */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">{t("teams.selectTeam")}</h2>
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
                  <h2 className="text-sm font-semibold">{t("teams.members")}</h2>
                  {canInvite && (
                    <Button variant="outline" size="sm" onClick={() => setShowInviteDialog(true)}>
                      <Mail className="mr-1.5 h-3.5 w-3.5" />
                      {t("team.invite")}
                    </Button>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-card">
                  {members.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <Users className="mb-2 h-8 w-8" />
                      <span className="text-sm">{t("teams.noMembers")}</span>
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
                  <h2 className="text-sm font-semibold">{t("teams.pendingInvitations")}</h2>
                  <div className="rounded-xl border border-border bg-card">
                    {pendingInvites.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <Mail className="mb-2 h-8 w-8" />
                        <span className="text-sm">{t("teams.noPendingInvitations")}</span>
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
                              onClick={() => copyInviteLink(invite.id, invite.token)}
                              title="Copy invite link"
                            >
                              {copiedInviteId === invite.id ? (
                                <Check className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
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
            <DialogTitle>{t("teams.inviteDialog.title")}</DialogTitle>
            <DialogDescription>
              Create an invitation to join {selectedTeam?.name}. Copy the invite link to share directly. Valid for 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t("teams.inviteDialog.emailAddress")}</label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t("teams.inviteDialog.role")}</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'owner' | 'admin' | 'member')}
                className="h-9 rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="member">{t("teams.inviteDialog.roleOptions.member")}</option>
                <option value="admin">{t("teams.inviteDialog.roleOptions.admin")}</option>
                <option value="owner">{t("teams.inviteDialog.roleOptions.owner")}</option>
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
                  {t("teams.inviteDialog.sending")}
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  {t("teams.inviteDialog.sendInvitation")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NotificationsContent() {
  const { t } = useTranslation("settings")
  const {
    profile,
    setNotificationsEnabled,
    setEmailNotifications,
  } = useUserProfileStore()

  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  )

  const handleBrowserToggle = async (enabled: boolean) => {
    if (enabled && browserPermission === "default") {
      const result = await Notification.requestPermission()
      setBrowserPermission(result)
      if (result !== "granted") return
    }
    setNotificationsEnabled(enabled)
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-primary font-semibold">{t("notifications.title")}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("notifications.browser")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("notifications.browserNotifications")}
            description={
              browserPermission === "unsupported"
                ? t("notifications.browserUnsupported")
                : browserPermission === "denied"
                  ? t("notifications.browserDenied")
                  : t("notifications.browserDesc")
            }
            last
          >
            <Toggle
              checked={profile.notificationsEnabled && browserPermission === "granted"}
              onChange={handleBrowserToggle}
            />
          </SettingsRow>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("notifications.email")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("notifications.emailNotifications")}
            description={t("notifications.emailDesc")}
            last
          >
            <Toggle
              checked={profile.emailNotifications}
              onChange={setEmailNotifications}
            />
          </SettingsRow>
        </div>
      </section>
    </div>
  )
}

const tierOptions = [
  { value: "large", label: "Large (Most capable)" },
  { value: "medium", label: "Medium (Balanced)" },
  { value: "small", label: "Small (Fast & cheap)" },
]

function EnvironmentsSettingsContent() {
  const { t } = useTranslation("settings")
  const { profile, setDefaultMachineId } = useUserProfileStore()
  const { modelTier, setModelTier, defaultProvider: settingsProvider, setDefaultProvider: setSettingsProvider, customModelMap, setCustomModel, getEffectiveTierMap } = useSettingsStore()
  const addToast = useToastStore((s) => s.add)

  const execMachines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const resetTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveRef = useRef<{ tier: ModelTier; provider: string; model: string } | null>(null)

  useEffect(() => {
    if (!machinesLoaded) loadMachines()
    if (!providersLoaded) loadProviders()
  }, [machinesLoaded, loadMachines, providersLoaded, loadProviders])

  // Cleanup timeouts on unmount and flush pending changes
  useEffect(() => {
    return () => {
      // Clear debounce timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // Clear reset status timeout
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current)
      }
      // Flush pending save to avoid data loss
      if (pendingSaveRef.current) {
        const { tier, provider, model } = pendingSaveRef.current
        setCustomModel(tier, provider, model)
      }
    }
  }, [setCustomModel])

  const onlineMachines = execMachines.filter((m) => m.status !== "offline")
  const availableProviders = providers.filter((p) => p.available)

  // Collect provider IDs from defaults + custom overrides only (not detected providers)
  const effectiveMap = getEffectiveTierMap()
  const allProviderIds = new Set<string>()
  for (const tier of ["large", "medium", "small"] as ModelTier[]) {
    for (const pid of Object.keys(effectiveMap[tier])) allProviderIds.add(pid)
  }
  const providerIds = Array.from(allProviderIds)
  const builtinProviders = new Set(Object.keys(defaultModelTierMap.large))

  // Debounced save function for model mapping
  const debouncedSetCustomModel = useCallback((tier: ModelTier, provider: string, model: string) => {
    setSaveStatus("saving")

    // Store pending save params for cleanup flush
    pendingSaveRef.current = { tier, provider, model }

    // Clear existing timeouts
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current)
    }

    // Set new debounced save timeout (300ms for better UX)
    saveTimeoutRef.current = setTimeout(() => {
      pendingSaveRef.current = null
      setCustomModel(tier, provider, model).then(() => {
        setSaveStatus("saved")
        addToast({
          type: "success",
          title: "Settings saved",
          description: "Model configuration has been updated",
          duration: 2000,
        })
        resetTimeoutRef.current = setTimeout(() => {
          setSaveStatus("idle")
        }, 1500)
      }).catch(() => {
        setSaveStatus("idle")
        addToast({
          type: "error",
          title: "Failed to save",
          description: "Model configuration could not be saved. Please try again.",
          duration: 3000,
        })
      })
    }, 300)
  }, [setCustomModel, addToast])

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-primary font-semibold">{t("environments.title")}</h1>

      {/* Default Machine */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("environments.defaultMachine")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("environments.machine")}
            description={t("environments.machineDesc")}
            last
          >
            <SelectDropdown
              value={profile.defaultMachineId || ""}
              onChange={(v) => setDefaultMachineId(v || undefined)}
              options={[
                { value: "", label: t("environments.autoMachine") },
                ...onlineMachines.map((m) => ({
                  value: m.machineId,
                  label: m.name,
                })),
              ]}
            />
          </SettingsRow>
        </div>
      </section>

      {/* Default AI Agent */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("environments.defaultAgent")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("environments.aiAgent")}
            description={t("environments.aiAgentDesc")}
            last
          >
            <SelectDropdown
              value={settingsProvider || ""}
              onChange={(v) => {
                setSettingsProvider(v)
              }}
              options={[
                { value: "", label: t("environments.autoAgent") },
                ...availableProviders.map((p) => ({
                  value: p.id,
                  label: p.name,
                })),
              ]}
            />
          </SettingsRow>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border/50 p-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Agent types:</span>
            <br />
            • <span className="font-medium">claude-sdk</span> - Claude Code/API models (Opus, Sonnet, Haiku)
            <br />
            • <span className="font-medium">codex</span> - OpenAI Codex models for code generation
          </p>
        </div>
      </section>

      {/* Default Model Size */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("environments.defaultModel")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <SettingsRow
            label={t("environments.modelTier")}
            description={t("environments.modelTierDesc")}
            last
          >
            <SelectDropdown
              value={modelTier}
              onChange={(v) => setModelTier(v as ModelTier)}
              options={tierOptions}
            />
          </SettingsRow>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border/50 p-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">When each tier is used:</span>
            <br />
            • <span className="font-medium">Large</span> - Complex reasoning, plan generation, strategic decisions
            <br />
            • <span className="font-medium">Medium</span> - Standard tasks, code implementation, general operations
            <br />
            • <span className="font-medium">Small</span> - Simple tasks, quick responses, cost-sensitive operations
          </p>
        </div>
      </section>

      {/* Editable Model Mapping */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t("environments.modelMapping")}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("environments.modelMappingDesc")}</p>
          </div>
          {saveStatus !== "idle" && (
            <div className="flex items-center gap-1.5">
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{t("environments.saving")}</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <Check className="h-3 w-3 text-success" />
                  <span className="text-xs text-success">{t("environments.saved")}</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left font-medium p-2.5 pl-4 w-[80px]">Tier</th>
                  {providerIds.map((pid) => (
                    <th key={pid} className="text-left font-medium p-2.5 min-w-[160px]">
                      {pid}
                      {!builtinProviders.has(pid) && (
                        <Badge variant="outline" className="ml-1.5 text-[9px] py-0">custom</Badge>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["large", "medium", "small"] as const).map((tier) => (
                  <tr key={tier} className="border-b last:border-0">
                    <td className={cn("p-2.5 pl-4 capitalize font-medium", modelTier === tier ? "text-foreground" : "text-muted-foreground")}>
                      {tier}
                    </td>
                    {providerIds.map((pid) => {
                      const defaultVal = defaultModelTierMap[tier]?.[pid] || ""
                      const customVal = customModelMap?.[tier]?.[pid]
                      const isCustomized = customVal !== undefined && customVal !== defaultVal
                      return (
                        <td key={pid} className="p-1.5">
                          <input
                            type="text"
                            value={customVal ?? defaultVal}
                            onChange={(e) => debouncedSetCustomModel(tier, pid, e.target.value)}
                            placeholder={defaultVal || "model-id"}
                            title={defaultVal ? `Default: ${defaultVal}` : undefined}
                            className={cn(
                              "w-full h-7 rounded border px-2 text-xs font-mono bg-background",
                              "focus:outline-none focus:ring-1 focus:ring-ring",
                              isCustomized ? "border-primary/50 text-foreground" : "border-border text-muted-foreground"
                            )}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Edit model IDs directly in the table. Custom values override the defaults.
        </p>
      </section>
    </div>
  )
}

function PlaceholderContent({ title }: { title: string }) {
  const { t: tc } = useTranslation("common")
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-primary font-semibold">{title}</h1>
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
        <p className="text-sm text-muted-foreground">{tc("comingSoon")}</p>
      </div>
    </div>
  )
}

const tabTitles: Record<SettingsTab, string> = {
  general: "General",
  appearance: "Appearance",
  profile: "Profile",
  notifications: "Notifications",
  teams: "Teams",
  "connected-accounts": "Connected accounts",
  environments: "Environments",
  plugins: "Plugins",
  skills: "Skills",
  "keyboard-shortcuts": "Keyboard shortcuts",
}

export function Settings() {
  const { t: ts } = useTranslation("settings")
  const [activeTab, setActiveTab] = useState<SettingsTab>("general")
  const [showContent, setShowContent] = useState(false)

  const handleTabClick = (tab: SettingsTab) => {
    setActiveTab(tab)
    setShowContent(true)
  }

  function renderContent() {
    switch (activeTab) {
      case "general":
        return <GeneralContent />
      case "appearance":
        return <AppearanceContent />
      case "profile":
        return <ProfileContent />
      case "teams":
        return <TeamsContent />
      case "notifications":
        return <NotificationsContent />
      case "connected-accounts":
        return <ConnectedAccountsContent />
      case "environments":
        return <EnvironmentsSettingsContent />
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
      {/* Settings Sidebar - hidden on mobile when content is shown */}
      <div className={cn(
        "flex shrink-0 flex-col border-r border-border bg-card",
        "w-full md:w-[240px]",
        showContent ? "hidden md:flex" : "flex"
      )}>
        <div className="px-3 pt-4 pb-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            {ts("backToApp")}
          </Link>
        </div>

        {/* Personal section */}
        <div className="flex flex-col gap-0.5 px-2 py-2">
          {personalItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-left transition-colors",
                  activeTab === item.id
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {ts(item.labelKey, { defaultValue: item.labelKey })}
              </button>
            )
          })}
        </div>

        {/* Workspace section */}
        <div className="px-2 py-2">
          <span className="px-2.5 text-[11px] font-semibold uppercase text-muted-foreground">
            {ts("sidebar.workspace")}
          </span>
          <div className="mt-2 flex flex-col gap-0.5">
            {workspaceItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-left transition-colors",
                    activeTab === item.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {ts(item.labelKey, { defaultValue: item.labelKey })}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Main Content - hidden on mobile when sidebar is shown */}
      <div className={cn(
        "flex-1 overflow-auto p-6 md:p-12 md:px-20",
        showContent ? "flex flex-col" : "hidden md:block"
      )}>
        {/* Mobile back button */}
        <button
          onClick={() => setShowContent(false)}
          className="md:hidden inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          {ts("title")}
        </button>
        {renderContent()}
      </div>
    </div>
  )
}
