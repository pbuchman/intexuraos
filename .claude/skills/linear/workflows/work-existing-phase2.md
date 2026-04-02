# Work on Existing Issue - Phase 2 (Strict Execution)

**Trigger:** Issue HAS `code-task` label

---

## Purpose

Execute the task autonomously. The issue has been prepared (Phase 1) and is ready for implementation.

---

## Verbose Transition Logging (MANDATORY)

```
🚀 PHASE 2: Starting Strict Execution for INT-123
🌿 BRANCH: Creating fix/INT-123 from origin/development
📍 STATE: Backlog → In Progress
📋 PLAN: Preparing implementation plan (non-trivial task)...
🔨 BUILD: Running pnpm build...
💻 IMPLEMENT: Starting implementation...
✅ CI: pnpm run ci:tracked passed
🧹 SIMPLIFY: Running /simplify on changed files...
✅ CI: pnpm run ci:tracked passed (post-simplify)
📦 COMMIT: [INT-123] <description>
🔀 MERGE: Merging origin/development...
📤 PUSH: Pushing to origin/fix/INT-123
🔗 PR: Created PR #XXX
🔍 REVIEW: Running dual code review — opus + sonnet (iteration 1)...
🔧 FIXES: Addressing combined review findings...
🔍 REVIEW: Running dual code review on fixes only (iteration 2)...
✅ REVIEW: No issues found — code review passed
📍 STATE: In Progress → In Review
✅ PHASE 2 COMPLETE: PR created, CI passed, review clean, Linear updated to In Review
```

---

## Non-Interactive Contract (MANDATORY)

**This mode operates WITHOUT user interaction. The following rules are absolute:**

| Rule             | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| **NO PROMPTS**   | Never ask "Should I commit?", "Ready to push?", etc.            |
| **AUTO-PROCEED** | Execute all steps automatically after CI passes                 |
| **NO WAITING**   | Don't pause for confirmation between steps                      |
| **FIX CI**       | On CI failure, fix and retry (up to 3 attempts before stopping) |
| **FIX REVIEW**   | On review findings, fix and re-review (loop until clean)        |

---

## Steps

### 1. Verify Tools

Verify Linear MCP, GitHub CLI, GCloud available. Fail fast if unavailable.

### 2. Create Branch

```bash
git fetch origin
git checkout -b fix/INT-XXX origin/development  # or feature/INT-XXX
```

**Branch naming:**

| Issue Type | Pattern            |
| ---------- | ------------------ |
| Bug        | `fix/INT-XXX`      |
| Feature    | `feature/INT-XXX`  |
| Refactor   | `refactor/INT-XXX` |

### 3. Build Packages

```bash
pnpm build
```

Required before any implementation work.

### 4. Update Linear State

```
Set state: "In Progress"
```

BEFORE any code changes.

### 5. Plan (Non-Trivial Tasks)

**MANDATORY for non-trivial tasks.** If the task involves multiple files, architectural decisions, or more than a straightforward single-file change:

1. Use the `writing-plans` skill to prepare an implementation plan
2. Share the plan (output it to the conversation)
3. Immediately proceed to Step 6 — do NOT wait for approval in non-interactive mode

**Skip this step ONLY for:** single-file bug fixes, typo corrections, or trivially obvious changes.

### 6. Implement

Use the `executing-plans` skill to execute the plan from Step 5. If Step 5 was skipped (trivial task), implement directly from the "Files to Change" section:

1. Write tests first (from Test Requirements section)
2. Implement code changes

### 7. CI Gate (MANDATORY)

```bash
pnpm run ci:tracked
```

**On failure:** Fix issues, re-run. Stop only after 3 failed attempts.

### 7.5. Simplify (MANDATORY — NON-NEGOTIABLE)

After CI passes and BEFORE committing, run `/simplify` on all changed files. This reviews changed code for reuse opportunities, quality issues, and efficiency improvements.

**This step is mandatory, non-negotiable, and must never be skipped.** It is a quality gate equivalent to CI.

After `/simplify` makes changes, re-run CI:

```bash
pnpm run ci:tracked
```

### 8. Commit and Push

```bash
git add -A
git commit -m "[INT-XXX] Implementation description"
git fetch origin && git merge origin/development
git push -u origin fix/INT-XXX
```

### 9. Create PR

```bash
gh pr create --base development \
  --title "[INT-XXX] Issue title" \
  --body "Fixes INT-XXX

## Summary
...

## Test Plan
..."
```

### 10. Code Review Loop (MANDATORY)

Run an iterative review cycle until the code is clean. Track the iteration count.

**Scope rule:**

- **Iteration 1 (initial review):** Review the FULL diff (base branch..HEAD) — entire implementation.
- **Iteration 2+ (fix reviews):** Review ONLY the fixes from the previous iteration. The diff scope narrows to the commit(s) made in Step 10f of the prior iteration. Do NOT re-review already-approved code.

**For each iteration:**

#### 10a. Dispatch Two Code Reviewers (in parallel)

Launch **two** `superpowers:code-reviewer` agents simultaneously using the Task tool:

| Agent | Model      | Purpose                                           |
| ----- | ---------- | ------------------------------------------------- |
| 1     | **opus**   | Deep architectural and correctness analysis       |
| 2     | **sonnet** | Fast pattern-matching for style and common issues |

Both receive the same inputs:

- **Iteration 1:** Full git diff (base branch..HEAD), description, requirements
- **Iteration 2+:** Git diff of only the previous iteration's fix commit(s), plus context of what was fixed and why

Wait for both to complete.

#### 10b. Post PR Comment — Combined Review Summary

Merge findings from both reviewers into a single deduplicated summary. If both flagged the same issue, keep the more detailed version. Post as ONE PR comment:

```bash
gh pr comment <PR_NUMBER> --body "## Code Review (Iteration N)

### Critical
- [issue] (file:line) — [explanation]

### Important
- [issue] (file:line) — [explanation]

### Minor
- [issue] (file:line) — [explanation]

### Triage & Fix Plan

| # | Severity | Issue              | Fix Plan                     |
|---|----------|--------------------|------------------------------|
| 1 | Critical | [description]      | [specific fix approach]      |
| 2 | Important| [description]      | [specific fix approach]      |
| 3 | Minor    | [description]      | Deferred — [reason]          |

**Proceeding to fix Critical and Important issues.**"
```

#### 10c. Implement Fixes

Fix all **Critical** and **Important** issues from the combined review. Minor/suggestions may be deferred.

#### 10d. Re-run CI Gate

```bash
pnpm run ci:tracked
```

#### 10e. Commit and Push Fixes

```bash
git add -A
git commit -m "[INT-XXX] Address code review iteration N"
git push
```

#### 10f. Loop Decision

- If the combined review found **zero Critical or Important issues** → exit loop, proceed to Step 11.
- Otherwise → increment iteration counter, go back to Step 10a (reviewers will scope to ONLY this iteration's fix commit).

**Safety valve:** After 5 review iterations, stop and report. Something is structurally wrong if fixes keep introducing new issues.

### 11. Update Linear State

```
Set state: "In Review"
```

Verify PR appears in Linear attachments.

### 12. Completion Statement (MANDATORY)

Output ALL of the following:

```
PHASE2_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/XXX
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/pbuchman/issue/INT-XXX
- Review iterations: <number>
- Turn summary: <line 1> | <line 2> | <line 3> | <line 4> | <line 5>
- Summary: Implemented requested changes
```

**Turn summary format:** Exactly ~5 short statements separated by `|`, summarizing what happened during this execution turn. This will be sent as a WhatsApp notification to the user, so write it as a concise human-readable status update. Examples:

```
- Turn summary: Planned 3-file refactor for auth middleware | Wrote 12 tests covering edge cases | Implemented token refresh logic | Code review clean after 2 iterations | PR #487 ready for human review
- Turn summary: Fixed Firestore query timeout bug | Added composite index migration | 100% branch coverage achieved | Review found missing error log — fixed | PR #501 merged-ready
```

---

## Completion Validation

The completion-validator hook checks:

- [ ] PR created (URL format)
- [ ] CI passed mentioned
- [ ] Linear updated to "In Review" mentioned
- [ ] Review iterations count present
- [ ] Turn summary present (~5 statements)

---

## Forbidden Actions

| Action                  | Why Forbidden                              |
| ----------------------- | ------------------------------------------ |
| Asking for confirmation | Non-interactive mode                       |
| Skipping CI             | CI is mandatory gate                       |
| Skipping code review    | Review loop is mandatory                   |
| Partial commits         | Complete the full cycle                    |
| Manual Linear updates   | Use MCP for all state transitions          |
| Setting assignee/delegate | User-only responsibility. Blocked by hook |
