# New Use Case Templates: Legal, Research, and Enterprise

## Proposed New Templates

### 1. Immigration Petition Letters (Priority: High — Enterprise Demo Value)

**Template ID**: `astro/immigration-petition`

#### H-1B Petition Letters

A structured template for generating H-1B petition support letters:

```typescript
const h1bPetitionTemplate: UseCaseTemplate = {
  id: 'astro/h1b-petition',
  name: 'H-1B Petition Support Letter',
  description: 'Generate comprehensive H-1B petition support letters with specialized occupation analysis',
  category: 'documentation',
  version: '1.0.0',
  icon: 'scale',
  tags: ['immigration', 'legal', 'h1b', 'petition'],

  parameters: {
    required: [
      {
        id: 'beneficiaryName',
        name: 'Beneficiary Name',
        type: 'string',
        description: 'Full legal name of the H-1B beneficiary',
      },
      {
        id: 'jobTitle',
        name: 'Job Title',
        type: 'string',
        description: 'Proposed job title (must align with specialty occupation)',
      },
      {
        id: 'petitionType',
        name: 'Petition Type',
        type: 'select',
        description: 'Type of H-1B petition',
        options: [
          { label: 'Initial', value: 'initial' },
          { label: 'Extension', value: 'extension' },
          { label: 'Amendment', value: 'amendment' },
          { label: 'Transfer', value: 'transfer' },
        ],
      },
      {
        id: 'companyProfile',
        name: 'Company Profile',
        type: 'textarea',
        description: 'Company description, size, revenue, industry',
      },
      {
        id: 'jobDescription',
        name: 'Job Description',
        type: 'textarea',
        description: 'Detailed job duties, responsibilities, and required qualifications',
      },
      {
        id: 'beneficiaryResume',
        name: 'Beneficiary Resume/CV',
        type: 'textarea',
        description: 'Education, work experience, publications, awards',
      },
    ],
    optional: [
      {
        id: 'specialtyOccupation',
        name: 'Specialty Occupation Analysis',
        type: 'select',
        description: 'Level of specialty occupation analysis',
        options: [
          { label: 'Standard', value: 'standard' },
          { label: 'Detailed (for RFE)', value: 'detailed' },
        ],
      },
      {
        id: 'wageLevel',
        name: 'Prevailing Wage Level',
        type: 'select',
        options: [
          { label: 'Level 1', value: '1' },
          { label: 'Level 2', value: '2' },
          { label: 'Level 3', value: '3' },
          { label: 'Level 4', value: '4' },
        ],
      },
      {
        id: 'additionalEvidence',
        name: 'Additional Supporting Evidence',
        type: 'textarea',
        description: 'Expert letters, industry reports, comparable position data',
      },
    ],
  },

  prompts: {
    planGeneration: `Generate a comprehensive plan for an H-1B petition support letter package.

The petition is for {{beneficiaryName}} for the position of {{jobTitle}} ({{petitionType}} petition).

Company Profile:
{{companyProfile}}

Job Description:
{{jobDescription}}

Beneficiary Background:
{{beneficiaryResume}}

Create a plan with these key sections:
1. **Specialty Occupation Analysis** — Prove the position qualifies as a specialty occupation under 8 CFR 214.2(h)(4)(ii)
2. **Beneficiary Qualification Analysis** — Demonstrate the beneficiary meets specialty occupation requirements
3. **Employer-Employee Relationship** — Establish the petitioner's right of control
4. **Job Duties Mapping** — Map duties to O*NET/OOH classifications
5. **Wage Level Justification** — Explain wage level selection with DOL LCA data
6. **Support Letter Draft** — The actual petition support letter
7. **Expert Opinion Letter Template** — Template for advisory opinion letters
8. **RFE Preemptive Arguments** — Address common RFE issues proactively`,

    taskExecution: `You are drafting immigration petition documents. Follow these guidelines:
- Use formal legal language appropriate for USCIS adjudicators
- Cite relevant statutes, regulations, and case law (Matter of Simeio, Defensor v. Meissner, etc.)
- Reference O*NET codes, OOH classifications, and DOL data
- Structure arguments using the specialty occupation four-prong test
- Include specific facts, metrics, and evidence references
- Address potential weaknesses proactively`,
  },

  planHints: {
    targetNodeCount: { min: 6, max: 10 },
    suggestedMilestones: [
      { title: 'Analysis Complete', description: 'All research and analysis tasks finished' },
      { title: 'Drafts Ready', description: 'All letter drafts complete and reviewed' },
    ],
    preferParallelTasks: true,
  },
}
```

#### Green Card (EB-1/EB-2 NIW) Petition Letters

Similar template for employment-based green card petitions:

```typescript
const greenCardPetitionTemplate: UseCaseTemplate = {
  id: 'astro/green-card-petition',
  name: 'Green Card Petition Package',
  description: 'Generate EB-1A/EB-1B/EB-2 NIW petition support materials',
  category: 'documentation',
  version: '1.0.0',

  parameters: {
    required: [
      {
        id: 'petitionCategory',
        name: 'Petition Category',
        type: 'select',
        options: [
          { label: 'EB-1A Extraordinary Ability', value: 'eb1a' },
          { label: 'EB-1B Outstanding Researcher', value: 'eb1b' },
          { label: 'EB-2 NIW National Interest Waiver', value: 'eb2-niw' },
          { label: 'EB-2 PERM', value: 'eb2-perm' },
        ],
      },
      {
        id: 'beneficiaryCV',
        name: 'Beneficiary CV',
        type: 'textarea',
        description: 'Complete academic and professional CV with publications, citations, awards',
      },
      {
        id: 'fieldOfExpertise',
        name: 'Field of Expertise',
        type: 'string',
        description: 'Specific field or subfield of expertise',
      },
      {
        id: 'proposedEndeavor',
        name: 'Proposed Endeavor (for NIW)',
        type: 'textarea',
        description: 'Description of the work the beneficiary will pursue in the US',
        visibleWhen: { parameterId: 'petitionCategory', operator: 'equals', value: 'eb2-niw' },
      },
    ],
  },

  prompts: {
    planGeneration: `Generate a plan for a {{petitionCategory}} green card petition.

For EB-1A, analyze against the 10 criteria (awards, membership, published material, judging, original contributions, scholarly articles, exhibitions, leading roles, high salary, commercial success).

For EB-2 NIW, analyze under the Dhanasar framework:
1. Substantial merit and national importance
2. Well-positioned to advance the endeavor
3. Balance of factors favoring waiver of job offer

Create parallel tasks for:
- Each qualifying criterion/prong
- Reference letter templates (5-8 recommenders)
- Citation and publication analysis
- Personal statement draft`,
  },

  inputParallelization: {
    parameterId: 'recommendersInfo',
    splitStrategy: 'newline',
    mergeStrategy: 'individual',
    branchLabelFormat: 'Recommender {{index}}: {{input}}',
    addMergeTask: true,
    mergeTaskDescription: 'Compile all reference letters and cross-reference claims',
  },
}
```

### 2. Academic Paper Writing (Priority: High)

**Template ID**: `astro/paper-writing`

```typescript
const paperWritingTemplate: UseCaseTemplate = {
  id: 'astro/paper-writing',
  name: 'Research Paper Writer',
  description: 'Structured academic paper writing with literature review, methodology, and results',
  category: 'research-analysis',
  version: '1.0.0',

  parameters: {
    required: [
      { id: 'paperTitle', name: 'Paper Title', type: 'string' },
      { id: 'abstract', name: 'Abstract/Summary', type: 'textarea' },
      { id: 'venue', name: 'Target Venue', type: 'string',
        description: 'Conference or journal (e.g., NeurIPS, Nature, ICML)' },
      { id: 'paperType', name: 'Paper Type', type: 'select',
        options: [
          { label: 'Conference Paper', value: 'conference' },
          { label: 'Journal Article', value: 'journal' },
          { label: 'Workshop Paper', value: 'workshop' },
          { label: 'Technical Report', value: 'report' },
        ]},
      { id: 'keyFindings', name: 'Key Findings/Contributions', type: 'textarea' },
      { id: 'experimentData', name: 'Experiment Details', type: 'textarea',
        description: 'Methods, datasets, baselines, results tables/numbers' },
    ],
    optional: [
      { id: 'relatedWork', name: 'Key Related Papers', type: 'textarea',
        description: 'List of key papers to cite and compare against' },
      { id: 'codeRepo', name: 'Code Repository', type: 'string',
        description: 'GitHub URL for supplementary code' },
      { id: 'templateFormat', name: 'LaTeX Template', type: 'select',
        options: [
          { label: 'NeurIPS 2025', value: 'neurips' },
          { label: 'ICML 2025', value: 'icml' },
          { label: 'ACL 2025', value: 'acl' },
          { label: 'IEEE', value: 'ieee' },
          { label: 'Nature', value: 'nature' },
          { label: 'Custom', value: 'custom' },
        ]},
    ],
  },

  prompts: {
    planGeneration: `Create a plan for writing a {{paperType}} targeting {{venue}}.

Title: {{paperTitle}}
Abstract: {{abstract}}
Key Findings: {{keyFindings}}

Generate parallel tasks for:
1. **Literature Survey** — Search and summarize 15-30 relevant papers
2. **Introduction Draft** — Motivation, problem statement, contributions
3. **Related Work** — Categorized comparison with existing approaches
4. **Methodology** — Technical approach description
5. **Experiments** — Results tables, ablation studies, analysis
6. **Discussion** — Limitations, broader impact, future work
7. **Figures and Tables** — Generate LaTeX figures and result tables
8. **Abstract Refinement** — Polish abstract to match final content
9. **Appendix** — Supplementary material, proofs, additional results`,

    taskExecution: `You are writing an academic paper. Follow these guidelines:
- Use precise, formal academic language
- Support claims with citations
- Use LaTeX for equations and formatting
- Follow the venue's style guide strictly
- Include quantitative comparisons with baselines
- Discuss statistical significance where applicable`,
  },

  planHints: {
    targetNodeCount: { min: 8, max: 15 },
    preferParallelTasks: true,
    suggestedMilestones: [
      { title: 'Literature Review Complete', description: 'All related work surveyed and organized' },
      { title: 'First Draft', description: 'All sections have initial content' },
      { title: 'Camera Ready', description: 'Final polished version' },
    ],
  },
}
```

### 3. Paper Review Writing (Priority: High)

**Template ID**: `astro/paper-review`

```typescript
const paperReviewTemplate: UseCaseTemplate = {
  id: 'astro/paper-review',
  name: 'Academic Paper Reviewer',
  description: 'Generate structured peer reviews for academic papers',
  category: 'research-analysis',
  version: '1.0.0',

  parameters: {
    required: [
      { id: 'workingDirectory', name: 'Working Directory', type: 'string',
        description: 'Path to directory containing the paper file(s)' },
      { id: 'venue', name: 'Review Venue', type: 'string',
        description: 'Conference/journal this review is for' },
      { id: 'reviewStyle', name: 'Review Style', type: 'select',
        options: [
          { label: 'Constructive (recommend improvements)', value: 'constructive' },
          { label: 'Critical (identify weaknesses)', value: 'critical' },
          { label: 'Balanced (standard review)', value: 'balanced' },
        ]},
    ],
    optional: [
      { id: 'reviewerExpertise', name: 'Your Expertise Level', type: 'select',
        options: [
          { label: 'Expert (published 5+ papers in area)', value: 'expert' },
          { label: 'Knowledgeable (familiar with area)', value: 'knowledgeable' },
          { label: 'Non-expert (outside main area)', value: 'non-expert' },
        ]},
      { id: 'reviewCriteria', name: 'Review Criteria', type: 'multi-select',
        options: [
          { label: 'Novelty', value: 'novelty' },
          { label: 'Correctness', value: 'correctness' },
          { label: 'Clarity', value: 'clarity' },
          { label: 'Significance', value: 'significance' },
          { label: 'Reproducibility', value: 'reproducibility' },
          { label: 'Ethical considerations', value: 'ethics' },
        ]},
    ],
  },

  prompts: {
    planGeneration: `Create a plan for reviewing the submitted paper for {{venue}}.

Review style: {{reviewStyle}}

Generate tasks for:
1. **Paper Summary** — 2-3 paragraph summary of contributions
2. **Strengths Analysis** — Identify and articulate key strengths
3. **Weaknesses Analysis** — Identify and explain weaknesses with evidence
4. **Technical Correctness Check** — Verify proofs, experiments, claims
5. **Related Work Assessment** — Check coverage of relevant literature
6. **Clarity and Presentation** — Evaluate writing quality, figures, organization
7. **Questions for Authors** — Specific questions to clarify unclear points
8. **Overall Assessment** — Score, confidence, and recommendation
9. **Detailed Comments** — Line-by-line or section-by-section feedback`,
  },

  inputParallelization: {
    parameterId: 'paperLink',
    splitStrategy: 'newline',
    mergeStrategy: 'individual',
    branchLabelFormat: 'Paper {{index}}',
    maxBranches: 10,
  },
}
```

### 4. Additional Enterprise Templates

**Compliance Document Generator** (`astro/compliance-doc`)
- SOC 2 compliance documentation
- GDPR data processing assessments
- ISO 27001 policy templates

**RFP Response Writer** (`astro/rfp-response`)
- Parse RFP requirements
- Generate structured responses
- Map capabilities to requirements
- Executive summary generation

**Technical Architecture Review** (`astro/arch-review`)
- Input: GitHub repo + deployment config
- Output: Architecture review document with recommendations

## Implementation Plan

### Phase 1: Core Templates (Week 1-2)

1. Create `astro/h1b-petition` template
2. Create `astro/green-card-petition` template
3. Create `astro/paper-writing` template
4. Create `astro/paper-review` template

Files to create:
```
packages/core/src/templates/examples/
├── h1b-petition.ts
├── green-card-petition.ts
├── paper-writing.ts
└── paper-review.ts
```

### Phase 2: Supporting Skills (Week 2-3)

Create skills in skills-lib that these templates reference:
```
skills-lib/skills/research/
├── academic-writing/SKILL.md
├── literature-search/SKILL.md
└── paper-review/SKILL.md

skills-lib/skills/tools/
├── arxiv-fetcher/SKILL.md
├── latex-writing/SKILL.md
└── legal-document-writing/SKILL.md
```

### Phase 3: Frontend Template Selector (Week 3-4)

Build a template selection UI in the "New Project" flow:
- Template browser with categories
- Parameter form generation from template schema
- Preview of generated prompts
- One-click launch

### Phase 4: Validation and Testing (Week 4-5)

- End-to-end tests for each template
- Parameter validation coverage
- Prompt interpolation tests
- Output quality assessment
