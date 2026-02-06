import { useState } from "react"
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
  RefreshCw,
  Terminal,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { Button } from "@/components/ui/button"

const models = [
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
]

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
            description="Select which view to display when launching Nexus"
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
  "keyboard-shortcuts": "Keyboard shortcuts",
}

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("preferences")

  function renderContent() {
    switch (activeTab) {
      case "preferences":
        return <PreferencesContent />
      case "models":
        return <ModelsContent />
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
