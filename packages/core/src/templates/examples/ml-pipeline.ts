/**
 * Example: ML Training Pipeline Template
 *
 * Demonstrates GPU-aware parallelization, SLURM execution strategy,
 * structured JSON output for experiment tracking, and machine label matching.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const mlPipelineTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro/ml-pipeline',
  name: 'ML Training Pipeline',
  description:
    'Machine learning training pipeline covering data preparation, model architecture, training loop, evaluation, and experiment tracking. Supports GPU-aware task dispatch, SLURM/Docker execution strategies, and structured experiment results.',
  category: 'machine-learning',
  version: '1.0.0',
  icon: '🧠',
  tags: ['ml', 'training', 'pytorch', 'gpu', 'experiments'],
  maturity: 'beta',

  // ── Parameters ────────────────────────────────────────────────────────
  requiredParameters: [
    {
      id: 'experimentName',
      name: 'Experiment Name',
      description: 'Name for this ML experiment (used in logging and artifact paths)',
      type: 'string',
      required: true,
      placeholder: 'bert-finetuning-v2',
      validation: {
        pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$',
        message: 'Alphanumeric with hyphens/underscores',
      },
      group: 'experiment',
      order: 0,
    },
    {
      id: 'task',
      name: 'ML Task',
      description: 'The type of machine learning task',
      type: 'select',
      required: true,
      default: 'classification',
      options: [
        { label: 'Classification', value: 'classification', description: 'Binary or multi-class classification' },
        { label: 'Regression', value: 'regression', description: 'Continuous value prediction' },
        { label: 'Sequence Modeling', value: 'sequence', description: 'NLP, time series, or sequential data' },
        { label: 'Generative', value: 'generative', description: 'Image/text generation, VAE, GAN, diffusion' },
      ],
      group: 'experiment',
      order: 1,
    },
    {
      id: 'dataDescription',
      name: 'Dataset Description',
      description: 'Describe the dataset: format, size, features, and where it lives',
      type: 'string',
      required: true,
      placeholder: 'CSV files in data/ directory, 100K rows, 50 features, target column is "label"',
      validation: { min: 20, message: 'Please provide enough detail for the agent to find and load the data' },
      group: 'data',
      order: 0,
    },
  ],

  optionalParameters: [
    {
      id: 'framework',
      name: 'ML Framework',
      description: 'Deep learning or ML framework',
      type: 'select',
      required: false,
      default: 'pytorch',
      options: [
        { label: 'PyTorch', value: 'pytorch', description: 'PyTorch with Lightning or bare' },
        { label: 'TensorFlow', value: 'tensorflow', description: 'TensorFlow 2.x / Keras' },
        { label: 'scikit-learn', value: 'sklearn', description: 'Classical ML with scikit-learn' },
        { label: 'JAX', value: 'jax', description: 'JAX with Flax or Haiku' },
      ],
      group: 'stack',
      order: 0,
    },
    {
      id: 'executionStrategy',
      name: 'Execution Strategy',
      description: 'How training jobs should be run',
      type: 'select',
      required: false,
      default: 'direct',
      options: [
        { label: 'Direct', value: 'direct', description: 'Run directly on the machine' },
        { label: 'SLURM', value: 'slurm', description: 'Submit via SLURM on HPC cluster' },
        { label: 'Docker', value: 'docker', description: 'Run in a Docker container' },
      ],
      group: 'infrastructure',
      order: 0,
    },
    {
      id: 'slurmPartition',
      name: 'SLURM Partition',
      description: 'Target SLURM partition for job submission',
      type: 'string',
      required: false,
      default: 'gpu',
      placeholder: 'gpu',
      visibleWhen: {
        parameterId: 'executionStrategy',
        operator: 'equals',
        value: 'slurm',
      },
      group: 'infrastructure',
      order: 1,
    },
    {
      id: 'gpuCount',
      name: 'GPU Count',
      description: 'Number of GPUs to request per training job',
      type: 'number',
      required: false,
      default: 1,
      validation: { min: 0, max: 8, message: '0-8 GPUs' },
      group: 'infrastructure',
      order: 2,
    },
    {
      id: 'trackingTool',
      name: 'Experiment Tracking',
      description: 'Tool for logging metrics and artifacts',
      type: 'select',
      required: false,
      default: 'wandb',
      options: [
        { label: 'Weights & Biases', value: 'wandb', description: 'W&B for experiment tracking' },
        { label: 'MLflow', value: 'mlflow', description: 'MLflow tracking server' },
        { label: 'TensorBoard', value: 'tensorboard', description: 'TensorBoard logging' },
        { label: 'None', value: 'none', description: 'Console/file logging only' },
      ],
      group: 'tracking',
      order: 0,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────
  prompts: {
    planGeneration: `You are a senior ML engineer planning a training pipeline.

## Experiment Specification
- Experiment: {{experimentName}}
- ML Task: {{task}}
- Dataset: {{dataDescription}}
- Framework: {{framework}}
- Execution: {{executionStrategy}}
- GPUs: {{gpuCount}}
- Tracking: {{trackingTool}}

## Planning Guidelines

Decompose this ML pipeline into a DAG of tasks and milestones:

1. **Milestone Structure**:
   - Data Preparation (loading, cleaning, splitting, feature engineering)
   - Model Development (architecture, loss function, training loop)
   - Training & Evaluation (train, validate, test, metrics)
   - Results & Artifacts (model export, reports, documentation)

2. **Task Granularity**:
   - Data exploration and EDA as one task
   - Data preprocessing and augmentation as separate tasks
   - Model architecture definition as one task
   - Training script as one task (the actual training is compute, not coding)
   - Evaluation and metrics as one task
   - Experiment tracking integration as one task

3. **Parallelism**:
   - Data tasks are sequential (each builds on the previous)
   - Model architecture can be developed in parallel with advanced data preprocessing
   - Training depends on both data and model being ready
   - Evaluation depends on training completion

4. **Labels**: Use l2=Backend (data pipeline code), l3=Testing (evaluation), l5=Research (EDA, architecture decisions).

5. **Verification**: Use "auto" for data pipeline tasks (checksum, row counts). Use "human" for model architecture decisions and final evaluation.`,

    taskExecution: `You are implementing part of an ML training pipeline: {{experimentName}}.

Framework: {{framework}}. Task type: {{task}}.

Follow these ML engineering standards:
- Set random seeds for reproducibility (torch.manual_seed, np.random.seed)
- Use data loaders with proper batching and shuffling
- Log all hyperparameters at the start of training
- Save checkpoints periodically during training
- Use validation set for hyperparameter tuning, test set only for final evaluation
- Write clean, documented code with type hints
- Use pathlib for file paths, not string concatenation
- Handle CUDA/MPS device detection gracefully`,

    sharedContext: `ML engineering best practices:
- Always split data into train/val/test before any preprocessing that uses statistics
- Normalize features using statistics from the training set only
- Use early stopping to prevent overfitting
- Report confidence intervals or standard deviations for metrics
- Version control data processing scripts and model configs
- Document all hyperparameter choices`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'json_schema',
    description: 'Training results reported as structured JSON for experiment tracking.',
    schema: {
      type: 'object',
      properties: {
        experimentName: { type: 'string' },
        metrics: {
          type: 'object',
          properties: {
            trainLoss: { type: 'number' },
            valLoss: { type: 'number' },
            testMetric: { type: 'number' },
            metricName: { type: 'string' },
          },
          required: ['trainLoss', 'valLoss', 'testMetric', 'metricName'],
        },
        hyperparameters: { type: 'object' },
        artifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              path: { type: 'string' },
              type: { type: 'string', enum: ['model', 'config', 'plot', 'data'] },
            },
          },
        },
        status: { type: 'string', enum: ['success', 'partial', 'failure'] },
      },
      required: ['experimentName', 'metrics', 'status'],
    },
    example: `{
  "experimentName": "bert-finetuning-v2",
  "metrics": {
    "trainLoss": 0.234,
    "valLoss": 0.312,
    "testMetric": 0.891,
    "metricName": "f1_score"
  },
  "hyperparameters": {
    "learningRate": 2e-5,
    "batchSize": 32,
    "epochs": 10,
    "optimizer": "AdamW"
  },
  "artifacts": [
    { "name": "best_model", "path": "outputs/best_model.pt", "type": "model" },
    { "name": "training_curves", "path": "outputs/curves.png", "type": "plot" }
  ],
  "status": "success"
}`,
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 2,
    autoDispatch: true,
    defaultPriority: 'high',
    retry: {
      maxRetries: 1,
      retryDelayMs: 10000,
      exponentialBackoff: false,
    },
    machineSelectionPolicy: 'label-match',
    requiredMachineLabels: ['gpu'],
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    maxTurns: 50,
    maxBudgetPerTask: 10.0,
    deliveryMode: 'branch',
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 6, max: 12 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      { title: 'Data Ready', description: 'Data loaded, cleaned, split, and preprocessed' },
      { title: 'Model Defined', description: 'Architecture, loss, optimizer configured' },
      { title: 'Training Complete', description: 'Model trained, best checkpoint saved' },
      { title: 'Results Documented', description: 'Metrics, plots, and artifacts exported' },
    ],
    commonLabels: ['l2', 'l3', 'l5'],
    preferParallelTasks: false,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['ml-ai', 'data-engineering', 'scientific-computing'],
  recommendedSkills: [],
  source: 'builtin',
  enabled: true,
}
