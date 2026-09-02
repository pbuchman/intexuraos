---
name: commit-push
description: Use when the user says "commit push", "commit and push", "push a PR", or asks Codex to finalize IntexuraOS changes by committing, pushing, and opening a pull request against development.
---

# Commit Push

## Overview

Finalize IntexuraOS work by committing the current intended changes, pushing a feature branch, and opening a pull request against `development`.

This skill is an IntexuraOS-specific exception to the normal Linear issue ID requirement. Do not ask for a Linear issue ID when this skill is invoked. GitHub automation will create or link the Linear issue after the PR is opened.

When invoked as direct finalization, do not ask for confirmation before commit, push, or PR creation unless a blocker requires user input.

## Scope Guard

Use this skill only in the IntexuraOS repo.

Before any mutation:

1. Confirm the repo root has `AGENTS.md`, `pnpm-workspace.yaml`, and `package.json`.
2. Confirm `package.json` has `"name": "intexuraos"`.
3. Confirm `git remote get-url origin` points to `pbuchman/intexuraos`.
4. If any check fails, stop and report that `$commit-push` is repo-specific.

After the scope check:

1. Read and follow the repository `AGENTS.md` before taking project actions.
2. Use `gh` for PR and GitHub operations it supports; use `git` only for local branch, staging, commit, rebase, and push operations where `gh` has no equivalent.

## Linear ID Exception

Only this rule is overridden:

- Do not stop to ask for an `INT-XXX` issue ID.
- Do not fabricate an `INT-XXX` issue ID.
- Do not create or update a Linear issue manually.
- Use a descriptive branch, commit message, PR title, and PR body without `INT-XXX`.
- Include this PR body note:

```markdown
Linear: omitted by `$commit-push`; GitHub automation will create or link the Linear issue after PR creation.
```

This exception does not apply to release finalization, ordinary GitHub workflows, or any other skill.

All other project rules still apply, especially:

- `pnpm run ci:tracked` must pass before commit.
- Never commit directly to `main` or `development`.
- Open the PR against `development`.
- Do not use forbidden ownership language around CI failures.
- Do not revert user changes unless explicitly requested.

## Workflow

### 1. Inspect Worktree

Run:

```bash
git status --short
git diff --stat
git diff
```

Identify the intended change set. If there are unrelated or risky changes, stage only the intended files and mention exclusions in the final response.

If there are no changes to commit, stop and report that the worktree has nothing to finalize.

### 2. Ensure Feature Branch

Check the current branch:

```bash
git branch --show-current
```

If on `main` or `development`, create a feature branch before committing:

```bash
BRANCH="codex/<short-change-slug>-$(date +%Y%m%d-%H%M)"
git switch -c "$BRANCH"
```

If already on a non-protected branch, keep using it unless the branch name is clearly wrong for the work.

### 3. Run Commit Gate

Run from repo root:

```bash
pnpm run ci:tracked
```

If CI fails:

- Capture and inspect the failure.
- Fix failures that block the accepted work, then rerun `pnpm run ci:tracked`.
- Do not commit until CI passes.
- If the failure cannot be resolved without user input or a risky scope change, stop and report the exact blocker.

### 4. Stage And Commit

Stage only intended files:

```bash
git add <files>
git status --short
```

Commit with a concise message and no fake issue ID:

```bash
git commit -m "<type>: <clear summary>"
```

Use conventional prefixes when they fit: `feat`, `fix`, `docs`, `chore`, `refactor`.

### 5. Update With Latest Development

Before pushing or opening a PR, update the feature branch with the latest base branch:

```bash
git fetch origin development
git rebase origin/development
```

If the branch is already shared remotely and rebasing would require a force push, merge instead:

```bash
git merge --no-edit origin/development
```

Resolve conflicts if needed. After the branch includes the latest `origin/development`, rerun the final commit gate:

```bash
pnpm run ci:tracked
```

Do not push or create a PR until this final CI run passes.

### 6. Push And Open PR

Push the feature branch:

```bash
git push -u origin HEAD
```

Open the pull request against `development`:

```bash
cat > /tmp/commit-push-pr-body.md <<'PR_BODY'
## Summary

- <what changed>

## Verification

- `pnpm run ci:tracked`

## Linear

Linear: omitted by `$commit-push`; GitHub automation will create or link the Linear issue after PR creation.
PR_BODY

gh pr create --base development --head "$(git branch --show-current)" \
  --title "<clear PR title without INT-XXX>" \
  --body-file /tmp/commit-push-pr-body.md
```

If an open PR already exists for the branch, do not create a duplicate. Use the existing PR and report its URL.

PR body format:

```markdown
## Summary

- <what changed>

## Verification

- `pnpm run ci:tracked`

## Linear

Linear: omitted by `$commit-push`; GitHub automation will create or link the Linear issue after PR creation.
```

## Final Response

Report:

- branch name
- commit SHA
- PR URL
- `pnpm run ci:tracked` result
- any files intentionally left unstaged

Do not commit, push, or open a PR if the user only asked for a plan, review, or explanation.
