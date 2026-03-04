/**
 * Use Case Templates Module
 *
 * This module exports the template schema types, built-in templates,
 * loading utilities, and validation functions.
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   // Types
 *   UseCaseTemplate,
 *   UseCaseParameter,
 *
 *   // Built-in templates
 *   BUILTIN_TEMPLATES,
 *   getTemplateById,
 *
 *   // Utilities
 *   validateTemplate,
 *   loadTemplateFromMarkdown,
 *   templateToMarkdown,
 * } from '@astro/core/templates'
 * ```
 *
 * ## Creating Templates
 *
 * Templates can be defined in TypeScript or YAML/Markdown format.
 * See the README.md in this directory for full documentation.
 */

// ── Types ───────────────────────────────────────────────────────────────
export type {
  // Core template interface
  UseCaseTemplate,
  UseCaseTemplateSummary,
  UseCaseTemplateInstance,
  ResolvedParameters,

  // Parameter types
  UseCaseParameter,
  ParameterType,
  ParameterOption,
  ParameterValidation,
  ParameterCondition,

  // Prompt configuration
  PromptConfig,

  // Output format
  OutputFormatSpec,

  // Execution configuration
  ParallelizationConfig,
  ExecutionConfig,
  PlanGenerationHints,

  // Metadata types
  UseCaseCategory,
  TemplateMaturity,
  TemplateSource,

  // Validation types
  TemplateValidationResult,
  TemplateValidationError,
  TemplateValidationWarning,
} from '../types/use-case-template.js'

// ── Built-in Templates ──────────────────────────────────────────────────
export {
  // Individual templates
  academicPresentationTemplate,
  academicReviewTemplate,
  moatFragilityTemplate,

  // Collections
  BUILTIN_TEMPLATES,
  TEMPLATES_BY_CATEGORY,

  // Lookup functions
  getTemplateById,
  getTemplatesByCategory,
} from './examples/index.js'

// ── Template Loader ─────────────────────────────────────────────────────
export {
  // Parsing types
  type TemplateYamlFrontmatter,
  type TemplateMarkdownSections,

  // Parsing functions
  parseYamlFrontmatter,
  parseMarkdownSections,
  convertToUseCaseTemplate,

  // Main loader
  loadTemplateFromMarkdown,
  templateToMarkdown,
} from './template-loader.js'

// ── Template Validator ──────────────────────────────────────────────────
export {
  validateTemplate,
  formatValidationResult,
} from './template-validator.js'
