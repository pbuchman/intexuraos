---
name: tech-debt-triage
description: This skill should be used when the user asks to "triage tech debt", "process the tech debt backlog", "consolidate technical debt", "create tech debt issues", "analyze tech debt docs", "turn tech debt into Linear issues", or mentions reviewing technical-debt.md files across the monorepo. Scans all technical-debt.md files, consolidates cross-service issues, and creates a parent Linear issue with subtasks for each approved finding. NOT for updating tech debt docs or analyzing actual source code.
---

# Tech Debt Triage

Scan all `technical-debt.md` files across the monorepo, consolidate cross-service issues into actionable groups, and create Linear issues ready for autonomous execution.

## Important Constraints

- **Docs-only analysis** — reads `technical-debt.md` files, never inspects actual source code
- **Assumes docs are current** — does not verify whether documented issues still exist in code
- **Single-run design** — running twice creates duplicate Linear issues; do NOT re-run without cleanup

## Workflow Overview

| Phase | Step | Type        | Description                                     |
| ----- | ---- | ----------- | ----------------------------------------------- |
| 1     | 1    | Gate        | Freshness warning + single-run disclaimer       |
| 2     | 2-3  | Scan        | Read all debt files, extract + classify         |
| 3     | 4    | User Input  | Select severity levels to proceed with          |
| 4     | 5    | Consolidate | Group cross-service issues that belong together |
| 5     | 6    | User Input  | Approve/reject each consolidated issue          |
| 6     | 7-8  | Linear      | Create parent issue + subtasks via `/linear`    |
| 6     | 9    | Output      | Display final triage summary to user            |

---

## Phase 1 — Pre-Flight Gate

### Step 1: Freshness Warning

Display `AskUserQuestion` with the following warning:

> This skill analyzes existing `technical-debt.md` documentation only — it does NOT inspect actual source code. It assumes all tech debt docs are up to date. This skill is designed for a single run — consecutive runs will create duplicate Linear issues.

Options: **"I understand, proceed"** / **"Cancel"**

If cancelled → STOP. No further action.

---

## Phase 2 — Discovery & Scanning

### Step 2: Scan All Tech Debt Files

Read all `technical-debt.md` files using these glob patterns:

- `docs/services/*/technical-debt.md` (apps + workers)
- `docs/packages/*/technical-debt.md` (shared packages)

Use parallel Glob + Read operations for efficiency. Skip files where all categories show count 0 and "None Detected" in every section.

### Step 3: Extract & Classify Issues

For each non-empty issue found, extract:

| Field      | Source                                                |
| ---------- | ----------------------------------------------------- |
| Title      | Section header (e.g., "codeRoutes.ts is 3500+ lines") |
| Service(s) | Component name from file path                         |
| Severity   | From summary table or inferred from Impact section    |
| Category   | TODO, Code Smell, SRP, Coverage Gap, Deprecation, TS  |
| Source     | Full path to the `technical-debt.md` file             |

**Severity inference** when not explicitly stated:

| Signal                              | Severity |
| ----------------------------------- | -------- |
| "Security risk", "production crash" | Critical |
| "SRP violation", "DRY violation"    | High     |
| "Difficult to navigate/test"        | Medium   |
| "Could benefit from", "minor"       | Low      |

Build a flat list of all extracted issues with these fields.

---

## Phase 3 — Severity Selection

### Step 4: Select Severity Levels

Display `AskUserQuestion` (multiSelect) showing discovered issue counts per severity:

```
Which severity levels to include?
- Critical (N issues)
- High (N issues)
- Medium (N issues)
- Low (N issues)
```

Filter the issue list to only selected severities. If none selected → STOP.

---

## Phase 4 — Consolidation

### Step 5: Consolidate Cross-Service Issues

Group issues that should be solved in a single Linear issue. Consult `references/consolidation-heuristics.md` for detailed grouping rules.

**Core principle:** If fixing one instance without fixing others would leave the codebase inconsistent, consolidate into a single issue.

**Key grouping patterns:**

1. **Same pattern across services** — e.g., "missing `logIncomingRequest()`" in 4 services → 1 issue
2. **Client/server mismatch** — e.g., API contract gap between producer and consumer → 1 issue covering both
3. **Shared infrastructure debt** — e.g., dead publisher + unused Terraform + orphaned env var → 1 cleanup issue
4. **Same TODO across files** — e.g., identical TODO in 3 use cases → 1 issue

Issues that are unique to a single service remain standalone.

For each consolidated group, produce:

- **Title** — descriptive, imperative mood (e.g., "Extract shared webhook secret generation utility")
- **Affected services** — list of all components involved
- **Source files** — all `technical-debt.md` paths that reported this
- **Brief scope** — 2-3 sentences on what needs to happen (NO fix design)

---

## Phase 5 — User Approval

### Step 6: Approve Issues

Present each consolidated issue via `AskUserQuestion` (multiSelect) for approval. Show:

- Issue title
- Affected services
- Severity + category
- Brief scope description

User selects which issues to create in Linear. If all rejected → STOP.

---

## Phase 6 — Linear Issue Creation

### Step 7: Create Parent Issue

Create a top-level Linear issue via `mcp__linear__create_issue`:

- **Team:** `IntexuraOS`
- **Title:** `[refactor] Tech debt triage — <date>`
- **State:** `Backlog`
- **Description:** Use the parent issue template from `references/linear-templates.md`
  - When analysis was performed
  - How many files scanned
  - How many issues found → consolidated → approved
  - Severity levels included
  - List of all approved subtask titles

### Step 8: Create Subtasks

For each approved issue, create a Linear child issue via `mcp__linear__create_issue`:

- **Team:** `IntexuraOS`
- **Title:** `[refactor] <descriptive title>`
- **State:** `Backlog`
- **Parent:** Set `parentId` to the UUID of the issue created in Step 7
- **Description:** Use the subtask template from `references/linear-templates.md`
  - Brief analysis of what needs to change
  - Affected services/packages
  - References to source `technical-debt.md` file(s) with relative paths
  - Explicit note: "No fix design included — analyze code before implementing"

Each subtask must be ready to be worked on directly via `/linear INT-XXX`.

### Step 9: Summary

Display final summary to user:

```
Tech Debt Triage Complete
- Files scanned: N
- Issues found: N → Consolidated: N → Approved: N → Created: N
- Parent issue: INT-XXX
- Subtasks: INT-YYY, INT-ZZZ, ...
```

---

## References

### Consolidation Heuristics

For detailed grouping rules and examples: **`references/consolidation-heuristics.md`**

### Linear Issue Templates

For parent and subtask description templates: **`references/linear-templates.md`**

---

## Error Handling

| Error                          | Action                                    |
| ------------------------------ | ----------------------------------------- |
| Linear MCP unavailable         | STOP immediately, inform user             |
| No tech debt files found       | STOP, suggest running `/document-service` |
| All files show "None Detected" | Inform user: no actionable debt found     |
| Linear issue creation fails    | Report which issues failed, continue rest |
