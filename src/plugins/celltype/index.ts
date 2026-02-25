/**
 * Celltype Toolbox Plugin
 *
 * Registers celltype/cli bioinformatics tools as skills in Astro.
 * This is a pure prompt-injection plugin — the Astro server never does compute.
 * Tools run on the user's machine via the celltype MCP server.
 *
 * What this plugin provides:
 * - Planning awareness: plan generation knows about available bio tools
 * - Execution skills: agents get detailed tool descriptions per category
 * - Marketplace discovery: skills appear in the skill settings UI
 */

import type { AstroPlugin, PluginContributions, PluginContext } from "@/types/plugin"
import { celltypeSkills } from "./skills"

const plugin: AstroPlugin = {
  manifest: {
    id: "celltype-toolbox",
    name: "Celltype Toolbox",
    version: "1.0.0",
    description: "190+ computational biology and drug discovery tools from celltype/cli. Tools run on your machine — Astro only manages skill discovery and prompt injection.",
    author: "CellType Inc.",
    capabilities: ["skills"],
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activate: async (_context: PluginContext): Promise<PluginContributions> => {
    return {
      skills: celltypeSkills,
    }
  },

  deactivate: async () => {
    // No cleanup needed — skills are removed when the plugin is disabled
  },
}

export default plugin
