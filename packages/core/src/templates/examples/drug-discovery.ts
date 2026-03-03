/**
 * Example: Computational Drug Discovery Template
 *
 * Demonstrates the celltype toolbox integration, computational biology
 * workflows, and sequential research pipeline planning.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const drugDiscoveryTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro/drug-discovery',
  name: 'Drug Discovery Pipeline',
  description:
    'Computational drug discovery pipeline covering target identification, validation, compound screening, ADMET prediction, and clinical landscape analysis. Leverages the celltype toolbox for automated bioinformatics workflows including Open Targets queries, DepMap analysis, virtual screening, and safety assessment.',
  category: 'computational-biology',
  version: '1.0.0',
  icon: '💊',
  tags: ['drug-discovery', 'bioinformatics', 'target-validation', 'virtual-screening', 'admet'],
  maturity: 'experimental',

  // ── Parameters ────────────────────────────────────────────────────────
  requiredParameters: [
    {
      id: 'targetGene',
      name: 'Target Gene/Protein',
      description: 'Primary gene or protein target for the drug discovery campaign (gene symbol, e.g., BRCA1, TP53, EGFR)',
      type: 'string',
      required: true,
      placeholder: 'EGFR',
      validation: {
        pattern: '^[A-Z][A-Z0-9-]+$',
        message: 'Use official gene symbol (uppercase letters and numbers)',
      },
      group: 'target',
      order: 0,
    },
    {
      id: 'diseaseContext',
      name: 'Disease Context',
      description: 'Disease or indication to investigate (e.g., "non-small cell lung cancer", "Alzheimer\'s disease")',
      type: 'string',
      required: true,
      placeholder: 'non-small cell lung cancer',
      validation: { min: 5, max: 200 },
      group: 'target',
      order: 1,
    },
    {
      id: 'modality',
      name: 'Therapeutic Modality',
      description: 'Type of therapeutic approach',
      type: 'select',
      required: true,
      default: 'small-molecule',
      options: [
        { label: 'Small Molecule', value: 'small-molecule', description: 'Traditional small molecule inhibitor/modulator' },
        { label: 'Targeted Degrader', value: 'degrader', description: 'PROTAC / molecular glue degrader' },
        { label: 'Antibody', value: 'antibody', description: 'Monoclonal antibody or ADC' },
        { label: 'Gene Therapy', value: 'gene-therapy', description: 'ASO, siRNA, or CRISPR-based' },
      ],
      group: 'target',
      order: 2,
    },
  ],

  optionalParameters: [
    {
      id: 'compoundSmiles',
      name: 'Lead Compound SMILES',
      description: 'SMILES string for an existing lead compound to use as starting point (if available)',
      type: 'string',
      required: false,
      placeholder: 'CC(=O)Nc1ccc(O)cc1',
      group: 'chemistry',
      order: 0,
    },
    {
      id: 'pipelineDepth',
      name: 'Pipeline Depth',
      description: 'How deep into the discovery pipeline to plan',
      type: 'select',
      required: false,
      default: 'hit-to-lead',
      options: [
        { label: 'Target Validation Only', value: 'target-validation', description: 'Focus on validating the target' },
        { label: 'Hit-to-Lead', value: 'hit-to-lead', description: 'Target validation through hit identification' },
        { label: 'Full Pipeline', value: 'full-pipeline', description: 'Target through preclinical candidate selection' },
      ],
      group: 'scope',
      order: 0,
    },
    {
      id: 'tissues',
      name: 'Relevant Tissues',
      description: 'Tissue types relevant to the disease context (for expression analysis)',
      type: 'multi-select',
      required: false,
      default: [],
      options: [
        { label: 'Lung', value: 'lung' },
        { label: 'Breast', value: 'breast' },
        { label: 'Brain', value: 'brain' },
        { label: 'Liver', value: 'liver' },
        { label: 'Blood', value: 'blood' },
        { label: 'Colon', value: 'colon' },
        { label: 'Skin', value: 'skin' },
        { label: 'Pancreas', value: 'pancreas' },
      ],
      group: 'biology',
      order: 0,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────
  prompts: {
    planGeneration: `You are a computational biology researcher planning a drug discovery campaign.

## Campaign Specification
- Target: {{targetGene}}
- Disease: {{diseaseContext}}
- Modality: {{modality}}
- Lead Compound: {{compoundSmiles}}
- Pipeline Depth: {{pipelineDepth}}
- Relevant Tissues: {{tissues}}

## Planning Guidelines

Decompose this drug discovery campaign into a DAG of computational analysis tasks:

1. **Milestone Structure**:
   - Target Validation (disease association, expression, essentiality, druggability)
   - Compound Analysis (if lead provided: descriptors, SAR, similarity search)
   - Virtual Screening (structure-based or ligand-based hit finding)
   - Safety & ADMET (anti-target profiling, toxicity prediction, ADMET properties)
   - Clinical Landscape (trials, competitive landscape, indication mapping)

2. **Task Granularity**: Each task should use 1-3 celltype tools:
   - "Query Open Targets disease associations for {{targetGene}}" → target.disease_association
   - "Assess druggability of {{targetGene}}" → target.druggability
   - "Profile expression across tissues" → target.expression_profile
   - "Find co-essential genes from DepMap" → target.coessentiality
   - "Screen compound library" → structure.batch_screen
   - "Predict ADMET properties" → safety.admet_predict
   - "Search clinical trials" → clinical.trial_search

3. **Parallelism**:
   - Target validation subtasks (expression, druggability, disease association) can run in parallel
   - Compound analysis can start in parallel with target validation IF a lead is provided
   - Virtual screening depends on target structure being available
   - Safety assessment depends on having compound hits
   - Clinical landscape analysis can run in parallel with everything

4. **Labels**: Use l5=Research for all tasks (this is a research pipeline).

5. **Verification**: Use "human" for all tasks — results require expert interpretation.`,

    taskExecution: `You are a computational biologist executing a drug discovery analysis task.

Target: {{targetGene}} in {{diseaseContext}}.
Modality: {{modality}}.

Guidelines:
- Use celltype tools for all bioinformatics queries (do not write custom API calls)
- Report results clearly with statistical context (p-values, confidence intervals)
- Flag any surprising or contradictory findings
- Cite data sources (e.g., "per Open Targets, {{targetGene}} has association score 0.72 for {{diseaseContext}}")
- Suggest follow-up analyses when findings are ambiguous
- Save structured results as JSON for downstream tasks`,

    sharedContext: `Drug discovery computational biology context:
- Target validation requires convergent evidence from multiple data sources
- Expression data should be interpreted in context of disease-relevant tissues
- Druggability assessment considers protein structure, binding pockets, and existing ligands
- Safety profiling must check for anti-target activity (tumor suppressors, essential genes)
- ADMET prediction is only as good as the training data — flag predictions with low confidence
- Clinical landscape analysis helps position the drug discovery effort strategically`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'json_schema',
    description: 'Structured target validation and screening results.',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        disease: { type: 'string' },
        validationScore: {
          type: 'object',
          properties: {
            geneticEvidence: { type: 'number', description: '0-1 score from GWAS/genetic data' },
            expressionRelevance: { type: 'number', description: '0-1 score from expression data' },
            essentiality: { type: 'number', description: '0-1 score from DepMap essentiality' },
            druggability: { type: 'number', description: '0-1 score from structural/ligand data' },
            overall: { type: 'number', description: 'Composite validation score' },
          },
        },
        hits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              smiles: { type: 'string' },
              name: { type: 'string' },
              score: { type: 'number' },
              source: { type: 'string' },
            },
          },
        },
        safetyFlags: {
          type: 'array',
          items: { type: 'string' },
        },
        recommendation: { type: 'string' },
      },
      required: ['target', 'disease', 'recommendation'],
    },
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 4,
    autoDispatch: true,
    defaultPriority: 'normal',
    retry: {
      maxRetries: 2,
      retryDelayMs: 15000,
      exponentialBackoff: true,
    },
    machineSelectionPolicy: 'priority',
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    preferredModel: 'claude-sonnet-4-20250514',
    maxTurns: 40,
    maxBudgetPerTask: 8.0,
    deliveryMode: 'branch',
    skipSafetyCheck: true,
    defaultVerification: 'human',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 8, max: 15 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      { title: 'Target Validated', description: 'Convergent evidence supports target-disease link' },
      { title: 'Hits Identified', description: 'Compound hits from screening or literature' },
      { title: 'Safety Profiled', description: 'ADMET and anti-target risks assessed' },
      { title: 'Campaign Report', description: 'Full analysis report with recommendations' },
    ],
    commonLabels: ['l5'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['computational-biology', 'scientific-computing'],
  recommendedSkills: [],
  source: 'builtin',
  enabled: true,
}
