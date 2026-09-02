# Full Release Workflow

**Trigger:** User calls `$release`, `$release --skip-docs`, or `$release --phase N`.

Run this workflow with subagent-driven execution first. Use `reference/subagent-execution.md` before Phase 1. Fall back to current-session execution only when Codex subagent tools are unavailable.

---

## Phase 0: Subagent-Driven Release Plan

Before release operations:

1. Verify whether Codex subagent tools are available.
2. Read `reference/subagent-execution.md`.
3. Create a short release execution plan using the `superpowers:subagent-driven-development` pattern.
4. Keep controller-owned work in the controller session.
5. Identify bounded subagent tasks and reasoning efforts for this release.

Do not create git worktrees. This repo forbids worktrees in `AGENTS.md`.

If subagent tools are unavailable, report:

```text
Subagent tools are unavailable; falling back to current-session release execution.
```

Then execute all referenced prompts in the current session with the default model.

---

## Phase 1: Kickoff

### 1.1 Tool Verification

Verify required tools before release work:

```bash
git --version
gh auth status
node --version
jq --version
gsutil version
```

If any command fails, stop and report the tool, why it is needed, and how to fix it.

### 1.2 Check for Pre-Collected Data

```bash
if [[ -f ".prerelease-data.md" ]]; then
  FILE_HEAD=$(head -1 .prerelease-data.md | grep -oP '(?<=HEAD: )\w+')
  CURRENT_HEAD=$(git rev-parse HEAD)
  if [[ "$FILE_HEAD" == "$CURRENT_HEAD" ]]; then
    echo "Pre-release data is current (HEAD: $FILE_HEAD)"
  fi
fi
```

If `.prerelease-data.md` is fresh and contains `## Triage Summary`, use it for commits, PRs, change groups, netting, modified services, and Linear refs.

If it is stale or missing:

1. Read the current version and last release tag.
2. List merged PRs since the last release.
3. Detect modified services.
4. If PR count is greater than 10, run `workflows/collect-release-data.md`; otherwise collect inline using `reference/semver-analysis.md`.

### 1.3 Read Current State

```bash
cat package.json | jq -r '.version'

LAST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)
if [[ -z "$LAST_TAG" ]]; then
  echo "No previous release tag found. This is the first release."
  LAST_TAG_DATE=$(git log --reverse --format="%ci" | head -1 | cut -d' ' -f1)
else
  echo "Last tag: $LAST_TAG"
  LAST_TAG_DATE=$(git log -1 --format="%ci" "$LAST_TAG" | cut -d' ' -f1)
fi
```

### 1.4 Get Merged PRs Since Last Release

```bash
gh pr list --state merged --base development --json number,title,body,mergedAt,author,labels --limit 3000 | \
  jq --arg date "$LAST_TAG_DATE" '[.[] | select(.mergedAt > $date)]'
```

### 1.5 Detect Modified Services

```bash
MODIFIED_APPS=$(git diff --name-only "$LAST_TAG"..HEAD -- apps/ | cut -d'/' -f2 | sort -u | grep -v '^web$' || true)
MODIFIED_WORKERS=$(git diff --name-only "$LAST_TAG"..HEAD -- workers/ | cut -d'/' -f2 | sort -u || true)
MODIFIED_SERVICES="$MODIFIED_APPS $MODIFIED_WORKERS"
echo "All modified services: $MODIFIED_SERVICES"
```

### 1.6 Run Semver Analysis

Use `reference/semver-analysis.md`:

1. Collect all data or load fresh pre-collected data.
2. Validate the manifest is non-empty.
3. Net out cancelled or reverted changes.
4. Categorize remaining changes.
5. Determine the version bump.

Do not build the changelog until prioritization is parsed.

For larger releases or fresh `.prerelease-data.md` generation, delegate triage using `reference/subagent-execution.md`:

- `Commit Grouper`: explorer, `reasoning_effort: medium`
- `Change Classifier`: explorer, `reasoning_effort: high`
- `Netting Detector`: explorer, `reasoning_effort: xhigh`
- `Summary Writer`: explorer, `reasoning_effort: high`

These triage tasks are sequential because each step consumes the prior output. The controller appends approved generated sections to `.prerelease-data.md`.

### 1.7 Single Prioritization Touchpoint

Only features are shown in the prioritizer. Notable changes and minor fixes are automatically included in the changelog.

Generate `/tmp/release-prioritizer.html` from `templates/prioritizer.html` by replacing:

- `{{NEW_VERSION}}`
- `{{PR_COUNT}}`
- `{{COMMIT_COUNT}}`
- `{{BUMP_TYPE}}`
- `{{ITEMS_JSON}}`

Use a JSON array containing only feature items:

```json
[{ "id": 1, "title": "Feature name", "desc": "User-facing description", "category": "feature" }]
```

Publish the page with `$share --html` or use direct GCS upload:

```bash
SLUG="release-prioritizer-v$(echo "$NEW_VERSION" | tr '.' '')"
gsutil ls gs://intexuraos-shared-content-dev/claude/$SLUG.html 2>&1
gsutil -h "Cache-Control:public, max-age=60" \
  -h "Content-Type:text/html; charset=utf-8" \
  cp /tmp/release-prioritizer.html \
  gs://intexuraos-shared-content-dev/claude/$SLUG.html
rm /tmp/release-prioritizer.html
```

Give the user:

```text
Release Prioritizer ready:
https://intexuraos.cloud/share/claude/<slug>.html

Open the page, star highlights, skip unwanted features, reorder, add comments, then paste the Export & Copy output here.
```

For major releases, also ask for a marketing slogan for the previous major version, or let the user type `skip`.

Parse the export:

- `HIGHLIGHTS` means priority `High` and `highlight = true`.
- `HIGH` means priority `High` and `highlight = false`.
- `SKIPPED` means omit from changelog.
- Text after `|` is the user comment.
- Text after the dash separator is the default description.

Then build:

- priority map
- comments map
- changelog entry per `reference/semver-analysis.md` Step 7
- release notes file per Step 7.1

---

## Phase 2: Service Documentation

Skip this phase when `--skip-docs` is used.

For each service in `MODIFIED_SERVICES`, build a release context from Phase 1:

- features from `## Change Groups` whose service list includes the service
- matching descriptions from `## Triage Summary`
- notable changes whose PRs touched the service path
- user priority, highlight flag, and comments from the prioritizer

Omit skip-priority features and minor fixes.

For each service, dispatch a `worker` subagent using `reference/agent-prompts.md` section `## Service Scribe` with `reasoning_effort: medium`; use `high` for broad changes or newly added services:

```text
Generate documentation for <service-name>.

<release-context-block>
```

Give each service-doc worker a disjoint write scope under `docs/services/<service>/`. Tell the worker not to edit changelog, package versions, release notes, README, website, or git state.

After each service update, dispatch an `explorer` subagent using `## Doc Validator` from `reference/agent-prompts.md` with `reasoning_effort: high`. Log validation summaries. Do not block the release solely on missing coverage unless the validator finds critical hallucinations or active contradictions.

---

## Phase 3: High-Level Docs

Dispatch a `worker` subagent using `reference/agent-prompts.md` section `## Docs Updater` with `reasoning_effort: high`:

```text
Version: vX.Y.Z

High-priority changes:
<list with descriptions>

User comments:
<title-to-comment map>
```

The prompt updates `docs/overview.md`, verifies README badges, and checks `docs/services/index.md`.

Skip edits if no high-priority features affect high-level docs.

Write scope: `docs/overview.md`, README badges only, and `docs/services/index.md`. Do not edit changelog, package versions, release notes, website, or git state.

---

## Phase 4: README Update

Read `README.md` and `templates/readme-whats-new.md`.

Dispatch a `worker` subagent with `reasoning_effort: high` to generate the README "What's New" section from highlighted or high-priority feature items:

- use user comments first
- fall back to triage summaries
- keep one-line impact descriptions
- preserve the accumulation pattern across the current major version

For patch and minor releases, append new tiles to the current major-version section and update its version header. For major releases, create a new section and move prior major-version highlights into history.

Write scope: `README.md` only. The controller reviews the diff before Phase 5.

---

## Phase 5: Website Improvements

Target file: `apps/web/src/pages/HomePage.tsx`.

Skip only when there are zero high-priority features.

Dispatch a `worker` subagent with `reasoning_effort: high`. Write scope: `apps/web/src/pages/HomePage.tsx` only.

Required changes:

- update homepage version strings for hero badge and footer
- add or update `WhatsNewSection`
- insert `<WhatsNewSection />` between integrations and getting-started content when missing
- include only genuinely new capabilities as cards
- exclude migrations, internal refactors, and moved functionality
- for major releases, add version history using the marketing slogan when provided

Use existing React, Tailwind, motion, and `lucide-react` patterns in the file.

After the website worker returns, the controller reviews the diff and verifies that website and README content do not present migrations, refactors, or moved functionality as new features.

---

## Phase 6: Finalize

### 6.1 Branch Safety

Follow project branch rules:

- do not commit directly to `development` or `main`
- work on a feature branch
- open a PR targeting `development`
- do not tag until the release commit is contained in `origin/main`
- use a real Linear issue ID in the release branch, PR title, and PR body when one exists
- if no real `INT-XXX` is available from user input or release context, stop before branch or PR creation and ask the user for the issue ID or explicit permission to proceed without one

If currently on `development` or `main`, create a feature branch before edits are committed.

### 6.2 Sync All Package Versions

```bash
NEW_VERSION="X.Y.Z"

jq ".version = \"$NEW_VERSION\"" package.json > tmp.json && mv tmp.json package.json

for f in apps/*/package.json packages/*/package.json workers/*/package.json; do
  if [[ -f "$f" ]] && [[ "$f" != *"/dist/"* ]]; then
    jq ".version = \"$NEW_VERSION\"" "$f" > tmp.json && mv tmp.json "$f"
  fi
done

MISMATCH=0
for f in package.json apps/*/package.json packages/*/package.json workers/*/package.json; do
  if [[ -f "$f" ]] && [[ "$f" != *"/dist/"* ]]; then
    version=$(jq -r '.version' "$f")
    if [[ "$version" != "$NEW_VERSION" ]]; then
      echo "MISMATCH: $f has version $version"
      MISMATCH=1
    fi
  fi
done
[[ $MISMATCH -eq 0 ]] || exit 1

pnpm install
```

### 6.3 Update Changelog and Release Notes

Prepend the new `## X.Y.Z` section to `CHANGELOG.md`, using sorted type subcategories from `reference/semver-analysis.md`.

Verify `/tmp/release-notes-$NEW_VERSION.md` exists. If missing, rebuild it from the changelog entry using `reference/semver-analysis.md` Step 7.1.

### 6.4 CI Gate

```bash
pnpm run ci:tracked
```

This must pass completely before committing. If it fails, fix every failure and rerun.

The controller owns the CI gate. For bounded CI failures, dispatch a `worker` subagent with `reasoning_effort: high`; escalate to `xhigh` after repeated failure. Give the worker the failing output and a narrow write scope. The controller reruns `pnpm run ci:tracked`.

### 6.5 Pre-Commit Validation

Verify before staging:

- old homepage version string has zero matches
- README "What's New" contains `vX.Y.Z`
- `CHANGELOG.md` contains `## X.Y.Z`
- package versions all match
- `docs/overview.md` reflects any new high-priority capabilities
- modified service docs contain recent changes when Phase 2 ran
- website and README do not present migrations or refactors as new features
- documented endpoints and version numbers are grounded in code or tags

Before committing, dispatch a final `explorer` subagent with `reasoning_effort: xhigh` as Final Release Auditor. It must check the planned release artifacts against `reference/subagent-execution.md`, this workflow, and `AGENTS.md`. Fix all critical findings before staging.

### 6.6 Commit and PR to Development

```bash
RELEASE_ISSUE_ID="INT-XXX" # Use a real issue ID from user input or release context.
BRANCH_NAME="release/$RELEASE_ISSUE_ID-v$NEW_VERSION"

git status
git add CHANGELOG.md package.json pnpm-lock.yaml \
  apps/*/package.json packages/*/package.json workers/*/package.json \
  docs/ README.md apps/web/src/

git commit -m "$RELEASE_ISSUE_ID Release v$NEW_VERSION"
git push -u origin HEAD
gh pr create --base development --head "$(git branch --show-current)" \
  --title "$RELEASE_ISSUE_ID Release v$NEW_VERSION" \
  --body "Fixes $RELEASE_ISSUE_ID"
```

Do not fabricate Linear issue IDs. If the user explicitly permits a release PR without a Linear issue, use a descriptive branch and PR title without `INT-XXX`, and document that explicit permission in the PR body.

### 6.7 After Merge to Main: Tag and GitHub Release

After the release PR has merged to `development` and the normal protected flow has put the release commit on `origin/main`, tag the main commit:

```bash
git fetch origin main
MAIN_SHA=$(git rev-parse origin/main)
git tag -a "v$NEW_VERSION" "$MAIN_SHA" -m "Release v$NEW_VERSION"
git push origin "v$NEW_VERSION"
```

Create the GitHub Release:

```bash
gh release create "v$NEW_VERSION" \
  --title "v$NEW_VERSION" \
  --notes-file /tmp/release-notes-$NEW_VERSION.md \
  --target main
```

### 6.8 Post-Release Validation

Run all checks:

```bash
TAG_COMMIT=$(git rev-parse "v$NEW_VERSION^{}")
git branch -r --contains "$TAG_COMMIT" | grep "origin/main" && echo "PASS: Tag on main" || echo "FAIL: Tag NOT on main"

gh release view "v$NEW_VERSION" --json tagName,targetCommitish,body --jq '{tag: .tagName, target: .targetCommitish, bodyLength: (.body | length)}'

grep -q "## $NEW_VERSION" CHANGELOG.md && echo "PASS: Version in CHANGELOG" || echo "FAIL: Version NOT in CHANGELOG"

MISMATCH=0
for f in package.json apps/*/package.json packages/*/package.json workers/*/package.json; do
  if [[ -f "$f" ]] && [[ "$f" != *"/dist/"* ]]; then
    version=$(jq -r '.version' "$f")
    [[ "$version" == "$NEW_VERSION" ]] || { echo "MISMATCH: $f has $version"; MISMATCH=1; }
  fi
done
[[ $MISMATCH -eq 0 ]] && echo "PASS: All versions match" || echo "FAIL: Version mismatch"

git branch --show-current
```

All checks must pass. Fix failed checks before reporting the release complete.

### 6.9 Summary

Use `templates/release-summary.md` and include:

- GitHub Release URL
- version
- changelog categories
- PR URL
- validation results

---

## Resume from Phase

When resuming with `$release --phase N`, reconstruct state from:

| Variable          | Source                                                 |
| ----------------- | ------------------------------------------------------ | -------- |
| `NEW_VERSION`     | `jq -r '.version' package.json` or Phase 1 calculation |
| `LAST_TAG`        | `git tag -l "v\*" --sort=-v:refname                    | head -1` |
| modified services | rerun Phase 1.5                                        |
| change data       | fresh `.prerelease-data.md` or semver analysis         |

For Phase 6 resume, read version, changelog, and release notes from files.

## Error Handling

| Error                         | Recovery                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------- |
| CI fails                      | Fix every failure, rerun `pnpm run ci:tracked`, do not commit until passing      |
| service docs fail             | Log exact service and failure; continue only if no critical hallucination exists |
| embeddings fail               | Report command and error; continue release                                       |
| release PR blocked            | Report blocker; do not bypass protected branches                                 |
| tag not on main               | Delete local/remote tag only after confirming target, then retag main            |
| GitHub Release creation fails | Report command to rerun and the release notes file path                          |
