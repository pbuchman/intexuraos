# Linear Issue Templates for Tech Debt Triage

## Parent Issue Template

Use this template for the top-level Linear issue created in Step 7.

```markdown
## Tech Debt Triage Report

**Analysis date:** <YYYY-MM-DD>
**Severity levels included:** <Critical, High, Medium, Low>

### Scan Summary

| Metric                    | Count |
| ------------------------- | ----- |
| Files scanned             | <N>   |
| Individual issues found   | <N>   |
| Consolidated into groups  | <N>   |
| User-approved for action  | <N>   |
| Subtasks created          | <N>   |

### Source

All findings are based on `technical-debt.md` documentation files located in:
- `docs/services/*/technical-debt.md` (apps + workers)
- `docs/packages/*/technical-debt.md` (shared packages)

Documentation was assumed current at time of analysis. No source code was inspected.

### Approved Subtasks

<numbered list of approved subtask titles with severity>

### Execution Notes

- Each subtask is self-contained and ready for `/linear INT-XXX` execution
- Subtasks reference their source `technical-debt.md` files
- No fix designs are included — agents must analyze code before implementing
- After fixes are applied, update the corresponding `technical-debt.md` to reflect resolved status
```

## Subtask Issue Template

Use this template for each child issue created in Step 8.

```markdown
## Test Requirements (MANDATORY - implement first)

**Backend Tests:**

| Test Name          | Endpoint/Function | Scenario              | Expected                |
| ------------------ | ----------------- | --------------------- | ----------------------- |
| <to be determined> | <affected code>   | <based on debt scope> | <correct behavior>      |

> Test requirements are intentionally incomplete. The executing agent MUST read the affected source code, understand the current behavior, and define specific test cases before implementing changes.

---

## Original User Instruction

> Fix technical debt: <issue title>

_This issue was created by the tech-debt-triage skill from documented technical debt._

---

## Summary

<2-3 sentences describing what the debt is and why it matters>

---

## Requirements

### Functional Requirements

- <Requirement based on debt remediation>
- Update `technical-debt.md` to move item to "Resolved Issues" section after fix

### Non-Functional Requirements

- All changes must pass `pnpm run ci:tracked`
- No new tech debt introduced

---

## Scope

### In Scope

- <Specific files/patterns to address>
- <List of affected services/packages>

### Out of Scope (DO NOT)

- Do NOT redesign or refactor beyond the documented debt
- Do NOT fix unrelated issues discovered during implementation
- Do NOT modify `technical-debt.md` files for OTHER services

---

## Technical Debt Sources

| Service/Package | File                                             | Section          |
| --------------- | ------------------------------------------------ | ---------------- |
| <name>          | `docs/services/<name>/technical-debt.md`         | <section header> |
| <name>          | `docs/packages/<name>/technical-debt.md`         | <section header> |

---

## Affected Components

<list of services/packages that need changes>

---

## Acceptance Criteria

- [ ] All tests in Test Requirements table pass
- [ ] `pnpm run ci:tracked` passes (all 4 phases: typecheck, lint, test, coverage)
- [ ] PR created with issue ID in title: `[INT-XXX] Description`
- [ ] Linear state updated to "In Review"
- [ ] Source `technical-debt.md` updated: item moved to "Resolved Issues"
- [ ] No new tech debt introduced

---

## Execution Notes

- **Analyze first:** Read the actual source code referenced in the debt docs before writing any fix
- **Audit pattern:** If this is a cross-service fix, apply the pattern consistently to ALL listed services (see CLAUDE.md Code Auditing rule)
- **Brief analysis only was performed** — the fix design must be determined during implementation by reading the affected code
```
