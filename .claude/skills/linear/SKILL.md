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

## Core Mandates (6 Essential Rules)

1. **Test Requirements First**: EVERY issue MUST have a "Test Requirements" section with specific test cases. No exceptions.
2. **Branch First**: EVERY task starts with branch from `origin/development`. Working on `main` = task failure.
3. **CI Gate**: `pnpm run ci:tracked` MUST pass before commit. NON-NEGOTIABLE.
4. **State Management**: Issues transition: Backlog → In Progress → In Review. Never skip states.
5. **Cross-Linking**: Every issue links Linear ↔ GitHub ↔ Sentry. PRs require `[INT-XXX]` in title.
6. **Never Assign Issues**: NEVER set `assignee`, `assigneeId`, or `delegate` on any Linear issue. Assignment is exclusively the user's responsibility. Enforced by PreToolUse hook.

---

### Execution Behaviors

| Behavior       | Rule                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| Fail Fast      | If Linear/GitHub/GCloud unavailable, STOP immediately                                |
| No Guessing    | When ambiguous, ASK the user                                                         |
| One at a Time  | Complete PR for each issue before starting next                                      |
| Checkpoint     | After issue completion, STOP and wait for instruction                                |
| Done Forbidden | Maximum agent state is "In Review" (never "QA" or "Done")                            |
| No Assignment  | NEVER set assignee or delegate on issues. User-only responsibility. Enforced by hook |
| 95% Coverage   | All listed tests MUST be implemented                                                 |
| Auto-Complete  | After implementation: CI → commit → push → PR → Linear. Never ask "Should I commit?" |

---

### Parent Execution Mode (Issues with Children)

When working on parent issues that have child subissues:

1. **Single Branch/PR**: One branch and one PR for the parent, covering all children
2. **Continuous Execution**: Execute ALL children without stopping between them
3. **PR Continuity**: Create PR early, update after EACH child with status
4. **Silent Transitions**: No "Next Step: INT-YYY" announcements between children

---

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

| Test | Endpoint/Function | Scenario        | Expected        |
| ---- | ----------------- | --------------- | --------------- |
| Name | What is tested    | Input/condition | Output/behavior |

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

### Note: Backlog → Todo Transition

**`/linear` (no args) queries "Todo" state**, but `create-issue.md` creates issues in **"Backlog" state**.

This gap is intentional:

- **Backlog**: Raw issues, may need triage/refinement
- **Todo**: Prioritized and ready for work

**To make an issue appear in `/linear` (no args) queue:**

1. Move issue from Backlog → Todo in Linear UI (manual triage), OR
2. Use `/linear INT-XXX` to work on a specific issue directly (bypasses queue)

> ⚠️ **Important:** Issues created via `/linear <description>` will NOT appear in the random queue until manually triaged to "Todo" state.

**Two-cycle pattern (cron mode):**

1. First invocation: `/linear INT-XXX` runs Phase 1, adds `code-task` label, STOPS
2. Second invocation: `/linear INT-XXX` runs Phase 2 (execution)

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

**Service account key location:** `~/.config/gcloud/sa-key.json`

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

## Query Safety (Context Overflow Prevention)

**CRITICAL:** Linear MCP can return massive payloads that crash context. Follow these rules strictly.

### Maximum Limits

| Query Type           | Max Limit | Reason                               |
| -------------------- | --------- | ------------------------------------ |
| Broad text search    | **10**    | Text search matches many issues      |
| Specific ID search   | 10        | Targeted, predictable size           |
| `parentId` query     | 20        | Known scope (children of one parent) |
| Status/state filter  | 10        | Can still match many issues          |
| No filter (list all) | **NEVER** | Unbounded, guaranteed overflow       |

### Safe vs Dangerous Queries

```typescript
// ❌ FORBIDDEN - broad search + high limit = context crash
list_issues({ query: 'tier', limit: 50 });
list_issues({ query: 'fix', limit: 50 });
list_issues({ limit: 100 });

// ✅ SAFE - specific issue ID
list_issues({ query: 'INT-445', limit: 10 });

// ✅ SAFE - query children by parentId
list_issues({ parentId: '<parent-uuid>', limit: 20 });

// ✅ SAFE - targeted state filter
list_issues({ state: 'Todo', team: 'IntexuraOS', limit: 10 });
```

### Finding Child Issues

**IMPORTANT:** `get_issue({ includeRelations: true })` does NOT return children.

It only returns: `blocks`, `blockedBy`, `relatedTo`, `duplicateOf`.

**To find children:**

```typescript
// Step 1: Get parent UUID
const parent = await get_issue({ id: 'INT-445' });

// Step 2: Query by parentId
const children = await list_issues({ parentId: parent.id, limit: 20 });
```

### If Context Overflows

1. Run `/clear` to reset context
2. Use specific issue ID queries only
3. Never retry the broad query that caused the crash

## GitHub Integration (Critical)

For PRs to appear as attachments in Linear UI:

1. **Branch name MUST contain Linear issue ID** - e.g., `fix/INT-123`
2. **PR title MUST contain Linear issue ID** - e.g., `[INT-123] Fix auth`

When both conditions are met, GitHub integration automatically attaches PR to Linear issue.

## Two-Phase Execution Model

All issue work follows a two-phase model (both interactive and worker modes):

| Phase   | Trigger               | Purpose             | Output                                                       |
| ------- | --------------------- | ------------------- | ------------------------------------------------------------ |
| Phase 1 | No `code-task` label  | Design & Validation | Enriched issue (in-place), subissues if complex, label added |
| Phase 2 | Has `code-task` label | Strict Execution    | Code, tests, PR, Linear "In Review"                          |

**Labels control phase:**

- `code-task` → Phase 2 (execute)
- `unclear` → Stop, await human review

**Phase 1 outputs (in-place on Linear issue):**

1. Enriched description with Unified Issue Template sections
2. Subissues with `code-task` label (if complex)
3. `code-task` or `unclear` label added to parent
4. Optional: Design doc PR for complex architectural decisions

See: [Two-Phase Execution Reference](reference/two-phase-execution.md)

## Verbose Transition Logging (MANDATORY)

**All workflow transitions MUST be printed for debugging purposes.**

### Log Format Reference

| Emoji | Category      | Usage                            |
| ----- | ------------- | -------------------------------- |
| 🔍    | FETCH/SEARCH  | Querying Linear API              |
| 🏷️    | LABELS        | Reading or adding labels         |
| 🔀    | ROUTING       | Phase/workflow routing decisions |
| 📋    | CREATED/FOUND | Issue creation or search results |
| 🎯    | SELECTED      | Issue selection from queue       |
| 📍    | STATE         | Linear state transitions         |
| 🔧    | PHASE 1       | Design & validation phase        |
| 🚀    | PHASE 2       | Execution phase                  |
| 🌿    | BRANCH        | Git branch operations            |
| ✅    | COMPLETE      | Phase/workflow completion        |
| ⏹️    | STOPPING      | Explicit workflow stop           |
| ❓    | UNCLEAR       | Issue needs clarification        |

### Examples

**Routing to Phase 2:**

```
🔍 FETCH: Getting issue INT-123 details...
🏷️ LABELS: ["feature", "code-task"]
🔀 ROUTING: INT-123 → Phase 2 (has code-task label)
```

**Phase 1 completion:**

```
🔧 PHASE 1: Starting Design & Validation for INT-456
📝 ENRICH: Updated issue with template sections
🏷️ LABEL: Adding 'code-task' label
✅ PHASE 1 COMPLETE: Issue enriched
⏹️ STOPPING: User must re-invoke for Phase 2
```

**Random todo selection:**

```
🔍 SEARCH: Looking for Todo issues in IntexuraOS...
📋 FOUND: 3 issues in Todo state
🎯 SELECTED: INT-789 "[bug] Fix auth" (priority: High)
🔀 ROUTING: Delegating to work-existing.md
```

## References

- Workflows: [`workflows/`](workflows/)
- Templates: [`templates/`](templates/)
- Reference: [`reference/`](reference/)
