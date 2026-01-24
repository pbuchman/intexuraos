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

### 3. Update State to In Progress (FIRST!)

**CRITICAL:** You MUST update the Linear issue state to "In Progress" BEFORE:

- Reading any code
- Planning implementation
- Investigating the issue
- Running any commands

```
- Call mcp__linear__update_issue
- Set state: "In Progress"
```

This signals that work has begun and prevents duplicate work.

### 4. Create Branch

```bash
git fetch origin
BASE_BRANCH="origin/development"  # or origin/main if development doesn't exist
git checkout -b fix/INT-123 "$BASE_BRANCH"
```

### 5. Guide Implementation

- Execute the task described in issue
- Make commits with clear messages

### 6. CI Gate (MANDATORY)

Run `pnpm run ci:tracked`

- If passes: Continue to PR creation
- If fails:
  - Report which step failed
  - Show `.claude/ci-failures/` content if available
  - Ask: "CI failed. Fix and retry, or explicitly override to proceed anyway?"

### 7. Update Branch with Latest Base (MANDATORY)

Before creating a PR, merge the latest base branch:

```bash
git fetch origin
git merge origin/development  # or origin/main if using main as base
# If conflicts occur, resolve them and commit:
git add -A && git commit -m "Resolve merge conflicts with development"
```

### 8. Create PR (Critical: Title MUST include issue ID)

```bash
git push -u origin fix/INT-123
gh pr create --base development \
             --title "[INT-123] Issue title" \
             --body "<PR template>"
```

**MANDATORY:** PR title MUST contain the Linear issue ID (e.g., `[INT-123]`, `INT-123:`)

### 9. Update Linear

- Set state to "In Review"
- GitHub integration automatically attaches PR (verify in `attachments` array)
- Only add comment if attachment is missing (fallback)

### 10. Cross-Link Summary

Show table of created artifacts.

## PR Creation Checklist

- [ ] `pnpm run ci:tracked` passes OR user explicitly overridden
- [ ] Branch created from correct base
- [ ] Latest base branch merged
- [ ] Merge conflicts resolved (if any)
- [ ] Branch name contains Linear issue ID
- [ ] PR title contains Linear issue ID
- [ ] All commits made
- [ ] PR description complete with all sections
- [ ] PR appears in Linear issue's `attachments` array

## Branch Naming Conventions

| Issue Type    | Branch Pattern     | Example                   |
| ------------- | ------------------ | ------------------------- |
| Bug           | `fix/INT-XXX`      | `fix/INT-42`              |
| Feature       | `feature/INT-XXX`  | `feature/INT-42`          |
| Sentry        | `fix/sentry-XXX`   | `fix/sentry-INTEXURAOS-4` |
| Refactor      | `refactor/INT-XXX` | `refactor/INT-42`         |
| Documentation | `docs/INT-XXX`     | `docs/INT-42`             |
