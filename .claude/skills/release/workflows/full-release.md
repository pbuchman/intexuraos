# Full Release Workflow

**Trigger:** User calls `/release`

---

## Phase 1: Kickoff

### 1.1 Tool Verification

Verify all required tools are available:

```bash
git --version
gh auth status
node --version
```

If any fails, ABORT with clear error message.

### 1.2 Check for Pre-Collected Data

Before doing CLI work, check if `.prerelease-data.md` exists and is current:

```bash
if [[ -f ".prerelease-data.md" ]]; then
  FILE_HEAD=$(head -1 .prerelease-data.md | grep -oP '(?<=HEAD: )\w+')
  CURRENT_HEAD=$(git rev-parse HEAD)
  if [[ "$FILE_HEAD" == "$CURRENT_HEAD" ]]; then
    echo "Pre-release data is current (HEAD: $FILE_HEAD)"
  fi
fi
```

**If fresh:** Load commits, PRs, modified services, and Linear refs from the file. If it contains a `## Triage Summary` section (from `/release --collect`), change groups and classifications are ready — use them directly in step 1.6 instead of re-analyzing. Skip steps 1.3-1.5.

**If stale or missing:**

1. Run steps 1.3-1.5 to get PR list and count
2. Apply the **Collection Strategy Table:**

| PR Count | Strategy                                                                                         | Rationale                                                 |
| -------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1-10     | Inline — execute semver-analysis Steps 3-6 directly                                              | Small enough to collect in main context                   |
| 11-25    | Dispatch — run `./scripts/collect-release-data.sh` then Steps 1-4 from `collect-release-data.md` | Too many PRs for reliable inline collection               |
| 26+      | Dispatch — same as 11-25                                                                         | Mandatory; inline collection WILL produce incomplete data |

**This table is NOT advisory — it is a hard gate.** If PR count exceeds 10, you MUST run the collection pipeline. Do not rationalize skipping it ("I can see the PR titles are clear enough", "most are small fixes", etc.).

After collection pipeline completes, reload `.prerelease-data.md` and proceed to step 1.6.

### 1.3 Read Current State

```bash
# Current version
cat package.json | jq -r '.version'

# Last release tag (with first-release guard)
LAST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)
if [[ -z "$LAST_TAG" ]]; then
  echo "No previous release tag found. This is the first release."
  LAST_TAG_DATE=$(git log --reverse --format="%ci" | head -1 | cut -d' ' -f1)
else
  echo "Last tag: $LAST_TAG"
  LAST_TAG_DATE=$(git log -1 --format="%ci" $LAST_TAG | cut -d' ' -f1)
fi
```

### 1.4 Get Merged PRs Since Last Release

```bash
# LAST_TAG_DATE was computed in step 1.3 (with first-release guard)

# List merged PRs since that date
gh pr list --state merged --base development --json number,title,body,mergedAt,author --limit 100 | \
  jq --arg date "$LAST_TAG_DATE" '[.[] | select(.mergedAt > $date)]'
```

### 1.5 Detect Modified Services

```bash
# Find apps changed since last tag (excluding web app)
LAST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)
MODIFIED_APPS=$(git diff --name-only $LAST_TAG..HEAD -- apps/ | cut -d'/' -f2 | sort -u | grep -v web)
echo "Modified apps: $MODIFIED_APPS"

# Find workers changed since last tag
MODIFIED_WORKERS=$(git diff --name-only $LAST_TAG..HEAD -- workers/ | cut -d'/' -f2 | sort -u)
echo "Modified workers: $MODIFIED_WORKERS"

# Combined list for documentation
MODIFIED_SERVICES="$MODIFIED_APPS $MODIFIED_WORKERS"
echo "All modified services: $MODIFIED_SERVICES"
```

### 1.6 Run Semver Analysis

Execute the semver analysis per [`reference/semver-analysis.md`](../reference/semver-analysis.md) Steps 3-6:

1. Collect all data (3.1-3.5) — or use pre-collected data from step 1.2 if available
2. Validate manifest is non-empty (3.6)
3. Net out cancelled changes (4) — or use netting from `## Netting Analysis` if present
4. Categorize remaining changes (5) — or use `## Change Groups` if present
5. Determine version bump (6) — `## Triage Summary` may suggest one, but user confirms

**Do NOT build changelog yet** — that happens after prioritization in step 1.7.

### 1.7 Single Prioritization Touchpoint

**This is the ONLY user interaction point before Phase 6.** Present all categorized changes in a consolidated view and collect priorities + optional comments.

Use `AskUserQuestion` tool with this format:

```
Release Prioritization — vCURRENT → vNEW

Modified services: [list]
PRs merged: [count]
Suggested bump: [major/minor/patch]

Priority guide:
  High   = First in CHANGELOG, top 3 become GitHub Release highlights, used for README/website
  Medium = Standard position in CHANGELOG
  Low    = Last in CHANGELOG
  Skip   = Omitted from CHANGELOG entirely

## Changes (adjust priorities, add comments, then type "go")

### Features (default: High)
  1. [Feature description] — PR #XXX / INT-XXX
  2. [Feature description] — PR #XXX / INT-XXX

### Notable Changes (default: Medium)
  3. [Change description] — PR #XXX
  4. [Change description] — PR #XXX

### Minor Fixes (default: Low)
  5-8. 4 bug fixes:
       - whatsapp: [fix description] (#XXX)
       - calendar: [fix description] (#XXX)
       - bookmarks: [fix description] (#XXX)
       - research: [fix description] (#XXX)

Commands:
  "3 high" — change #3 to High priority
  "1 comment: Voice transcription enables..." — add description comment to #1
  "5 skip" — exclude #5 from changelog (targets entire batch if 5 is a batched range; use "expand 5-8" first to target individual items)
  "expand 5-8" — show individual items in a batched group (assigns each a unique number for individual commands)
  "preview" — show final changelog preview before confirming
  "slogan: End-to-end AI autonomy..." — set marketing slogan (major releases only)
  "go" or "approve" — confirm and proceed
```

**Command validation:** If the user types an unrecognized command, respond with the valid command list and ask them to try again.

**Batching rules:**

- Features: shown individually (each gets its own number)
- Notable changes: shown individually
- Minor fixes: batched by area if >4 (e.g., "5-8. 4 bug fixes across whatsapp, calendar services")
- **Batch command semantics:** Commands targeting a batch number (e.g., "5 skip") apply to the **entire batch**. To target individual items within a batch, the user must first "expand 5-8" to assign unique numbers, then use those individual numbers.

**For major version releases**, also prompt:

```
  This is a MAJOR version release. Please provide a marketing slogan for the
  previous major version (vX.x) for the Version History section, or type "skip".
```

**After user confirms ("go"):**

1. Store the **priority map** (change number → High/Medium/Low/Skip)
2. Store the **comments map** (change number → user comment text)
3. Store the **marketing slogan** (if major release)
4. Build changelog entry per [`reference/semver-analysis.md`](../reference/semver-analysis.md) Step 7
5. Build GitHub Release body per Step 7.1

Store all results for downstream phases.

---

## Phase 2: Service Documentation (Silent Batch)

### 2.1 For Each Modified Service

For each service in `MODIFIED_SERVICES`:

```
Use Task tool with:
- subagent_type: "service-scribe"
- prompt: "Generate documentation for the <service-name> service"
- run_in_background: false (wait for completion)
```

### 2.2 Parallel Execution

Launch ALL service-scribe agents in a single message with multiple Task tool calls:

```
Task 1: service-scribe for actions-agent
Task 2: service-scribe for bookmarks-agent
Task 3: service-scribe for research-agent
... etc
```

### 2.3 Wait for Completion

All agents must complete before proceeding. Do NOT ask for user confirmation here — this is silent batch processing.

---

## Phase 3: High-Level Docs (Automatic)

### 3.1 Spawn Docs Updater Agent

Launch the `release-docs-updater` agent with High-priority changes and optional user comments from Phase 1:

```
Use Agent tool with:
- subagent_type: "release-docs-updater"
- prompt: |
    Version: vX.Y.Z

    High-priority changes:
    [list of High-priority items with descriptions]

    User comments:
    [map of change → comment from Phase 1 touchpoint]
- run_in_background: false
```

The agent will automatically:

1. Update `docs/overview.md` following `docs/STANDARDS.md` rules
2. Verify README badges (AI Models count, Components count)
3. Check `docs/services/index.md` has all services listed

### 3.2 Skip Condition

If the release has no High-priority features that affect the overview (e.g., pure bugfix release), the agent will report "No changes needed" and this phase completes instantly.

---

## Phase 4: README Update (Automatic)

### 4.1 Read Current README

```bash
head -150 README.md
```

### 4.2 Generate "What's New" Section

Use template from [`templates/readme-whats-new.md`](../templates/readme-whats-new.md).

Auto-generate from High-priority items collected in Phase 1:

- Use user comments (from Phase 1 touchpoint) as descriptions where provided
- Fall back to triage summary descriptions for items without comments
- Sort by: Features first, then Notable changes, then fixes
- Use concise table format (see template)

### 4.3 Apply Changes

Use Edit tool to apply the "What's New" section following the accumulation pattern (see step 4.4):

- **Patch/minor release:** APPEND new tiles to the existing section, update version in header
- **Major release:** Replace entire section with only the new release tiles (move old tiles to VersionHistorySection)

### 4.4 Accumulation Pattern (MANDATORY)

**README "What's New" section accumulates across a MAJOR version:**

- **Showcase ALL High-priority features** from ALL sub-releases in current major version
- Example: v2.0.0 (6 features) + v2.1.0 (2 features) → 8 tiles total in v2.x section
- **Only when new major version releases** (e.g., v3.0.0) do old features move to VersionHistorySection
- **Header**: "What's New in vX.Y.Z"
- **Right side**: Changelog link
- **Maximum**: 3-12 feature tiles

**For PATCH releases (X.Y.Z+1):** Add new tiles to existing section
**For MINOR releases (X.Y+1.0):** Add new tiles to existing section
**For MAJOR releases (X+1.0.0):** Create new section, move old to VersionHistorySection

---

## Phase 5: Website Improvements (Automatic)

### 5.1 Detect Major Version Release

Check if this is a MAJOR version bump (X+1.0.0):

```bash
# Compare current version with new version
CURRENT_VERSION="2.1.0"  # From package.json
NEW_VERSION="3.0.0"       # From Phase 1 calculation

if [[ $(echo "$NEW_VERSION" | cut -d'.' -f1) -gt $(echo "$CURRENT_VERSION" | cut -d'.' -f1) ]]; then
  echo "MAJOR VERSION RELEASE"
  # Need to create VersionHistorySection
fi
```

### 5.2 Auto-Update RecentUpdatesSection

Map High-priority features from Phase 1 to website-ready content:

- Transform feature descriptions into user-facing language
- Use user comments from Phase 1 touchpoint for richer descriptions
- Use brutalist design: `BrutalistCard` with icon, title, description
- Color coding (optional):
  - Green → user-facing improvements
  - Purple → AI/classification features
  - Yellow → calendar/time features
  - Cyan → model control
  - Orange → dashboard/organization
  - Red → safety/reliability

**Tile Grid Layout:**

- Mobile: 1 column
- Tablet: 2 columns (md:grid-cols-2)
- Desktop: 3 columns (lg:grid-cols-3)

### 5.3 Generate VersionHistorySection Content (Major Release Only)

**ONLY for major version releases**, create expandable version history section.

**Structure:**

- Expandable button below "What's New" section
- Combined subreleases (e.g., v2.0.0, v2.1.0 → v2.x paragraph)
- List format: paragraphs, not tiles
- Marketing slogan from Phase 1 touchpoint (collected during step 1.7)

**Example v1.x content:**

```markdown
v1.x — Launch

End-to-end AI autonomy: From your mobile to the cloud and back. IntexuraOS went from architecture document to handling live traffic — voice to research, links to bookmarks, dates to calendar events. The full AI agent pipeline is now processing real user requests in production.
```

### 5.4 Implement Changes

**Guard:** If no features were marked High priority in the Phase 1 priority map, skip the RecentUpdatesSection update. Only invoke frontend-design when there are concrete features to display.

Invoke the frontend-design skill for the website updates:

```
Use Skill tool with:
- skill: "frontend-design"
- args: "Update RecentUpdatesSection with [N] new feature tiles from release vX.Y.Z: [list of High-priority features with descriptions]"
```

For major releases, invoke VersionHistorySection **after** RecentUpdatesSection completes (sequential, not parallel — both touch the same web files):

```
Use Skill tool with:
- skill: "frontend-design"
- args: "Create VersionHistorySection for vX.x with marketing slogan: [slogan from Phase 1]"
```

---

## Phase 6: Finalize

### 6.1 Update All Package Versions (MANDATORY)

**CRITICAL:** All package.json files must have the same version. This ensures the monorepo stays in sync.

```bash
NEW_VERSION="X.Y.Z"  # From Phase 1 calculation

# Update root package.json
jq ".version = \"$NEW_VERSION\"" package.json > tmp.json && mv tmp.json package.json

# Update all apps (excluding dist directories)
for app in apps/*/package.json; do
  if [[ ! "$app" == *"/dist/"* ]]; then
    jq ".version = \"$NEW_VERSION\"" "$app" > tmp.json && mv tmp.json "$app"
  fi
done

# Update all packages (excluding dist directories)
for pkg in packages/*/package.json; do
  if [[ ! "$pkg" == *"/dist/"* ]]; then
    jq ".version = \"$NEW_VERSION\"" "$pkg" > tmp.json && mv tmp.json "$pkg"
  fi
done

# Update all workers (excluding dist directories)
for worker in workers/*/package.json; do
  if [[ ! "$worker" == *"/dist/"* ]]; then
    jq ".version = \"$NEW_VERSION\"" "$worker" > tmp.json && mv tmp.json "$worker"
  fi
done

# Verify all versions are updated
echo "Verifying all package.json versions..."
MISMATCH=0
for f in package.json apps/*/package.json packages/*/package.json workers/*/package.json; do
  if [[ ! "$f" == *"/dist/"* ]]; then
    version=$(jq -r '.version' "$f")
    if [[ "$version" != "$NEW_VERSION" ]]; then
      echo "MISMATCH: $f has version $version"
      MISMATCH=1
    fi
  fi
done
if [[ $MISMATCH -eq 1 ]]; then
  echo "ERROR: Version mismatch detected. Fix before proceeding."
  exit 1
fi
echo "All package.json files updated to $NEW_VERSION"

# Regenerate lock file after version changes
pnpm install
```

**Why all packages?** In a monorepo, version consistency ensures:

- Clear release tracking across all services
- Deployment scripts can rely on consistent versioning
- No confusion about which service is at which version

### 6.2 Update CHANGELOG.md and Release Notes

Prepend the changelog entry built during Phase 1 (see [`reference/semver-analysis.md`](../reference/semver-analysis.md) Step 7):

1. Read current CHANGELOG.md
2. Insert new `## X.Y.Z` section at the top (below any file header)
3. Use the type-subcategorized, priority-ordered entries from Step 7:

```markdown
## X.Y.Z

### Added

- [High-priority entries first]
- [Medium-priority entries]
- [Low-priority entries]

### Fixed

- [entries sorted by priority]

### Improved

- [entries sorted by priority]
```

4. Omit empty subcategories (e.g., if no `### Removed` entries, skip it entirely)

Also verify the GitHub Release notes file:

- This was generated in Phase 1 step 1.7 per [`reference/semver-analysis.md`](../reference/semver-analysis.md) Step 7.1
- Confirm `/tmp/release-notes-$NEW_VERSION.md` exists; if missing, rebuild per Step 7.1

### 6.3 CI Gate (MANDATORY)

```bash
pnpm run ci:tracked
```

**This MUST pass.** If it fails:

1. Report the failure
2. Fix the issues
3. Re-run CI
4. Do NOT proceed until CI passes

### 6.4 Refresh RAG Embeddings

After CI passes (all docs are finalized), re-generate embeddings for the chat-agent RAG pipeline:

```bash
FIRESTORE_EMULATOR_HOST="" \
GOOGLE_CLOUD_PROJECT=intexuraos-dev-pbuchman \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
OPENAI_API_KEY=$INTEXURAOS_OPENAI_APP_API_KEY \
pnpm run embed-docs
```

**What this does:**

1. Reads all `docs/**/*.md` files (250+ files)
2. Chunks by markdown headers (max 8000 chars per chunk)
3. Generates OpenAI `text-embedding-3-small` embeddings (1536-dim)
4. Uploads to `doc_embeddings` Firestore collection (production)
5. Cleans stale embeddings from deleted docs

**Skip condition:** If `--skip-docs` was used, skip this step (no doc changes to re-embed).

**Failure handling:** Log the error but do NOT block the release. Embeddings can be re-run manually:

```bash
FIRESTORE_EMULATOR_HOST="" GOOGLE_CLOUD_PROJECT=intexuraos-dev-pbuchman \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
OPENAI_API_KEY=$INTEXURAOS_OPENAI_APP_API_KEY pnpm run embed-docs
```

**Environment note:** The `FIRESTORE_EMULATOR_HOST=""` and `GOOGLE_CLOUD_PROJECT=intexuraos-dev-pbuchman` overrides are required because direnv sets emulator variables locally. Without them, the script targets the non-running emulator instead of production Firestore.

### 6.5 Stage & Commit on Development

```bash
git status
git add CHANGELOG.md package.json pnpm-lock.yaml \
  apps/*/package.json packages/*/package.json workers/*/package.json \
  docs/ README.md apps/web/src/

NEW_VERSION="X.Y.Z"  # From Phase 1

git commit -m "$(cat <<'EOF'
Release vX.Y.Z

- Bumped all package.json versions to X.Y.Z
- Updated service documentation
- Updated docs/overview.md
- Updated README "What's New" section
- Website improvements
- Refreshed RAG embeddings (doc_embeddings)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

### 6.6 Push Development

```bash
git push origin development
```

### 6.7 Merge Development → Main

```bash
# Check if a dev→main PR already exists
EXISTING_PR=$(gh pr list --base main --head development --json number --jq '.[0].number // empty')

if [ -n "$EXISTING_PR" ]; then
  # Merge existing PR
  gh pr merge $EXISTING_PR --merge
else
  # Direct merge path
  git checkout main
  git pull origin main
  git merge development --no-edit
  if [[ $? -ne 0 ]]; then
    echo "MERGE CONFLICT detected. Resolve conflicts, then:"
    echo "  git add <resolved-files>"
    echo "  git merge --continue"
    echo "  git push origin main"
    echo "  git checkout development"
    # STOP and ask user for guidance
    exit 1
  fi
  git push origin main
  git checkout development
fi
```

**Why merge before tagging?** Tags should point to `main` — the canonical release branch. Tagging on `development` means the tag references a commit that may never reach `main` in the same form (merge commits change SHAs).

### 6.8 Tag on Main

```bash
# Tag the merge commit on main (not development)
git fetch origin main
MAIN_SHA=$(git rev-parse origin/main)
git tag -a "v$NEW_VERSION" "$MAIN_SHA" -m "Release v$NEW_VERSION"
git push origin "v$NEW_VERSION"
```

### 6.9 Create GitHub Release

```bash
# Verify release notes file exists
if [[ ! -f "/tmp/release-notes-$NEW_VERSION.md" ]]; then
  echo "WARNING: Release notes file not found. Building from CHANGELOG..."
  # Fallback: extract the current version's section from CHANGELOG.md
fi

gh release create "v$NEW_VERSION" \
  --title "v$NEW_VERSION" \
  --notes-file /tmp/release-notes-$NEW_VERSION.md \
  --target main
```

The release notes file is built during step 6.2 (CHANGELOG and release notes generation). See the **Build GitHub Release Body** step in [`reference/semver-analysis.md`](../reference/semver-analysis.md) for the generation logic.

### 6.10 Post-Release Validation

Run all checks and report results. **Do NOT skip any check.**

```bash
# 1. Tag points to main
echo "=== Tag target ==="
TAG_COMMIT=$(git rev-parse "v$NEW_VERSION^{}")
git branch -r --contains "$TAG_COMMIT" | grep "origin/main" && echo "PASS: Tag on main" || echo "FAIL: Tag NOT on main"

# 2. GitHub Release exists and has content
echo "=== GitHub Release ==="
gh release view "v$NEW_VERSION" --json tagName,targetCommitish,body --jq '{tag: .tagName, target: .targetCommitish, bodyLength: (.body | length)}'

# 3. CHANGELOG contains the version
echo "=== CHANGELOG ==="
grep -q "## $NEW_VERSION" CHANGELOG.md && echo "PASS: Version in CHANGELOG" || echo "FAIL: Version NOT in CHANGELOG"

# 4. All package.json versions match
echo "=== Package versions ==="
MISMATCH=0
for f in package.json apps/*/package.json packages/*/package.json workers/*/package.json; do
  if [[ ! "$f" == *"/dist/"* ]] && [[ -f "$f" ]]; then
    version=$(jq -r '.version' "$f")
    if [[ "$version" != "$NEW_VERSION" ]]; then
      echo "MISMATCH: $f has $version"
      MISMATCH=1
    fi
  fi
done
[[ $MISMATCH -eq 0 ]] && echo "PASS: All versions match" || echo "FAIL: Version mismatch"

# 5. Current branch is development (not stuck on main)
echo "=== Current branch ==="
CURRENT=$(git branch --show-current)
[[ "$CURRENT" == "development" ]] && echo "PASS: On development" || echo "WARN: On $CURRENT (expected development)"
```

**All checks must PASS.** If any check fails:

| Failure                   | Recovery                                                                         |
| ------------------------- | -------------------------------------------------------------------------------- |
| Tag not on main           | Delete tag, re-tag on correct SHA, push                                          |
| GitHub Release missing    | Run `gh release create` manually                                                 |
| CHANGELOG missing version | Edit CHANGELOG.md, create new fixup commit, push normally                        |
| Package version mismatch  | Fix mismatched files, create new fixup commit, push normally                     |
| Merge to main fails       | Detect conflicts, STOP, ask user for guidance. Do NOT force-push or auto-resolve |
| Wrong branch              | `git checkout development`                                                       |

### 6.11 Display Summary

Use template from [`templates/release-summary.md`](../templates/release-summary.md).

Include the GitHub Release URL and validation results in the summary output:

```
https://github.com/pbuchman/intexuraos/releases/tag/v$NEW_VERSION
```

---

## Error Handling

### CI Failure in Phase 6

If `pnpm run ci:tracked` fails:

1. **Do NOT commit or tag**
2. Report which checks failed
3. Fix the issues
4. Re-run CI
5. Only after CI passes, proceed with commit/tag

### User Skips All Changes

If user marks all changes as "Skip" during Phase 1 prioritization:

1. Phases 3-5 have no High-priority items to work with — they complete instantly
2. Phase 6 still runs with a minimal changelog (version bump only)
3. Tag is still created and pushed

### Resume State

When resuming from `--phase N`, reconstruct state from:

| Variable          | Source when resuming                                          |
| ----------------- | ------------------------------------------------------------- |
| NEW_VERSION       | `jq -r '.version' package.json`                               |
| LAST_TAG          | `git tag -l "v*" --sort=-v:refname \| head -1`                |
| MODIFIED_SERVICES | Re-run step 1.4 detection                                     |
| Change Manifest   | Re-run semver analysis (steps 3-7) if resuming before Phase 6 |

For Phase 6 resume: version and changelog are already committed, so read from files.

### Agent Failure in Phase 2

If a service-scribe agent fails:

1. Log the error
2. Continue with other agents
3. Report partial success in summary
4. Allow user to decide whether to proceed
