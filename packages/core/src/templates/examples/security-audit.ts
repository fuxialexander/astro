/**
 * Example: Security Audit Template
 *
 * Demonstrates sequential analysis workflows, human-verification emphasis,
 * structured report output, and security-focused task decomposition.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const securityAuditTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro--security-audit',
  name: 'Security Audit',
  description:
    'Comprehensive security audit covering dependency vulnerabilities, code analysis, secrets detection, authentication review, and security best practices. Generates a structured security report with findings categorized by severity.',
  category: 'security',
  version: '1.0.0',
  icon: '🔒',
  tags: ['security', 'audit', 'vulnerabilities', 'compliance', 'sast'],
  maturity: 'beta',

  // ── Parameters ────────────────────────────────────────────────────────
  requiredParameters: [
    {
      id: 'targetDescription',
      name: 'Audit Target',
      description: 'What application or system are we auditing? Describe its purpose and tech stack.',
      type: 'string',
      required: true,
      placeholder: 'Node.js REST API with PostgreSQL database, handling user authentication and payment processing',
      validation: { min: 20, max: 1000 },
      group: 'target',
      order: 0,
    },
    {
      id: 'auditScope',
      name: 'Audit Scope',
      description: 'What areas should the audit cover?',
      type: 'multi-select',
      required: true,
      default: ['dependencies', 'code', 'secrets', 'auth'],
      options: [
        { label: 'Dependencies', value: 'dependencies', description: 'npm/pip/cargo audit, outdated packages' },
        { label: 'Code Analysis', value: 'code', description: 'Static analysis, code patterns, input validation' },
        { label: 'Secrets', value: 'secrets', description: 'Detect hardcoded secrets, API keys, credentials' },
        { label: 'Authentication', value: 'auth', description: 'Auth flow review, session handling, password policy' },
        { label: 'Authorization', value: 'authz', description: 'Access control, role permissions, privilege escalation' },
        { label: 'Data Handling', value: 'data', description: 'Encryption, PII handling, data retention' },
        { label: 'Infrastructure', value: 'infra', description: 'Cloud config, network security, TLS' },
      ],
      group: 'scope',
      order: 0,
    },
  ],

  optionalParameters: [
    {
      id: 'complianceFrameworks',
      name: 'Compliance Frameworks',
      description: 'Regulatory frameworks to check against (optional)',
      type: 'multi-select',
      required: false,
      default: [],
      options: [
        { label: 'OWASP Top 10', value: 'owasp', description: 'OWASP Top 10 Web Application Security Risks' },
        { label: 'CWE/SANS Top 25', value: 'cwe25', description: 'CWE/SANS Top 25 Most Dangerous Software Weaknesses' },
        { label: 'PCI-DSS', value: 'pci', description: 'Payment Card Industry Data Security Standard' },
        { label: 'HIPAA', value: 'hipaa', description: 'Health Insurance Portability and Accountability Act' },
        { label: 'SOC 2', value: 'soc2', description: 'Service Organization Control 2' },
      ],
      group: 'compliance',
      order: 0,
    },
    {
      id: 'severityThreshold',
      name: 'Severity Threshold',
      description: 'Minimum severity to report (lower = more findings)',
      type: 'select',
      required: false,
      default: 'low',
      options: [
        { label: 'Critical Only', value: 'critical', description: 'Only report critical vulnerabilities' },
        { label: 'High+', value: 'high', description: 'High and critical findings' },
        { label: 'Medium+', value: 'medium', description: 'Medium, high, and critical findings' },
        { label: 'Low+', value: 'low', description: 'All findings including low severity' },
        { label: 'Informational', value: 'info', description: 'All findings plus informational notes' },
      ],
      group: 'reporting',
      order: 0,
    },
    {
      id: 'includeRemediations',
      name: 'Include Remediations',
      description: 'Should the report include remediation guidance?',
      type: 'boolean',
      required: false,
      default: true,
      group: 'reporting',
      order: 1,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────
  prompts: {
    planGeneration: `You are a senior security engineer planning a security audit.

## Audit Specification
- Target: {{targetDescription}}
- Scope: {{auditScope}}
- Compliance: {{complianceFrameworks}}
- Severity Threshold: {{severityThreshold}}
- Include Remediations: {{includeRemediations}}

## Planning Guidelines

Decompose this security audit into a DAG of analysis tasks:

1. **Milestone Structure**:
   - Discovery & Inventory (understand the codebase, dependencies, architecture)
   - Automated Scanning (dependency audit, SAST, secrets detection)
   - Manual Review (auth flows, access control, business logic)
   - Report Generation (findings compilation, severity assignment, remediations)

2. **Task Granularity**:
   - Dependency audit as one task (npm audit, pip-audit, cargo-audit)
   - Static analysis as one task (semgrep, ESLint security rules)
   - Secrets detection as one task (gitleaks, truffleHog)
   - Each manual review area (auth, authz, data handling) as separate tasks
   - Report compilation as the final task

3. **Parallelism**:
   - Discovery must complete before any analysis
   - Automated scans can run in parallel with each other
   - Manual reviews can run in parallel after discovery
   - Report generation depends on all analysis tasks

4. **Labels**: Use l4=Infrastructure for tooling, l5=Research for manual analysis.

5. **Verification**: Use "auto" for automated scans (tool output). Use "human" for ALL manual review tasks — security findings require expert validation.

IMPORTANT: Security audits should be methodical. Prefer sequential execution for manual reviews to maintain context between related areas.`,

    taskExecution: `You are conducting a security audit of: {{targetDescription}}.

Current audit scope: {{auditScope}}.

Security analysis guidelines:
- Document every finding with: description, severity (critical/high/medium/low/info), affected code/file, and evidence
- Use CVE IDs when referencing known vulnerabilities
- For secrets detection, NEVER include the actual secret in your output — use redacted placeholders
- Reference OWASP/CWE categories where applicable
- Consider both exploitability and impact when assigning severity
- Note false positives explicitly so they can be filtered

For automated tools:
- Run the tool with appropriate flags
- Parse output into structured findings
- Deduplicate similar findings
- Filter by severity threshold: {{severityThreshold}}

For manual review:
- Trace data flow from input to output
- Check for input validation at trust boundaries
- Verify error handling doesn't leak sensitive information
- Review crypto usage (algorithms, key management, randomness)`,

    sharedContext: `Security audit context:

Severity Definitions:
- Critical: Actively exploitable, no authentication required, direct access to sensitive data or systems
- High: Exploitable with some preconditions, significant impact
- Medium: Requires specific conditions or insider access, moderate impact
- Low: Minor security concern, defense-in-depth issue
- Info: Best practice recommendation, no direct security impact

Common Vulnerability Categories:
- Injection (SQL, NoSQL, OS command, LDAP)
- Broken Authentication (weak passwords, session fixation, credential stuffing)
- Sensitive Data Exposure (unencrypted PII, verbose errors, debug endpoints)
- XML External Entities (XXE)
- Broken Access Control (IDOR, privilege escalation, path traversal)
- Security Misconfiguration (default creds, verbose errors, missing headers)
- Cross-Site Scripting (XSS) (reflected, stored, DOM-based)
- Insecure Deserialization
- Using Components with Known Vulnerabilities
- Insufficient Logging & Monitoring`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'json_schema',
    description: 'Structured security audit report with categorized findings.',
    schema: {
      type: 'object',
      properties: {
        auditMetadata: {
          type: 'object',
          properties: {
            targetDescription: { type: 'string' },
            auditDate: { type: 'string', format: 'date' },
            auditor: { type: 'string' },
            scope: { type: 'array', items: { type: 'string' } },
            complianceFrameworks: { type: 'array', items: { type: 'string' } },
          },
          required: ['targetDescription', 'auditDate', 'scope'],
        },
        summary: {
          type: 'object',
          properties: {
            totalFindings: { type: 'integer' },
            bySeverity: {
              type: 'object',
              properties: {
                critical: { type: 'integer' },
                high: { type: 'integer' },
                medium: { type: 'integer' },
                low: { type: 'integer' },
                info: { type: 'integer' },
              },
            },
            riskRating: {
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low', 'minimal'],
            },
          },
          required: ['totalFindings', 'bySeverity', 'riskRating'],
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique finding ID (e.g., SEC-001)' },
              title: { type: 'string' },
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
              category: { type: 'string', description: 'e.g., OWASP A01, CWE-89' },
              description: { type: 'string' },
              affectedComponent: { type: 'string' },
              evidence: { type: 'string' },
              remediation: { type: 'string' },
              references: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'title', 'severity', 'description', 'affectedComponent'],
          },
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              priority: { type: 'string', enum: ['immediate', 'short-term', 'long-term'] },
              action: { type: 'string' },
              rationale: { type: 'string' },
            },
            required: ['priority', 'action'],
          },
        },
      },
      required: ['auditMetadata', 'summary', 'findings'],
    },
    example: `{
  "auditMetadata": {
    "targetDescription": "E-commerce API",
    "auditDate": "2025-02-26",
    "scope": ["dependencies", "code", "auth"]
  },
  "summary": {
    "totalFindings": 5,
    "bySeverity": { "critical": 1, "high": 2, "medium": 1, "low": 1, "info": 0 },
    "riskRating": "high"
  },
  "findings": [
    {
      "id": "SEC-001",
      "title": "SQL Injection in Search Endpoint",
      "severity": "critical",
      "category": "CWE-89 / OWASP A03",
      "description": "User input directly interpolated into SQL query without parameterization",
      "affectedComponent": "src/routes/search.ts:45",
      "evidence": "Query uses template literal: \`SELECT * FROM products WHERE name LIKE '%\${query}%'\`",
      "remediation": "Use parameterized queries or prepared statements",
      "references": ["https://owasp.org/www-community/attacks/SQL_Injection"]
    }
  ],
  "recommendations": [
    { "priority": "immediate", "action": "Fix SQL injection vulnerability", "rationale": "Actively exploitable" }
  ]
}`,
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 2,
    autoDispatch: true,
    defaultPriority: 'high',
    retry: {
      maxRetries: 1,
      retryDelayMs: 5000,
      exponentialBackoff: false,
    },
    machineSelectionPolicy: 'priority',
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    maxTurns: 40,
    maxBudgetPerTask: 8.0,
    deliveryMode: 'branch',
    defaultVerification: 'human',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 6, max: 10 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      { title: 'Discovery Complete', description: 'Codebase inventory and architecture understood' },
      { title: 'Scans Complete', description: 'Automated security scans finished' },
      { title: 'Reviews Complete', description: 'Manual security reviews finished' },
      { title: 'Report Delivered', description: 'Final security report with findings and remediations' },
    ],
    commonLabels: ['l4', 'l5'],
    preferParallelTasks: false,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['security', 'devops-infrastructure'],
  recommendedSkills: [],
  source: 'builtin',
  enabled: true,
}
