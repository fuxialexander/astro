---
name: skill-onboarder
version: "1.0.0"
description: "This skill should be used when the user asks to import a skill from an external source, onboard a downloaded skill, validate an imported skill, write tests for a skill, create a cookbook entry for a skill, or adapt a third-party skill to the skills-lib format."
category: tools
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - WebFetch
---

# Skill Onboarder

## Goal
Import a Claude Code skill from an external source, validate it, fix issues, write targeted tests, and produce a cookbook entry — making the skill a first-class member of skills-lib.

## When to Use
- User wants to download and add a skill from another repository
- User has copied a SKILL.md into the repo and wants it validated and documented
- User asks to "onboard" or "import" or "integrate" a third-party skill
- User wants to write tests or a cookbook for an existing skill
- User asks how to adapt an external skill to the skills-lib format

## Related Skills
- [skill-creator](../../../.claude/skills/skill-creator/SKILL.md) — for writing skills from scratch instead of importing

## Inputs / Outputs

| Input | Type | Description |
|-------|------|-------------|
| source | string or URL | GitHub repo, directory path, or URL to the skill |
| skill_name | string | Kebab-case name for the skill |
| category | string | Target category: tools, prompts, daily, or research |

| Output | Type | Description |
|--------|------|-------------|
| Validated SKILL.md | file | Skill file passing all validation tests |
| .security-allow | file | Allowlist for accepted security findings (if needed) |
| Cookbook entry | file | Usage guide in cookbooks/ |
| Test report | text | Summary of test results and fixes applied |

## Workflow

### Phase 1: Acquire the Skill

Fetch the skill from its source. For a GitHub repo, use the API to download the SKILL.md and any associated files.

```python
# Example: download from GitHub
import subprocess
import json
import base64

def download_skill(owner, repo, skill_path, branch="main"):
    """Download a SKILL.md from a GitHub repository."""
    api_path = f"repos/{owner}/{repo}/contents/{skill_path}"
    result = subprocess.run(
        ["gh", "api", api_path, "--jq", ".content"],
        capture_output=True, text=True
    )
    content = base64.b64decode(result.stdout.strip()).decode("utf-8")
    return content
```

Place the skill into the correct category directory:

```
skills/<category>/<skill-name>/SKILL.md
```

If the skill has associated files (examples, references), copy those too:

```
skills/<category>/<skill-name>/
├── SKILL.md
├── examples/
│   └── example.py
└── references/
    └── docs.md
```

### Phase 2: Run Initial Validation

Run the full test suite against the imported skill to identify all issues:

```python
# Run from repo root
import subprocess

result = subprocess.run(
    ["pytest", "tests/", "-v", "--tb=short"],
    capture_output=True, text=True
)
print(result.stdout)
```

Collect the failures into categories. Common issues when importing skills from other repos:

**Format issues** — things that differ from the skills-lib schema:
- Missing `category` field in frontmatter (most common — many skill repos do not use this field)
- Missing `allowed-tools` field
- Missing required sections (Goal, When to Use, Workflow)
- Word count outside bounds

**Security findings** — patterns the scanner flags:
- `obj.compile()` method calls triggering the `compile()` rule (false positive)
- IP addresses in API URLs from documentation examples
- Version strings matching the IP regex (e.g., `3.1.2`)
- Token/credential placeholder strings

**Link failures** — broken cross-references:
- Links to sibling skills that were not imported
- Links using a different directory structure than skills-lib

**Syntax issues** — code blocks with problems:
- Code that uses features not available in the detected language
- Pseudo-code labeled as a real language

### Phase 3: Fix Format Issues

Add any missing frontmatter fields. The required fields are:

```yaml
---
name: skill-name          # Must match directory name, kebab-case
version: "1.0.0"          # Semver
description: "This skill should be used when..."
category: tools            # tools | prompts | daily | research
allowed-tools:             # List of Claude Code tools
  - Read
  - Write
---
```

If the source skill has extra frontmatter fields (like `dspy-compatibility`), keep them — the validator only checks for required fields, not against extras.

Add any missing required sections. At minimum:
- `## Goal` — one line
- `## When to Use` — bullet list
- `## Workflow` — step-by-step instructions

### Phase 4: Triage Security Findings

For each security finding, decide: is it a real threat or a false positive?

**Real threats** (must be fixed):
- `eval()` or `exec()` used to run user-provided strings
- Hardcoded credentials with real values
- Network calls to unknown external services
- File access outside the project directory

**Acceptable patterns** (add to allowlist):
- Method calls like `optimizer.compile()` that are not Python's `compile()` builtin
- IP addresses from official documentation (e.g., demo API servers)
- Placeholder credential strings used in examples

For acceptable patterns, create a `.security-allow` file in the skill directory:

```
# .security-allow
# Each line is a substring of a violation description to suppress.
# Document WHY each exception is safe.

# ColBERTv2 demo server from official DSPy docs
hardcoded IP address
```

### Phase 5: Fix Broken Links

For cross-references to skills that are not in the repo, you have three options:

1. **Import the linked skill too** — best if you plan to use it
2. **Remove the link** — replace with a text reference (no hyperlink)
3. **Replace with an external URL** — link to the source repo instead

Example fix — replacing a broken relative link with an external reference:

Before:
```markdown
- [DSPy Evaluation Suite](../dspy-evaluation-suite/SKILL.md)
```

After:
```markdown
- DSPy Evaluation Suite (see [OmidZamani/dspy-skills](https://github.com/OmidZamani/dspy-skills))
```

### Phase 6: Write a Cookbook Entry

Create a cookbook that shows how to actually use the imported skill. The cookbook should cover:

1. **What the skill does** — one paragraph summary
2. **Prerequisites** — what needs to be installed or configured
3. **Step-by-step usage** — concrete example with real inputs and expected outputs
4. **Composing with other skills** — how it fits into larger workflows
5. **Troubleshooting** — common issues and solutions

Template for a cookbook entry:

```markdown
# Using the <Skill Name> Skill

## What It Does
<One paragraph describing the skill's purpose and value.>

## Prerequisites
- List dependencies
- Configuration needed

## Usage

### Basic Example
<Walk through the simplest use case with concrete inputs.>

### Advanced Example
<Show a more complex scenario or composition with other skills.>

## Composing with Other Skills
<Describe how this skill connects to others in a pipeline.>

## Troubleshooting
| Problem | Solution |
|---------|----------|
| ... | ... |
```

Save the cookbook to `cookbooks/<number>_<skill-name>.md`, continuing the numbering sequence.

### Phase 7: Final Validation

Run the full test suite one more time. All tests should pass except for any intentionally deferred link fixes.

```python
import subprocess

result = subprocess.run(
    ["pytest", "tests/", "-v", "--tb=short"],
    capture_output=True, text=True
)

# Count results
lines = result.stdout.splitlines()
summary = [l for l in lines if "passed" in l or "failed" in l]
print("\n".join(summary))
```

Also run the preflight check:

```python
import subprocess

result = subprocess.run(
    ["python", "scripts/preflight.py", "skills/"],
    capture_output=True, text=True
)
print(result.stdout)
```

### Phase 8: Document the Import

Update the marketplace catalog in `.claude-plugin/marketplace.json` to include the new skill:

```python
import json
from pathlib import Path

marketplace = Path(".claude-plugin/marketplace.json")
data = json.loads(marketplace.read_text())
data["skills"].append({
    "name": "skill-name",
    "category": "tools",
    "path": "skills/tools/skill-name/SKILL.md",
    "source": "https://github.com/owner/repo",
    "imported": "2025-01-15"
})
marketplace.write_text(json.dumps(data, indent=2))
```

## Best Practices
- Always run the full test suite before and after making changes — this gives you a clear diff of what you fixed
- Keep `.security-allow` files minimal and well-documented — each exception should explain WHY it is safe
- When importing from a collection, check the Related Skills section and decide upfront which linked skills to import too
- Write the cookbook before you forget the import context — your notes during triage are the best source material
- Preserve extra frontmatter fields from the source — they may carry useful metadata (compatibility versions, tags, authorship)

## Limitations
- Cannot automatically determine if a security finding is a true positive or false positive — human judgment is required
- Broken links to skills outside the repo cannot be auto-resolved — you must decide whether to import, remove, or rewrite each link
- The word count check may be too strict for very focused skills — adjust `MIN_WORDS` in `test_skill_format.py` if needed
- TypeScript syntax validation requires `tsc` to be installed — it is skipped gracefully if unavailable
