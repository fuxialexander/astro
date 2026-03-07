/**
 * PR 1 Refactoring Verification Tests
 *
 * Guards the renames and dead-code removal in the "Simplified Pathways" refactor:
 *
 * 1. Route consolidation: /chat + /plan-chat → /project-chat
 * 2. Store method renames: planSession → planGeneration
 * 3. API client renames: planChatWithAgent → projectChatWithAgent
 * 4. Dead code removal: plan-extraction-retry, generateServerSideSummary, task-chat component
 * 5. Component directory rename: plan-session/ → plan-generation/
 *
 * These tests import the actual source modules (not mocks) to verify that old
 * names are gone and new names are present — catching accidental reversions.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')

// ============================================================================
// Section 1: Route Consolidation
// ============================================================================

describe('Route consolidation: /chat + /plan-chat → /project-chat', () => {
  const agentRouteSource = readFileSync(
    join(ROOT, 'server/routes/agent.ts'),
    'utf-8',
  )

  it('has /project-chat route', () => {
    expect(agentRouteSource).toContain("'/project-chat'")
  })

  it('does NOT have standalone /chat route (old name)', () => {
    // The route should be /project-chat, not bare /chat
    // Use regex to match agentRoute.post('/chat' exactly (not /project-chat or /task-chat)
    const hasBareChat = /agentRoute\.post\(\s*['"]\/chat['"]/.test(agentRouteSource)
    expect(hasBareChat).toBe(false)
  })

  it('does NOT have /plan-chat route (merged into /project-chat)', () => {
    const hasPlanChat = /agentRoute\.post\(\s*['"]\/plan-chat['"]/.test(agentRouteSource)
    expect(hasPlanChat).toBe(false)
  })

  it('/project-chat handler uses project-chat- prefix for task IDs', () => {
    expect(agentRouteSource).toContain('project-chat-')
  })
})

// ============================================================================
// Section 2: API Client Renames
// ============================================================================

describe('API client: planChatWithAgent → projectChatWithAgent', () => {
  const apiClientSource = readFileSync(
    join(ROOT, 'src/lib/api-client.ts'),
    'utf-8',
  )

  it('exports projectChatWithAgent', () => {
    expect(apiClientSource).toContain('export async function projectChatWithAgent')
  })

  it('does NOT export planChatWithAgent (old name)', () => {
    expect(apiClientSource).not.toContain('planChatWithAgent')
  })

  it('does NOT export chatWithAgent (dead code)', () => {
    // chatWithAgent was a dead function with zero callers
    expect(apiClientSource).not.toContain('function chatWithAgent')
  })

  it('projectChatWithAgent calls /api/agent/project-chat', () => {
    expect(apiClientSource).toContain('/api/agent/project-chat')
  })

  it('does NOT reference /api/agent/chat (old route)', () => {
    // Should not have the old bare /chat route
    const hasOldRoute = /\/api\/agent\/chat["']/.test(apiClientSource)
    expect(hasOldRoute).toBe(false)
  })

  it('does NOT reference /api/agent/plan-chat (old route)', () => {
    expect(apiClientSource).not.toContain('/api/agent/plan-chat')
  })
})

// ============================================================================
// Section 3: Store Method Renames (planSession → planGeneration)
// ============================================================================

describe('Execution store: planSession → planGeneration renames', () => {
  const storeSource = readFileSync(
    join(ROOT, 'src/stores/execution-store.ts'),
    'utf-8',
  )

  it('has startPlanGeneration method', () => {
    expect(storeSource).toContain('startPlanGeneration')
  })

  it('has cancelPlanGeneration method', () => {
    expect(storeSource).toContain('cancelPlanGeneration')
  })

  it('has steerPlanGeneration method', () => {
    expect(storeSource).toContain('steerPlanGeneration')
  })

  it('has cleanupPlanGeneration method', () => {
    expect(storeSource).toContain('cleanupPlanGeneration')
  })

  it('has startPlanGenerationForProject method', () => {
    expect(storeSource).toContain('startPlanGenerationForProject')
  })

  it('does NOT contain old planSession method names', () => {
    expect(storeSource).not.toContain('startPlanSession')
    expect(storeSource).not.toContain('cancelPlanSession')
    expect(storeSource).not.toContain('steerPlanSession')
    expect(storeSource).not.toContain('cleanupPlanSession')
    expect(storeSource).not.toContain('startPlanSessionForProject')
  })

  it('uses [plan-generation] log prefix (not [plan-session])', () => {
    expect(storeSource).toContain('[plan-generation]')
    expect(storeSource).not.toContain('[plan-session]')
  })

  it('uses [replan] log prefix (not [replan-session])', () => {
    expect(storeSource).not.toContain('[replan-session]')
  })
})

// ============================================================================
// Section 4: Dead Code Removal
// ============================================================================

describe('Dead code removal', () => {
  it('plan-extraction-retry.ts is deleted', () => {
    const exists = existsSync(join(ROOT, 'packages/core/src/plan-extraction-retry.ts'))
    expect(exists).toBe(false)
  })

  it('packages/core/src/index.ts does NOT re-export plan-extraction-retry', () => {
    const indexSource = readFileSync(
      join(ROOT, 'packages/core/src/index.ts'),
      'utf-8',
    )
    expect(indexSource).not.toContain('plan-extraction-retry')
    expect(indexSource).not.toContain('retryPlanExtraction')
  })

  it('generateServerSideSummary is removed from summary-utils', () => {
    const summarySource = readFileSync(
      join(ROOT, 'packages/core/src/dispatch/summary-utils.ts'),
      'utf-8',
    )
    expect(summarySource).not.toContain('generateServerSideSummary')
  })

  it('summary-utils does NOT import @anthropic-ai/sdk', () => {
    const summarySource = readFileSync(
      join(ROOT, 'packages/core/src/dispatch/summary-utils.ts'),
      'utf-8',
    )
    expect(summarySource).not.toContain('@anthropic-ai/sdk')
  })

  it('dispatch/index.ts does NOT export generateServerSideSummary', () => {
    const dispatchIndex = readFileSync(
      join(ROOT, 'packages/core/src/dispatch/index.ts'),
      'utf-8',
    )
    expect(dispatchIndex).not.toContain('generateServerSideSummary')
    expect(dispatchIndex).not.toContain('SummaryInput')
  })

  it('PR summary fallback chain is 4-layer (not 5)', () => {
    const summarySource = readFileSync(
      join(ROOT, 'packages/core/src/dispatch/summary-utils.ts'),
      'utf-8',
    )
    expect(summarySource).toContain('4-layer')
    expect(summarySource).not.toContain('5-layer')
  })

  it('PrSummarySource does NOT include server_generated', () => {
    const summarySource = readFileSync(
      join(ROOT, 'packages/core/src/dispatch/summary-utils.ts'),
      'utf-8',
    )
    expect(summarySource).not.toContain('server_generated')
  })

  it('server/routes/dispatch.ts does NOT import retryPlanExtractionWithHaiku', () => {
    const dispatchRoute = readFileSync(
      join(ROOT, 'server/routes/dispatch.ts'),
      'utf-8',
    )
    expect(dispatchRoute).not.toContain('retryPlanExtraction')
  })

  it('task-chat.tsx component is deleted (dead, never imported)', () => {
    const exists = existsSync(join(ROOT, 'src/components/task-detail/task-chat.tsx'))
    expect(exists).toBe(false)
  })
})

// ============================================================================
// Section 5: Component Directory Rename (plan-session → plan-generation)
// ============================================================================

describe('Component rename: plan-session/ → plan-generation/', () => {
  it('plan-generation/ directory exists with all files', () => {
    const dir = join(ROOT, 'src/components/plan-generation')
    expect(existsSync(join(dir, 'plan-generation.tsx'))).toBe(true)
    expect(existsSync(join(dir, 'plan-generation-header.tsx'))).toBe(true)
    expect(existsSync(join(dir, 'inline-approval-card.tsx'))).toBe(true)
    expect(existsSync(join(dir, 'plan-result-card.tsx'))).toBe(true)
  })

  it('plan-session/ directory is gone', () => {
    expect(existsSync(join(ROOT, 'src/components/plan-session'))).toBe(false)
  })

  it('no imports reference plan-session/ path', () => {
    // Check key consumer files
    const consumers = [
      'src/pages/project-new-plan.tsx',
      'src/pages/playground.tsx',
      'src/pages/dashboard.tsx',
      'src/components/task-detail/unified-activity-view.tsx',
    ]
    for (const file of consumers) {
      const source = readFileSync(join(ROOT, file), 'utf-8')
      expect(source).not.toContain('plan-session/')
    }
  })

  it('PlanGeneration component is exported (not PlanChatPhase)', () => {
    const source = readFileSync(
      join(ROOT, 'src/components/plan-generation/plan-generation.tsx'),
      'utf-8',
    )
    expect(source).toContain('export function PlanGeneration')
    expect(source).not.toContain('PlanChatPhase')
  })

  it('PlanGenerationHeader component is exported (not PlanSessionHeader)', () => {
    const source = readFileSync(
      join(ROOT, 'src/components/plan-generation/plan-generation-header.tsx'),
      'utf-8',
    )
    expect(source).toContain('PlanGenerationHeader')
    expect(source).not.toContain('PlanSessionHeader')
  })
})

// ============================================================================
// Section 6: Caller Consistency
// ============================================================================

describe('All callers use new names consistently', () => {
  it('session-store.ts uses projectChatWithAgent (chat SSE moved to store)', () => {
    const source = readFileSync(
      join(ROOT, 'src/stores/session-store.ts'),
      'utf-8',
    )
    expect(source).toContain('projectChatWithAgent')
    expect(source).not.toContain('planChatWithAgent')
  })

  it('use-convert-to-project.ts uses startPlanGenerationForProject', () => {
    const source = readFileSync(
      join(ROOT, 'src/hooks/use-convert-to-project.ts'),
      'utf-8',
    )
    expect(source).toContain('startPlanGenerationForProject')
    expect(source).not.toContain('startPlanSessionForProject')
  })

  it('project-new-plan.tsx imports from plan-generation/', () => {
    const source = readFileSync(
      join(ROOT, 'src/pages/project-new-plan.tsx'),
      'utf-8',
    )
    expect(source).toContain('plan-generation/')
    expect(source).not.toContain('plan-session/')
  })

  it('pr-body-update-hook uses 4-layer comment (not 5)', () => {
    const source = readFileSync(
      join(ROOT, 'server/lib/events/hooks/pr-body-update-hook.ts'),
      'utf-8',
    )
    expect(source).not.toContain('5 layers')
    // Should not pass fileChanges to runPrSummaryFallbackChain
    expect(source).not.toContain('fileChanges:')
  })
})

// ============================================================================
// Section 7: Default Compute Backend Skills Completeness
// ============================================================================

describe('Default compute backend skills', () => {
  const skillDir = join(ROOT, 'skills/compute_backend_default')

  it('k8s-exec skill covers essential topics', () => {
    const source = readFileSync(join(skillDir, 'k8s-exec/SKILL.md'), 'utf-8')
    expect(source).toContain('kubectl exec')
    expect(source).toContain('kubectl cp')
    expect(source).toContain('kubectl run')
    expect(source).toContain('kubectl logs')
    expect(source).toContain('nvidia.com/gpu')
    expect(source).toContain('port-forward')
    expect(source).toContain('kubectl create job')
  })

  it('docker skill covers essential topics', () => {
    const source = readFileSync(join(skillDir, 'docker/SKILL.md'), 'utf-8')
    expect(source).toContain('docker exec')
    expect(source).toContain('docker cp')
    expect(source).toContain('docker run')
    expect(source).toContain('docker build')
    expect(source).toContain('--gpus all')
    expect(source).toContain('--memory')
    expect(source).toContain('--cpus')
    expect(source).toContain('-p <host-port>')
    expect(source).toContain('-e KEY=VALUE')
  })

  it('slurm skill covers essential topics', () => {
    const source = readFileSync(join(skillDir, 'slurm/SKILL.md'), 'utf-8')
    expect(source).toContain('NEVER run compute directly on the login node')
    expect(source).toContain('sbatch')
    expect(source).toContain('squeue')
    expect(source).toContain('sinfo')
    expect(source).toContain('srun --pty')
    expect(source).toContain('--gres=gpu')
    expect(source).toContain('module load')
    expect(source).toContain('$SCRATCH')
    expect(source).toContain('--array=')
    expect(source).toContain('--dependency=afterok')
  })

  it('slurm skill includes interactive node request command', () => {
    const source = readFileSync(join(skillDir, 'slurm/SKILL.md'), 'utf-8')
    // Should have explicit srun command with CPU/memory/time for requesting a node
    expect(source).toContain('Request an interactive compute node')
    expect(source).toContain('Request a GPU node')
  })

  it('all skills have correct YAML frontmatter', () => {
    for (const backend of ['k8s-exec', 'docker', 'slurm']) {
      const source = readFileSync(join(skillDir, `${backend}/SKILL.md`), 'utf-8')
      expect(source).toMatch(/^---\n/)
      expect(source).toContain('category: tools')
      expect(source).toContain('tags:')
    }
  })
})
