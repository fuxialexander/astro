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
            "--background": "193 100% 3%",
            "--foreground": "44 87% 94%",
            "--primary": "175 59% 40%",
            "--primary-foreground": "44 87% 94%",
            "--accent": "175 59% 40%",
            "--accent-foreground": "44 87% 94%",
            "--muted": "193 44% 14%",
            "--muted-foreground": "180 7% 60%",
            "--card": "193 95% 6%",
            "--border": "193 44% 14%",
          },
        },
        {
          id: "nord",
          name: "Nord",
          baseTheme: "dark",
          cssVariables: {
            "--background": "220 16% 16%",
            "--foreground": "218 27% 92%",
            "--primary": "213 32% 52%",
            "--primary-foreground": "218 27% 92%",
            "--accent": "179 25% 65%",
            "--accent-foreground": "218 27% 92%",
            "--muted": "220 16% 22%",
            "--muted-foreground": "219 28% 66%",
            "--card": "220 16% 18%",
            "--border": "220 16% 24%",
          },
        },
        {
          id: "catppuccin-mocha",
          name: "Catppuccin Mocha",
          baseTheme: "dark",
          cssVariables: {
            "--background": "240 21% 12%",
            "--foreground": "226 64% 88%",
            "--primary": "267 84% 81%",
            "--primary-foreground": "240 21% 12%",
            "--accent": "267 84% 81%",
            "--accent-foreground": "240 21% 12%",
            "--muted": "237 16% 23%",
            "--muted-foreground": "227 35% 68%",
            "--card": "240 21% 14%",
            "--border": "237 16% 23%",
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
