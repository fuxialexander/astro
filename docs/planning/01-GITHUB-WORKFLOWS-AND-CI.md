# GitHub Workflows and CI/CD Improvements

## Current State

### Astro (1 active, 5 disabled)
- **Active**: `fly-deploy.yml` — Deploy to Fly.io on push to main
- **Disabled** (in `.github/workflows.disabled/`):
  - `ci.yml` — ESLint, TypeScript, build, test
  - `docker.yml` — Multi-platform Docker builds
  - `release.yml` — Semver releases
  - `security.yml` — CodeQL, npm audit
  - `deploy.yml` — Cloudflare Pages

### Agent Runner
- `docs/github-workflow.md` documents a `main`/`dev` branching strategy
- npm publishing to `@astroanywhere/agent` with `latest` and `next` dist-tags
- Branch protection: `main` requires 1 review, `dev` is open

### Additional Safety & Quality Workflows (Reference)
Other production-grade platforms commonly include comprehensive CI/CD patterns for code safety:
- **Code quality**: Automated linting and type checking
- **Testing**: Backend, E2E (Playwright), SDK, and demo testing
- **Security**: Container scanning (Trivy), SBOM generation, weekly vulnerability audits
- **AI-assisted**: Claude Code PR reviews, auto-issue creation from failed checks
- **Automation**: Round-robin reviewer assignment, backport, env template sync

These patterns inform the improvements proposed below.

## Proposed Improvements

### Phase 1: Re-enable Core CI (Week 1-2)

Re-enable the 5 disabled workflows with updates:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint
      - run: npm run build

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm test
```

### Phase 2: Security & Quality (Week 2-3)

1. **Security scanning**:
   - Re-enable CodeQL + npm audit
   - Add Trivy container scanning
   - Add SBOM generation

2. **AI-assisted PR reviews**:
   ```yaml
   # .github/workflows/ai-review.yml
   name: AI Review
   on: pull_request
   jobs:
     review:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - name: Claude Code Review
           run: |
             npx @anthropic-ai/claude-code review \
               --diff "$(gh pr diff ${{ github.event.pull_request.number }})"
   ```

3. **Reviewer assignment**: Auto-assign based on file paths

### Phase 3: Release Automation (Week 3-4)

1. **Semantic release**: Auto-version from conventional commits
2. **Changelog generation**: Auto-generate from commit messages
3. **npm publish**: Auto-publish agent-runner on `main` merge
4. **Docker image**: Multi-arch build and push to registry

### Phase 4: Agent Runner CI (Week 4-5)

Add dedicated agent-runner workflows:
- `agent-runner-ci.yml` — Lint + build + test on PR to dev
- `agent-runner-release.yml` — Version bump + npm publish on dev → main merge
- `agent-runner-integration.yml` — Full integration test with relay server

## Workflow Files to Create

| File | Trigger | Purpose |
|------|---------|---------|
| `ci.yml` | push, PR | Lint + build + test |
| `security.yml` | push, weekly | CodeQL, npm audit, Trivy |
| `ai-review.yml` | PR | Claude Code PR review |
| `release.yml` | push to main | Version bump + changelog |
| `docker.yml` | push to main | Multi-arch Docker build |
| `deploy.yml` | push to main | CF Pages + Fly.io deploy |
| `assign-reviewer.yml` | PR opened | Auto-assign reviewer |
| `agent-runner-ci.yml` | PR to dev | Agent runner lint + test |

## Priority

**High**: Re-enable `ci.yml` and `security.yml` — these are table stakes for enterprise customers.
**Medium**: AI review, release automation — improve developer velocity.
**Low**: Reviewer assignment, backport — nice-to-have for team scaling.

## AI Code Review Setup (Bedrock API)

The AI-assisted PR review workflow runs **on GitHub's servers** (GitHub Actions runners), not locally. This means the runner needs credentials to call an AI provider.

Since you use **AWS Bedrock API** (not direct Anthropic API keys), set up credentials as **GitHub repository secrets**:

### Required GitHub Secrets

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | IAM user or role access key |
| `AWS_SECRET_ACCESS_KEY` | `wJal...` | IAM secret key |
| `AWS_REGION` | `us-east-1` | Bedrock region (must have Claude models enabled) |

Set these in: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

### Updated AI Review Workflow (Bedrock)

```yaml
# .github/workflows/ai-review.yml
name: AI Review
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code

      - name: Claude Code Review
        env:
          # Bedrock credentials
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_REGION: ${{ secrets.AWS_REGION }}
          # Tell Claude Code to use Bedrock
          CLAUDE_CODE_USE_BEDROCK: "1"
        run: |
          DIFF=$(gh pr diff ${{ github.event.pull_request.number }})
          claude -p "Review this PR diff for bugs, security issues, and code quality. Be concise. Diff:\n\n$DIFF"
```

### Alternative: Self-Hosted Runner (Local)

If you prefer not to store AWS credentials in GitHub, use a **self-hosted runner** on a machine that already has Bedrock credentials configured:

```yaml
jobs:
  review:
    runs-on: self-hosted  # Your local machine with AWS credentials
    steps:
      - uses: actions/checkout@v4
      - name: Claude Code Review
        run: |
          DIFF=$(gh pr diff ${{ github.event.pull_request.number }})
          claude -p "Review this PR diff for bugs and security issues:\n\n$DIFF"
```

This avoids storing credentials in GitHub entirely — the runner uses the local machine's `~/.aws/credentials` or IAM role.

### IAM Policy (Minimum Required)

The IAM user/role needs Bedrock model invocation permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
    }
  ]
}
```
