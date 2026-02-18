/**
 * Hook for persisting welcome form state across page refreshes
 *
 * Saves form state to localStorage on every change, restores on mount.
 * Clears persisted state when form is submitted successfully.
 */

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'astro:welcome-form-state'

export interface WelcomeFormState {
  // Step 1
  userType: 'builder' | 'scientist' | null
  inputMode: 'type' | 'paste' | 'import' | 'repo'
  description: string
  pastedDoc: string
  repoUrl: string
  repoPath: string

  // Step 2
  domain: string
  startDate: string
  targetDate: string
  techStack: string
  selectedEnvironment: 'local' | 'remote' | 'hpc' | 'cloud'
  selectedMachineId: string | null

  // Navigation
  currentStep: number
}

const defaultState: WelcomeFormState = {
  userType: null,
  inputMode: 'type',
  description: '',
  pastedDoc: '',
  repoUrl: '',
  repoPath: '',
  domain: '',
  startDate: '',
  targetDate: '',
  techStack: '',
  selectedEnvironment: 'local',
  selectedMachineId: null,
  currentStep: 1,
}

export function useWelcomeFormPersistence() {
  const [state, setState] = useState<WelcomeFormState>(() => {
    // Restore from localStorage on mount
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as WelcomeFormState
        // Validate the shape
        if (parsed && typeof parsed === 'object' && 'currentStep' in parsed) {
          return { ...defaultState, ...parsed }
        }
      }
    } catch (error) {
      console.warn('Failed to restore welcome form state:', error)
    }
    return defaultState
  })

  // Persist to localStorage on every state change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      console.warn('Failed to persist welcome form state:', error)
    }
  }, [state])

  // Update individual fields
  const updateField = useCallback(<K extends keyof WelcomeFormState>(
    field: K,
    value: WelcomeFormState[K]
  ) => {
    setState((prev) => ({ ...prev, [field]: value }))
  }, [])

  // Clear persisted state (call after successful submission)
  const clearState = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (error) {
      console.warn('Failed to clear welcome form state:', error)
    }
    setState(defaultState)
  }, [])

  return {
    state,
    updateField,
    clearState,
  }
}
