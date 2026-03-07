/**
 * Unit tests for plan regeneration repoContext construction (Fix 6).
 *
 * Verifies that when regenerating a plan from the graph view,
 * the project's stored machine/directory info is correctly assembled
 * into a repoContext object for startGeneration().
 *
 * Run with: npx vitest run tests/plan-regeneration-context.test.ts
 */

import { describe, it, expect } from 'vitest'

// Extract the repoContext construction logic from plan-canvas.tsx
// so we can test it without a full React render.
interface ProjectLike {
  workingDirectory?: string
  repository?: string
  defaultMachineId?: string
}

interface RepoContext {
  workingDirectory: string
  targetMachineId?: string
}

function buildRepoContext(project: ProjectLike): RepoContext | undefined {
  return (project.workingDirectory || project.repository || project.defaultMachineId) ? {
    workingDirectory: project.workingDirectory || project.repository || '',
    targetMachineId: project.defaultMachineId,
  } : undefined
}

describe('buildRepoContext for plan regeneration', () => {
  describe('returns undefined when project has no workspace info', () => {
    it('returns undefined for empty project', () => {
      expect(buildRepoContext({})).toBeUndefined()
    })

    it('returns undefined when all fields are undefined', () => {
      expect(buildRepoContext({
        workingDirectory: undefined,
        repository: undefined,
        defaultMachineId: undefined,
      })).toBeUndefined()
    })
  })

  describe('priority: workingDirectory > repository', () => {
    it('uses workingDirectory when available', () => {
      const ctx = buildRepoContext({
        workingDirectory: '/home/user/project',
        repository: 'https://github.com/user/repo',
      })
      expect(ctx).toEqual({
        workingDirectory: '/home/user/project',
        targetMachineId: undefined,
      })
    })

    it('falls back to repository when no workingDirectory', () => {
      const ctx = buildRepoContext({
        repository: 'https://github.com/user/repo',
      })
      expect(ctx).toEqual({
        workingDirectory: 'https://github.com/user/repo',
        targetMachineId: undefined,
      })
    })
  })

  describe('machine ID propagation', () => {
    it('includes defaultMachineId when present', () => {
      const ctx = buildRepoContext({
        workingDirectory: '/home/user/project',
        defaultMachineId: 'machine-123',
      })
      expect(ctx).toEqual({
        workingDirectory: '/home/user/project',
        targetMachineId: 'machine-123',
      })
    })

    it('creates context even with only defaultMachineId', () => {
      const ctx = buildRepoContext({
        defaultMachineId: 'machine-123',
      })
      expect(ctx).toEqual({
        workingDirectory: '',
        targetMachineId: 'machine-123',
      })
    })

    it('omits targetMachineId when defaultMachineId is undefined', () => {
      const ctx = buildRepoContext({
        workingDirectory: '/home/user/project',
      })
      expect(ctx?.targetMachineId).toBeUndefined()
    })
  })

  describe('real-world scenarios', () => {
    it('local project with directory and machine', () => {
      const ctx = buildRepoContext({
        workingDirectory: '/home/user/my-app',
        defaultMachineId: 'local-macbook',
      })
      expect(ctx).toEqual({
        workingDirectory: '/home/user/my-app',
        targetMachineId: 'local-macbook',
      })
    })

    it('GitHub project with repo URL', () => {
      const ctx = buildRepoContext({
        repository: 'https://github.com/org/project',
        workingDirectory: '/home/user/org/project',
        defaultMachineId: 'dev-server',
      })
      expect(ctx).toEqual({
        workingDirectory: '/home/user/org/project',
        targetMachineId: 'dev-server',
      })
    })

    it('project with only repo URL (no local clone)', () => {
      const ctx = buildRepoContext({
        repository: 'https://github.com/org/project',
      })
      expect(ctx).toEqual({
        workingDirectory: 'https://github.com/org/project',
        targetMachineId: undefined,
      })
    })
  })
})
