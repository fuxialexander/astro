import { create } from "zustand"
import type { PlanNode, PlanEdge } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { layoutGraph } from "@/lib/graph-utils"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface PlanState {
  nodes: PlanNode[]
  edges: PlanEdge[]
  loaded: boolean
  load: () => Promise<void>
  addNode: (node: PlanNode) => void
  updateNode: (id: string, updates: Partial<PlanNode>) => void
  addEdge: (edge: PlanEdge) => void
  setProjectPlan: (projectId: string, nodes: PlanNode[], edges: PlanEdge[]) => void
  reorganizeProject: (projectId: string) => void
}

// Helper: map Supabase plan_nodes row to PlanNode
function mapNodeRow(row: Record<string, unknown>): PlanNode {
  return {
    id: row.client_id as string,
    projectId: row.project_id as string,
    type: row.type as PlanNode["type"],
    title: row.title as string,
    description: (row.description as string) || "",
    status: row.status as PlanNode["status"],
    parentId: row.parent_id as string | null,
    dependencies: [], // loaded from junction table
    environment: row.environment as PlanNode["environment"],
    verification: (row.verification as PlanNode["verification"]) || "auto",
    position: { x: (row.position_x as number) || 0, y: (row.position_y as number) || 0 },
    startDate: row.start_date as string | undefined,
    endDate: row.end_date as string | undefined,
    dueDate: row.due_date as string | undefined,
    priority: row.priority as PlanNode["priority"],
    estimate: row.estimate as PlanNode["estimate"],
    milestoneId: row.milestone_id as string | undefined,
    labelIds: row.label_ids as string[] | undefined,
    executionId: row.execution_id as string | undefined,
    executionOutput: row.execution_output as string | undefined,
    executionError: row.execution_error as string | undefined,
    executionStartedAt: row.execution_started_at ? new Date(row.execution_started_at as string) : undefined,
    executionCompletedAt: row.execution_completed_at ? new Date(row.execution_completed_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

// Helper: map Supabase plan_edges row to PlanEdge
function mapEdgeRow(row: Record<string, unknown>): PlanEdge {
  return {
    id: row.client_id as string,
    source: row.source_client_id as string,
    target: row.target_client_id as string,
    type: (row.type as PlanEdge["type"]) || "dependency",
  }
}

let nodesChannel: RealtimeChannel | null = null
let edgesChannel: RealtimeChannel | null = null

// ── proj-1: Personal Finance App (65 %, Jan 15 → Mar 30) ─────────────
// Labels: l1=Frontend, l2=Backend, l3=Testing
const P1_NODES: PlanNode[] = [
  { id: "n1", projectId: "proj-1", type: "task", title: "Project Setup", description: "Initialize repo, CI/CD, and dev environment", status: "completed", parentId: null, dependencies: [], environment: "local", verification: "auto", position: { x: 40, y: 40 }, startDate: "2026-01-15", endDate: "2026-01-17", priority: "medium", estimate: "S", milestoneId: "n4", createdAt: new Date("2026-01-15"), updatedAt: new Date("2026-01-17") },
  { id: "n2", projectId: "proj-1", type: "task", title: "Authentication", description: "JWT auth with OAuth2 social login", status: "completed", parentId: null, dependencies: ["n1"], environment: "local", verification: "auto", position: { x: 40, y: 140 }, startDate: "2026-01-17", endDate: "2026-01-22", priority: "high", estimate: "M", milestoneId: "n4", labelIds: ["l2"], createdAt: new Date("2026-01-16"), updatedAt: new Date("2026-01-22") },
  { id: "n3", projectId: "proj-1", type: "task", title: "Database Schema", description: "Design and implement core database schema with migrations", status: "in_progress", parentId: null, dependencies: ["n2"], environment: "local", verification: "auto", position: { x: 40, y: 240 }, startDate: "2026-01-22", endDate: "2026-01-28", priority: "high", dueDate: "2026-02-07", estimate: "M", milestoneId: "n4", labelIds: ["l2"], createdAt: new Date("2026-01-20"), updatedAt: new Date("2026-02-03") },
  { id: "n4", projectId: "proj-1", type: "milestone", title: "Core Infrastructure", description: "All core backend services running", status: "in_progress", parentId: null, dependencies: ["n3"], verification: "human", position: { x: 40, y: 340 }, startDate: "2026-01-28", endDate: "2026-01-28", createdAt: new Date("2026-01-15"), updatedAt: new Date("2026-02-03") },
  { id: "n5", projectId: "proj-1", type: "task", title: "REST API", description: "RESTful API endpoints for all resources", status: "pruned", parentId: null, dependencies: ["n4"], environment: "local", verification: "auto", position: { x: 300, y: 400 }, startDate: "2026-01-29", endDate: "2026-02-05", priority: "medium", estimate: "L", labelIds: ["l2"], createdAt: new Date("2026-01-25"), updatedAt: new Date("2026-02-01") },
  { id: "n6", projectId: "proj-1", type: "task", title: "GraphQL API", description: "GraphQL schema and resolvers for transactions, accounts, goals", status: "in_progress", parentId: null, dependencies: ["n4"], environment: "local", verification: "auto", position: { x: 300, y: 470 }, startDate: "2026-01-29", endDate: "2026-02-06", priority: "high", estimate: "M", milestoneId: "n10", labelIds: ["l2"], createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-05") },
  { id: "n7", projectId: "proj-1", type: "task", title: "Navigation UI", description: "App navigation, routing, and layout shell", status: "awaiting_judgment", parentId: null, dependencies: ["n4"], environment: "local", verification: "human", position: { x: 300, y: 540 }, startDate: "2026-01-29", endDate: "2026-02-04", priority: "medium", dueDate: "2026-02-10", estimate: "M", milestoneId: "n10", labelIds: ["l1"], createdAt: new Date("2026-02-02"), updatedAt: new Date("2026-02-05") },
  { id: "n8", projectId: "proj-1", type: "task", title: "Dashboard UI", description: "Main dashboard with summary cards and recent activity", status: "planned", parentId: null, dependencies: ["n6", "n7"], environment: "local", verification: "human", position: { x: 300, y: 610 }, startDate: "2026-02-07", endDate: "2026-02-14", priority: "medium", estimate: "L", milestoneId: "n10", labelIds: ["l1"], createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "n9", projectId: "proj-1", type: "task", title: "Charts & Viz", description: "Budget charts, spending breakdowns, and trend visualizations", status: "planned", parentId: null, dependencies: ["n8"], environment: "local", verification: "human", position: { x: 300, y: 680 }, startDate: "2026-02-14", endDate: "2026-02-21", priority: "medium", estimate: "M", milestoneId: "n10", labelIds: ["l1"], createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "n10", projectId: "proj-1", type: "milestone", title: "Frontend Complete", description: "All frontend screens functional", status: "planned", parentId: null, dependencies: ["n9"], verification: "human", position: { x: 300, y: 750 }, startDate: "2026-02-21", endDate: "2026-02-21", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "n11", projectId: "proj-1", type: "task", title: "Transaction Import", description: "CSV/OFX import and bank API integration for transaction data", status: "planned", parentId: null, dependencies: ["n6"], environment: "local", verification: "auto", position: { x: 550, y: 540 }, startDate: "2026-02-07", endDate: "2026-02-13", priority: "high", estimate: "M", labelIds: ["l2"], createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "n12", projectId: "proj-1", type: "task", title: "AI Categorization", description: "ML model for automatic transaction categorization", status: "planned", parentId: null, dependencies: ["n11"], environment: "local", verification: "auto", position: { x: 550, y: 610 }, startDate: "2026-02-13", endDate: "2026-02-20", priority: "high", estimate: "L", labelIds: ["l2"], createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "n13", projectId: "proj-1", type: "task", title: "E2E Tests", description: "End-to-end test suite for critical user flows", status: "planned", parentId: null, dependencies: ["n8", "n12"], environment: "local", verification: "auto", position: { x: 550, y: 680 }, startDate: "2026-02-21", endDate: "2026-02-28", priority: "medium", estimate: "M", labelIds: ["l3"], createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "n14", projectId: "proj-1", type: "milestone", title: "Beta Release", description: "Feature-complete beta for internal testing", status: "planned", parentId: null, dependencies: ["n10", "n13"], verification: "human", position: { x: 550, y: 750 }, startDate: "2026-03-01", endDate: "2026-03-01", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
]

const P1_EDGES: PlanEdge[] = [
  { id: "e1", source: "n1", target: "n2", type: "dependency" },
  { id: "e2", source: "n2", target: "n3", type: "dependency" },
  { id: "e3", source: "n3", target: "n4", type: "dependency" },
  { id: "e4", source: "n4", target: "n5", type: "branch" },
  { id: "e5", source: "n4", target: "n6", type: "branch" },
  { id: "e6", source: "n4", target: "n7", type: "branch" },
  { id: "e7", source: "n6", target: "n8", type: "dependency" },
  { id: "e8", source: "n7", target: "n8", type: "dependency" },
  { id: "e9", source: "n8", target: "n9", type: "dependency" },
  { id: "e10", source: "n9", target: "n10", type: "dependency" },
  { id: "e11", source: "n6", target: "n11", type: "dependency" },
  { id: "e12", source: "n11", target: "n12", type: "dependency" },
  { id: "e13", source: "n8", target: "n13", type: "dependency" },
  { id: "e14", source: "n12", target: "n13", type: "dependency" },
  { id: "e15", source: "n10", target: "n14", type: "dependency" },
  { id: "e16", source: "n13", target: "n14", type: "dependency" },
]

// ── proj-2: ML Training Pipeline (30 %, Feb 1 → May 15) ─────────────
// Labels: l1=Infrastructure, l2=Research
const P2_NODES: PlanNode[] = [
  { id: "p2-m1", projectId: "proj-2", type: "milestone", title: "Data Layer Ready", description: "Data ingestion and preprocessing pipelines operational", status: "completed", parentId: null, dependencies: ["p2-3"], verification: "human", position: { x: 40, y: 300 }, startDate: "2026-02-14", endDate: "2026-02-14", createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-14") },
  { id: "p2-1", projectId: "proj-2", type: "task", title: "Infrastructure Setup", description: "Kubernetes cluster, GPU node pools, storage buckets, and container registry", status: "completed", parentId: null, dependencies: [], environment: "cloud", verification: "auto", position: { x: 40, y: 40 }, startDate: "2026-02-01", endDate: "2026-02-05", priority: "urgent", estimate: "M", milestoneId: "p2-m1", labelIds: ["l1"], createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-05") },
  { id: "p2-2", projectId: "proj-2", type: "task", title: "Data Ingestion", description: "S3/GCS connectors, streaming pipeline with schema validation", status: "completed", parentId: null, dependencies: ["p2-1"], environment: "cloud", verification: "auto", position: { x: 40, y: 120 }, startDate: "2026-02-05", endDate: "2026-02-10", priority: "high", estimate: "M", milestoneId: "p2-m1", labelIds: ["l1"], createdAt: new Date("2026-02-05"), updatedAt: new Date("2026-02-10") },
  { id: "p2-3", projectId: "proj-2", type: "task", title: "Data Preprocessing", description: "Feature extraction, normalization, and train/val/test split automation", status: "completed", parentId: null, dependencies: ["p2-2"], environment: "cloud", verification: "auto", position: { x: 40, y: 200 }, startDate: "2026-02-10", endDate: "2026-02-14", priority: "high", estimate: "L", milestoneId: "p2-m1", labelIds: ["l1", "l2"], createdAt: new Date("2026-02-10"), updatedAt: new Date("2026-02-14") },
  { id: "p2-4", projectId: "proj-2", type: "task", title: "Training Framework", description: "Distributed training harness with PyTorch DDP and mixed precision", status: "in_progress", parentId: null, dependencies: ["p2-m1"], environment: "hpc", verification: "auto", position: { x: 40, y: 380 }, startDate: "2026-02-14", endDate: "2026-02-24", priority: "urgent", estimate: "XL", labelIds: ["l2"], createdAt: new Date("2026-02-14"), updatedAt: new Date("2026-02-20") },
  { id: "p2-5", projectId: "proj-2", type: "task", title: "Experiment Tracking", description: "MLflow/W&B integration for metrics, artifacts, and model versioning", status: "in_progress", parentId: null, dependencies: ["p2-m1"], environment: "cloud", verification: "auto", position: { x: 250, y: 380 }, startDate: "2026-02-14", endDate: "2026-02-20", priority: "medium", estimate: "M", labelIds: ["l1"], createdAt: new Date("2026-02-14"), updatedAt: new Date("2026-02-19") },
  { id: "p2-m2", projectId: "proj-2", type: "milestone", title: "Training Operational", description: "Can train models end-to-end on GPU cluster", status: "in_progress", parentId: null, dependencies: ["p2-4", "p2-5"], verification: "human", position: { x: 150, y: 460 }, startDate: "2026-02-24", endDate: "2026-02-24", createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-20") },
  { id: "p2-6", projectId: "proj-2", type: "task", title: "Hyperparameter Search", description: "Bayesian optimization with Optuna, parallel trial execution on SLURM", status: "planned", parentId: null, dependencies: ["p2-m2"], environment: "hpc", verification: "auto", position: { x: 40, y: 540 }, startDate: "2026-02-24", endDate: "2026-03-07", priority: "high", estimate: "L", labelIds: ["l2"], createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-01") },
  { id: "p2-7", projectId: "proj-2", type: "task", title: "Model Evaluation", description: "Automated eval suite: accuracy, latency, fairness metrics, regression checks", status: "planned", parentId: null, dependencies: ["p2-6"], environment: "cloud", verification: "auto", position: { x: 40, y: 620 }, startDate: "2026-03-07", endDate: "2026-03-14", priority: "high", estimate: "M", labelIds: ["l2"], createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-01") },
  { id: "p2-8", projectId: "proj-2", type: "task", title: "Model Registry", description: "Versioned model storage with promotion workflow (staging → prod)", status: "planned", parentId: null, dependencies: ["p2-7"], environment: "cloud", verification: "auto", position: { x: 40, y: 700 }, startDate: "2026-03-14", endDate: "2026-03-21", priority: "medium", estimate: "M", labelIds: ["l1"], createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-01") },
  { id: "p2-9", projectId: "proj-2", type: "task", title: "Serving Pipeline", description: "Model serving with TorchServe, canary deployment, A/B testing hooks", status: "planned", parentId: null, dependencies: ["p2-8"], environment: "cloud", verification: "auto", position: { x: 40, y: 780 }, startDate: "2026-03-21", endDate: "2026-04-01", priority: "medium", estimate: "L", labelIds: ["l1"], createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-01") },
  { id: "p2-10", projectId: "proj-2", type: "task", title: "Monitoring & Alerts", description: "Data drift detection, model performance monitoring, PagerDuty alerts", status: "planned", parentId: null, dependencies: ["p2-9"], environment: "cloud", verification: "auto", position: { x: 40, y: 860 }, startDate: "2026-04-01", endDate: "2026-04-10", priority: "medium", estimate: "M", labelIds: ["l1"], createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-01") },
  { id: "p2-m3", projectId: "proj-2", type: "milestone", title: "Production Ready", description: "Full pipeline deployed and monitored in production", status: "planned", parentId: null, dependencies: ["p2-10"], verification: "human", position: { x: 40, y: 940 }, startDate: "2026-04-10", endDate: "2026-04-10", createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-01") },
]

const P2_EDGES: PlanEdge[] = [
  { id: "p2-e1", source: "p2-1", target: "p2-2", type: "dependency" },
  { id: "p2-e2", source: "p2-2", target: "p2-3", type: "dependency" },
  { id: "p2-e3", source: "p2-3", target: "p2-m1", type: "dependency" },
  { id: "p2-e4", source: "p2-m1", target: "p2-4", type: "dependency" },
  { id: "p2-e5", source: "p2-m1", target: "p2-5", type: "dependency" },
  { id: "p2-e6", source: "p2-4", target: "p2-m2", type: "dependency" },
  { id: "p2-e7", source: "p2-5", target: "p2-m2", type: "dependency" },
  { id: "p2-e8", source: "p2-m2", target: "p2-6", type: "dependency" },
  { id: "p2-e9", source: "p2-6", target: "p2-7", type: "dependency" },
  { id: "p2-e10", source: "p2-7", target: "p2-8", type: "dependency" },
  { id: "p2-e11", source: "p2-8", target: "p2-9", type: "dependency" },
  { id: "p2-e12", source: "p2-9", target: "p2-10", type: "dependency" },
  { id: "p2-e13", source: "p2-10", target: "p2-m3", type: "dependency" },
]

// ── proj-3: API Gateway Service (15 %, Feb 3 → Apr 1) ─────────────
const P3_NODES: PlanNode[] = [
  { id: "p3-1", projectId: "proj-3", type: "task", title: "Architecture Design", description: "System design doc: routing, middleware chain, plugin system", status: "completed", parentId: null, dependencies: [], environment: "local", verification: "human", position: { x: 40, y: 40 }, startDate: "2026-02-03", endDate: "2026-02-06", priority: "urgent", estimate: "M", milestoneId: "p3-m1", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-06") },
  { id: "p3-2", projectId: "proj-3", type: "task", title: "Core Router", description: "High-performance HTTP router with path matching and middleware chain", status: "in_progress", parentId: null, dependencies: ["p3-1"], environment: "local", verification: "auto", position: { x: 40, y: 120 }, startDate: "2026-02-06", endDate: "2026-02-13", priority: "urgent", estimate: "L", milestoneId: "p3-m1", createdAt: new Date("2026-02-06"), updatedAt: new Date("2026-02-10") },
  { id: "p3-3", projectId: "proj-3", type: "task", title: "JWT Authentication", description: "JWT validation middleware, key rotation, JWKS endpoint", status: "planned", parentId: null, dependencies: ["p3-2"], environment: "local", verification: "auto", position: { x: 40, y: 200 }, startDate: "2026-02-13", endDate: "2026-02-18", priority: "high", estimate: "M", milestoneId: "p3-m1", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-m1", projectId: "proj-3", type: "milestone", title: "Auth & Routing", description: "Gateway handles authenticated request routing", status: "planned", parentId: null, dependencies: ["p3-3"], verification: "human", position: { x: 40, y: 280 }, startDate: "2026-02-18", endDate: "2026-02-18", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-4", projectId: "proj-3", type: "task", title: "Rate Limiting", description: "Token bucket rate limiter with Redis backing, per-client and global limits", status: "planned", parentId: null, dependencies: ["p3-m1"], environment: "local", verification: "auto", position: { x: 40, y: 360 }, startDate: "2026-02-18", endDate: "2026-02-24", priority: "high", estimate: "M", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-5", projectId: "proj-3", type: "task", title: "Request Transform", description: "Header injection, path rewriting, request/response body transforms", status: "planned", parentId: null, dependencies: ["p3-m1"], environment: "local", verification: "auto", position: { x: 250, y: 360 }, startDate: "2026-02-18", endDate: "2026-02-22", priority: "medium", estimate: "M", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-6", projectId: "proj-3", type: "task", title: "Circuit Breaker", description: "Circuit breaker pattern for upstream service failures", status: "planned", parentId: null, dependencies: ["p3-4"], environment: "local", verification: "auto", position: { x: 40, y: 440 }, startDate: "2026-02-24", endDate: "2026-02-28", priority: "medium", estimate: "M", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-7", projectId: "proj-3", type: "task", title: "Observability", description: "OpenTelemetry traces, Prometheus metrics, structured JSON logs", status: "planned", parentId: null, dependencies: ["p3-5", "p3-6"], environment: "local", verification: "auto", position: { x: 150, y: 520 }, startDate: "2026-02-28", endDate: "2026-03-06", priority: "high", estimate: "L", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-m2", projectId: "proj-3", type: "milestone", title: "Feature Complete", description: "All gateway features implemented", status: "planned", parentId: null, dependencies: ["p3-7"], verification: "human", position: { x: 150, y: 600 }, startDate: "2026-03-06", endDate: "2026-03-06", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-8", projectId: "proj-3", type: "task", title: "Load Testing", description: "k6 load tests: throughput, latency percentiles, saturation point", status: "planned", parentId: null, dependencies: ["p3-m2"], environment: "cloud", verification: "auto", position: { x: 150, y: 680 }, startDate: "2026-03-06", endDate: "2026-03-12", priority: "high", estimate: "M", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-9", projectId: "proj-3", type: "task", title: "Security Audit", description: "OWASP top-10 review, fuzzing, dependency scan", status: "planned", parentId: null, dependencies: ["p3-m2"], environment: "local", verification: "human", position: { x: 350, y: 680 }, startDate: "2026-03-06", endDate: "2026-03-13", priority: "urgent", estimate: "M", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-10", projectId: "proj-3", type: "task", title: "Documentation", description: "API reference, deployment guide, runbook", status: "planned", parentId: null, dependencies: ["p3-8", "p3-9"], environment: "local", verification: "human", position: { x: 250, y: 760 }, startDate: "2026-03-13", endDate: "2026-03-18", priority: "medium", estimate: "S", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "p3-m3", projectId: "proj-3", type: "milestone", title: "GA Release", description: "Production-ready general availability", status: "planned", parentId: null, dependencies: ["p3-10"], verification: "human", position: { x: 250, y: 840 }, startDate: "2026-03-18", endDate: "2026-03-18", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
]

const P3_EDGES: PlanEdge[] = [
  { id: "p3-e1", source: "p3-1", target: "p3-2", type: "dependency" },
  { id: "p3-e2", source: "p3-2", target: "p3-3", type: "dependency" },
  { id: "p3-e3", source: "p3-3", target: "p3-m1", type: "dependency" },
  { id: "p3-e4", source: "p3-m1", target: "p3-4", type: "dependency" },
  { id: "p3-e5", source: "p3-m1", target: "p3-5", type: "dependency" },
  { id: "p3-e6", source: "p3-4", target: "p3-6", type: "dependency" },
  { id: "p3-e7", source: "p3-5", target: "p3-7", type: "dependency" },
  { id: "p3-e8", source: "p3-6", target: "p3-7", type: "dependency" },
  { id: "p3-e9", source: "p3-7", target: "p3-m2", type: "dependency" },
  { id: "p3-e10", source: "p3-m2", target: "p3-8", type: "dependency" },
  { id: "p3-e11", source: "p3-m2", target: "p3-9", type: "dependency" },
  { id: "p3-e12", source: "p3-8", target: "p3-10", type: "dependency" },
  { id: "p3-e13", source: "p3-9", target: "p3-10", type: "dependency" },
  { id: "p3-e14", source: "p3-10", target: "p3-m3", type: "dependency" },
]

// ── proj-4: Genomic Data Pipeline (0 %, Mar 1 → Jun 15) ─────────────
const P4_NODES: PlanNode[] = [
  { id: "p4-1", projectId: "proj-4", type: "task", title: "Environment Setup", description: "SLURM modules, Singularity containers, reference genome download", status: "planned", parentId: null, dependencies: [], environment: "hpc", verification: "auto", position: { x: 40, y: 40 }, startDate: "2026-03-01", endDate: "2026-03-06", priority: "urgent", estimate: "M", milestoneId: "p4-m1", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-2", projectId: "proj-4", type: "task", title: "FASTQ Ingestion", description: "Automated sample sheet parsing, FASTQ validation, and staging to scratch", status: "planned", parentId: null, dependencies: ["p4-1"], environment: "hpc", verification: "auto", position: { x: 40, y: 120 }, startDate: "2026-03-06", endDate: "2026-03-11", priority: "high", estimate: "M", milestoneId: "p4-m1", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-3", projectId: "proj-4", type: "task", title: "Quality Control", description: "FastQC, MultiQC, adapter trimming with fastp, contamination screen", status: "planned", parentId: null, dependencies: ["p4-2"], environment: "hpc", verification: "auto", position: { x: 40, y: 200 }, startDate: "2026-03-11", endDate: "2026-03-16", priority: "high", estimate: "M", milestoneId: "p4-m1", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-m1", projectId: "proj-4", type: "milestone", title: "Data QC Complete", description: "Clean, validated FASTQ files ready for alignment", status: "planned", parentId: null, dependencies: ["p4-3"], verification: "human", position: { x: 40, y: 280 }, startDate: "2026-03-16", endDate: "2026-03-16", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-4", projectId: "proj-4", type: "task", title: "BWA-MEM2 Alignment", description: "Read alignment to GRCh38, duplicate marking with sambamba", status: "planned", parentId: null, dependencies: ["p4-m1"], environment: "hpc", verification: "auto", position: { x: 40, y: 360 }, startDate: "2026-03-16", endDate: "2026-03-24", priority: "urgent", estimate: "L", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-5", projectId: "proj-4", type: "task", title: "BQSR & Realignment", description: "Base quality score recalibration and local indel realignment", status: "planned", parentId: null, dependencies: ["p4-4"], environment: "hpc", verification: "auto", position: { x: 40, y: 440 }, startDate: "2026-03-24", endDate: "2026-03-30", priority: "high", estimate: "M", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-6", projectId: "proj-4", type: "task", title: "Variant Calling", description: "GATK HaplotypeCaller per-sample, then joint genotyping across cohort", status: "planned", parentId: null, dependencies: ["p4-5"], environment: "hpc", verification: "auto", position: { x: 40, y: 520 }, startDate: "2026-03-30", endDate: "2026-04-08", priority: "urgent", estimate: "XL", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-m2", projectId: "proj-4", type: "milestone", title: "Variants Called", description: "Joint-called VCF for entire cohort", status: "planned", parentId: null, dependencies: ["p4-6"], verification: "human", position: { x: 40, y: 600 }, startDate: "2026-04-08", endDate: "2026-04-08", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-7", projectId: "proj-4", type: "task", title: "Variant Annotation", description: "VEP + ClinVar + gnomAD annotation, pathogenicity prediction", status: "planned", parentId: null, dependencies: ["p4-m2"], environment: "hpc", verification: "auto", position: { x: 40, y: 680 }, startDate: "2026-04-08", endDate: "2026-04-16", priority: "high", estimate: "L", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-8", projectId: "proj-4", type: "task", title: "Population Analysis", description: "PCA, admixture analysis, Fst calculations, IBD estimation", status: "planned", parentId: null, dependencies: ["p4-m2"], environment: "hpc", verification: "auto", position: { x: 250, y: 680 }, startDate: "2026-04-08", endDate: "2026-04-18", priority: "medium", estimate: "L", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-9", projectId: "proj-4", type: "task", title: "Results Dashboard", description: "Interactive web dashboard for variant exploration and cohort stats", status: "planned", parentId: null, dependencies: ["p4-7", "p4-8"], environment: "local", verification: "human", position: { x: 150, y: 760 }, startDate: "2026-04-18", endDate: "2026-04-28", priority: "medium", estimate: "L", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
  { id: "p4-m3", projectId: "proj-4", type: "milestone", title: "Analysis Complete", description: "Full pipeline results validated and published", status: "planned", parentId: null, dependencies: ["p4-9"], verification: "human", position: { x: 150, y: 840 }, startDate: "2026-04-28", endDate: "2026-04-28", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
]

const P4_EDGES: PlanEdge[] = [
  { id: "p4-e1", source: "p4-1", target: "p4-2", type: "dependency" },
  { id: "p4-e2", source: "p4-2", target: "p4-3", type: "dependency" },
  { id: "p4-e3", source: "p4-3", target: "p4-m1", type: "dependency" },
  { id: "p4-e4", source: "p4-m1", target: "p4-4", type: "dependency" },
  { id: "p4-e5", source: "p4-4", target: "p4-5", type: "dependency" },
  { id: "p4-e6", source: "p4-5", target: "p4-6", type: "dependency" },
  { id: "p4-e7", source: "p4-6", target: "p4-m2", type: "dependency" },
  { id: "p4-e8", source: "p4-m2", target: "p4-7", type: "dependency" },
  { id: "p4-e9", source: "p4-m2", target: "p4-8", type: "dependency" },
  { id: "p4-e10", source: "p4-7", target: "p4-9", type: "dependency" },
  { id: "p4-e11", source: "p4-8", target: "p4-9", type: "dependency" },
  { id: "p4-e12", source: "p4-9", target: "p4-m3", type: "dependency" },
]

// ── proj-5: LLM Benchmark Suite (85 %, Dec 10 → Feb 10) ─────────────
const P5_NODES: PlanNode[] = [
  { id: "p5-1", projectId: "proj-5", type: "task", title: "Framework Scaffold", description: "Core benchmark runner, plugin system, config schema", status: "completed", parentId: null, dependencies: [], environment: "local", verification: "auto", position: { x: 40, y: 40 }, startDate: "2025-12-10", endDate: "2025-12-16", priority: "urgent", estimate: "L", milestoneId: "p5-m1", createdAt: new Date("2025-12-10"), updatedAt: new Date("2025-12-16") },
  { id: "p5-2", projectId: "proj-5", type: "task", title: "Model Adapters", description: "Unified API adapters for OpenAI, Anthropic, Mistral, local GGUF", status: "completed", parentId: null, dependencies: ["p5-1"], environment: "local", verification: "auto", position: { x: 40, y: 120 }, startDate: "2025-12-16", endDate: "2025-12-23", priority: "high", estimate: "M", milestoneId: "p5-m1", createdAt: new Date("2025-12-16"), updatedAt: new Date("2025-12-23") },
  { id: "p5-m1", projectId: "proj-5", type: "milestone", title: "Core Framework", description: "Benchmark runner can invoke any supported model", status: "completed", parentId: null, dependencies: ["p5-2"], verification: "human", position: { x: 40, y: 200 }, startDate: "2025-12-23", endDate: "2025-12-23", createdAt: new Date("2025-12-10"), updatedAt: new Date("2025-12-23") },
  { id: "p5-3", projectId: "proj-5", type: "task", title: "Reasoning Benchmarks", description: "GSM8K, ARC, MMLU, HellaSwag, BBH — eval harness + scoring", status: "completed", parentId: null, dependencies: ["p5-m1"], environment: "cloud", verification: "auto", position: { x: 40, y: 280 }, startDate: "2025-12-23", endDate: "2026-01-03", priority: "high", estimate: "L", milestoneId: "p5-m2", createdAt: new Date("2025-12-23"), updatedAt: new Date("2026-01-03") },
  { id: "p5-4", projectId: "proj-5", type: "task", title: "Code Generation", description: "HumanEval, MBPP, SWE-bench Lite — sandboxed execution + pass@k", status: "completed", parentId: null, dependencies: ["p5-m1"], environment: "cloud", verification: "auto", position: { x: 250, y: 280 }, startDate: "2025-12-23", endDate: "2026-01-06", priority: "high", estimate: "L", milestoneId: "p5-m2", createdAt: new Date("2025-12-23"), updatedAt: new Date("2026-01-06") },
  { id: "p5-5", projectId: "proj-5", type: "task", title: "Instruction Following", description: "IFEval, MT-Bench, AlpacaEval 2.0 — judge model scoring", status: "completed", parentId: null, dependencies: ["p5-m1"], environment: "cloud", verification: "auto", position: { x: 460, y: 280 }, startDate: "2025-12-26", endDate: "2026-01-08", priority: "high", estimate: "L", milestoneId: "p5-m2", createdAt: new Date("2025-12-26"), updatedAt: new Date("2026-01-08") },
  { id: "p5-m2", projectId: "proj-5", type: "milestone", title: "Benchmarks Complete", description: "All three benchmark suites passing", status: "completed", parentId: null, dependencies: ["p5-3", "p5-4", "p5-5"], verification: "human", position: { x: 250, y: 380 }, startDate: "2026-01-08", endDate: "2026-01-08", createdAt: new Date("2025-12-10"), updatedAt: new Date("2026-01-08") },
  { id: "p5-6", projectId: "proj-5", type: "task", title: "Leaderboard UI", description: "Web dashboard with sortable tables, radar charts, model comparison", status: "completed", parentId: null, dependencies: ["p5-m2"], environment: "local", verification: "human", position: { x: 250, y: 460 }, startDate: "2026-01-08", endDate: "2026-01-17", priority: "medium", estimate: "M", createdAt: new Date("2026-01-08"), updatedAt: new Date("2026-01-17") },
  { id: "p5-7", projectId: "proj-5", type: "task", title: "CI Integration", description: "GitHub Actions workflow to run benchmarks on new model releases", status: "completed", parentId: null, dependencies: ["p5-m2"], environment: "cloud", verification: "auto", position: { x: 460, y: 460 }, startDate: "2026-01-10", endDate: "2026-01-16", priority: "medium", estimate: "S", createdAt: new Date("2026-01-10"), updatedAt: new Date("2026-01-16") },
  { id: "p5-8", projectId: "proj-5", type: "task", title: "Report Generator", description: "Automated PDF/HTML report with methodology, results, and analysis", status: "in_progress", parentId: null, dependencies: ["p5-6", "p5-7"], environment: "local", verification: "human", position: { x: 350, y: 540 }, startDate: "2026-01-17", endDate: "2026-01-28", priority: "medium", estimate: "M", dueDate: "2026-02-05", createdAt: new Date("2026-01-17"), updatedAt: new Date("2026-02-04") },
  { id: "p5-9", projectId: "proj-5", type: "task", title: "Safety Benchmarks", description: "TruthfulQA, toxicity detection, refusal calibration suite", status: "in_progress", parentId: null, dependencies: ["p5-m2"], environment: "cloud", verification: "human", position: { x: 40, y: 460 }, startDate: "2026-01-20", endDate: "2026-02-03", priority: "high", estimate: "L", dueDate: "2026-02-08", createdAt: new Date("2026-01-20"), updatedAt: new Date("2026-02-04") },
  { id: "p5-m3", projectId: "proj-5", type: "milestone", title: "v1.0 Release", description: "Public release of benchmark suite", status: "planned", parentId: null, dependencies: ["p5-8", "p5-9"], verification: "human", position: { x: 250, y: 620 }, startDate: "2026-02-05", endDate: "2026-02-05", createdAt: new Date("2025-12-10"), updatedAt: new Date("2026-02-04") },
]

const P5_EDGES: PlanEdge[] = [
  { id: "p5-e1", source: "p5-1", target: "p5-2", type: "dependency" },
  { id: "p5-e2", source: "p5-2", target: "p5-m1", type: "dependency" },
  { id: "p5-e3", source: "p5-m1", target: "p5-3", type: "dependency" },
  { id: "p5-e4", source: "p5-m1", target: "p5-4", type: "dependency" },
  { id: "p5-e5", source: "p5-m1", target: "p5-5", type: "dependency" },
  { id: "p5-e6", source: "p5-3", target: "p5-m2", type: "dependency" },
  { id: "p5-e7", source: "p5-4", target: "p5-m2", type: "dependency" },
  { id: "p5-e8", source: "p5-5", target: "p5-m2", type: "dependency" },
  { id: "p5-e9", source: "p5-m2", target: "p5-6", type: "dependency" },
  { id: "p5-e10", source: "p5-m2", target: "p5-7", type: "dependency" },
  { id: "p5-e11", source: "p5-6", target: "p5-8", type: "dependency" },
  { id: "p5-e12", source: "p5-7", target: "p5-8", type: "dependency" },
  { id: "p5-e13", source: "p5-m2", target: "p5-9", type: "dependency" },
  { id: "p5-e14", source: "p5-8", target: "p5-m3", type: "dependency" },
  { id: "p5-e15", source: "p5-9", target: "p5-m3", type: "dependency" },
]

// ── Combined seed data ───────────────────────────────────────────────
const MOCK_NODES: PlanNode[] = [...P1_NODES, ...P2_NODES, ...P3_NODES, ...P4_NODES, ...P5_NODES]
const MOCK_EDGES: PlanEdge[] = [...P1_EDGES, ...P2_EDGES, ...P3_EDGES, ...P4_EDGES, ...P5_EDGES]

async function loadFromIdb(): Promise<{ nodes: PlanNode[]; edges: PlanEdge[] } | null> {
  const savedNodes = await loadState<PlanNode[]>("nexus-plan-nodes")
  const savedEdges = await loadState<PlanEdge[]>("nexus-plan-edges")
  if (savedNodes && savedEdges) {
    return {
      nodes: savedNodes.map(n => ({ ...n, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt) })),
      edges: savedEdges,
    }
  }
  return null
}

function saveToIdb(nodes: PlanNode[], edges: PlanEdge[]) {
  saveState("nexus-plan-nodes", nodes)
  saveState("nexus-plan-edges", edges)
}

// Supabase sync helpers
function syncAddNode(node: PlanNode) {
  const supabase = getSupabase()
  if (!supabase || !isSupabaseConfigured()) return
  supabase.from("plan_nodes").insert({
    project_id: node.projectId,
    client_id: node.id,
    type: node.type,
    title: node.title,
    description: node.description,
    status: node.status,
    parent_id: node.parentId,
    environment: node.environment || null,
    verification: node.verification,
    position_x: node.position.x,
    position_y: node.position.y,
    start_date: node.startDate || null,
    end_date: node.endDate || null,
    due_date: node.dueDate || null,
    priority: node.priority || null,
    estimate: node.estimate || null,
    milestone_id: node.milestoneId || null,
    label_ids: node.labelIds || [],
  }).then()
}

function syncUpdateNode(id: string, projectId: string, updates: Partial<PlanNode>) {
  const supabase = getSupabase()
  if (!supabase || !isSupabaseConfigured()) return
  const row: Record<string, unknown> = {}
  if (updates.title !== undefined) row.title = updates.title
  if (updates.description !== undefined) row.description = updates.description
  if (updates.status !== undefined) row.status = updates.status
  if (updates.position !== undefined) { row.position_x = updates.position.x; row.position_y = updates.position.y }
  if (updates.startDate !== undefined) row.start_date = updates.startDate || null
  if (updates.endDate !== undefined) row.end_date = updates.endDate || null
  if (updates.dueDate !== undefined) row.due_date = updates.dueDate || null
  if (updates.priority !== undefined) row.priority = updates.priority || null
  if (updates.estimate !== undefined) row.estimate = updates.estimate || null
  if (updates.milestoneId !== undefined) row.milestone_id = updates.milestoneId || null
  if (updates.executionId !== undefined) row.execution_id = updates.executionId || null
  if (updates.executionOutput !== undefined) row.execution_output = updates.executionOutput || null
  if (updates.executionError !== undefined) row.execution_error = updates.executionError || null
  if (Object.keys(row).length > 0) {
    supabase.from("plan_nodes").update(row).eq("project_id", projectId).eq("client_id", id).then()
  }
}

function syncAddEdge(edge: PlanEdge, projectId: string) {
  const supabase = getSupabase()
  if (!supabase || !isSupabaseConfigured()) return
  supabase.from("plan_edges").insert({
    project_id: projectId,
    client_id: edge.id,
    source_client_id: edge.source,
    target_client_id: edge.target,
    type: edge.type,
  }).then()
}

export const usePlanStore = create<PlanState>((set, get) => ({
  nodes: [],
  edges: [],
  loaded: false,

  load: async () => {
    const supabase = getSupabase()

    if (supabase && isSupabaseConfigured()) {
      // Load from Supabase
      const [nodesRes, edgesRes] = await Promise.all([
        supabase.from("plan_nodes").select("*").order("created_at"),
        supabase.from("plan_edges").select("*"),
      ])

      if (!nodesRes.error && nodesRes.data && nodesRes.data.length > 0) {
        // Also load dependencies
        const { data: deps } = await supabase.from("plan_node_dependencies").select("*")
        const depsMap = new Map<string, string[]>()
        if (deps) {
          for (const dep of deps) {
            const key = `${dep.node_project_id}:${dep.node_client_id}`
            if (!depsMap.has(key)) depsMap.set(key, [])
            depsMap.get(key)!.push(dep.depends_on_client_id)
          }
        }

        const nodes = nodesRes.data.map((row) => {
          const node = mapNodeRow(row)
          node.dependencies = depsMap.get(`${row.project_id}:${row.client_id}`) || []
          return node
        })
        const edges = (edgesRes.data || []).map(mapEdgeRow)
        set({ nodes, edges, loaded: true })
        saveToIdb(nodes, edges)
      } else {
        // Fallback to IndexedDB
        const cached = await loadFromIdb()
        if (cached) {
          set({ ...cached, loaded: true })
        } else {
          set({ nodes: MOCK_NODES, edges: MOCK_EDGES, loaded: true })
          saveToIdb(MOCK_NODES, MOCK_EDGES)
        }
      }

      // Subscribe to realtime node changes
      if (!nodesChannel) {
        nodesChannel = supabase
          .channel("plan-nodes-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: "plan_nodes" }, (payload) => {
            const current = get().nodes
            if (payload.eventType === "UPDATE") {
              const updated = mapNodeRow(payload.new)
              // Preserve dependencies (not in the row)
              const existing = current.find((n) => n.id === updated.id && n.projectId === updated.projectId)
              if (existing) updated.dependencies = existing.dependencies
              set({ nodes: current.map((n) => (n.id === updated.id && n.projectId === updated.projectId ? updated : n)) })
            }
          })
          .subscribe()
      }

      if (!edgesChannel) {
        edgesChannel = supabase
          .channel("plan-edges-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: "plan_edges" }, () => {
            // Re-fetch edges on change for simplicity
          })
          .subscribe()
      }
    } else {
      // Pure IndexedDB mode
      const cached = await loadFromIdb()
      if (cached) {
        set({ ...cached, loaded: true })
      } else {
        set({ nodes: MOCK_NODES, edges: MOCK_EDGES, loaded: true })
        saveToIdb(MOCK_NODES, MOCK_EDGES)
      }
    }
  },

  addNode: (node) => {
    const nextNodes = [...get().nodes, node]
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)
    syncAddNode(node)
  },

  updateNode: (id, updates) => {
    const existing = get().nodes.find((n) => n.id === id)
    const nextNodes = get().nodes.map((n) =>
      n.id === id ? { ...n, ...updates, updatedAt: new Date() } : n
    )
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)
    if (existing) syncUpdateNode(id, existing.projectId, updates)
  },

  addEdge: (edge) => {
    const nextEdges = [...get().edges, edge]
    set({ edges: nextEdges })
    saveState("nexus-plan-edges", nextEdges)
    // Determine projectId from source node
    const sourceNode = get().nodes.find((n) => n.id === edge.source)
    if (sourceNode) syncAddEdge(edge, sourceNode.projectId)
  },

  setProjectPlan: (projectId, newNodes, newEdges) => {
    const otherNodes = get().nodes.filter((n) => n.projectId !== projectId)
    const otherEdges = get().edges.filter((e) => {
      const nodeIds = new Set(get().nodes.filter((n) => n.projectId === projectId).map((n) => n.id))
      return !nodeIds.has(e.source) && !nodeIds.has(e.target)
    })
    const nextNodes = [...otherNodes, ...newNodes]
    const nextEdges = [...otherEdges, ...newEdges]
    set({ nodes: nextNodes, edges: nextEdges })
    saveToIdb(nextNodes, nextEdges)

    // Bulk sync to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      // Delete old nodes/edges for project, then insert new
      supabase.from("plan_edges").delete().eq("project_id", projectId).then(() => {
        supabase.from("plan_nodes").delete().eq("project_id", projectId).then(() => {
          // Insert new nodes
          const nodeRows = newNodes.map((n) => ({
            project_id: n.projectId,
            client_id: n.id,
            type: n.type,
            title: n.title,
            description: n.description,
            status: n.status,
            parent_id: n.parentId,
            environment: n.environment || null,
            verification: n.verification,
            position_x: n.position.x,
            position_y: n.position.y,
            start_date: n.startDate || null,
            end_date: n.endDate || null,
            due_date: n.dueDate || null,
            priority: n.priority || null,
            estimate: n.estimate || null,
            milestone_id: n.milestoneId || null,
            label_ids: n.labelIds || [],
          }))
          if (nodeRows.length > 0) supabase.from("plan_nodes").insert(nodeRows).then()

          // Insert new edges
          const edgeRows = newEdges.map((e) => ({
            project_id: projectId,
            client_id: e.id,
            source_client_id: e.source,
            target_client_id: e.target,
            type: e.type,
          }))
          if (edgeRows.length > 0) supabase.from("plan_edges").insert(edgeRows).then()

          // Insert dependencies
          const depRows = newNodes.flatMap((n) =>
            n.dependencies.map((depId) => ({
              node_project_id: projectId,
              node_client_id: n.id,
              depends_on_client_id: depId,
            }))
          )
          if (depRows.length > 0) supabase.from("plan_node_dependencies").insert(depRows).then()
        })
      })
    }
  },

  reorganizeProject: (projectId) => {
    const allNodes = get().nodes
    const allEdges = get().edges
    const projectNodes = allNodes.filter((n) => n.projectId === projectId)
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    const projectEdges = allEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    const positions = layoutGraph(projectNodes, projectEdges)

    const nextNodes = allNodes.map((n) => {
      const newPos = positions.get(n.id)
      return newPos ? { ...n, position: newPos, updatedAt: new Date() } : n
    })
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)

    // Sync position updates to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      for (const [nodeId, pos] of positions) {
        supabase.from("plan_nodes").update({ position_x: pos.x, position_y: pos.y }).eq("project_id", projectId).eq("client_id", nodeId).then()
      }
    }
  },
}))
