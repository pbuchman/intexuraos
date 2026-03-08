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
gsutil version
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

**This is the ONLY user interaction point before Phase 6.** An interactive HTML page is generated, shared via `/share`, and the user prioritizes **features only**. Notable changes and minor fixes bypass the prioritizer and are automatically included in the changelog.

#### 1.7.1 Generate Interactive Prioritization Page

1. Read the `## Triage Summary` from `.prerelease-data.md` (or from the semver analysis output if collected inline)
2. Build a JSON array of **only features** (NOT notable changes or minor fixes):

```json
[{ "id": 1, "title": "Feature name", "desc": "User-facing description", "category": "feature" }]
```

**Notable changes and minor fixes are NOT included in the prioritizer.** They are automatically categorized into changelog type subcategories (Added/Changed/Fixed/Improved/Removed) during step 1.7.4.

3. Read the template from [`templates/prioritizer.html`](../templates/prioritizer.html)
4. Replace the following placeholders in the template:
   - `{{NEW_VERSION}}` → e.g., `v3.2.0`
   - `{{PR_COUNT}}` → number of merged PRs
   - `{{COMMIT_COUNT}}` → number of commits
   - `{{BUMP_TYPE}}` → `MAJOR`, `MINOR`, or `PATCH`
   - `{{ITEMS_JSON}}` → the JSON array from step 2 (features only)
5. Write the result to `/tmp/release-prioritizer.html`

#### 1.7.2 Share the Page

Upload via the `/share` skill's GCS workflow (skip `/frontend-design` — the HTML is already self-contained):

```bash
SLUG="release-prioritizer-v$(echo $NEW_VERSION | tr '.' '')"

# Check collision
gsutil ls gs://intexuraos-shared-content-dev/claude/$SLUG.html 2>&1

# Upload (overwrite if same version slug)
gsutil -h "Cache-Control:public, max-age=60" \
  -h "Content-Type:text/html; charset=utf-8" \
  cp /tmp/release-prioritizer.html \
  gs://intexuraos-shared-content-dev/claude/$SLUG.html

rm /tmp/release-prioritizer.html
```

**Use a short cache TTL (60s)** — the user may reload after re-uploading with adjustments.

#### 1.7.3 Present URL and Wait

Present the URL to the user and wait for them to paste back the export:

```
Release Prioritizer ready:
https://intexuraos.cloud/share/claude/<slug>.html

Instructions:
1. Open the page
2. ★ Star items for README/website highlights
3. ✕ Skip items to omit from CHANGELOG
4. Drag to reorder priority
5. Add comments to override descriptions
6. Click "Export & Copy" and paste the result here
```

**For major version releases**, also ask:

```
This is a MAJOR version release. Please also provide a marketing slogan for the
previous major version (vX.x) for the Version History section, or type "skip".
```

#### 1.7.4 Parse the Export

The user pastes structured text from the page's export. Parse it to extract:

```
RELEASE PRIORITIZATION — vX.Y.Z
=============================================

HIGHLIGHTS (N) — README + Website
  1. Title | comment or — description [category]
  2. Title — description [category]

HIGH (N) — CHANGELOG
  1. Title | comment [category]
  2. Title — description [category]

SKIPPED (N)
  1. Title [category]
```

**Parsing rules:**

- `HIGHLIGHTS` section → priority = High, highlight = true (used for README/website)
- `HIGH` section → priority = High, highlight = false
- `SKIPPED` section → priority = Skip
- Items with `|` have user comments (text after `|`, before `[category]`)
- Items with `—` use default descriptions (text after `—`, before `[category]`)
- `[feature]` / `[notable]` / `[minor]` → original category for changelog type grouping

**After parsing:**

1. Store the **priority map** (title → High/Skip + highlight flag) — features only
2. Store the **comments map** (title → user comment text) — features only
3. Store the **marketing slogan** (if major release)
4. **Auto-include notable changes and minor fixes** — categorize all notable changes and minor fixes from the triage summary into changelog type subcategories (Added/Changed/Fixed/Improved/Removed). These are NOT subject to user prioritization and are always included.
5. Build changelog entry per [`reference/semver-analysis.md`](../reference/semver-analysis.md) Step 7 — combining user-prioritized features with auto-included notable changes and minor fixes
6. Build GitHub Release body per Step 7.1

Store all results for downstream phases.

---

## Phase 2: Service Documentation (Silent Batch)

### 2.1 Build Per-Service Release Context

For each service in `MODIFIED_SERVICES`, assemble a release context block from Phase 1 data:

1. **Filter Features from Change Groups**: From the `## Change Groups` → `### Features` table, select rows where "Services Touched" contains the service name
2. **Map to Triage Descriptions**: For each matching feature group, find the corresponding line in `## Triage Summary` → `### Features` (match by PR numbers)
3. **Include Notable Changes**: From `## Triage Summary` → `### Notable Changes`, include lines whose PR numbers appear in commits that touched this service's directory (use the commits section's file paths for matching)
4. **Attach User Prioritization**: For each triage item, look up the priority map from Phase 1.7 — attach priority (High/Skip), highlight flag, and user comment (if any)

Assemble into a structured markdown block per service:

```markdown
## Release Context

Version: vX.Y.Z (from vPREV)
Last tag: vPREV

### Features Touching This Service

**[Highlighted]** <feature-group-name>

- Triage: <user-facing description from Triage Summary>
- PRs: #N, #N, #N
- Linear: INT-NNN, INT-NNN
- Priority: High | Highlight: yes
- User comment: "<user's comment from prioritizer, or —>"

<feature-group-name>
- Triage: <user-facing description from Triage Summary>
- PRs: #N, #N
- Linear: INT-NNN
- Priority: High | Highlight: no
- User comment: —

### Notable Changes Touching This Service

- <notable change description> (INT-NNN, PR #N)
- <notable change description> (PR #N)
```

**Rules for the context block:**

- **Omit Skip-priority features entirely** — if the user skipped a feature in the prioritizer, the doc agent should not emphasize it
- **Mark highlighted items with `[Highlighted]`** — these are README/website headline features
- **Include user comments** — the user's own words about what matters
- **Include all notable changes** that touch the service — these are auto-included in the release (not subject to prioritization)
- **Omit minor fixes** — too granular; the agent's own `git log` handles these

### 2.2 For Each Modified Service

For each service in `MODIFIED_SERVICES`:

```
Use Task tool with:
- subagent_type: "service-scribe"
- prompt: |
    Generate documentation for the <service-name> service.

    <release-context-block from step 2.1>
- run_in_background: false (wait for completion)
```

### 2.3 Parallel Execution

Launch ALL service-scribe agents in a single message with multiple Task tool calls:

```
Task 1: service-scribe for actions-agent
Task 2: service-scribe for bookmarks-agent
Task 3: service-scribe for research-agent
... etc
```

### 2.4 Wait for Completion

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

## Phase 5: Website Improvements

**Target file:** `apps/web/src/pages/HomePage.tsx` — all website updates happen in this single file.

**Guard condition:** Skip this phase ONLY if there are zero High-priority features. The absence of a component is NOT a reason to skip — create it.

### 5.1 Update Version Strings

Find and replace the version in two hardcoded locations:

1. **Hero badge** — inside the `HeroSection` function, find the `IntexuraOS vX.Y.Z` text and update to new version
2. **Footer** — inside the `Footer` function, find the `<span>` containing `vX.Y.Z` and update

Search the file for the previous version string to confirm zero remaining references.

### 5.2 Add or Update WhatsNewSection

For each High-priority feature from Phase 1, create a feature card in the `WhatsNewSection` function.

**If `WhatsNewSection` already exists:** Update its content — replace the version in the header, add/remove/update feature cards to match the current release.

**If `WhatsNewSection` does not exist:** Create it as a new function and insert `<WhatsNewSection />` between `<IntegrationsSection />` and `<GettingStartedSection />` in the `HomePage` render.

**Design pattern** (matches existing sections):

```tsx
const features = [
  {
    title: 'Feature Name',
    description: 'One-line user-facing description.',
    icon: LucideIconComponent,
    borderColor: 'border-purple-200',
    bgGradient: 'bg-gradient-to-br from-purple-50 to-white',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-700',
  },
  // ... one per High-priority feature
];
```

- **Grid:** `grid gap-6 md:grid-cols-2 lg:grid-cols-3`
- **Card style:** `rounded-2xl`, gradient border (`border-{color}-200`), gradient bg (`bg-gradient-to-br from-{color}-50 to-white`), hover lift via `motion.div` with `whileHover={{ y: -5 }}`, icon in `rounded-xl` container
- **Icons:** `lucide-react` — select icons that match the feature domain
- **Color palette:** purple, cyan, emerald, blue, violet, amber, green (one per card, vary)
- **No external skill invocations** — write JSX directly using existing patterns
- **Content filtering:** Only genuinely new capabilities become cards. Migrations, internal refactors, and moved functionality are excluded. If a feature existed before and was moved to a new service, it is a migration — not a new feature.

**Section header pattern:**

```tsx
<p className="mb-4 text-sm font-semibold uppercase tracking-wider text-cyan-600">What's New</p>
<h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
  vX.Y.Z —{' '}
  <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
    N new capabilities.
  </span>
</h2>
```

### 5.3 Version History (Major Release Only)

When releasing a NEW major version (e.g., v3.0.0):

- Create a collapsible version history section below What's New
- Content: combined features from previous major version's sub-releases
- Format: expandable panel, not tiles
- Uses marketing slogan from Phase 1 touchpoint

**Skip condition:** Only for major version releases.

### Accumulation Pattern

- **Minor/patch releases:** Append new cards to existing `WhatsNewSection` grid, update version header
- **Major releases:** Reset section content, move old cards to version history

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

### 6.5 Pre-Merge Release Validation (MANDATORY)

Before staging the commit, verify every phase produced its expected output. Walk through this checklist and confirm each item. If any item fails, go back and fix it before committing.

#### Content Checklist

| Check                  | How to Verify                                                                         | Expected                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Version strings**    | Search `HomePage.tsx` for previous version string                                     | Zero matches — all updated to new version                              |
| **What's New section** | Check `HomePage.tsx` for `WhatsNewSection`                                            | Present with cards for each High-priority feature (unless all skipped) |
| **README What's New**  | Read the "What's New in vX.Y.Z" table in README.md                                    | Updated with new version, contains High-priority features              |
| **CHANGELOG**          | Read top of CHANGELOG.md                                                              | Contains `## X.Y.Z` section with categorized entries                   |
| **Package versions**   | Spot-check 3 random package.json files                                                | All show new version                                                   |
| **docs/overview.md**   | Read the overview narrative                                                           | Reflects any new capabilities added in this release                    |
| **Service docs**       | For each modified service, check `docs/services/<name>/technical.md` "Recent Changes" | Contains entries from this release                                     |

#### Accuracy Checklist

| Check                         | How to Verify                                  | Expected                                                                         |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| **No false "new" features**   | Review What's New cards and README table       | Migrations, refactors, and moved functionality are NOT presented as new features |
| **Version numbers grounded**  | Search all modified docs for `vX.Y.Z` patterns | Every version mentioned exists in `git tag -l "v*"`                              |
| **No hallucinated endpoints** | Spot-check 2 service technical.md files        | Every endpoint listed exists in the actual route files                           |

#### Improvement Loop

If any check fails:

1. Fix the issue
2. Re-run `pnpm run ci:tracked` if code was changed
3. Re-verify the failed check
4. Continue only when all checks pass

### 6.6 Stage & Commit on Development

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

### 6.7 Push Development

```bash
git push origin development
```

### 6.8 Merge Development → Main

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

### 6.9 Tag on Main

```bash
# Tag the merge commit on main (not development)
git fetch origin main
MAIN_SHA=$(git rev-parse origin/main)
git tag -a "v$NEW_VERSION" "$MAIN_SHA" -m "Release v$NEW_VERSION"
git push origin "v$NEW_VERSION"
```

### 6.10 Create GitHub Release

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

### 6.11 Post-Release Validation

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

### 6.12 Display Summary

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
