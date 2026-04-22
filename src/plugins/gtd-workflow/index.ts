/**
 * GTD Workflow Plugin
 *
 * Adds a Getting Things Done workflow page, sidebar item,
 * and custom metadata fields for GTD-specific node properties.
 */

import type { AstroPlugin, PluginContributions, PluginContext } from "@/types/plugin"
import { GtdPage } from "./gtd-page"

const plugin: AstroPlugin = {
  manifest: {
    id: "gtd-workflow",
    name: "GTD Workflow",
    version: "1.0.0",
    description: "Getting Things Done workflow with contexts, energy levels, and next action tracking",
    author: "Astro Team",
    capabilities: ["routes", "sidebar", "node-metadata"],
  },

  activate: async (_context: PluginContext): Promise<PluginContributions> => {
    return {
      sidebarItems: [
        {
          id: "gtd",
          to: "/plugins/gtd",
          icon: "BookOpen",
          label: "GTD",
          defaultVisible: true,
        },
      ],
      routes: [
        {
          path: "gtd",
          component: GtdPage,
        },
      ],
      nodeMetadataFields: [
        {
          key: "gtd-context",
          label: "Context",
          type: "select",
          options: [
            "@computer",
            "@phone",
            "@errand",
            "@home",
            "@office",
            "@anywhere",
          ],
        },
        {
          key: "gtd-energy",
          label: "Energy",
          type: "select",
          options: ["high", "medium", "low"],
        },
        {
          key: "gtd-next-action",
          label: "Next Action",
          type: "boolean",
        },
      ],
    }
  },

  deactivate: async () => {
    // No cleanup needed
  },
}

export default plugin
