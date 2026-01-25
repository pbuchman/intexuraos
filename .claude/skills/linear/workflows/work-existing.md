# Work on Existing Issue Workflow

**Trigger:** User calls `/linear INT-123`

---

## 🚨 CRITICAL: Task Fails Without Branch Creation

**A task is FAILED BY DEFINITION if you start working on `development` or `main`.**

This is not a guideline — it's a hard requirement. Before reading code for implementation, before updating Linear state, before ANY work:

1. Check current branch
2. If on `development` or `main` → CREATE BRANCH FIRST
3. Only then proceed with work

---

## 🚨 CRITICAL: Issue State Transitions Are NON-NEGOTIABLE

**A task is INCOMPLETE if Linear issue state is not updated.**

This is not a guideline — it's a hard requirement. EVERY task must update state at two specific points:

### Point 1: When Starting Work (MANDATORY)

**BEFORE making any code changes:**

1. Create feature branch (see above)
2. Update Linear state to "In Progress"
3. Only then proceed with implementation

**If you skip this:** Team has no visibility that work started, duplicate work may occur.

### Point 2: After Creating PR (MANDATORY)

**AFTER PR is created but BEFORE marking task complete:**

1. Create PR with issue ID in title
2. Update Linear state to "In Review"
3. Verify PR appears in Linear attachments

**If you skip this:** PR workflow breaks, team can't find your PR, review process stalls.

### Summary Table

| Timing          | Linear State | When                      | Why                                  |
| --------------- | ------------ | ------------------------- | ------------------------------------ |
| **MANDATORY 1** | In Progress  | AFTER branch, BEFORE code | Signals work started, prevents dupes |
| **MANDATORY 2** | In Review    | AFTER PR, BEFORE done     | Signals review requested, links PR   |

**No exceptions. No shortcuts. Both transitions are REQUIRED.**

---

## Steps

### 1. Tool Verification

Verify Linear, GitHub, GCloud available.

### 2. Fetch Issue Details

```
- Call mcp__linear__get_issue with issue ID
- Extract: title, description, state, assignee
```

### 2.5 Parent Issue Detection (MANDATORY)

Check if this issue has child subissues:

```
Call mcp__linear__issue_read(method: "get_sub_issues", issueId: "INT-XXX")
```

**Routing Decision:**

| Result                    | Action                                                     |
| ------------------------- | ---------------------------------------------------------- |
| Children array non-empty  | **REDIRECT** to [parent-execution.md](parent-execution.md) |
| Children array empty/null | Continue with single-issue workflow (Step 3 below)         |

**Why:** Parent issues with children require continuous execution of ALL children without stopping. The parent-execution workflow handles branch naming, commit grouping, and PR creation differently.

### 3. Pre-Flight Branch Check (MANDATORY - BLOCKS ALL WORK)

⛔ **STOP: You MUST NOT be on `development` or `main` before making ANY changes.**

**Check current branch:**

```bash
git branch --show-current
```

**If on `development` or `main`:**

- DO NOT update Linear state
- DO NOT read code for implementation
- DO NOT make any changes
- PROCEED TO STEP 4 to create branch FIRST

**If already on a feature branch (`fix/INT-*`, `feature/INT-*`, etc.):**

- Verify branch name contains the issue ID
- Proceed to Step 5

**Override Exception:**
User can explicitly override branch requirements by saying:

- "work on development directly"
- "use branch X instead"
- "skip branch creation"

Without explicit override, branch creation is MANDATORY.

### 4. Create Branch from Fresh Development (MANDATORY)

**Always branch from `origin/development` (not local):**

```bash
git fetch origin
git checkout -b fix/INT-123 origin/development
```

**Why `origin/development`?**

- Local `development` may be stale or have uncommitted changes
- `origin/development` guarantees fresh state
- Prevents merge conflicts and ensures CI runs against current code

### 4.5. Build All Packages (MANDATORY - BLOCKS ALL WORK)

⛔ **STOP: You MUST build packages before starting any implementation work.**

**Always run `pnpm build` in repository root after branch checkout:**

```bash
pnpm build
```

**Why this is MANDATORY:**

- Apps depend on packages' `dist/` directories for type imports
- Without built packages, apps fail typecheck with misleading errors (50+ lint errors)
- Fresh branch checkout means packages aren't built yet
- The CLAUDE.md "Session Start Protocol" specifies this requirement

**Signs you forgot to build:**

- `Cannot find module '@intexuraos/...'` errors
- 50+ `no-unsafe-*` lint errors in apps
- Typecheck errors only in `apps/` not `packages/`

**Time estimate:** 30-60 seconds for all packages

**DO NOT proceed to state update or implementation until packages are built.**

### 5. Update State to In Progress (MANDATORY - BLOCKS ALL WORK)

⛔ **STOP: You MUST update Linear state BEFORE making any code changes.**

**This is not optional — it's a hard requirement:**

```
- Call mcp__linear__update_issue
- Set state: "In Progress"
```

**Why this is MANDATORY:**

- Signals to team that work has begun
- Prevents duplicate work from others
- Creates audit trail of when work started
- Enables accurate time tracking

**DO NOT proceed to implementation until state is updated.**

### 6. Guide Implementation

- Execute the task described in issue
- Make commits with clear messages

### 7. CI Gate (MANDATORY - BLOCKS PR CREATION)

⛔ **STOP: You MUST NOT push or create a PR until `pnpm run ci:tracked` passes.**

```bash
pnpm run ci:tracked
```

**If tempted to skip because "the change is simple":**

- This is precisely when bugs slip through
- "Simple" changes have non-obvious dependencies
- Partial checks (build, typecheck) create false confidence
- 2-3 minutes of CI is cheaper than debugging production

**What CI checks (ALL required):**

1. TypeCheck (source files)
2. TypeCheck (test files)
3. Lint
4. Tests + Coverage (95% threshold)

Running only 1-2 of these is WORSE than running none — it creates false confidence.

**If CI fails:**

- Report which step failed
- Show `.claude/ci-failures/` content if available
- Fix the issue and re-run CI
- Only after CI passes, continue to Step 8

**Override Exception:**
User can explicitly override CI requirements by saying "skip CI" or "push anyway".
Without explicit override, passing CI is MANDATORY.

### 8. Update Branch with Latest Base (MANDATORY)

Before creating a PR, merge the latest base branch:

```bash
git fetch origin
git merge origin/development  # or origin/main if using main as base
# If conflicts occur, resolve them and commit:
git add -A && git commit -m "Resolve merge conflicts with development"
```

### 9. Create PR (Critical: Title MUST include issue ID)

```bash
git push -u origin fix/INT-123
gh pr create --base development \
             --title "[INT-123] Issue title" \
             --body "<PR template>"
```

**MANDATORY:** PR title MUST contain the Linear issue ID (e.g., `[INT-123]`, `INT-123:`)

### 10. Update Linear State (MANDATORY - NON-NEGOTIABLE)

⛔ **STOP: You MUST update Linear state AFTER creating PR. Task is INCOMPLETE until this is done.**

**This is not optional — it's a hard requirement:**

- Set state to "In Review"
- GitHub integration automatically attaches PR (verify in `attachments` array)
- Only add comment if attachment is missing (fallback)

**Why this is MANDATORY:**

- Signals to team that review is requested
- Enables PR workflow in Linear UI
- Creates link between GitHub PR and Linear issue
- Required for code review process

**DO NOT mark task complete until state is updated to "In Review".**

### 11. Cross-Link Summary

Show table of created artifacts.

## Sequential Issue Processing (Epic/Child Issues)

When working on multiple related issues (e.g., epic children), follow these rules:

### One-at-a-Time Enforcement

1. **Complete ONE issue fully** before starting the next:
   - All code changes committed
   - CI passes (`pnpm run ci:tracked`)
   - PR created with issue ID in title

2. **STOP and checkpoint** after each issue:
   - Move issue to In Review (not Done)
   - Report completion to user
   - Wait for explicit "continue" or "next" instruction

3. **Never batch update** Linear issues:
   ```
   ❌ WRONG: Call update_issue for INT-232, INT-233, INT-234 in same response
   ✅ RIGHT: Complete INT-232 fully, checkpoint, get user approval, then start INT-233
   ```

### Forbidden Patterns

| Pattern                       | Why It's Wrong                         |
| ----------------------------- | -------------------------------------- |
| Parallel `update_issue` calls | No verification between issues         |
| Marking Done without user     | Done is user-controlled terminal state |
| Continuing without checkpoint | User loses control of workflow         |
| "I'll mark these as Done"     | Only user marks Done                   |

### Verification Between Issues

Before starting the NEXT issue, verify the CURRENT issue is complete:

- [ ] Code changes committed with issue ID in message
- [ ] CI passes (all 4 checks)
- [ ] PR created OR issue moved to In Review
- [ ] User acknowledged completion

Only after user says "continue" or "next issue" → proceed.

---

## PR Creation Checklist

**Blocking gates (cannot proceed without these):**

- [ ] Pre-flight branch check passed (NOT on `development` or `main`)
- [ ] Branch created from `origin/development` (fresh state)
- [ ] Packages built with `pnpm build` (MANDATORY after branch checkout)
- [ ] `pnpm run ci:tracked` passes (ALL 4 checks: typecheck src, typecheck tests, lint, tests+coverage)
- [ ] ALL CI errors fixed (even in other workspaces — ownership mindset)

**Terraform verification (ALWAYS CHECK):**

```bash
git diff --name-only HEAD~1 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"
```

- [ ] Verified terraform change status (document result)
- [ ] If terraform changed: `tf fmt -check -recursive` passes
- [ ] If terraform changed: `tf validate` passes

**Required before PR:**

- [ ] Branch name contains Linear issue ID
- [ ] Latest base branch merged
- [ ] Merge conflicts resolved (if any)
- [ ] PR title contains Linear issue ID
- [ ] All commits made
- [ ] PR description complete with all sections

**Post-PR verification:**

- [ ] PR appears in Linear issue's `attachments` array

## CI Failure Ownership

When CI fails, you own ALL errors — not just errors in "your" workspace.

| CI Error Location     | Your Response                                         |
| --------------------- | ----------------------------------------------------- |
| Workspace you touched | Fix immediately                                       |
| Other workspace       | Fix immediately OR ask: "Fix here or separate issue?" |
| Pre-existing lint     | Fix it (discovery creates ownership)                  |
| Flaky test            | Stabilize it                                          |

**Forbidden phrases:**

- ❌ "These are unrelated to my changes"
- ❌ "This was already broken"
- ❌ "Someone else's code"

**Required response:**

- ✅ "CI failed with X errors. Fixing them now."
- ✅ "Found X errors in `<workspace>`. Should I fix here or create separate issue?"

## Branch Naming Conventions

| Issue Type    | Branch Pattern     | Example                   |
| ------------- | ------------------ | ------------------------- |
| Bug           | `fix/INT-XXX`      | `fix/INT-42`              |
| Feature       | `feature/INT-XXX`  | `feature/INT-42`          |
| Sentry        | `fix/sentry-XXX`   | `fix/sentry-INTEXURAOS-4` |
| Refactor      | `refactor/INT-XXX` | `refactor/INT-42`         |
| Documentation | `docs/INT-XXX`     | `docs/INT-42`             |
