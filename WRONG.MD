# Grammar and Writing Issues in README Files

This document summarizes grammar, punctuation, and style issues found in the README.md files across the repository.

---

## 1. `/README.md` (Main README)

### Issues Found:

1. **Line 46** - Inconsistent table capitalization
   - Issue: "Does NOT do" uses "NOT" in all caps inconsistently with the rest of the headers
   - Suggestion: Use "Does not do" for consistency

2. **Line 48** - Run-on sentence in table cell
   - Issue: "Renders pages, graphs, chat panels" could be clearer
   - Suggestion: "Renders pages, graphs, and chat panels"

3. **Line 49** - Missing article
   - Issue: "Prompt assembly" could benefit from an article
   - Suggestion: "Prompt assembly" is acceptable in terse table format, but "The prompt assembly" would be more formal

4. **Line 100** - Inconsistent punctuation in list
   - Issue: Feature list items inconsistently use colons after the bold text
   - Lines 100-108 use `: ` after bold text, which is correct and consistent (no issue here)

5. **Line 186** - Run-on sentence
   - Issue: "This runs device auth (opens a browser for verification) and starts the agent in foreground mode."
   - The parenthetical is fine, but the sentence is quite long
   - Suggestion: Consider splitting: "This runs device auth (opens a browser for verification). The agent starts in foreground mode."

6. **Line 204** - Awkward phrasing
   - Issue: "It will later be published as a standalone package"
   - Suggestion: "It will be published later as a standalone package" (clearer word order)

7. **Line 302** - Missing period consistency
   - Issue: "Ctrl+C sends SIGTERM for graceful shutdown." ends with period but the comment style varies
   - Note: This is minor and acceptable in code comments

8. **Line 490** - Redundant note formatting
   - Issue: "> **Important:**" uses both blockquote and bold, which may be excessive
   - Suggestion: Use just one: either `> Important:` or `**Important:**`

9. **Line 493** - Missing article
   - Issue: "Generate env profiles"
   - Suggestion: "Generate the env profiles" or "Generate environment profiles"

---

## 2. `/docs/design/README.md`

### Issues Found:

1. **Line 9** - Comma needed
   - Issue: "three processes, two operating modes, package layout, tech stack, communication protocols, event system"
   - This is a list and is grammatically correct, but could use "and" before the last item for formal writing
   - Suggestion: "three processes, two operating modes, package layout, tech stack, communication protocols, and event system"

2. **Line 10** - Missing "and" before last item
   - Issue: "routing, 18 Zustand stores, data persistence, API client, key components, data flow"
   - Suggestion: "routing, 18 Zustand stores, data persistence, API client, key components, and data flow"

3. **Line 11** - Missing "and" before last item
   - Issue: "startup sequence, 20 routes, middleware, data storage (Postgres schema), event system, dispatch engine, prompt templates, observability"
   - Suggestion: Add "and" before "observability"

4. **Line 12** - Missing "and" before last item
   - Issue: "CLI commands, WebSocket client, task executor, 4 provider adapters, 5 execution strategies, safety system, worktree/PR management, MCP integration, configuration"
   - Suggestion: Add "and" before "configuration"

5. **Line 13** - Missing "and" before last item
   - Issue: "protocol messages, machine registry, authentication (local vs server), horizontal scaling, event flow, protocol gaps"
   - Suggestion: Add "and" before "protocol gaps"

6. **Line 15** - Missing "and" before last item
   - Issue: "Project, PlanNode, PlanEdge, TaskExecution, Session, and more"
   - This one correctly uses "and" - no issue

7. **Line 16** - Missing "and" before last item
   - Issue: "project creation, plan generation, task execution, chat, steering, approvals, batch execution, branch pruning, device auth, procedure pipeline"
   - Suggestion: Add "and" before "procedure pipeline"

---

## 3. `/scripts/README.md`

### Issues Found:

1. **Line 9** - Capitalization inconsistency
   - Issue: "#### `demo-approval-flow.ts`" - the section uses filename as header without description
   - Suggestion: Add a brief title, e.g., "#### Demo Approval Flow (`demo-approval-flow.ts`)"

2. **Line 42** - Missing "the"
   - Issue: "Tests all components independently"
   - Suggestion: "Tests all components independently" is acceptable, but "Tests all the components independently" is slightly more formal

3. **Line 109** - Inconsistent dash usage
   - Issue: "**most comprehensive test**" - uses double asterisks correctly
   - Note: The em-dash "—" in the sentence is correct

4. **Line 193** - Unclear antecedent
   - Issue: "Check Node.js version (requires Node 18+)"
   - Suggestion: "Check the Node.js version (Node 18+ is required)" for clarity

5. **Line 198** - Passive voice could be clearer
   - Issue: "Indicates the system is correctly waiting for user input"
   - Suggestion: "This indicates that the system is correctly waiting for user input"

6. **Line 203** - Article needed
   - Issue: "Check browser console"
   - Suggestion: "Check the browser console"

7. **Line 208** - Article needed
   - Issue: "Check execution store"
   - Suggestion: "Check the execution store" or "Check that the execution store"

---

## Summary

| File | Issue Count | Severity |
|------|-------------|----------|
| `/README.md` | 9 | Minor |
| `/docs/design/README.md` | 6 | Minor (mostly serial comma) |
| `/scripts/README.md` | 7 | Minor |

**Total Issues: 22**

### Most Common Issues:

1. **Missing serial comma (Oxford comma)** - Lists often missing "and" before the final item
2. **Missing articles** - "the", "a", "an" sometimes omitted (common in technical writing)
3. **Inconsistent formatting** - Minor variations in emphasis and punctuation style

### Note:

Many of these issues are acceptable in technical documentation where brevity is valued. The README files are generally well-written and clear. The issues identified are mostly stylistic preferences rather than grammatical errors that would cause confusion.
