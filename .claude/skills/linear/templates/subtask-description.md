# Subtask Description Template

Template for child issues created during plan splitting.

---

## Parent Execution Mode Variant

When child issues are executed via the **parent execution workflow** (invoked with `/linear INT-<parent>`), include this header at the top of the description:

````markdown
## 🚨 PARENT EXECUTION MODE

This issue is part of **parent issue execution**. The workflow:

1. Executes ALL children in tier order continuously
2. Does **NOT** stop between children
3. Creates **ONE PR** for the parent issue
4. Uses **ONE branch** named after the parent

**DO NOT STOP** after completing this task — the parent execution loop continues automatically to the next child.

---
````

**When to use:** Add this variant when the subtask will be executed as part of a parent issue batch, not as a standalone issue.

---

## Template

````markdown
## 🚨 MANDATORY EXECUTION RULES (NON-NEGOTIABLE)

### Branch Creation — TASK FAILS WITHOUT THIS

**YOU MUST CREATE A NEW BRANCH BEFORE ANY WORK.** This is not optional.

```bash
git fetch origin
git checkout -b feature/INT-XXX origin/development
```

If you start working on `development` or `main`, **THE TASK HAS FAILED BY DEFINITION**. Stop immediately and create the branch.

### Full CI Verification — NON-NEGOTIABLE

**`pnpm run ci:tracked` MUST pass before marking this task complete.**

- Running only `vitest` or `tsc` is NOT sufficient
- Running only workspace-level checks is NOT sufficient
- The ONLY acceptable verification is `pnpm run ci:tracked` passing locally
- If CI fails, fix ALL errors (even in other workspaces) — you OWN them

### Test Coverage — 95% is MINIMUM, Not Target

- You MUST implement ALL required tests listed in this issue
- 95% branch coverage is the MINIMUM acceptable threshold
- Do NOT simplify work to save tokens or time
- Do NOT skip edge cases or "nice to have" tests
- Every test scenario mentioned MUST be implemented

### Continuation — MANDATORY

**After completing this task, you MUST IMMEDIATELY proceed to the next task.**

- Do NOT wait for user input
- Do NOT stop to ask if you should continue
- Do NOT claim you need a break or fresh context
- Commit, verify CI passes, then MOVE ON to the next issue

---

## Context

Part of: [Parent Title](PARENT_ISSUE_URL)
Tier: X | Sequence: Y

## Scope

<Extracted from parent plan - what this specific task covers>

## Requirements

- <Specific requirement 1>
- <Specific requirement 2>

## Acceptance Criteria

- [ ] <Criterion 1>
- [ ] <Criterion 2>
- [ ] <Criterion 3>

## Dependencies

**Blocked By:**

- [INT-XXX](url) - <dependency description>

**Blocks:**

- [INT-XXX](url) - <what this enables>

## Verification Commands

```bash
<commands to verify this task is complete>
```

## Implementation Suggestions

> ⚠️ **Point-in-Time Accuracy:** Code snippets below reflect codebase state at issue creation (YYYY-MM-DD).
> Before implementing, verify file contents match these assumptions.

### Current Implementation

**File:** `<path/to/file.ts>` (lines XX-YY)

```typescript
// Current code that will be replaced/modified
```

### Target Implementation

```typescript
// Suggested new code
```

### Pre-Flight Verification

Before implementing, confirm:

- [ ] File exists at specified path
- [ ] Line numbers roughly match (±10 lines acceptable)
- [ ] Dependencies/imports are available
- [ ] Type signatures haven't changed

## Testing Scenarios

### Unit Tests

```typescript
// Example test structure
describe('featureName', () => {
  it('should handle valid input', () => {
    /* ... */
  });
});
```

### Edge Cases to Cover

1. <Edge case 1>
2. <Edge case 2>
3. ...
````

## Notes

<Implementation hints, gotchas, or context from parent plan>

---

## 🚨 AFTER COMPLETION — MANDATORY NEXT STEPS

1. ✅ Verify `pnpm run ci:tracked` passes (NON-NEGOTIABLE)
2. ✅ Commit all changes with message: `INT-XXX <task description>`
3. ✅ **IMMEDIATELY proceed to INT-YYY** — DO NOT STOP

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next unblocked task without waiting for user input.

````

## Mandatory Sections

| Section                  | Required     | Purpose                                    |
| ------------------------ | ------------ | ------------------------------------------ |
| Context                  | Yes          | Links to parent, shows tier/sequence       |
| Scope                    | Yes          | What this specific task covers             |
| Requirements             | Yes          | Specific deliverables                      |
| Acceptance Criteria      | Yes          | How to verify completion                   |
| Dependencies             | Yes          | What blocks this / what this blocks        |
| Verification             | Yes          | Commands to run                            |
| Implementation Suggestions | Conditional | Required for code changes (see below)     |
| Testing Scenarios        | Conditional  | Required when tests are expected           |
| Continuation             | Varies       | Include for all except final task          |

## When to Include Implementation Suggestions

**ALWAYS include** for tasks involving:

- Migrations (schema, validation, API)
- Refactors (renaming, restructuring)
- Bug fixes (showing current vs expected behavior)
- New features with specific code locations

**May omit** for:

- Documentation-only tasks
- Configuration changes
- Pure research/investigation tasks

## Tier Context Line

Always include tier and sequence in context section:

```markdown
Tier: 0 | Sequence: 1
````

This helps quickly identify:

- **Tier 0**: Setup/prerequisite work
- **Tier 1**: Independent deliverables
- **Tier 2**: Integration work
- **Tier 3+**: Verification/finalization

## Continuation Directive

**Include for all subtasks EXCEPT the final one.**

The continuation directive ensures uninterrupted execution through the entire task series. The final task omits this to allow natural completion and user review.

```markdown
---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next unblocked task without waiting for user input.
```
