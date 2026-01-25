# Linear Issue Template

## Title Format

```
[coverage][<app-or-package>] <filename> <description>
```

**Examples:**
- `[coverage][actions-agent] executeAction.ts error handling branches`
- `[coverage][infra-claude] client.ts retry logic edge cases`
- `[coverage][research-agent] researchRoutes.ts authentication guards`

## Body Template

```markdown
## Prerequisites

**IMPORTANT:** Read `.claude/CLAUDE.md` before starting — contains CI and ownership rules.

## Branch Coverage Gap

**File:** `<full-relative-path>`
**Uncovered Lines:** <line-numbers>
**Branch Type:** <description of what the branch does>

## Code Context

\`\`\`typescript
// Lines <start>-<end>
<code-snippet>
\`\`\`

## Implementation Steps

1. Create branch from freshly fetched `development`:
   \`\`\`bash
   git fetch origin
   git checkout -b fix/INT-XXX-coverage-<filename> origin/development
   \`\`\`

2. **Investigate the uncovered branches:**
   - Read the source code to understand what each branch does
   - Determine if truly unreachable OR testable with proper setup

3. **If truly unreachable:**
   - Add entry to `.claude/skills/coverage/unreachable/<app-or-package>.md`
   - Follow the format in that file
   - Include CODE SNIPPET (not just line numbers)

4. **If testable:**
   - Write tests in `<test-file-path>`
   - Add necessary fake configuration if required

5. **Verify:**
   \`\`\`bash
   pnpm run ci:tracked
   \`\`\`
   This MUST pass before proceeding.

6. **Commit and push:**
   \`\`\`bash
   git add -A && git commit -m "[coverage] <description>"
   git push -u origin fix/INT-XXX-coverage-<filename>
   \`\`\`

7. **Create PR:**
   - If added exemptions, include "Unreachable Branches" section in PR
   - Link to this Linear issue

## Acceptance Criteria

- [ ] Branch is covered by test OR documented in unreachable file
- [ ] `pnpm run ci:tracked` passes locally
- [ ] PR CI checks pass
- [ ] No coverage threshold modifications
- [ ] PR links to this issue
```

## Label

Apply label: `coverage` (create if doesn't exist)

## Assignment

Leave unassigned — will be picked up via `/linear` workflow.
