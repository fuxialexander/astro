/**
 * Example: Code Documentation Generator Template
 *
 * Generates comprehensive documentation for codebases from GitHub repository URLs.
 * Demonstrates multi-phase analysis workflows with parallel documentation generation
 * for different aspects of the codebase (API reference, architecture, guides, etc.).
 *
 * The pipeline:
 * 1. Clone and analyze repository structure
 * 2. Extract code metadata (functions, classes, modules, dependencies)
 * 3. Generate documentation in parallel (API docs, architecture, guides, tutorials)
 * 4. Assemble final documentation site with navigation and search
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const codeDocumentationTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro--code-documentation',
  name: 'Code Documentation Generator',
  description:
    'Generate comprehensive documentation for any GitHub repository. Analyzes code structure, extracts API signatures, and produces a complete documentation suite including API reference, architecture overview, getting started guide, and tutorials. Outputs markdown files suitable for static site generators (Docusaurus, VitePress, MkDocs).',
  category: 'documentation',
  version: '1.0.0',
  icon: '📚',
  tags: ['documentation', 'api-reference', 'github', 'docusaurus', 'markdown', 'developer-docs'],
  maturity: 'beta',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'repoUrls',
      name: 'GitHub Repository URL(s)',
      description:
        'GitHub repository URL(s) to document. Supports public repositories. For multiple repositories, enter one URL per line - each will be processed as a separate parallel branch.',
      type: 'string',
      required: true,
      placeholder: 'https://github.com/owner/repo\nhttps://github.com/owner/another-repo',
      validation: {
        pattern: '^https?://github\\.com/.+',
        message: 'Must be a valid GitHub repository URL',
      },
      group: 'source',
      order: 0,
    },
    {
      id: 'language',
      name: 'Primary Language',
      description: 'Primary programming language of the codebase. Affects parsing strategies and documentation conventions.',
      type: 'select',
      required: true,
      default: 'typescript',
      options: [
        { label: 'TypeScript', value: 'typescript', description: 'TypeScript/JavaScript projects with type definitions' },
        { label: 'Python', value: 'python', description: 'Python projects with type hints and docstrings' },
        { label: 'Go', value: 'go', description: 'Go projects with godoc comments' },
        { label: 'Rust', value: 'rust', description: 'Rust projects with rustdoc comments' },
        { label: 'Java', value: 'java', description: 'Java projects with Javadoc' },
        { label: 'C/C++', value: 'cpp', description: 'C/C++ projects with Doxygen-style comments' },
        { label: 'Mixed/Other', value: 'mixed', description: 'Multi-language or other language projects' },
      ],
      group: 'source',
      order: 1,
    },
  ],

  optionalParameters: [
    {
      id: 'branch',
      name: 'Branch',
      description: 'Git branch to document. Defaults to the default branch (main/master).',
      type: 'string',
      required: false,
      placeholder: 'main',
      group: 'source',
      order: 2,
    },
    {
      id: 'docFormat',
      name: 'Documentation Format',
      description: 'Output format and structure for the generated documentation.',
      type: 'select',
      required: false,
      default: 'docusaurus',
      options: [
        { label: 'Docusaurus', value: 'docusaurus', description: 'React-based documentation site with sidebar navigation' },
        { label: 'VitePress', value: 'vitepress', description: 'Vue-powered static site generator optimized for docs' },
        { label: 'MkDocs', value: 'mkdocs', description: 'Python-based docs with Material theme' },
        { label: 'Plain Markdown', value: 'markdown', description: 'Standard markdown files with manual linking' },
        { label: 'GitBook', value: 'gitbook', description: 'GitBook-compatible structure with SUMMARY.md' },
      ],
      group: 'output',
      order: 0,
    },
    {
      id: 'docSections',
      name: 'Documentation Sections',
      description: 'Which documentation sections to generate. All sections can be generated in parallel.',
      type: 'multi-select',
      required: false,
      default: ['api', 'architecture', 'quickstart', 'contributing'],
      options: [
        { label: 'API Reference', value: 'api', description: 'Function/class/method documentation extracted from code' },
        { label: 'Architecture Overview', value: 'architecture', description: 'High-level system architecture and design patterns' },
        { label: 'Quick Start Guide', value: 'quickstart', description: 'Installation, setup, and basic usage examples' },
        { label: 'Tutorials', value: 'tutorials', description: 'Step-by-step tutorials for common use cases' },
        { label: 'Contributing Guide', value: 'contributing', description: 'Development setup, testing, and contribution workflow' },
        { label: 'FAQ', value: 'faq', description: 'Frequently asked questions based on issues/discussions' },
        { label: 'Changelog', value: 'changelog', description: 'Version history and migration guides' },
      ],
      group: 'content',
      order: 0,
    },
    {
      id: 'includeExamples',
      name: 'Include Examples',
      description: 'Extract and include code examples from the repository (from tests, examples directory, README snippets).',
      type: 'boolean',
      required: false,
      default: true,
      group: 'content',
      order: 1,
    },
    {
      id: 'audience',
      name: 'Target Audience',
      description: 'Who is the primary audience for this documentation?',
      type: 'select',
      required: false,
      default: 'developers',
      options: [
        { label: 'Developers', value: 'developers', description: 'Technical users integrating the library/tool' },
        { label: 'Contributors', value: 'contributors', description: 'Open source contributors wanting to modify the code' },
        { label: 'End Users', value: 'users', description: 'Non-technical users of a CLI/application' },
        { label: 'Mixed', value: 'mixed', description: 'Multiple audience types with clear sections for each' },
      ],
      group: 'content',
      order: 2,
    },
    {
      id: 'existingDocs',
      name: 'Existing Docs Behavior',
      description: 'How to handle existing documentation in the repository.',
      type: 'select',
      required: false,
      default: 'augment',
      options: [
        { label: 'Augment', value: 'augment', description: 'Keep existing docs and fill in gaps' },
        { label: 'Replace', value: 'replace', description: 'Generate fresh documentation, replacing existing' },
        { label: 'Reference Only', value: 'reference', description: 'Use existing docs as context but create new structure' },
      ],
      group: 'output',
      order: 1,
    },
    {
      id: 'maxDepth',
      name: 'API Documentation Depth',
      description: 'How deep to document the API hierarchy.',
      type: 'select',
      required: false,
      default: 'full',
      options: [
        { label: 'Public Only', value: 'public', description: 'Only exported/public APIs' },
        { label: 'Full', value: 'full', description: 'All public and protected APIs' },
        { label: 'Exhaustive', value: 'exhaustive', description: 'Include private/internal APIs (for contributors)' },
      ],
      group: 'content',
      order: 3,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────

  prompts: {
    planGeneration: `You are an expert technical writer generating documentation for GitHub repositories.

## Repository Specification
- Repository URL(s): {{repoUrls}}
- Primary Language: {{language}}
- Branch: {{branch}}

## Documentation Specification
- Format: {{docFormat}}
- Sections: {{docSections}}
- Include Examples: {{includeExamples}}
- Target Audience: {{audience}}
- Existing Docs: {{existingDocs}}
- API Depth: {{maxDepth}}

## Planning Guidelines

Decompose this documentation generation into a DAG of tasks and milestones. The output is a **complete documentation suite** structured for the chosen format.

### Target Output Structure

\`\`\`
docs/
  index.md                    # Landing page with project overview
  getting-started/
    installation.md           # Installation and setup
    quickstart.md             # Quick start guide
    configuration.md          # Configuration options
  guides/
    basic-usage.md            # Core concepts and basic usage
    advanced.md               # Advanced patterns
    tutorials/                # Step-by-step tutorials
  api/
    overview.md               # API design and conventions
    modules/                  # Per-module documentation
      module-a.md
      module-b.md
    classes/                  # Class documentation
    functions/                # Function documentation
  architecture/
    overview.md               # System architecture
    design-decisions.md       # Key design decisions
    data-flow.md              # Data flow diagrams
  contributing/
    development-setup.md      # Local development setup
    testing.md                # Testing guide
    pull-requests.md          # PR workflow
  reference/
    cli.md                    # CLI reference (if applicable)
    configuration.md          # Configuration reference
    faq.md                    # FAQ
    changelog.md              # Version history
  sidebar.js / _sidebar.md    # Navigation configuration
\`\`\`

### Milestone Structure

1. **Repository Analysis**
   - Clone repository and identify structure
   - Parse entry points (package.json, setup.py, Cargo.toml, etc.)
   - Identify public API surface and module boundaries
   - Catalog existing documentation and README content
   - Extract code examples from tests and examples directories

2. **Content Extraction** (parallelizable)
   - Extract API signatures and docstrings/comments
   - Analyze code patterns and architectural decisions
   - Identify common usage patterns from tests/examples
   - Parse issues/discussions for FAQ content (if available)
   - Extract dependency information and version constraints

3. **Documentation Generation** (main parallel phase)
   Each section from {{docSections}} runs as an independent parallel task:
   - Generate API Reference from extracted signatures
   - Generate Architecture Overview from code structure analysis
   - Generate Quick Start from README and examples
   - Generate Tutorials from test cases and examples
   - Generate Contributing Guide from dev config files
   - Generate FAQ from issues/common patterns
   - Generate Changelog from git history

4. **Assembly & Polish**
   - Create navigation structure (sidebar, table of contents)
   - Cross-link related documentation pages
   - Add search configuration
   - Validate all internal links
   - Generate landing page with project summary

### Task Granularity

- Repository cloning and structure analysis: 1 task
- Each documentation section: 1 task (these run in parallel)
- API reference may split into multiple tasks for large codebases
- Assembly and navigation: 1 task

### Parallelism

**Within a Single Repository:**
- Repository analysis must complete first
- All documentation sections can generate in parallel
- Assembly depends on all sections completing

**Multiple Repositories (Input Parallelization):**
If multiple repository URLs are provided (one per line):
- Each repository gets its own independent branch
- Branches are positioned side-by-side horizontally (x offset of 260)
- Each branch follows: Clone → Analyze → Generate Sections → Assemble
- Branches execute completely in parallel
- No merge task needed - each repo produces independent docs

### Language-Specific Considerations

For {{language}}:
${`- TypeScript: Use TypeDoc conventions, extract from .d.ts files, document type parameters
- Python: Use Sphinx/Google docstring format, extract from __init__.py exports
- Go: Use godoc conventions, document package-level and exported symbols
- Rust: Use rustdoc conventions, document public items and feature flags
- Java: Use Javadoc conventions, document public/protected members
- C/C++: Use Doxygen conventions, document header files`}

### Labels
- l2=Backend (code parsing, API extraction)
- l1=Frontend (documentation site, navigation)
- l5=Research (architecture analysis, pattern identification)

### Verification
- "auto" for structural tasks (file generation, link validation)
- "human" for content quality (accuracy, completeness, clarity)`,

    taskExecution: `You are generating documentation for a GitHub repository.

## Context
- Repository: {{repoUrls}}
- Language: {{language}}
- Format: {{docFormat}}
- Audience: {{audience}}
- Include Examples: {{includeExamples}}

## Documentation Standards

### Markdown Conventions
- Use ATX-style headers (# H1, ## H2, etc.)
- Include a brief description after each header
- Use code fences with language specifiers
- Add alt text to all images
- Use relative links for internal references

### API Documentation Format
For each function/method:
\`\`\`markdown
### \`functionName(param1, param2)\`

Brief description of what the function does.

**Parameters:**
- \`param1\` (Type): Description of first parameter
- \`param2\` (Type, optional): Description of second parameter

**Returns:**
- (Type): Description of return value

**Throws:**
- \`ErrorType\`: When this error occurs

**Example:**
\\\`\\\`\\\`{{language}}
// Example usage
const result = functionName('value', { option: true });
\\\`\\\`\\\`

**See Also:**
- [relatedFunction](#relatedfunction)
\`\`\`

### Architecture Documentation
- Include high-level diagrams (Mermaid format)
- Explain the "why" behind design decisions
- Document module boundaries and responsibilities
- Show data flow between components

### Code Examples
- Every public API should have at least one example
- Examples should be runnable (no pseudo-code)
- Include both simple and complex use cases
- Add comments explaining non-obvious steps

### Formatting for {{docFormat}}
${`- docusaurus: Use MDX, add frontmatter with sidebar_position
- vitepress: Use Vue components, add frontmatter with outline
- mkdocs: Use admonitions (!!!), add nav entries
- markdown: Use standard GFM with manual table of contents
- gitbook: Include page references in SUMMARY.md`}`,

    planRefinement: `You are refining a documentation generation plan for {{repoUrls}}.

The current plan targets {{language}} documentation in {{docFormat}} format for a {{audience}} audience.

The user may want to:
- Focus on specific modules or APIs (narrow scope)
- Change the documentation depth or audience level
- Add or remove documentation sections from {{docSections}}
- Modify the output format or structure
- Include additional code examples or tutorials
- Adjust the API depth (currently: {{maxDepth}})
- Change how existing docs are handled (currently: {{existingDocs}})

When the user suggests changes:
1. Identify which tasks/sections in the current plan are affected
2. Propose specific modifications to the task DAG (add, remove, or update nodes)
3. Estimate impact on documentation completeness and quality
4. Suggest whether new tasks need to be added or existing ones can be repurposed
5. Maintain the parallel structure — documentation sections should remain independent where possible`,

    sharedContext: `Code documentation generation context:

## Documentation Quality Principles
- **Accuracy**: Document actual behavior, not intended behavior
- **Completeness**: Cover all public APIs and common use cases
- **Clarity**: Use simple language, avoid jargon where possible
- **Examples**: Show, don't just tell - include working code
- **Searchability**: Use consistent terminology for discoverability
- **Freshness**: Ensure docs match the code at the specified branch/commit

## Code Analysis Strategies
- Parse AST for accurate signature extraction
- Extract JSDoc/docstrings/comments for descriptions
- Analyze test files for usage examples
- Examine issues/PRs for common pain points
- Check README for project overview and quick start
- Inspect package.json / setup.py / Cargo.toml for dependency docs

## Repository Structure Analysis
- Identify entry points (main, index, lib)
- Map module dependencies and internal architecture
- Find configuration files for setup docs
- Locate example directories (examples/, demo/, sample/)
- Parse CI config for build/test instructions
- Check for existing docs/ directory structure

## Common Documentation Gaps
- Missing installation prerequisites
- Undocumented environment variables
- No migration guides between versions
- Missing error handling examples
- Insufficient type documentation
- Undocumented CLI flags or configuration options

## Language-Specific Documentation Conventions

### TypeScript/JavaScript
- TypeDoc for API reference generation
- Extract from .d.ts files and JSDoc comments
- Document generic type parameters and utility types
- Show import paths clearly

### Python
- Sphinx/Google/NumPy docstring format
- Extract from __init__.py re-exports
- Document type hints and Optional parameters
- Include pip install instructions

### Go
- godoc conventions for package and function docs
- Document exported symbols only
- Show import paths and package structure

### Rust
- rustdoc conventions with /// doc comments
- Document trait implementations and feature flags
- Show cargo add instructions

## Mermaid Diagram Templates
Architecture diagram:
\`\`\`mermaid
graph TD
    A[Component A] --> B[Component B]
    A --> C[Component C]
    B --> D[Database]
\`\`\`

Sequence diagram:
\`\`\`mermaid
sequenceDiagram
    Client->>API: Request
    API->>DB: Query
    DB-->>API: Result
    API-->>Client: Response
\`\`\`

Class diagram:
\`\`\`mermaid
classDiagram
    class BaseClass {
        +method()
    }
    ChildClass --|> BaseClass
\`\`\`

Module dependency diagram:
\`\`\`mermaid
graph LR
    core --> utils
    api --> core
    cli --> api
    tests --> api
\`\`\``,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'markdown',
    description:
      'Complete documentation suite as markdown files organized for the chosen static site generator. Includes navigation configuration, cross-references, and search-optimized content.',
    example: `# Example: docs/api/core.md

---
sidebar_position: 1
title: Core Module
---

# Core Module

The core module provides the foundational utilities for the library.

## Functions

### \`createInstance(config)\`

Creates a new instance with the provided configuration.

**Parameters:**
- \`config\` (Config): Configuration object
  - \`name\` (string): Instance name
  - \`options\` (Options, optional): Additional options

**Returns:**
- (Instance): Configured instance ready for use

**Example:**

\`\`\`typescript
import { createInstance } from 'library';

const instance = createInstance({
  name: 'my-instance',
  options: { debug: true }
});
\`\`\`

**See Also:**
- [destroyInstance](#destroyinstance)
- [Configuration Guide](/guides/configuration)

---

## Classes

### \`Instance\`

Main instance class for interacting with the library.

\`\`\`typescript
class Instance {
  constructor(config: Config);
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Status;
}
\`\`\`

#### Methods

##### \`start()\`

Starts the instance and begins processing.

**Returns:** Promise<void>

**Throws:**
- \`AlreadyStartedError\`: If instance is already running`,
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 6,
    autoDispatch: true,
    defaultPriority: 'normal',
    retry: {
      maxRetries: 2,
      retryDelayMs: 5000,
      exponentialBackoff: true,
    },
    machineSelectionPolicy: 'priority',
  },

  // ── Input Parallelization ──────────────────────────────────────────────
  inputParallelization: {
    parameterId: 'repoUrls',
    splitStrategy: 'newline',
    mergeStrategy: 'individual',
    branchLabelFormat: 'Repo {{index}}: {{shortValue}}',
    maxBranches: 5,
    minInputsForParallel: 2,
    addMergeTask: false,
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    preferredModel: 'claude-sonnet-4-20250514',
    maxTurns: 40,
    maxBudgetPerTask: 6.0,
    deliveryMode: 'branch',
    skipSafetyCheck: false,
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 8, max: 16 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      {
        title: 'Repository Analyzed',
        description: 'Code structure understood, API surface identified, existing docs cataloged',
      },
      {
        title: 'Content Extracted',
        description: 'API signatures, docstrings, examples, and patterns extracted from codebase',
      },
      {
        title: 'Documentation Generated',
        description: 'All documentation sections written with examples and cross-references',
      },
      {
        title: 'Documentation Assembled',
        description: 'Navigation configured, links validated, search enabled, ready for deployment',
      },
    ],
    commonLabels: ['l2', 'l1', 'l5'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['web-development', 'systems-programming', 'devops-infrastructure'],
  recommendedSkills: [],
  source: 'builtin',
  enabled: true,
}
