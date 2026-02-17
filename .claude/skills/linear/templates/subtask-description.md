# Subtask Description Template

Template for child issues created during plan splitting.

---

## Parent Execution Mode Variant

When child issues are executed via the **parent execution workflow** (invoked with `/linear INT-<parent>`), include this header at the top of the description:

```markdown
## 🚨 PARENT EXECUTION MODE

This issue is part of **parent issue execution**. The workflow:

1. Executes ALL children in tier order continuously
2. Does **NOT** stop between children
3. Creates **ONE PR** for the parent issue
4. Uses **ONE branch** named after the parent

**DO NOT STOP** after completing this task — the parent execution loop continues automatically to the next child.

---
```

**When to use:** Add this variant when the subtask will be executed as part of a parent issue batch, not as a standalone issue.

---

## Template

`````markdown
## Test Requirements (MANDATORY - implement first)

**Backend Tests (`apps/<service>/src/__tests__/`):**

| Test        | Endpoint/Function | Scenario          | Expected          |
| ----------- | ----------------- | ----------------- | ----------------- |
| <test name> | <what is tested>  | <input/condition> | <output/behavior> |
| ...         | ...               | ...               | ...               |

**Frontend Tests (if applicable):**

- <test case 1>
- <test case 2>

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

- [ ] All tests in Test Requirements table pass
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

## Mandatory Sections

| Section                    | Required    | Purpose                                       |
| -------------------------- | ----------- | --------------------------------------------- |
| Test Requirements          | Yes         | **QUALITY GATE** - exact tests to implement   |
| Context                    | Yes         | Links to parent, shows tier/sequence          |
| Scope                      | Yes         | What this specific task covers                |
| Requirements               | Yes         | Specific deliverables                         |
| Acceptance Criteria        | Yes         | How to verify completion (includes tests)     |
| Dependencies               | Yes         | What blocks this / what this blocks           |
| Verification               | Yes         | Commands to run                               |
| Implementation Suggestions | Conditional | Required for code changes (see below)         |
| Continuation               | Varies      | Include for all except final task             |

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
```

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
````
`````
