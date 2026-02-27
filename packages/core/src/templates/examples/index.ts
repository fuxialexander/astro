/**
 * Built-in Use Case Template Examples
 *
 * These templates demonstrate the UseCaseTemplate schema for different
 * domains and use cases. They serve as:
 *
 * 1. Reference implementations for template authors
 * 2. Built-in templates available to all Astro users
 * 3. Test fixtures for template validation and rendering
 */

export { webAppTemplate } from './web-app.js'
export { mlPipelineTemplate } from './ml-pipeline.js'
export { drugDiscoveryTemplate } from './drug-discovery.js'

import { webAppTemplate } from './web-app.js'
import { mlPipelineTemplate } from './ml-pipeline.js'
import { drugDiscoveryTemplate } from './drug-discovery.js'
import type { UseCaseTemplate } from '../../types/use-case-template.js'

/** All built-in templates */
export const BUILTIN_TEMPLATES: UseCaseTemplate[] = [
  webAppTemplate,
  mlPipelineTemplate,
  drugDiscoveryTemplate,
]
