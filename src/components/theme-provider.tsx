/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"

type Theme = "light" | "dark" | "system" | (string & {})

export interface ThemeDefinition {
  id: string
  name: string
  baseTheme: "light" | "dark"
  cssVariables?: Record<string, string>
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  availableThemes: ThemeDefinition[]
  registerTheme: (theme: ThemeDefinition) => void
  unregisterTheme: (themeId: string) => void
}

const builtInThemes: ThemeDefinition[] = [
  { id: "light", name: "Light", baseTheme: "light" },
  { id: "dark", name: "Dark", baseTheme: "dark" },
  { id: "system", name: "System", baseTheme: "light" },
]

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  availableThemes: builtInThemes,
  registerTheme: () => {},
  unregisterTheme: () => {},
})

/** Track custom CSS variables set by plugins so we can remove them */
let activeCustomVariables: string[] = []

function applyTheme(theme: Theme, customThemes: ThemeDefinition[]) {
  const root = document.documentElement
  root.classList.remove("light", "dark")

  // Clear any previously applied custom variables
  for (const prop of activeCustomVariables) {
    root.style.removeProperty(prop)
  }
  activeCustomVariables = []

  if (theme === "system") {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    root.classList.add(systemTheme)
  } else if (theme === "light" || theme === "dark") {
    root.classList.add(theme)
  } else {
    // Custom theme from plugin
    const customTheme = customThemes.find((t) => t.id === theme)
    if (customTheme) {
      root.classList.add(customTheme.baseTheme)
      if (customTheme.cssVariables) {
        for (const [prop, value] of Object.entries(customTheme.cssVariables)) {
          root.style.setProperty(prop, value)
          activeCustomVariables.push(prop)
        }
      }
    } else {
      // Fallback to light if custom theme not found
      root.classList.add("light")
    }
  }

  // Update the title bar / theme-color meta tag to match the active background
  const resolvedDark = root.classList.contains("dark")
  const themeColorMetas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColorMetas.length >= 2) {
    // Two media-conditional tags: override both so the active one wins
    for (const meta of themeColorMetas) {
      meta.setAttribute("content", resolvedDark ? "#0C0C0E" : "#FFFFFF")
    }
  } else if (themeColorMetas.length === 1) {
    themeColorMetas[0].setAttribute("content", resolvedDark ? "#0C0C0E" : "#FFFFFF")
  }

  localStorage.setItem("astro-theme", theme)
}

export function ThemeProvider({ children, defaultTheme = "system" }: { children: ReactNode; defaultTheme?: Theme }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("astro-theme") as Theme | null
    // Migrate legacy "bright" theme → "light"
    if (stored === "bright") return "light"
    return stored || defaultTheme
  })
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>([])

  const availableThemes = [...builtInThemes, ...customThemes]

  useEffect(() => {
    applyTheme(theme, customThemes)
  }, [theme, customThemes])

  const registerTheme = useCallback((themeDef: ThemeDefinition) => {
    setCustomThemes((prev) => {
      if (prev.some((t) => t.id === themeDef.id)) return prev
      return [...prev, themeDef]
    })
  }, [])

  const unregisterTheme = useCallback((themeId: string) => {
    setCustomThemes((prev) => prev.filter((t) => t.id !== themeId))
    // If the removed theme was active, fall back to system
    setTheme((current) => (current === themeId ? "system" : current))
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, availableThemes, registerTheme, unregisterTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
