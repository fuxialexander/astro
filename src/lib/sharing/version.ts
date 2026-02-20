import type { AstroExportBundle } from './types'

/**
 * Check if an import bundle is compatible with the current version.
 */
export function checkVersionCompatibility(bundle: AstroExportBundle): {
  compatible: boolean
  warnings: string[]
} {
  const warnings: string[] = []

  if (bundle.$schema !== 'astro-export') {
    return { compatible: false, warnings: ['Invalid bundle: missing $schema "astro-export"'] }
  }

  // Check major version
  const [bundleMajor] = bundle.version.split('.')
  const currentMajor = '1'

  if (bundleMajor !== currentMajor) {
    return {
      compatible: false,
      warnings: [`Incompatible version: bundle is v${bundle.version}, current is v1.0`],
    }
  }

  // Minor version differences are OK but worth noting
  const [, bundleMinor] = bundle.version.split('.')
  if (bundleMinor !== '0') {
    warnings.push(`Bundle version ${bundle.version} is newer than current v1.0; some features may not import`)
  }

  return { compatible: true, warnings }
}
