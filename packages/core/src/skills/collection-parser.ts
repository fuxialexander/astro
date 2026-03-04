/**
 * Catalog Collection YAML Parser
 *
 * Parses COLLECTION.yaml manifest files into CatalogCollectionManifest.
 * Same simple line-by-line YAML pattern as builtin-parser.ts.
 *
 * Pure function — no filesystem dependencies.
 */

import type { CatalogCollectionManifest } from './types.js'

/**
 * Parse COLLECTION.yaml content into a CatalogCollectionManifest.
 *
 * Expected format:
 * ```yaml
 * name: Claude Official
 * provider: Anthropic
 * icon: sparkles
 * description: Curated skills from Anthropic
 * ```
 *
 * @param content - Raw YAML file content
 * @param collectionId - Directory name used as the collection ID
 */
export function parseCollectionYaml(content: string, collectionId: string): CatalogCollectionManifest | null {
  const meta: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key && value) meta[key] = value
  }

  if (!meta.name || !meta.provider) return null

  return {
    id: collectionId,
    name: meta.name.replace(/^["']|["']$/g, ''),
    provider: meta.provider.replace(/^["']|["']$/g, ''),
    icon: meta.icon?.replace(/^["']|["']$/g, '') || 'package',
    description: meta.description?.replace(/^["']|["']$/g, ''),
  }
}
