# Phase Checklist Reference

Use this as the quick release checklist for `$release`.

---

## Phase 0: Subagent Plan

- [ ] Verify whether Codex subagent tools are available
- [ ] Read `reference/subagent-execution.md`
- [ ] Create a short subagent-driven release execution plan or report current-session fallback
- [ ] Confirm no git worktree will be created

---

## Phase 1: Kickoff

- [ ] Verify tools: `git`, `gh`, `node`, `jq`, `gsutil`
- [ ] Read current version from `package.json`
- [ ] Find last release tag
- [ ] List merged PRs since last release
- [ ] Detect modified services
- [ ] Run semver analysis or load fresh `.prerelease-data.md`
- [ ] Generate and publish feature-only prioritizer page
- [ ] Parse exported priorities, comments, highlights, skips, and major-release slogan
- [ ] Build changelog entry and GitHub Release notes file

Key commands:

```bash
cat package.json | jq -r '.version'
git tag -l "v*" --sort=-v:refname | head -1
gh pr list --state merged --base development --json number,title,body,mergedAt,author,labels --limit 3000
```

---

## Phase 2: Service Docs

- [ ] Skip if `--skip-docs`
- [ ] Build a release context block for each modified service
- [ ] Dispatch one `Service Scribe` worker per modified service with bounded `docs/services/<service>/` write scope
- [ ] Dispatch `Doc Validator` explorer for each updated service
- [ ] Log coverage and contradiction findings

---

## Phase 3: High-Level Docs

- [ ] Dispatch `Docs Updater` worker from `reference/agent-prompts.md`
- [ ] Update `docs/overview.md` only for grounded high-priority capabilities
- [ ] Verify README badges
- [ ] Verify `docs/services/index.md` lists real services only

---

## Phase 4: README

- [ ] Read `README.md`
- [ ] Read `templates/readme-whats-new.md`
- [ ] Generate "What's New" entries from highlighted or high-priority features
- [ ] Preserve current-major accumulation pattern
- [ ] Use user comments before generated descriptions

---

## Phase 5: Website

- [ ] Update version strings in `apps/web/src/pages/HomePage.tsx`
- [ ] Add or update `WhatsNewSection`
- [ ] Exclude migrations, refactors, and moved functionality from feature cards
- [ ] For major releases, add version history when prior major highlights exist

---

## Phase 6: Finalize

- [ ] Confirm work is on a feature branch, not `development` or `main`
- [ ] Update every package version: root, apps, packages, workers
- [ ] Run `pnpm install` to refresh the lockfile
- [ ] Prepend `CHANGELOG.md` entry
- [ ] Verify `/tmp/release-notes-X.Y.Z.md`
- [ ] Run `pnpm run ci:tracked` and fix all failures
- [ ] Run pre-commit release validation
- [ ] Dispatch final `xhigh` release auditor and fix critical findings
- [ ] Confirm a real `INT-XXX` exists, or get explicit user permission to proceed without one before branch or PR creation
- [ ] Commit on feature branch
- [ ] Push feature branch
- [ ] Open PR targeting `development`
- [ ] After protected merge flow reaches `origin/main`, tag `origin/main`
- [ ] Create GitHub Release
- [ ] Run post-release validation

Commit and PR commands:

```bash
RELEASE_ISSUE_ID="INT-XXX"
git status
git add CHANGELOG.md package.json pnpm-lock.yaml \
  apps/*/package.json packages/*/package.json workers/*/package.json \
  docs/ README.md apps/web/src/
git commit -m "$RELEASE_ISSUE_ID Release vX.Y.Z"
git push -u origin HEAD
gh pr create --base development --head "$(git branch --show-current)" \
  --title "$RELEASE_ISSUE_ID Release vX.Y.Z" \
  --body "Fixes $RELEASE_ISSUE_ID"
```

Tag and release commands:

```bash
git fetch origin main
MAIN_SHA=$(git rev-parse origin/main)
git tag -a "vX.Y.Z" "$MAIN_SHA" -m "Release vX.Y.Z"
git push origin "vX.Y.Z"
gh release create "vX.Y.Z" --title "vX.Y.Z" --notes-file /tmp/release-notes-X.Y.Z.md --target main
```

Post-release validation:

```bash
TAG_COMMIT=$(git rev-parse "vX.Y.Z^{}")
git branch -r --contains "$TAG_COMMIT" | grep "origin/main"
gh release view "vX.Y.Z" --json tagName,targetCommitish,body
grep -q "## X.Y.Z" CHANGELOG.md
for f in package.json apps/*/package.json packages/*/package.json workers/*/package.json; do
  [[ ! -f "$f" || "$f" == *"/dist/"* ]] && continue
  jq -r '.version' "$f"
done
git branch --show-current
```

---

## Resume from Phase

Use `$release --phase N`.

| N   | Phase Name      | What to Reconstruct                                     |
| --- | --------------- | ------------------------------------------------------- |
| 2   | Service Docs    | release context from `.prerelease-data.md`              |
| 3   | High-Level Docs | high-priority items and comments                        |
| 4   | README          | version, highlights, comments                           |
| 5   | Website         | version, highlights, major-version slogan if applicable |
| 6   | Finalize        | version, changelog entry, release notes, modified files |
