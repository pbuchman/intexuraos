---
name: linear
description: Linear issue management with automatic workflow orchestration. Handles issue creation, state transitions, and automatic splitting of large plans into tiered child issues. Use when creating issues, tracking tasks, working on INT-XXX issues, or managing Linear workflow.
argument-hint: '[INT-XXX | task description | sentry-url]'
---

# Linear Issue Management

Manage Linear issues, branches, and PRs with enforced workflow and cross-linking.

**Team:** `IntexuraOS` — ALWAYS use this exact team name for all Linear API calls. Never guess.

**Project Key:** `INT-` (e.g., `INT-123`, `INT-144`). All issue references use generic `LIN-XXX` placeholders, but for this project always use `INT-XXX`.

## Usage

```
/linear                           # NON-INTERACTIVE: Pick random Todo issue
/linear <task description>        # Create new issue
/linear INT-123                   # Work on existing issue
/linear <sentry-url>              # Create issue from Sentry error
```

## Core Mandates

1. **Test Requirements First (QUALITY GATE)**: EVERY implementation issue MUST start with a "Test Requirements" section listing exact test cases in a table format. Issues without explicit test specifications are incomplete — do NOT create them.
2. **Branch First**: EVERY task MUST start with branch creation from `origin/development`. Task FAILS if work starts on `development` or `main`.
3. **Fail Fast**: If Linear, GitHub CLI, or GCloud are unavailable, STOP immediately
4. **No Guessing**: When issue type is ambiguous, ASK the user
5. **Cross-Linking**: Every issue MUST link between systems (Linear <-> GitHub <-> Sentry)
6. **CI Gate**: `pnpm run ci:tracked` MUST pass before PR creation — NON-NEGOTIABLE, no shortcuts
7. **State Management (MANDATORY)**: EVERY issue MUST transition through states: Backlog → In Progress (when starting) → In Review (when PR created). NEVER skip or delay state updates.
8. **One Issue at a Time**: Complete verification, commit, and PR for EACH issue before starting the next
9. **Checkpoint Pattern**: After completing an issue, STOP and wait for user instruction before proceeding
10. **Done Forbidden**: Never move issues to Done — maximum agent-controlled state is QA
11. **95% Coverage MINIMUM**: All tests listed in issues MUST be implemented. Do NOT simplify work.
12. **Parent Execution Mode**: When working on parent issues with children, execute ALL children continuously without stopping between them. Single branch and single PR for the parent.
13. **PR Continuity Pattern (Parent Issues)**: Create PR early (before first child), then after EACH child: commit → push → update PR description. PR description MUST list all children with status and maintain a progress log.

## Test Requirements Quality Gate

**Every implementation issue (features, bugs, refactors) MUST include test requirements as the FIRST section.**

This applies to:
- Parent issues
- ALL child issues created during splitting
- Standalone issues

### Required Format

```markdown
## Test Requirements (MANDATORY - implement first)

**Backend Tests (`apps/<service>/src/__tests__/`):**

| Test | Endpoint/Function | Scenario | Expected |
|------|-------------------|----------|----------|
| Name | What is tested | Input/condition | Output/behavior |

**Frontend Tests (if applicable):**
- Test case 1
- Test case 2
```

### Why This Matters

- LLM agents skip tests when not explicitly listed
- "Add tests" is too vague — specific test cases ensure coverage
- Test-first thinking catches design issues early
- Acceptance criteria without test specs are incomplete

## Invocation Detection

The skill automatically detects intent from input:

| Input Pattern                   | Type               | Workflow                                                 |
| ------------------------------- | ------------------ | -------------------------------------------------------- |
| `/linear` (no args)             | Random Todo        | [random-todo.md](workflows/random-todo.md)               |
| `/linear <task description>`    | Create New         | [create-issue.md](workflows/create-issue.md)             |
| `/linear INT-<number>`          | Work Existing      | [work-existing.md](workflows/work-existing.md)\*         |
| `/linear https://sentry.io/...` | Sentry Integration | [sentry-integration.md](workflows/sentry-integration.md) |

\*Routes to [parent-execution.md](workflows/parent-execution.md) if issue has child subissues

## Auto-Splitting Detection

For complex multi-step tasks, auto-splitting is triggered when:

1. Issue description has numbered phases (Phase 1, Phase 2...)
2. Issue description has >5 checkbox items
3. Issue description >2000 characters with clear sections
4. User explicitly says "split this into subtasks"

When detected, see: [plan-splitting.md](workflows/plan-splitting.md)

## Tool Verification (Fail Fast)

Before ANY operation, verify all required tools:

| Tool       | Verification Command         | Purpose          |
| ---------- | ---------------------------- | ---------------- |
| Linear MCP | `mcp__linear__list_teams`    | Issue management |
| GitHub CLI | `gh auth status`             | PR creation      |
| GCloud     | Service account verification | Firestore access |

### GCloud Verification

**Service account key location:** `~/personal/gcloud-claude-code-dev.json`

1. Check if credentials file exists
2. If `gcloud auth list` shows no active account, activate service account
3. Verify authentication

**You are NEVER "unauthenticated" if the service account key file exists.**

### Failure Handling

If ANY required tool is unavailable, **ABORT immediately**:

```
ERROR: /linear cannot proceed - <tool-name> unavailable

Required for: <purpose>
Fix: <fix-command>

Aborting.
```

## GitHub Integration (Critical)

For PRs to appear as attachments in Linear UI:

1. **Branch name MUST contain Linear issue ID** - e.g., `fix/INT-123`
2. **PR title MUST contain Linear issue ID** - e.g., `[INT-123] Fix auth`

When both conditions are met, GitHub integration automatically attaches PR to Linear issue.

## References

- Workflows: [`workflows/`](workflows/)
- Templates: [`templates/`](templates/)
- Reference: [`reference/`](reference/)
