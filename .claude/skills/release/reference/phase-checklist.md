# Phase Checklist Reference

Quick reference for all release phases and their requirements.

---

## Phase 1: Kickoff

- [ ] Verify tools: `git`, `gh`, `node`
- [ ] Read current version from `package.json`
- [ ] Find last release tag
- [ ] List merged PRs since last release
- [ ] Detect modified services
- [ ] Run semver analysis (collect, net, categorize, determine bump)
- [ ] **Single Prioritization Touchpoint** — present changes, collect priorities + comments + slogan

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
- [ ] No user interaction — silent batch processing

**Tool Usage:**

```
Task tool with subagent_type: "service-scribe"
Multiple Task calls in single message for parallel execution
```

---

## Phase 3: High-Level Docs (Automatic)

- [ ] Spawn `release-docs-updater` agent with High-priority changes + user comments
- [ ] Agent auto-updates `docs/overview.md`, verifies README badges, checks `docs/services/index.md`
- [ ] If pure bugfix release: agent skips updates

**No user interaction required.**

---

## Phase 4: README (Automatic)

- [ ] Read current README.md
- [ ] Auto-generate "What's New" table from High-priority items
- [ ] Use user comments as descriptions (fallback to triage summaries)
- [ ] Apply following accumulation pattern

**Template:** `templates/readme-whats-new.md`

**No user interaction required.**

---

## Phase 5: Website (Automatic)

- [ ] Update version strings in `HomePage.tsx` (hero badge + footer)
- [ ] Add/update `WhatsNewSection` with High-priority feature cards
- [ ] If major version: create version history section
- [ ] Content filter: exclude migrations and refactors from feature cards

**No user interaction required.**

---

## Phase 6: Finalize

- [ ] Update ALL package.json versions (root, apps/\*, packages/\*, workers/\*)
- [ ] Update CHANGELOG.md with new version entry (sorted type subcategories)
- [ ] Run `pnpm run ci:tracked` — **MUST PASS**
- [ ] Refresh RAG embeddings: `pnpm run embed-docs` (with prod env overrides)
- [ ] **Pre-merge release validation** — verify all phases produced output:
  - [ ] Version strings updated in `HomePage.tsx`
  - [ ] `WhatsNewSection` present with feature cards (or all features skipped)
  - [ ] README "What's New" updated
  - [ ] CHANGELOG contains new version
  - [ ] Package versions match
  - [ ] No false "new" features (migrations/refactors excluded)
  - [ ] No hallucinated version numbers or endpoints
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

**Changelog Format (Sorted by Type):**

```markdown
## X.Y.Z

### Added

- [High-priority entries first]
- [Medium-priority entries]

### Fixed

- [entries sorted by priority]

### Improved

- [entries sorted by priority]
```

Type subcategories, omit empty categories, High → Medium → Low within each.

**Commands:**

```bash
pnpm run ci:tracked
git add CHANGELOG.md package.json pnpm-lock.yaml \
  apps/*/package.json packages/*/package.json workers/*/package.json \
  docs/ README.md apps/web/src/
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

| Action                   | Command                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Get current version      | `cat package.json \| jq -r '.version'`                                                               |
| Get last tag             | `git tag -l "v*" --sort=-v:refname \| head -1`                                                       |
| List merged PRs          | `gh pr list --state merged --base development`                                                       |
| Detect modified services | `git diff --name-only $TAG..HEAD -- apps/`                                                           |
| Run CI                   | `pnpm run ci:tracked`                                                                                |
| Push development         | `git push origin development`                                                                        |
| Check existing PR        | `gh pr list --base main --head development --json number`                                            |
| Merge PR                 | `gh pr merge $PR_NUMBER --merge`                                                                     |
| Tag on main              | `git tag -a "vX.Y.Z" "$(git rev-parse origin/main)" -m "Release vX.Y.Z"`                             |
| Push tag                 | `git push origin vX.Y.Z`                                                                             |
| Create GitHub Release    | `gh release create "vX.Y.Z" --title "vX.Y.Z" --notes-file /tmp/release-notes-X.Y.Z.md --target main` |
| Validate tag on main     | `git branch -r --contains "$(git rev-parse vX.Y.Z^{})" \| grep origin/main`                          |
| Validate GitHub Release  | `gh release view "vX.Y.Z" --json tagName`                                                            |
| Validate CHANGELOG entry | `grep -q "## X.Y.Z" CHANGELOG.md`                                                                    |

---

## Single Touchpoint Pattern Explained

All user interaction happens once in Phase 1 step 1.7:

```
┌─────────────────────────────────────────┐
│ 1. Present all changes by category      │
│    - Features (default: High)           │
│    - Notable Changes (default: Medium)  │
│    - Minor Fixes (default: Low)         │
├─────────────────────────────────────────┤
│ 2. User adjusts priorities/comments     │
│    - "3 high" — change priority         │
│    - "1 comment: ..." — add comment     │
│    - "5 skip" — exclude from changelog  │
├─────────────────────────────────────────┤
│ 3. User confirms with "go"              │
│    - Store priority map + comments map  │
│    - Build changelog + release notes    │
├─────────────────────────────────────────┤
│ 4. Phases 2-5 run automatically         │
│    - No further user interaction        │
│    - All phases use Phase 1 data        │
└─────────────────────────────────────────┘
```

---

## Error Recovery

| Error                         | Recovery                                              |
| ----------------------------- | ----------------------------------------------------- |
| CI fails in Phase 6           | Fix issues, re-run CI, then commit                    |
| service-scribe agent fails    | Log error, continue with other services               |
| RAG embeddings fail           | Log error, continue release (re-run manually)         |
| User skips all changes        | Proceed with version-only release                     |
| Tool unavailable              | ABORT immediately with clear error                    |
| Merge to main fails           | Check for conflicts, resolve manually, retry          |
| GitHub Release creation fails | Log error, provide manual `gh release create` command |
| Existing dev→main PR blocked  | Fall back to direct merge or report blocker           |

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
