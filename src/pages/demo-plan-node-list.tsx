/**
 * Demo page for the PlanNodeList json-render component.
 * Visit /demo/plan-node-list to view.
 */
import { JsonRenderView } from '@/components/ui/json-render-view'
import type { Spec } from '@json-render/core'

const SAMPLE_NODES = [
  // ── Milestone 1: Backend MVP ──────────────────────────────────────
  {
    id: 'ms-backend',
    title: 'Backend MVP',
    type: 'milestone',
    status: 'in_progress',
    description: 'All core backend features working end-to-end.',
    estimate: null,
    priority: null,
    dueDate: '2026-04-15',
    milestoneId: null,
    dependencies: [],
  },
  {
    id: 'node-schema',
    title: 'Set up database schema',
    type: 'task',
    status: 'completed',
    description: 'Create tables for users, sessions, plan_nodes, plan_edges.',
    estimate: 'S',
    priority: 'high',
    dueDate: '2026-03-20',
    milestoneId: 'ms-backend',
    dependencies: [],
  },
  {
    id: 'node-api',
    title: 'Build REST API endpoints',
    type: 'task',
    status: 'in_progress',
    description: 'CRUD endpoints for projects and plan nodes. Uses Hono + Drizzle.',
    estimate: 'L',
    priority: 'high',
    dueDate: '2026-04-01',
    milestoneId: 'ms-backend',
    dependencies: ['node-schema'],
  },
  {
    id: 'node-auth',
    title: 'Implement authentication',
    type: 'task',
    status: 'in_progress',
    description: 'WebAuthn passkey auth via Supabase. Requires HTTPS for TouchID.',
    estimate: 'M',
    priority: 'critical',
    dueDate: '2026-03-30',
    milestoneId: 'ms-backend',
    dependencies: ['node-schema'],
  },
  {
    id: 'node-tests',
    title: 'Write integration tests',
    type: 'task',
    status: 'planned',
    description: 'Vitest integration tests for all API routes. Must hit real DB.',
    estimate: 'M',
    priority: 'medium',
    dueDate: null,
    milestoneId: 'ms-backend',
    dependencies: ['node-api', 'node-auth'],
  },
  {
    id: 'node-deploy-staging',
    title: 'Deploy to staging',
    type: 'task',
    status: 'planned',
    description: 'Fly.io backend + Cloudflare Pages frontend. Run db:push first.',
    estimate: 'S',
    priority: 'medium',
    dueDate: '2026-04-10',
    milestoneId: 'ms-backend',
    dependencies: ['node-tests'],
  },

  // ── Milestone 2: Frontend Polish ──────────────────────────────────
  {
    id: 'ms-frontend',
    title: 'Frontend Polish',
    type: 'milestone',
    status: 'planned',
    description: 'UI complete, accessible, and ready for beta users.',
    estimate: null,
    priority: null,
    dueDate: '2026-05-01',
    milestoneId: null,
    dependencies: ['ms-backend'],
  },
  {
    id: 'node-design-system',
    title: 'Finalize design tokens',
    type: 'task',
    status: 'completed',
    description: 'Lock color, spacing, and typography scales in Tailwind config.',
    estimate: 'S',
    priority: 'medium',
    dueDate: '2026-03-25',
    milestoneId: 'ms-frontend',
    dependencies: [],
  },
  {
    id: 'node-plan-view',
    title: 'Rebuild plan list view',
    type: 'task',
    status: 'in_progress',
    description: 'Replace DAG graph with sorted task list + hover details.',
    estimate: 'M',
    priority: 'high',
    dueDate: '2026-04-18',
    milestoneId: 'ms-frontend',
    dependencies: ['node-design-system', 'node-api'],
  },
  {
    id: 'node-mobile',
    title: 'Mobile-responsive layout',
    type: 'task',
    status: 'planned',
    description: 'MobileLayout wrapper for project and task views.',
    estimate: 'M',
    priority: 'medium',
    dueDate: null,
    milestoneId: 'ms-frontend',
    dependencies: ['node-plan-view'],
  },
  {
    id: 'node-a11y',
    title: 'Accessibility audit',
    type: 'task',
    status: 'planned',
    description: 'Run axe-core, fix all critical violations before beta.',
    estimate: 'S',
    priority: 'high',
    dueDate: '2026-04-28',
    milestoneId: 'ms-frontend',
    dependencies: ['node-mobile'],
  },

  // ── Milestone 3: Launch ───────────────────────────────────────────
  {
    id: 'ms-launch',
    title: 'Public Launch',
    type: 'milestone',
    status: 'planned',
    description: 'Open beta available to external users.',
    estimate: null,
    priority: null,
    dueDate: '2026-05-15',
    milestoneId: null,
    dependencies: ['ms-frontend'],
  },
  {
    id: 'node-docs',
    title: 'Write API documentation',
    type: 'task',
    status: 'planned',
    description: null,
    estimate: 'XS',
    priority: 'low',
    dueDate: null,
    milestoneId: 'ms-launch',
    dependencies: ['node-api'],
  },
  {
    id: 'node-onboarding',
    title: 'Build onboarding flow',
    type: 'task',
    status: 'planned',
    description: 'Welcome wizard: create first project, invite teammate, run first task.',
    estimate: 'L',
    priority: 'high',
    dueDate: '2026-05-10',
    milestoneId: 'ms-launch',
    dependencies: ['node-a11y', 'node-deploy-staging'],
  },
  {
    id: 'node-graphql',
    title: 'Migrate from REST to GraphQL',
    type: 'task',
    status: 'pruned',
    description: 'Descoped — REST is sufficient for current needs.',
    estimate: 'XL',
    priority: 'none',
    dueDate: null,
    milestoneId: null,
    dependencies: [],
  },
]

const graphSpec: Spec = {
  root: 'graph',
  elements: {
    graph: { type: 'PlanGraph', props: { nodes: SAMPLE_NODES }, children: [] },
  },
}

const listSpec: Spec = {
  root: 'list',
  elements: {
    list: { type: 'PlanNodeList', props: { nodes: SAMPLE_NODES }, children: [] },
  },
}

export default function DemoPlanNodeList() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Plan Components Demo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            3 milestones · 11 tasks. Two views: interactive DAG graph and sorted list.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Graph view</h2>
          <p className="text-xs text-muted-foreground">Auto-layout DAG with dagre. Pan and zoom supported.</p>
          <JsonRenderView spec={graphSpec} maxHeight="none" />
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">List view</h2>
          <p className="text-xs text-muted-foreground">
            Hover a row for details. Click a <em>needs:</em> chip to scroll to that dependency.
          </p>
          <JsonRenderView spec={listSpec} maxHeight="none" />
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Raw spec (what the AI generates or astro-cli outputs):</p>
          <pre className="text-[11px] font-mono text-foreground/70 overflow-auto max-h-48 whitespace-pre-wrap">
            {JSON.stringify({ type: 'PlanGraph', props: { nodes: '...' } }, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}
