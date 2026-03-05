/**
 * Example: Data Pipeline / ETL Template
 *
 * Demonstrates data engineering workflows with source/sink configuration,
 * transformation stages, data quality checks, and orchestration setup.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const dataPipelineTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro--data-pipeline',
  name: 'Data Pipeline',
  description:
    'ETL/ELT data pipeline covering data ingestion, transformation, validation, and loading. Supports batch and streaming architectures with orchestration setup (Airflow, Prefect) and data quality monitoring.',
  category: 'data-science',
  version: '1.0.0',
  icon: '🔄',
  tags: ['etl', 'data-engineering', 'pipeline', 'dbt', 'airflow'],
  maturity: 'stable',

  // ── Parameters ────────────────────────────────────────────────────────
  requiredParameters: [
    {
      id: 'pipelineName',
      name: 'Pipeline Name',
      description: 'Name for the data pipeline (used in DAG IDs, table prefixes, etc.)',
      type: 'string',
      required: true,
      placeholder: 'sales-analytics-pipeline',
      validation: {
        pattern: '^[a-z][a-z0-9_-]*$',
        message: 'Lowercase with underscores/hyphens',
      },
      group: 'basics',
      order: 0,
    },
    {
      id: 'pipelineDescription',
      name: 'Pipeline Description',
      description: 'What data does this pipeline process and what is the business purpose?',
      type: 'string',
      required: true,
      placeholder: 'Ingest daily sales data from Salesforce, transform for analytics, load to BigQuery',
      validation: { min: 20, max: 500 },
      group: 'basics',
      order: 1,
    },
    {
      id: 'pipelineType',
      name: 'Pipeline Type',
      description: 'Batch or streaming architecture',
      type: 'select',
      required: true,
      default: 'batch',
      options: [
        { label: 'Batch', value: 'batch', description: 'Scheduled batch processing (hourly/daily)' },
        { label: 'Streaming', value: 'streaming', description: 'Real-time event processing' },
        { label: 'Hybrid', value: 'hybrid', description: 'Batch with near-real-time micro-batches' },
      ],
      group: 'architecture',
      order: 0,
    },
  ],

  optionalParameters: [
    {
      id: 'sourceType',
      name: 'Data Source',
      description: 'Primary data source type',
      type: 'select',
      required: false,
      default: 'api',
      options: [
        { label: 'REST API', value: 'api', description: 'HTTP/REST API endpoints' },
        { label: 'Database', value: 'database', description: 'PostgreSQL, MySQL, etc.' },
        { label: 'Cloud Storage', value: 'storage', description: 'S3, GCS, Azure Blob' },
        { label: 'Kafka', value: 'kafka', description: 'Kafka topics' },
        { label: 'Files', value: 'files', description: 'Local CSV/JSON/Parquet files' },
        { label: 'SaaS', value: 'saas', description: 'Salesforce, HubSpot, etc.' },
      ],
      group: 'sources',
      order: 0,
    },
    {
      id: 'sinkType',
      name: 'Data Sink',
      description: 'Primary data destination',
      type: 'select',
      required: false,
      default: 'warehouse',
      options: [
        { label: 'Data Warehouse', value: 'warehouse', description: 'BigQuery, Snowflake, Redshift' },
        { label: 'Data Lake', value: 'lake', description: 'Delta Lake, Iceberg, Hudi' },
        { label: 'Database', value: 'database', description: 'PostgreSQL, MySQL, etc.' },
        { label: 'Cloud Storage', value: 'storage', description: 'S3, GCS parquet files' },
        { label: 'Kafka', value: 'kafka', description: 'Kafka topics for downstream' },
      ],
      group: 'sinks',
      order: 0,
    },
    {
      id: 'transformationTool',
      name: 'Transformation Tool',
      description: 'Tool for data transformations',
      type: 'select',
      required: false,
      default: 'dbt',
      options: [
        { label: 'dbt', value: 'dbt', description: 'SQL-based transformations with dbt' },
        { label: 'Spark', value: 'spark', description: 'PySpark or Scala Spark' },
        { label: 'Pandas', value: 'pandas', description: 'Python Pandas for smaller datasets' },
        { label: 'Polars', value: 'polars', description: 'Rust-based Polars for performance' },
        { label: 'SQL', value: 'sql', description: 'Pure SQL transformations' },
      ],
      group: 'transformation',
      order: 0,
    },
    {
      id: 'orchestrator',
      name: 'Orchestrator',
      description: 'Workflow orchestration tool',
      type: 'select',
      required: false,
      default: 'airflow',
      options: [
        { label: 'Airflow', value: 'airflow', description: 'Apache Airflow DAGs' },
        { label: 'Prefect', value: 'prefect', description: 'Prefect flows' },
        { label: 'Dagster', value: 'dagster', description: 'Dagster pipelines' },
        { label: 'GitHub Actions', value: 'gha', description: 'Scheduled GitHub Actions' },
        { label: 'None', value: 'none', description: 'Manual execution or cron' },
      ],
      group: 'orchestration',
      order: 0,
    },
    {
      id: 'schedule',
      name: 'Schedule',
      description: 'How often should the pipeline run?',
      type: 'select',
      required: false,
      default: 'daily',
      options: [
        { label: 'Hourly', value: 'hourly', description: 'Run every hour' },
        { label: 'Daily', value: 'daily', description: 'Run once per day' },
        { label: 'Weekly', value: 'weekly', description: 'Run once per week' },
        { label: 'On-Demand', value: 'manual', description: 'Triggered manually' },
        { label: 'Continuous', value: 'continuous', description: 'Streaming (always running)' },
      ],
      visibleWhen: {
        parameterId: 'pipelineType',
        operator: 'not-equals',
        value: 'streaming',
      },
      group: 'orchestration',
      order: 1,
    },
    {
      id: 'dataQuality',
      name: 'Data Quality',
      description: 'Data quality validation approach',
      type: 'select',
      required: false,
      default: 'great-expectations',
      options: [
        { label: 'Great Expectations', value: 'great-expectations', description: 'Full expectation suites' },
        { label: 'dbt Tests', value: 'dbt-tests', description: 'dbt schema tests and custom tests' },
        { label: 'Soda', value: 'soda', description: 'Soda checks' },
        { label: 'Custom', value: 'custom', description: 'Custom validation scripts' },
        { label: 'None', value: 'none', description: 'No automated quality checks' },
      ],
      group: 'quality',
      order: 0,
    },
    {
      id: 'incrementalStrategy',
      name: 'Incremental Strategy',
      description: 'How to handle incremental loads',
      type: 'select',
      required: false,
      default: 'timestamp',
      options: [
        { label: 'Timestamp-based', value: 'timestamp', description: 'Filter by updated_at column' },
        { label: 'CDC', value: 'cdc', description: 'Change Data Capture from source' },
        { label: 'Full Refresh', value: 'full', description: 'Reload all data each run' },
        { label: 'Merge', value: 'merge', description: 'Upsert based on primary key' },
      ],
      group: 'loading',
      order: 0,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────
  prompts: {
    planGeneration: `You are a senior data engineer planning a data pipeline.

## Pipeline Specification
- Name: {{pipelineName}}
- Description: {{pipelineDescription}}
- Type: {{pipelineType}}
- Source: {{sourceType}}
- Sink: {{sinkType}}
- Transformation: {{transformationTool}}
- Orchestrator: {{orchestrator}}
- Schedule: {{schedule}}
- Data Quality: {{dataQuality}}
- Incremental: {{incrementalStrategy}}

## Planning Guidelines

Decompose this data pipeline into a DAG of tasks:

1. **Milestone Structure**:
   - Pipeline Foundation (project setup, connections, schema definitions)
   - Extract Layer (source connectors, data extraction logic)
   - Transform Layer (staging models, business logic, aggregations)
   - Load & Quality (loading logic, data quality checks, monitoring)
   - Orchestration (DAG definition, alerting, documentation)

2. **Task Granularity**:
   - Connection/credential setup as one task
   - Each source connector as a separate task
   - Staging transformations (raw → cleaned) as one task
   - Business transformations (cleaned → modeled) as one task
   - Final aggregations/marts as one task
   - Data quality suite as one task
   - Orchestration DAG as one task

3. **Parallelism**:
   - Foundation must complete before extraction
   - Different source extracts can run in parallel
   - Transformations have dependencies (staging → cleaned → modeled → marts)
   - Data quality can test each layer independently
   - Orchestration depends on all pipeline components

4. **Labels**: Use l2=Backend for Python/Spark code, l4=Infrastructure for orchestration/infra.

5. **Verification**: Use "auto" for data quality tests. Use "human" for schema design and business logic validation.`,

    taskExecution: `You are building part of the {{pipelineName}} data pipeline.

Stack: {{pipelineType}} pipeline using {{transformationTool}} for transformations, {{orchestrator}} for orchestration.
Source: {{sourceType}} → Sink: {{sinkType}}.

Data engineering standards:
- Use environment variables for all credentials (never hardcode)
- Implement idempotent operations (re-runnable without side effects)
- Add logging at each pipeline stage with record counts
- Handle schema evolution gracefully
- Include data lineage metadata
- Use partitioning for large tables (date, region, etc.)
- Set appropriate compute resources (don't over-provision)

For dbt models:
- Use CTEs for readability
- Add documentation strings to all models
- Use refs() for model dependencies
- Implement incremental models where appropriate
- Add schema tests (not_null, unique, relationships)

For orchestration:
- Set reasonable timeouts and retries
- Add SLA alerts for business-critical pipelines
- Use XCom or equivalent for passing metadata between tasks
- Implement graceful failure handling`,

    sharedContext: `Data pipeline best practices:

ETL vs ELT:
- ETL: Transform before loading (legacy, limited compute)
- ELT: Load raw, transform in warehouse (modern, scalable)

Incremental Processing:
- Use watermarks (high_watermark table) for timestamp-based
- CDC captures inserts, updates, deletes from source
- Full refresh for small dimensions or when CDC unavailable

Data Quality Dimensions:
- Completeness: Are all expected records present?
- Uniqueness: No duplicate primary keys
- Validity: Values within expected ranges/formats
- Consistency: Cross-table relationships hold
- Timeliness: Data arrives within SLA

Testing Strategy:
- Schema tests: Column types, nullability, uniqueness
- Data tests: Row counts, value ranges, referential integrity
- Freshness tests: Data not stale
- Custom tests: Business rule validation`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'free',
    description: 'Pipeline code, dbt models, DAG definitions, and data quality tests as file changes.',
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 2,
    autoDispatch: true,
    defaultPriority: 'normal',
    retry: {
      maxRetries: 2,
      retryDelayMs: 5000,
      exponentialBackoff: true,
    },
    machineSelectionPolicy: 'priority',
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    maxTurns: 35,
    maxBudgetPerTask: 5.0,
    deliveryMode: 'pr',
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 7, max: 12 },
    defaultEstimate: 'S',
    suggestedMilestones: [
      { title: 'Pipeline Foundation', description: 'Project setup, connections, schemas defined' },
      { title: 'Extract Complete', description: 'All source connectors working' },
      { title: 'Transform Complete', description: 'All transformation logic implemented' },
      { title: 'Pipeline Operational', description: 'Orchestration, quality checks, and monitoring ready' },
    ],
    commonLabels: ['l2', 'l4'],
    preferParallelTasks: false,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['data-engineering', 'devops-infrastructure'],
  recommendedSkills: [],
  source: 'builtin',
  enabled: true,
}
