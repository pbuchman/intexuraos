# Work on Existing Issue Workflow

**Trigger:** User calls `/linear INT-123`

## Steps

### 1. Tool Verification

Verify Linear, GitHub, GCloud available.

### 2. Fetch Issue Details

```
- Call mcp__linear__get_issue with issue ID
- Extract: title, description, state, assignee
```

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

### 5. Update State to In Progress

**CRITICAL:** Only update Linear state AFTER you have a proper feature branch.

```
- Call mcp__linear__update_issue
- Set state: "In Progress"
```

This signals that work has begun and prevents duplicate work.

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

### 10. Update Linear

- Set state to "In Review"
- GitHub integration automatically attaches PR (verify in `attachments` array)
- Only add comment if attachment is missing (fallback)

### 11. Cross-Link Summary

Show table of created artifacts.

## PR Creation Checklist

**Blocking gates (cannot proceed without these):**
- [ ] Pre-flight branch check passed (NOT on `development` or `main`)
- [ ] Branch created from `origin/development` (fresh state)
- [ ] `pnpm run ci:tracked` passes (ALL 4 checks: typecheck src, typecheck tests, lint, tests+coverage)

**Required before PR:**
- [ ] Branch name contains Linear issue ID
- [ ] Latest base branch merged
- [ ] Merge conflicts resolved (if any)
- [ ] PR title contains Linear issue ID
- [ ] All commits made
- [ ] PR description complete with all sections

**Post-PR verification:**
- [ ] PR appears in Linear issue's `attachments` array

## Branch Naming Conventions

| Issue Type    | Branch Pattern     | Example                   |
| ------------- | ------------------ | ------------------------- |
| Bug           | `fix/INT-XXX`      | `fix/INT-42`              |
| Feature       | `feature/INT-XXX`  | `feature/INT-42`          |
| Sentry        | `fix/sentry-XXX`   | `fix/sentry-INTEXURAOS-4` |
| Refactor      | `refactor/INT-XXX` | `refactor/INT-42`         |
| Documentation | `docs/INT-XXX`     | `docs/INT-42`             |
