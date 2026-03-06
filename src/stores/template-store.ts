import { create } from "zustand"
import type {
  UseCaseTemplateSummary,
  UseCaseTemplate,
} from "@astro/core/templates"
import {
  getTemplates,
  getTemplateCategories,
  getTemplate,
  validateTemplateParams,
  launchTemplate,
  previewTemplate,
  type TemplateCategory,
  type ParameterValidationError,
  type PreviewTemplateResult,
  type LaunchTemplateParams,
  type LaunchTemplateResult,
} from "@/lib/api-client"
import { useToastStore } from "@/stores/toast-store"

interface TemplateStore {
  /** Template summaries for browsing */
  templates: UseCaseTemplateSummary[]
  /** Categories with template lists */
  categories: TemplateCategory[]
  /** Currently selected template details */
  selectedTemplate: UseCaseTemplate | null
  /** Parameter values for the selected template */
  parameterValues: Record<string, unknown>
  /** Validation errors from last validate call */
  validationErrors: ParameterValidationError[]
  /** Preview result from last preview call */
  previewResult: PreviewTemplateResult | null
  /** Loading states */
  isLoading: boolean
  loaded: boolean
  error: string | null

  // Lifecycle
  load: () => Promise<void>
  reset: () => void

  // Template browsing
  fetchTemplates: (category?: string) => Promise<void>
  fetchCategories: () => Promise<void>

  // Template selection and configuration
  fetchTemplate: (id: string) => Promise<void>
  selectTemplate: (id: string) => Promise<void>
  setParameterValue: (key: string, value: unknown) => void
  setParameterValues: (values: Record<string, unknown>) => void

  // Validation and preview
  validateParameters: () => Promise<boolean>
  previewTemplate: () => Promise<void>

  // Launch
  launchTemplate: (projectName: string, workDir?: string, targetMachineId?: string, visionDoc?: string, preferredProvider?: string, model?: string) => Promise<LaunchTemplateResult | undefined>

}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  categories: [],
  selectedTemplate: null,
  parameterValues: {},
  validationErrors: [],
  previewResult: null,
  isLoading: false,
  loaded: false,
  error: null,

  /**
   * Load templates and categories on initial app load.
   * Called by DataLoader in Phase 2 (non-critical background load).
   */
  load: async () => {
    set({ isLoading: true, error: null })
    try {
      // Fetch templates and categories in parallel
      const [templatesResult, categoriesResult] = await Promise.all([
        getTemplates(),
        getTemplateCategories(),
      ])
      set({
        templates: templatesResult.templates,
        categories: categoriesResult.categories,
        loaded: true,
        isLoading: false,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load templates'
      // Mark loaded so app doesn't block, but show error
      set({
        loaded: true,
        isLoading: false,
        error: errorMsg,
      })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to load templates',
        description: errorMsg,
      })
    }
  },

  /**
   * Reset all template state (useful when navigating away from template flows).
   */
  reset: () => {
    set({
      selectedTemplate: null,
      parameterValues: {},
      validationErrors: [],
      previewResult: null,
      isLoading: false,
      error: null,
    })
  },

  /**
   * Fetch templates list, optionally filtered by category.
   */
  fetchTemplates: async (category?: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await getTemplates(category)
      set({
        templates: result.templates,
        isLoading: false,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch templates'
      set({ isLoading: false, error: errorMsg })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to fetch templates',
        description: errorMsg,
      })
    }
  },

  /**
   * Fetch categories with template counts.
   */
  fetchCategories: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await getTemplateCategories()
      set({
        categories: result.categories,
        isLoading: false,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch categories'
      set({ isLoading: false, error: errorMsg })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to fetch categories',
        description: errorMsg,
      })
    }
  },

  /**
   * Fetch full template details including parameter schema.
   */
  fetchTemplate: async (id: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await getTemplate(id)
      set({
        selectedTemplate: result.template,
        isLoading: false,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch template'
      set({ isLoading: false, error: errorMsg })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to fetch template',
        description: errorMsg,
      })
    }
  },

  /**
   * Select a template by ID and fetch its details.
   * Resets parameter values and validation state.
   */
  selectTemplate: async (id: string) => {
    set({
      selectedTemplate: null,
      parameterValues: {},
      validationErrors: [],
      previewResult: null,
      isLoading: true,
      error: null,
    })
    try {
      const result = await getTemplate(id)
      // Populate default values from parameter definitions
      const defaults: Record<string, unknown> = {}
      const allParams = [
        ...(result.template.requiredParameters ?? []),
        ...(result.template.optionalParameters ?? []),
      ]
      for (const param of allParams) {
        if (param.default !== undefined) {
          defaults[param.id] = param.default
        }
      }
      set({
        selectedTemplate: result.template,
        parameterValues: defaults,
        isLoading: false,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to select template'
      set({ isLoading: false, error: errorMsg })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to select template',
        description: errorMsg,
      })
    }
  },

  /**
   * Set a single parameter value.
   */
  setParameterValue: (key: string, value: unknown) => {
    const parameterValues = { ...get().parameterValues }
    parameterValues[key] = value
    set({ parameterValues })
  },

  /**
   * Set multiple parameter values at once.
   */
  setParameterValues: (values: Record<string, unknown>) => {
    set({ parameterValues: { ...get().parameterValues, ...values } })
  },

  /**
   * Validate current parameter values against the selected template's schema.
   * Returns true if valid, false otherwise. Updates validationErrors state.
   */
  validateParameters: async () => {
    const { selectedTemplate, parameterValues } = get()
    if (!selectedTemplate) {
      useToastStore.getState().add({
        type: 'error',
        title: 'No template selected',
        description: 'Please select a template first',
      })
      return false
    }

    set({ isLoading: true, error: null })
    try {
      const result = await validateTemplateParams(selectedTemplate.id, parameterValues)
      set({
        validationErrors: result.errors,
        isLoading: false,
      })
      return result.valid
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Validation failed'
      set({ isLoading: false, error: errorMsg })
      useToastStore.getState().add({
        type: 'error',
        title: 'Validation failed',
        description: errorMsg,
      })
      return false
    }
  },

  /**
   * Preview what the template would generate with current parameters.
   * Shows interpolated prompts and configuration without creating a project.
   */
  previewTemplate: async () => {
    const { selectedTemplate, parameterValues } = get()
    if (!selectedTemplate) {
      useToastStore.getState().add({
        type: 'error',
        title: 'No template selected',
        description: 'Please select a template first',
      })
      return
    }

    set({ isLoading: true, error: null })
    try {
      const result = await previewTemplate(selectedTemplate.id, parameterValues)
      set({
        previewResult: result,
        isLoading: false,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Preview failed'
      set({ isLoading: false, error: errorMsg })
      useToastStore.getState().add({
        type: 'error',
        title: 'Preview failed',
        description: errorMsg,
      })
    }
  },

  /**
   * Launch the selected template with current parameters.
   * Creates a new project and returns the launch result.
   * @param projectName - Name for the new project
   * @param workDir - Optional working directory override
   * @returns The launch result with project details, or undefined on error
   */
  launchTemplate: async (projectName: string, workDir?: string, targetMachineId?: string, visionDoc?: string, preferredProvider?: string, model?: string) => {
    const { selectedTemplate, parameterValues } = get()
    if (!selectedTemplate) {
      useToastStore.getState().add({
        type: 'error',
        title: 'No template selected',
        description: 'Please select a template first',
      })
      return undefined
    }

    set({ isLoading: true, error: null })
    try {
      const params: LaunchTemplateParams = {
        parameters: parameterValues,
        projectName,
        workingDirectory: workDir,
        targetMachineId,
        visionDoc,
        preferredProvider,
        model,
      }
      const result = await launchTemplate(selectedTemplate.id, params)

      set({ isLoading: false })

      // Reset state after successful launch
      get().reset()

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Launch failed'
      set({ isLoading: false, error: errorMsg })
      useToastStore.getState().add({
        type: 'error',
        title: 'Launch failed',
        description: errorMsg,
      })
      return undefined
    }
  },
}))
