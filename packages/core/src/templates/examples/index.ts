/**
 * Built-in Use Case Template Examples
 *
 * These templates demonstrate the UseCaseTemplate schema for different
 * domains and use cases. They serve as:
 *
 * 1. Reference implementations for template authors
 * 2. Built-in templates available to all Astro users
 * 3. Test fixtures for template validation and rendering
 *
 * Template Categories:
 * - software-development: web-app, api-development
 * - data-science: data-pipeline
 * - machine-learning: ml-pipeline, benchmark-runner
 * - computational-biology: drug-discovery
 * - security: security-audit
 * - research-analysis: paper-to-slides, literature-review
 * - documentation: code-documentation
 */

export { webAppTemplate } from './web-app.js'
export { mlPipelineTemplate } from './ml-pipeline.js'
export { drugDiscoveryTemplate } from './drug-discovery.js'
export { apiDevelopmentTemplate } from './api-development.js'
export { securityAuditTemplate } from './security-audit.js'
export { dataPipelineTemplate } from './data-pipeline.js'
export { paperToSlidesTemplate } from './paper-to-slides.js'
export { codeDocumentationTemplate } from './code-documentation.js'
export { literatureReviewTemplate } from './literature-review.js'
export { benchmarkRunnerTemplate } from './benchmark-runner.js'

import { webAppTemplate } from './web-app.js'
import { mlPipelineTemplate } from './ml-pipeline.js'
import { drugDiscoveryTemplate } from './drug-discovery.js'
import { apiDevelopmentTemplate } from './api-development.js'
import { securityAuditTemplate } from './security-audit.js'
import { dataPipelineTemplate } from './data-pipeline.js'
import { paperToSlidesTemplate } from './paper-to-slides.js'
import { codeDocumentationTemplate } from './code-documentation.js'
import { literatureReviewTemplate } from './literature-review.js'
import { benchmarkRunnerTemplate } from './benchmark-runner.js'
import type { UseCaseTemplate } from '../../types/use-case-template.js'

/** All built-in templates */
export const BUILTIN_TEMPLATES: UseCaseTemplate[] = [
  webAppTemplate,
  apiDevelopmentTemplate,
  mlPipelineTemplate,
  dataPipelineTemplate,
  drugDiscoveryTemplate,
  securityAuditTemplate,
  paperToSlidesTemplate,
  codeDocumentationTemplate,
  literatureReviewTemplate,
  benchmarkRunnerTemplate,
]

/** Templates grouped by category */
export const TEMPLATES_BY_CATEGORY: Record<string, UseCaseTemplate[]> = {
  'software-development': [webAppTemplate, apiDevelopmentTemplate],
  'data-science': [dataPipelineTemplate],
  'machine-learning': [mlPipelineTemplate, benchmarkRunnerTemplate],
  'computational-biology': [drugDiscoveryTemplate],
  'security': [securityAuditTemplate],
  'research-analysis': [paperToSlidesTemplate, literatureReviewTemplate],
  'documentation': [codeDocumentationTemplate],
}

/** Get a template by ID */
export function getTemplateById(id: string): UseCaseTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id)
}

/** Get templates by category */
export function getTemplatesByCategory(category: string): UseCaseTemplate[] {
  return TEMPLATES_BY_CATEGORY[category] ?? []
}
