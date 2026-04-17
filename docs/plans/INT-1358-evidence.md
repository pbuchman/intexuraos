# INT-1358: Restore Missing Merge Button for Code Tasks

> **Planned:** 2026-04-13
> **Complexity:** SIMPLE
> **Type:** Prompt clarification (no logic changes)

## Investigation Summary

The merge button was not showing for execution task `task_c57671a7` (PR #1774, INT-1354) in the code tasks UI.

### Root Cause

The review agent set `needs_remediation: "1"` because it flagged **operational/manual verification steps** as unmet acceptance criteria:
- "Apply migration 093 in `intexuraos-dev-pbuchman`"
- "Verify the affected dev LLM usage flow stops returning `FAILED_PRECONDITION`"

These are post-merge deployment tasks, not code changes. But the review treated them as blocking.

Because `needs_remediation === "1"`, the review-outcome webhook did not set the `ready-to-merge` label on INT-1354. Without this label, `hasMergeReadyLabel()` returns `false` and the merge button is hidden in both list and detail views.

### Evidence Chain

1. **Task document** (`task_c57671a7`): status=`implemented`, has `result.prUrl`, has `prNumber`
2. **Linear issue** (INT-1354): labels=`["code-task"]` — no `ready-to-merge`
3. **Review task** (`task_7115aed6`): `result.needs_remediation: "1"` — flagged operational steps
4. **UI logic** (`isTaskMergeable()` in `apps/web/src/utils/issueGroups.ts`): requires `ready-to-merge` label
5. **Pipeline logic** (`derivePipeline()` in `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`): requires `hasMergeReadyLabel()` for merge step

### Fix

Update the `needs_remediation` prompt definition in two locations to explicitly exclude operational/manual verification steps:

1. `workers/orchestrator/src/services/system-prompt.ts` (~line 1160) — review agent prompt
2. `workers/orchestrator/src/services/completion-verifier.ts` (~line 366) — extraction prompt

Both use `PromptBuilder` with semver versioning — bump patch version. Update snapshot tests.
