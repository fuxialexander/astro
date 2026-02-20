/**
 * Example Theme Plugin
 *
 * Provides additional color themes (Solarized Dark, Nord, Catppuccin Mocha).
 * Demonstrates the ThemeContribution plugin capability.
 */

import type { AstroPlugin, PluginContributions, PluginContext } from "@/types/plugin"

const plugin: AstroPlugin = {
  manifest: {
    id: "example-theme",
    name: "Example Themes",
    version: "1.0.0",
    description: "Additional color themes: Solarized Dark, Nord, Catppuccin Mocha",
    author: "Astro Team",
    capabilities: ["theme"],
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activate: async (_context: PluginContext): Promise<PluginContributions> => {
    return {
      themes: [
        {
          id: "solarized-dark",
          name: "Solarized Dark",
          baseTheme: "dark",
          cssVariables: {
            "--background": "#002b36",
            "--foreground": "#fdf6e3",
            "--primary": "#268bd2",
            "--primary-foreground": "#fdf6e3",
            "--accent": "#2aa198",
            "--accent-foreground": "#fdf6e3",
            "--muted": "#073642",
            "--muted-foreground": "#93a1a1",
            "--card": "#073642",
            "--border": "#073642",
          },
        },
        {
          id: "nord",
          name: "Nord",
          baseTheme: "dark",
          cssVariables: {
            "--background": "#2e3440",
            "--foreground": "#eceff4",
            "--primary": "#81a1c1",
            "--primary-foreground": "#eceff4",
            "--accent": "#88c0d0",
            "--accent-foreground": "#eceff4",
            "--muted": "#3b4252",
            "--muted-foreground": "#81a1c1",
            "--card": "#3b4252",
            "--border": "#434c5e",
          },
        },
        {
          id: "catppuccin-mocha",
          name: "Catppuccin Mocha",
          baseTheme: "dark",
          cssVariables: {
            "--background": "#1e1e2e",
            "--foreground": "#cdd6f4",
            "--primary": "#cba6f7",
            "--primary-foreground": "#1e1e2e",
            "--accent": "#b4befe",
            "--accent-foreground": "#1e1e2e",
            "--muted": "#313244",
            "--muted-foreground": "#a6adc8",
            "--card": "#1e1e2e",
            "--border": "#313244",
          },
        },
      ],
    }
  },

  deactivate: async () => {
    // No cleanup needed
  },
}

export default plugin
