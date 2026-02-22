# Phase Checklist Reference

Quick reference for all release phases and their requirements.

---

## Phase 1: Kickoff

- [ ] Verify tools: `git`, `gh`, `node`
- [ ] Read current version from `package.json`
- [ ] Find last release tag
- [ ] List merged PRs since last release
- [ ] Detect modified services
- [ ] Calculate version bump (major/minor/patch)
- [ ] Ask user for release focus (AskUserQuestion)

**Commands:**

```bash
cat package.json | jq -r '.version'
git tag -l "v*" --sort=-v:refname | head -1
gh pr list --state merged --base development --limit 100
git diff --name-only $LAST_TAG..HEAD -- apps/ | cut -d'/' -f2 | sort -u | grep -v web
```

---

## Phase 2: Service Docs (Silent)

- [ ] For each modified service: spawn service-scribe agent
- [ ] Run all agents in parallel
- [ ] Wait for all completions
- [ ] No checkpoint — silent batch processing

**Tool Usage:**

```
Task tool with subagent_type: "service-scribe"
Multiple Task calls in single message for parallel execution
```

---

## Phase 3: High-Level Docs (Checkpoint)

- [ ] Read `docs/overview.md`
- [ ] Analyze changes from release
- [ ] Draft proposed updates
- [ ] **CHECKPOINT**: Present, wait for approval
- [ ] If approved: apply changes with Edit tool

**Checkpoint Options:**

1. Approve — Apply changes
2. Revise — Incorporate feedback, re-present
3. Skip — Proceed without changes

---

## Phase 4: README (Checkpoint)

- [ ] Read current README.md
- [ ] Generate "What's New" section using template
- [ ] **CHECKPOINT**: Present, wait for approval
- [ ] If approved: replace section with Edit tool

**Template:** `templates/readme-whats-new.md`

**Checkpoint Options:**

1. Approve — Apply changes
2. Revise — Incorporate feedback, re-present
3. Skip — Proceed without changes

---

## Phase 5: Website (Checkpoint)

- [ ] Generate RecentUpdatesSection content
- [ ] Run website audit (see `workflows/website-audit.md`)
- [ ] Compile EXACTLY 3 suggestions
- [ ] **CHECKPOINT**: Present, wait for selection
- [ ] For each selected: invoke `/frontend-design` skill

**Template:** `templates/website-suggestions.md`

**Selection Rules:**

- At least 1 release-driven
- At least 1 Low effort
- Maximum 1 High effort

**Checkpoint Options (multiSelect):**

1. Suggestion 1
2. Suggestion 2
3. Suggestion 3
4. None — skip website updates

---

## Phase 6: Finalize

- [ ] Update ALL package.json versions (root, apps/\*, packages/\*, workers/\*)
- [ ] Update CHANGELOG.md with new version entry (Claude Code style)
- [ ] Run `pnpm run ci:tracked` — **MUST PASS**
- [ ] Refresh RAG embeddings: `pnpm run embed-docs` (with prod env overrides)
- [ ] Stage & commit on `development`
- [ ] Push `development` branch
- [ ] Merge `development` → `main` (via existing PR or direct merge)
- [ ] Tag on `main` (NOT `development`)
- [ ] Push tag: `git push origin vX.Y.Z`
- [ ] Create GitHub Release with categorized release notes
- [ ] **Post-release validation** — all 5 checks MUST pass:
  - [ ] Tag points to commit on `main`
  - [ ] GitHub Release exists and has correct content
  - [ ] CHANGELOG.md contains new version entry
  - [ ] All package.json versions match new version
  - [ ] Current branch is `development`
- [ ] Display summary using template (includes release URL and validation results)

**Changelog Format (Claude Code Style):**

```markdown
## X.Y.Z

- Added [feature with `code` inline]
- Fixed [bug description]
- Changed [modification]
```

No subcategories, verb-first entries, single line each.

**Commands:**

```bash
pnpm run ci:tracked
git add -A
git commit -m "Release vX.Y.Z..."
git push origin development

# Merge to main (via PR or direct)
gh pr list --base main --head development --json number --jq '.[0].number // empty'
gh pr merge $PR_NUMBER --merge
# OR: git checkout main && git merge development && git push origin main

# Tag on main
git fetch origin main
MAIN_SHA=$(git rev-parse origin/main)
git tag -a "vX.Y.Z" "$MAIN_SHA" -m "Release vX.Y.Z"
git push origin "vX.Y.Z"

# GitHub Release
gh release create "vX.Y.Z" --title "vX.Y.Z" --notes-file /tmp/release-notes-X.Y.Z.md --target main

# Post-release validation
TAG_COMMIT=$(git rev-parse "vX.Y.Z^{}")
git branch -r --contains "$TAG_COMMIT" | grep "origin/main"        # Check 1: tag on main
gh release view "vX.Y.Z" --json tagName                            # Check 2: release exists
grep -q "## X.Y.Z" CHANGELOG.md                                    # Check 3: changelog entry
node -e "console.log(require('./package.json').version)"            # Check 4: version match
git branch --show-current                                           # Check 5: on development
```

**Template:** `templates/release-summary.md`

---

## Quick Commands Reference

| Action                   | Command                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| Get current version      | `cat package.json \| jq -r '.version'`                                          |
| Get last tag             | `git tag -l "v*" --sort=-v:refname \| head -1`                                  |
| List merged PRs          | `gh pr list --state merged --base development`                                  |
| Detect modified services | `git diff --name-only $TAG..HEAD -- apps/`                                      |
| Run CI                   | `pnpm run ci:tracked`                                                           |
| Push development         | `git push origin development`                                                   |
| Check existing PR        | `gh pr list --base main --head development --json number`                       |
| Merge PR                 | `gh pr merge $PR_NUMBER --merge`                                                |
| Tag on main              | `git tag -a "vX.Y.Z" "$(git rev-parse origin/main)" -m "Release vX.Y.Z"`       |
| Push tag                 | `git push origin vX.Y.Z`                                                        |
| Create GitHub Release    | `gh release create "vX.Y.Z" --title "vX.Y.Z" --notes-file /tmp/release-notes-X.Y.Z.md --target main` |
| Validate tag on main     | `git branch -r --contains "$(git rev-parse vX.Y.Z^{})" \| grep origin/main`                          |
| Validate GitHub Release  | `gh release view "vX.Y.Z" --json tagName`                                                             |
| Validate CHANGELOG entry | `grep -q "## X.Y.Z" CHANGELOG.md`                                                                     |

---

## Checkpoint Pattern Explained

At each checkpoint (Phases 3, 4, 5):

```
┌─────────────────────────────────────────┐
│ 1. Present proposed changes             │
│    - Clear formatting                   │
│    - Explain what will change           │
│    - Show before/after if applicable    │
├─────────────────────────────────────────┤
│ 2. STOP execution                       │
│    - Do NOT proceed automatically       │
│    - Wait for user input                │
├─────────────────────────────────────────┤
│ 3. Use AskUserQuestion                  │
│    - Approve: Apply and continue        │
│    - Revise: Get feedback, redo         │
│    - Skip: Continue without changes     │
├─────────────────────────────────────────┤
│ 4. Handle response                      │
│    - If approved: Edit tool to apply    │
│    - If revise: Loop back to step 1     │
│    - If skip: Move to next phase        │
└─────────────────────────────────────────┘
```

---

## Error Recovery

| Error                         | Recovery                                                  |
| ----------------------------- | --------------------------------------------------------- |
| CI fails in Phase 6           | Fix issues, re-run CI, then commit                        |
| service-scribe agent fails    | Log error, continue with other services                   |
| RAG embeddings fail           | Log error, continue release (re-run manually)             |
| User declines all checkpoints | Proceed with version-only release                         |
| Tool unavailable              | ABORT immediately with clear error                        |
| Merge to main fails           | Check for conflicts, resolve manually, retry              |
| GitHub Release creation fails | Log error, provide manual `gh release create` command     |
| Existing dev→main PR blocked  | Fall back to direct merge or report blocker               |

---

## Resume from Phase

To resume from a specific phase after interruption:

```
/release --phase N
```

| N   | Phase Name      | What Gets Skipped          |
| --- | --------------- | -------------------------- |
| 2   | Service Docs    | Kickoff (uses cached data) |
| 3   | High-Level Docs | Phases 1-2                 |
| 4   | README          | Phases 1-3                 |
| 5   | Website         | Phases 1-4                 |
| 6   | Finalize        | All documentation phases   |
