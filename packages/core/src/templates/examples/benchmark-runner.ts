/**
 * Example: Benchmark Runner Template
 *
 * Runs model benchmarks with configurable models and evaluation suites.
 * Demonstrates parallel execution across multiple models and benchmarks,
 * with aggregation into comparison reports.
 *
 * The pipeline:
 * 1. Parse benchmark configuration and validate model access
 * 2. Set up evaluation environment and download datasets
 * 3. Run benchmarks in parallel (model × benchmark combinations)
 * 4. Collect and aggregate results
 * 5. Generate comparison report with analysis
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const benchmarkRunnerTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro--benchmark-runner',
  name: 'Benchmark Runner',
  description:
    'Run comprehensive benchmarks comparing multiple AI models across standardized evaluation suites. Supports LLM benchmarks (MMLU, HumanEval, GSM8K), vision benchmarks, and custom evaluations. Executes model × benchmark combinations in parallel and generates detailed comparison reports with statistical analysis.',
  category: 'machine-learning',
  version: '1.0.0',
  icon: '📊',
  tags: ['benchmark', 'evaluation', 'llm', 'comparison', 'metrics', 'leaderboard'],
  maturity: 'beta',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'models',
      name: 'Models to Evaluate',
      description:
        'Models to benchmark. Enter one model per line. Supports: OpenAI models (gpt-4o, gpt-4-turbo), Anthropic models (claude-3-opus, claude-sonnet-4-20250514), open-source models via API (llama-3-70b, mixtral-8x7b), or local model paths.',
      type: 'string',
      required: true,
      placeholder: 'gpt-4o\nclaude-sonnet-4-20250514\nllama-3-70b',
      validation: {
        min: 3,
        message: 'Enter at least one model name',
      },
      group: 'models',
      order: 0,
    },
    {
      id: 'benchmarks',
      name: 'Benchmarks',
      description: 'Evaluation benchmarks to run. Each benchmark tests specific capabilities.',
      type: 'multi-select',
      required: true,
      default: ['mmlu', 'humaneval'],
      options: [
        { label: 'MMLU', value: 'mmlu', description: 'Massive Multitask Language Understanding (57 subjects)' },
        { label: 'HumanEval', value: 'humaneval', description: 'Code generation from docstrings (Python)' },
        { label: 'GSM8K', value: 'gsm8k', description: 'Grade school math word problems' },
        { label: 'MATH', value: 'math', description: 'Competition mathematics problems' },
        { label: 'HellaSwag', value: 'hellaswag', description: 'Commonsense reasoning about situations' },
        { label: 'ARC', value: 'arc', description: 'AI2 Reasoning Challenge (science questions)' },
        { label: 'TruthfulQA', value: 'truthfulqa', description: 'Truthfulness and avoiding misinformation' },
        { label: 'MBPP', value: 'mbpp', description: 'Mostly Basic Python Problems' },
        { label: 'WinoGrande', value: 'winogrande', description: 'Commonsense reasoning (pronoun resolution)' },
        { label: 'BBH', value: 'bbh', description: 'Big-Bench Hard (23 challenging tasks)' },
      ],
      group: 'benchmarks',
      order: 0,
    },
  ],

  optionalParameters: [
    {
      id: 'customBenchmark',
      name: 'Custom Benchmark',
      description: 'Path to custom benchmark definition (JSON/YAML) or GitHub URL. See docs for format.',
      type: 'string',
      required: false,
      placeholder: 'https://github.com/org/benchmark-suite or ./benchmarks/custom.json',
      group: 'benchmarks',
      order: 1,
    },
    {
      id: 'evaluationMode',
      name: 'Evaluation Mode',
      description: 'How to run evaluations - affects speed vs thoroughness.',
      type: 'select',
      required: false,
      default: 'standard',
      options: [
        { label: 'Quick', value: 'quick', description: 'Subset sampling (100 examples per benchmark)' },
        { label: 'Standard', value: 'standard', description: 'Full benchmark with standard parameters' },
        { label: 'Thorough', value: 'thorough', description: 'Multiple runs for statistical significance' },
        { label: 'Custom', value: 'custom', description: 'Custom sample size and runs' },
      ],
      group: 'execution',
      order: 0,
    },
    {
      id: 'sampleSize',
      name: 'Sample Size',
      description: 'Number of examples per benchmark (for custom mode).',
      type: 'number',
      required: false,
      default: 500,
      validation: {
        min: 10,
        max: 10000,
        message: 'Sample size must be between 10 and 10,000',
      },
      visibleWhen: {
        parameterId: 'evaluationMode',
        operator: 'equals',
        value: 'custom',
      },
      group: 'execution',
      order: 1,
    },
    {
      id: 'numRuns',
      name: 'Number of Runs',
      description: 'Number of evaluation runs per model-benchmark pair (for variance estimation).',
      type: 'number',
      required: false,
      default: 1,
      validation: {
        min: 1,
        max: 10,
        message: 'Number of runs must be between 1 and 10',
      },
      visibleWhen: {
        parameterId: 'evaluationMode',
        operator: 'equals',
        value: 'custom',
      },
      group: 'execution',
      order: 2,
    },
    {
      id: 'temperature',
      name: 'Temperature',
      description: 'Sampling temperature for model inference.',
      type: 'select',
      required: false,
      default: '0',
      options: [
        { label: '0.0 (Deterministic)', value: '0', description: 'Greedy decoding, most reproducible' },
        { label: '0.3 (Low)', value: '0.3', description: 'Slight variation, mostly consistent' },
        { label: '0.7 (Medium)', value: '0.7', description: 'Balanced creativity and consistency' },
        { label: '1.0 (High)', value: '1.0', description: 'Maximum variation' },
      ],
      group: 'execution',
      order: 3,
    },
    {
      id: 'promptFormat',
      name: 'Prompt Format',
      description: 'How to format prompts for each model.',
      type: 'select',
      required: false,
      default: 'auto',
      options: [
        { label: 'Auto-detect', value: 'auto', description: 'Use model-specific formatting automatically' },
        { label: 'Chat', value: 'chat', description: 'Chat/instruction format with system message' },
        { label: 'Completion', value: 'completion', description: 'Raw completion format' },
        { label: 'Few-shot', value: 'few-shot', description: 'Include few-shot examples in prompt' },
      ],
      group: 'execution',
      order: 4,
    },
    {
      id: 'metrics',
      name: 'Additional Metrics',
      description: 'Extra metrics to compute beyond benchmark defaults.',
      type: 'multi-select',
      required: false,
      default: ['latency', 'cost'],
      options: [
        { label: 'Latency', value: 'latency', description: 'Response time (p50, p95, p99)' },
        { label: 'Cost', value: 'cost', description: 'API cost per benchmark' },
        { label: 'Token Usage', value: 'tokens', description: 'Input/output token counts' },
        { label: 'Confidence', value: 'confidence', description: 'Model confidence scores' },
        { label: 'Error Analysis', value: 'errors', description: 'Categorized error breakdown' },
      ],
      group: 'analysis',
      order: 0,
    },
    {
      id: 'reportFormat',
      name: 'Report Format',
      description: 'Format for the final comparison report.',
      type: 'select',
      required: false,
      default: 'markdown',
      options: [
        { label: 'Markdown', value: 'markdown', description: 'GitHub-flavored markdown with tables' },
        { label: 'HTML', value: 'html', description: 'Interactive HTML with charts' },
        { label: 'JSON', value: 'json', description: 'Structured JSON for programmatic access' },
        { label: 'LaTeX', value: 'latex', description: 'Publication-ready LaTeX tables' },
      ],
      group: 'output',
      order: 0,
    },
    {
      id: 'includeCharts',
      name: 'Include Charts',
      description: 'Generate visualization charts in the report.',
      type: 'boolean',
      required: false,
      default: true,
      group: 'output',
      order: 1,
    },
    {
      id: 'compareBaseline',
      name: 'Baseline Model',
      description: 'Model to use as baseline for relative comparisons.',
      type: 'string',
      required: false,
      placeholder: 'gpt-4o',
      group: 'analysis',
      order: 1,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────

  prompts: {
    planGeneration: `You are an expert ML engineer designing benchmark evaluation pipelines.

## Benchmark Specification
- Models: {{models}}
- Benchmarks: {{benchmarks}}
- Custom Benchmark: {{customBenchmark}}
- Evaluation Mode: {{evaluationMode}}
- Sample Size: {{sampleSize}}
- Number of Runs: {{numRuns}}
- Temperature: {{temperature}}
- Prompt Format: {{promptFormat}}
- Additional Metrics: {{metrics}}
- Report Format: {{reportFormat}}
- Include Charts: {{includeCharts}}
- Baseline Model: {{compareBaseline}}

## Planning Guidelines

Decompose this benchmark run into a DAG of tasks and milestones. The key parallelization opportunity is running model × benchmark combinations concurrently.

### Target Output Structure

\`\`\`
benchmark-results/
  config/
    benchmark-config.yaml     # Full configuration used
    model-configs/            # Per-model inference configs
  results/
    raw/                      # Raw evaluation outputs
      {model}/{benchmark}/    # Per model-benchmark results
    aggregated/
      by-model.json           # Results grouped by model
      by-benchmark.json       # Results grouped by benchmark
  analysis/
    summary-stats.json        # Aggregated statistics
    error-analysis.json       # Error categorization
    latency-analysis.json     # Timing analysis
  report/
    comparison-report.md      # Main comparison report
    charts/                   # Visualization assets
    tables/                   # Standalone tables
  logs/
    execution.log             # Detailed execution log
    errors.log                # Error traces
\`\`\`

### Milestone Structure

1. **Environment Setup**
   - Validate model access (API keys, endpoints)
   - Download/prepare benchmark datasets
   - Set up evaluation harness
   - Configure logging and result collection

2. **Benchmark Execution** (main parallel phase)
   - For each (model, benchmark) pair:
     - Configure model-specific prompt format
     - Run evaluation with {{evaluationMode}} settings
     - Collect raw outputs and metrics
     - Handle rate limits and retries
   - All combinations can run in parallel (up to rate limits)

3. **Result Aggregation**
   - Collect all raw results
   - Compute per-model aggregate scores
   - Compute per-benchmark rankings
   - Calculate statistical significance (if multiple runs)
   - Generate error categorization

4. **Report Generation**
   - Generate comparison tables
   - Create visualization charts (if {{includeCharts}})
   - Compute relative performance vs baseline
   - Write analysis and insights
   - Format final report ({{reportFormat}})

### Task Granularity

**Parallelization Strategy:**
- Parse models: Split {{models}} by newline to get model list
- Create one task per (model, benchmark) combination
- Example: 3 models × 4 benchmarks = 12 parallel evaluation tasks
- Group small benchmarks if < 5 combinations total

**Task Breakdown:**
- Environment setup: 1-2 tasks (validation, dataset prep)
- Evaluation: 1 task per (model, benchmark) pair — HIGHLY PARALLEL
- Aggregation: 1 task
- Report generation: 1 task

### Parallelism Constraints

- API rate limits may constrain true parallelism
- Same-provider models share rate limits
- Consider staggering requests to avoid 429s
- Local models limited by GPU memory

### Evaluation Specifics by Benchmark

${`MMLU: 57 subjects, multiple choice, accuracy metric
HumanEval: 164 Python problems, pass@k metric, execute code
GSM8K: 8.5K math problems, exact match after parsing
MATH: 12.5K competition math, LaTeX parsing required
HellaSwag: 10K examples, 4-way multiple choice
ARC: Easy (2.3K) and Challenge (1.1K) splits
TruthfulQA: MC1 and MC2 accuracy, generation mode optional
MBPP: 500 Python problems, pass@k metric
WinoGrande: 1.3K pronoun resolution, accuracy
BBH: 23 tasks, CoT prompting recommended`}

### Labels
- l3=Testing (benchmark execution)
- l5=Research (analysis, insights)
- l2=Backend (API calls, data processing)

### Verification
- "auto" for benchmark execution (deterministic with temp=0)
- "human" for analysis quality and insight generation`,

    taskExecution: `You are running model benchmarks.

## Context
- Models: {{models}}
- Benchmarks: {{benchmarks}}
- Temperature: {{temperature}}
- Prompt Format: {{promptFormat}}
- Evaluation Mode: {{evaluationMode}}

## Execution Standards

### API Call Best Practices
- Always handle rate limits with exponential backoff
- Log all requests and responses for debugging
- Validate responses before marking success
- Track token usage for cost calculation

### Benchmark-Specific Instructions

**Code Execution Benchmarks (HumanEval, MBPP):**
- Execute generated code in sandboxed environment
- Capture stdout, stderr, and exceptions
- Timeout after 30 seconds per problem
- Report pass@1, pass@10, pass@100 if sampling

**Multiple Choice (MMLU, ARC, HellaSwag):**
- Extract answer letter from response
- Handle various response formats (A, (A), "A", etc.)
- Log when parsing fails for manual review

**Math Benchmarks (GSM8K, MATH):**
- Parse numeric answers from natural language
- Normalize units and formats
- Handle LaTeX in MATH problems

### Result Format
\`\`\`json
{
  "model": "model-name",
  "benchmark": "benchmark-name",
  "config": {
    "temperature": 0,
    "prompt_format": "chat",
    "sample_size": 500
  },
  "results": {
    "accuracy": 0.85,
    "pass_at_1": 0.72,
    "correct": 425,
    "total": 500
  },
  "metrics": {
    "latency_p50_ms": 230,
    "latency_p95_ms": 450,
    "total_tokens": 150000,
    "cost_usd": 2.50
  },
  "errors": {
    "rate_limit": 3,
    "timeout": 1,
    "parse_failure": 5
  },
  "timestamp": "2026-02-27T10:00:00Z"
}
\`\`\`

### Chart Generation (Mermaid)
Comparison bar chart:
\`\`\`mermaid
xychart-beta
    title "MMLU Accuracy by Model"
    x-axis ["GPT-4o", "Claude 3.5", "Llama 3"]
    y-axis "Accuracy (%)" 0 --> 100
    bar [86, 88, 79]
\`\`\`

Radar chart for multi-benchmark:
\`\`\`mermaid
%%{init: {"radar": {"chartWidth": 400}}}%%
radar
    title "Model Capabilities"
    series ["GPT-4o", "Claude 3.5"]
    axis ["MMLU", "HumanEval", "GSM8K", "MATH"]
    "GPT-4o" => [86, 67, 92, 53]
    "Claude 3.5" => [88, 72, 95, 58]
\`\`\``,

    planRefinement: `You are refining a benchmark run plan. The user may want to:

- Add or remove models from the comparison
- Select different benchmarks
- Change evaluation parameters (sample size, runs)
- Focus on specific capability areas
- Adjust parallelism for rate limit constraints

When the user suggests changes:
1. Identify which tasks are affected
2. Recalculate the model × benchmark matrix
3. Estimate runtime and cost impact
4. Propose specific modifications`,

    sharedContext: `Benchmark evaluation context:

## Standard Benchmark References

| Benchmark | Size | Metric | Notes |
|-----------|------|--------|-------|
| MMLU | 14K | Accuracy | 57 subjects, 5-shot standard |
| HumanEval | 164 | pass@k | Python code generation |
| GSM8K | 8.5K | Accuracy | Grade school math, CoT helps |
| MATH | 12.5K | Accuracy | Competition math, LaTeX |
| HellaSwag | 10K | Accuracy | Commonsense, 4-way MC |
| ARC-C | 1.1K | Accuracy | Science reasoning |
| TruthfulQA | 817 | MC1/MC2 | Factual accuracy |
| MBPP | 500 | pass@k | Basic Python |
| WinoGrande | 1.3K | Accuracy | Pronoun resolution |
| BBH | 6.5K | Accuracy | 23 hard tasks, CoT |

## Model API Endpoints

OpenAI: https://api.openai.com/v1/chat/completions
Anthropic: https://api.anthropic.com/v1/messages
Together AI: https://api.together.xyz/v1/completions
Anyscale: https://api.endpoints.anyscale.com/v1/chat/completions

## Cost Estimation (per 1M tokens, approx)
- GPT-4o: $2.50 input, $10 output
- Claude 3.5 Sonnet: $3 input, $15 output
- GPT-4 Turbo: $10 input, $30 output
- Llama 3 70B (Together): $0.90 input, $0.90 output

## Statistical Significance
- For comparing models: Use paired bootstrap
- Report 95% confidence intervals
- Min 3 runs recommended for tight CIs
- Consider effect size, not just p-value

## Common Issues
- Rate limits: Implement backoff, consider batching
- Parsing failures: Log and manually review
- Cost overruns: Monitor token usage
- Variance: Use temp=0 or multiple runs`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'markdown',
    description:
      'Comprehensive benchmark comparison report with performance tables, statistical analysis, charts, and insights. Raw results available in JSON for programmatic access.',
    example: `# Benchmark Comparison Report

**Generated:** 2026-02-27
**Models Evaluated:** GPT-4o, Claude 3.5 Sonnet, Llama 3 70B
**Benchmarks:** MMLU, HumanEval, GSM8K, MATH

## Executive Summary

| Model | MMLU | HumanEval | GSM8K | MATH | Avg |
|-------|------|-----------|-------|------|-----|
| GPT-4o | 86.4% | 67.0% | 92.0% | 52.9% | 74.6% |
| Claude 3.5 | **88.3%** | **72.0%** | **95.0%** | **58.1%** | **78.4%** |
| Llama 3 70B | 79.5% | 61.6% | 83.0% | 42.5% | 66.7% |

**Winner:** Claude 3.5 Sonnet leads on all benchmarks.

## Detailed Results

### MMLU (Massive Multitask Language Understanding)

Measures broad knowledge across 57 academic subjects.

| Model | Accuracy | CI (95%) | Samples |
|-------|----------|----------|---------|
| Claude 3.5 | 88.3% | ±0.8% | 14042 |
| GPT-4o | 86.4% | ±0.9% | 14042 |
| Llama 3 70B | 79.5% | ±1.0% | 14042 |

**By Category:**
- STEM: Claude 3.5 (87.1%) > GPT-4o (84.2%) > Llama 3 (76.8%)
- Humanities: Claude 3.5 (89.2%) > GPT-4o (88.1%) > Llama 3 (81.2%)
- Social Sciences: GPT-4o (88.5%) > Claude 3.5 (88.2%) > Llama 3 (80.1%)

### HumanEval (Code Generation)

164 Python programming problems.

| Model | pass@1 | pass@10 | Latency (p50) |
|-------|--------|---------|---------------|
| Claude 3.5 | 72.0% | 86.0% | 1.2s |
| GPT-4o | 67.0% | 82.0% | 0.9s |
| Llama 3 70B | 61.6% | 75.0% | 2.1s |

## Cost Analysis

| Model | Total Tokens | Cost (USD) | $/1K samples |
|-------|--------------|------------|--------------|
| GPT-4o | 2.1M | $12.50 | $0.45 |
| Claude 3.5 | 2.3M | $18.00 | $0.65 |
| Llama 3 70B | 2.0M | $3.60 | $0.13 |

## Key Insights

1. **Claude 3.5 Sonnet shows consistent leadership** across all evaluated benchmarks, with particularly strong performance on code generation (+5% over GPT-4o).

2. **Cost-performance tradeoff**: Llama 3 70B offers 5x lower cost but trails by ~12% average accuracy.

3. **Math remains challenging**: All models score below 60% on competition math (MATH), indicating room for improvement.

## Recommendations

- **Best overall**: Claude 3.5 Sonnet
- **Best value**: Llama 3 70B (if 12% accuracy drop acceptable)
- **Fastest inference**: GPT-4o

---

*Full raw results available in \`results/raw/\`*`,
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 10,
    autoDispatch: true,
    defaultPriority: 'normal',
    retry: {
      maxRetries: 3,
      retryDelayMs: 30000, // Higher delay for rate limits
      exponentialBackoff: true,
    },
    machineSelectionPolicy: 'round-robin',
  },

  // ── Input Parallelization ──────────────────────────────────────────────
  inputParallelization: {
    parameterId: 'models',
    splitStrategy: 'newline',
    mergeStrategy: 'aggregate',
    branchLabelFormat: 'Model: {{shortValue}}',
    maxBranches: 8,
    minInputsForParallel: 2,
    addMergeTask: true,
    mergeTaskDescription: 'Aggregate all model results and generate comparison report',
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    preferredModel: 'claude-sonnet-4-20250514',
    maxTurns: 60,
    maxBudgetPerTask: 15.0, // Higher budget for benchmark runs
    deliveryMode: 'branch',
    skipSafetyCheck: false,
    defaultVerification: 'auto', // Benchmarks have deterministic answers
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 8, max: 25 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      {
        title: 'Environment Ready',
        description: 'Model access validated, datasets downloaded, harness configured',
      },
      {
        title: 'Benchmarks Complete',
        description: 'All model × benchmark evaluations finished, raw results collected',
      },
      {
        title: 'Results Aggregated',
        description: 'Statistics computed, rankings determined, errors analyzed',
      },
      {
        title: 'Report Generated',
        description: 'Comparison tables and charts generated, insights written',
      },
    ],
    commonLabels: ['l3', 'l5', 'l2'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['ml-ai', 'systems-programming', 'data-engineering'],
  recommendedSkills: [],
  source: 'builtin',
  enabled: true,
}
