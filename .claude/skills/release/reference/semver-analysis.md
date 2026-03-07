# Semver Analysis Reference

Analyze merged pull requests, commit messages, and their associated Linear issues (including subissues) since the last release to determine the version bump and build changelog entries.

**Important:** Use commit messages, PR descriptions, AND Linear issues as combined sources of truth. Each captures different granularity — commits show atomic changes, PRs show intent and context, Linear shows business rationale and hierarchy.

## Architecture: Collect First, Process Second

This workflow follows a strict **collect → net → categorize → build** pipeline:

1. **Collect** all raw data (PRs, commits, Linear issues + subissues)
2. **Net out** cancelled changes (added then removed in same release)
3. **Categorize** remaining changes
4. **Build** the changelog from the netted, categorized result

Never categorize or filter during collection. Collect everything first.

## Steps

### 1. Read Current State

```bash
# Current version from root package.json
cat package.json | grep '"version"'

# Last release in CHANGELOG
head -30 CHANGELOG.md
```

### 2. Find Last Release Point

```bash
# Check for version tags
git tag -l "v*" --sort=-v:refname | head -5

# Get the date of the last release tag (with first-release guard)
LAST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)
if [[ -z "$LAST_TAG" ]]; then
  echo "No previous release tag found. This is the first release."
  LAST_TAG_DATE=$(git log --reverse --format="%ci" | head -1 | cut -d' ' -f1)
else
  LAST_TAG_DATE=$(git log -1 --format="%ci" $LAST_TAG | cut -d' ' -f1)
fi
```

### 3. Collect ALL Data (Do Not Process Yet)

**CRITICAL:** Complete ALL sub-steps before moving to Step 4. Do not categorize, filter, or skip anything during collection.

**Scale enforcement:** If you are executing these steps inline (not via the `--collect` pipeline), you are responsible for completing every sub-step for every PR. For releases with 11+ PRs, this is prohibitively expensive in the main context — use the `--collect` pipeline instead (see `full-release.md` step 1.2 Collection Strategy Table).

**Common failure mode:** Skipping Steps 3.2-3.4 and categorizing from PR titles alone. This produces shallow, inaccurate triage. PR titles are summaries — commits, Linear issues, and subissues contain the actual change details needed for correct categorization and netting.

#### 3.1 Collect All Merged PRs

```bash
# List PRs merged since last release date
gh pr list --state merged --base development --json number,title,body,mergedAt,author,labels --limit 100 | \
  jq --arg date "<last-release-date>" '[.[] | select(.mergedAt > $date)]'
```

For EACH merged PR, also fetch full details:

```bash
gh pr view <pr-number> --json title,body,labels,mergedAt,commits
```

Store: PR number, title, body, labels, mergedAt, author.

#### 3.2 Collect All Commit Messages Per PR

For each PR collected in 3.1, extract the individual commit messages:

```bash
# Get all commits in a PR
gh pr view <pr-number> --json commits --jq '.commits[].messageHeadline'
```

Commit messages capture granular changes that PR descriptions may summarize or omit. Store each commit message alongside its parent PR number.

**What to extract from commit messages:**

- Conventional commit prefixes: `feat:`, `fix:`, `chore:`, `refactor:`, `perf:`, `docs:`
- Linear issue IDs: `INT-XXX` patterns
- Scope indicators: `feat(classifier):`, `fix(whatsapp):`
- Revert indicators: `Revert "..."` or `revert:` prefix

#### 3.3 Collect Direct Commits Without PRs

Some commits are pushed directly without going through a PR:

```bash
# Get commits since last release that aren't from merge commits
git log v<last-version>..origin/development --no-merges --format="%H %s" | \
  while read hash msg; do
    # Check if commit is part of any merged PR
    if ! gh pr list --state merged --search "$hash" --json number | jq -e 'length > 0' > /dev/null 2>&1; then
      echo "$hash $msg"
    fi
  done
```

For each direct commit, store: hash, message, any `INT-XXX` reference.

#### 3.4 Collect All Linear Issues and Subissues

Extract ALL `INT-XXX` references found across:

- PR titles and bodies (from 3.1)
- Commit messages (from 3.2 and 3.3)

For EACH unique Linear issue ID:

1. **Fetch the issue** using `mcp__linear__get_issue`
2. **Extract:** title, description, labels, state, parent issue ID
3. **Fetch subissues** using `mcp__linear__list_issues` with `parentId` filter (limit: 20)
4. **For each subissue:** extract title, description, labels, state

**Why subissues matter:** A parent issue like "INT-300: Revamp classifier" may have subissues that describe individual changes ("INT-301: Add Polish support", "INT-302: Add keyword isolation"). The subissues often contain the granular changelog-worthy details that the parent issue rolls up.

Store the full issue hierarchy: parent → children, with labels and descriptions for each.

#### 3.5 Build Unified Change Manifest

After ALL collection is complete, assemble a single manifest:

```
Change Manifest:
├── PR #101: "feat: add calendar preview"
│   ├── Commits: ["feat(calendar): add preview endpoint", "feat(calendar): add preview UI"]
│   ├── Linear: INT-250 (labels: feature)
│   │   ├── Subissue: INT-251 "Preview rendering" (labels: feature)
│   │   └── Subissue: INT-252 "Preview approval flow" (labels: feature)
│   └── Source: PR description + commit messages + Linear context
├── PR #105: "fix: duplicate WhatsApp messages"
│   ├── Commits: ["fix(whatsapp): deduplicate approval messages"]
│   ├── Linear: INT-260 (labels: bug)
│   └── Source: PR description + commit messages + Linear context
├── PR #110: "revert: remove calendar preview"
│   ├── Commits: ["Revert 'feat: add calendar preview'"]
│   ├── Linear: none
│   └── Source: PR title indicates revert of PR #101
└── Direct commit: abc123 "chore: fix typo in README"
    └── Linear: none
```

This manifest is the SINGLE source for all subsequent steps.

#### 3.6 Validate Manifest

If the manifest is empty (no PRs, no direct commits):

Use `AskUserQuestion`:

```
"No changes detected since last release. How to proceed?"
```

**Options:**

1. "Abort release" (Recommended)
2. "Create version-only release" — bump version with empty changelog
3. "Let me check" — pause for manual investigation

#### Completeness Gate (MANDATORY before Step 4)

Before proceeding to Step 4 (netting), verify ALL of the following. If ANY check fails, STOP and complete the missing collection.

| Check | How to Verify | Failure Action |
|-------|--------------|----------------|
| Every PR has commits collected | Each manifest entry has non-empty `Commits` array | Re-run Step 3.2 for missing PRs |
| All INT-XXX refs fetched from Linear | Count unique INT-XXX in manifest vs. fetched issues | Re-run Step 3.4 for missing IDs |
| Unified manifest assembled | Manifest exists with PR → commits → Linear structure | Re-run Step 3.5 |
| No PR was skipped during collection | Manifest PR count matches `gh pr list` count | Investigate missing PRs |

**If using pre-collected data:** The `## Triage Summary` section in `.prerelease-data.md` satisfies this gate — the collection pipeline already enforces completeness through its 4 sequential agent steps.

### 4. Net Out Cancelled Changes

**CRITICAL:** Before categorizing, detect and remove changes that cancel each other out within this release window.

#### 4.1 Detect Revert Pairs

Scan the manifest for:

| Pattern                          | Detection Method                                           |
| -------------------------------- | ---------------------------------------------------------- |
| Explicit revert PRs              | PR title starts with `revert:` or `Revert "..."`           |
| Revert commits                   | Commit message starts with `Revert "..."`                  |
| Add-then-remove on same resource | PR adds feature X, later PR removes/disables feature X     |
| Feature flag on then off         | PR enables flag, later PR disables same flag               |
| Endpoint added then removed      | Route added in one PR, route removed in another            |
| Linear issue cancelled           | Linear issue state is `Cancelled` or has `won't-fix` label |

#### 4.2 Net Out Algorithm

```
FOR each change in manifest:
  IF change is a revert:
    Mark BOTH the revert AND the original as "netted out"
  IF change adds feature X AND another change removes feature X:
    Mark BOTH as "netted out"
  IF Linear issue state is Cancelled:
    Mark as "netted out"

REMOVE all "netted out" entries from manifest
```

#### 4.3 Document What Was Netted

Keep a separate log of netted changes for transparency:

```
Netted Out (not included in changelog):
- PR #101 "feat: add calendar preview" ← reverted by PR #110
- PR #110 "revert: remove calendar preview" ← revert of PR #101
- INT-275 "Add dark mode toggle" ← Linear state: Cancelled
```

Present this log to the user for verification before building the changelog.

### 5. Categorize Remaining Changes

**Only categorize changes that survived netting (Step 4).**

**Categorization sources (in priority order):**

1. **Linear issue labels** — `feature`, `bug`, `chore`, `breaking-change` (check both parent and subissues)
2. **PR labels** — Similar categorization
3. **Commit message prefixes** — `feat:`, `fix:`, `chore:`, `refactor:`, `perf:`, `docs:`
4. **Linear issue title prefix** — `[sentry]`, `[feature]`, etc.
5. **PR title prefix** — Convention-based
6. **PR description content** — Look for explicit mentions of breaking changes

**Label to Category Mapping:**

| Label/Prefix                      | Verb Prefix | Semver Impact |
| --------------------------------- | ----------- | ------------- |
| `breaking-change`, `BREAKING`     | Removed     | MAJOR         |
| `feature`, `feat:`, `enhancement` | Added       | MINOR         |
| `bug`, `fix:`, `[sentry]`         | Fixed       | PATCH         |
| `improvement`, `perf:`            | Improved    | PATCH         |
| `chore`, `refactor`               | Changed     | PATCH         |

**Combining sources for richer descriptions:**

For each change, synthesize the best description by combining:

- **Commit messages** → What specifically changed (granular, technical)
- **PR description** → Why it changed and what it means (context, intent)
- **Linear issue/subissues** → Business rationale and user-facing framing

Prefer user-facing language from Linear issues over technical language from commits.

### 5.1 Prioritization (Handled by Phase 1 Touchpoint)

**This step is executed as part of the Phase 1 single prioritization touchpoint in `full-release.md` step 1.7.** The categorized changes from Step 5 are presented to the user in a consolidated view. Do not use separate AskUserQuestion calls here.

**Priority assignments from the touchpoint:**

| Priority | CHANGELOG position                | GitHub Release Highlights |
| -------- | --------------------------------- | ------------------------- |
| High     | First within its type subcategory | Top 3 become Highlights   |
| Medium   | Standard position in subcategory  | Not in Highlights         |
| Low      | Last within its type subcategory  | Not in Highlights         |
| Skip     | Omitted entirely                  | Not in Highlights         |

**GitHub Release Highlights:** Pick the top 3 High-priority items. If fewer than 3 are High, promote the top Medium items.

---

### 6. Determine Semver Version Bump

Based on the categorized changes (post-netting):

**Decision Table:**

| Change Type             | Release Level | How to Detect                                       |
| ----------------------- | ------------- | --------------------------------------------------- |
| **Breaking Changes**    | **MAJOR**     |                                                     |
| API breaking change     | MAJOR         | PR mentions "breaking", Linear has `breaking` label |
| Removed endpoint        | MAJOR         | PR describes removal, deprecation notice            |
| Schema migration        | MAJOR         | PR mentions migration, DB changes                   |
| **New Features**        | **MINOR**     |                                                     |
| New feature             | MINOR         | Linear `feature` label, PR title `feat:`            |
| New service             | MINOR         | PR describes new service, Linear mentions new       |
| **Fixes & Maintenance** | **PATCH**     |                                                     |
| Bug fix                 | PATCH         | Linear `bug` label, PR title `fix:`, `[sentry]`     |
| Refactoring             | PATCH         | PR title `refactor:`, Linear `chore` label          |
| Documentation           | PATCH         | PR title `docs:`, docs-only changes                 |

**Algorithm:**

```
IF any change (post-netting) indicates breaking changes:
    RETURN "major"
ELSE IF any change (post-netting) indicates new features:
    RETURN "minor"
ELSE:
    RETURN "patch"
```

### 7. Build the Changelog Entry

**Format:** Version header with type subcategories. Entries sorted by priority within each category.

```markdown
## X.Y.Z

### Added

- [feature description with inline `code` for commands/settings]
- [another feature] (INT-XXX)

### Changed

- [modification description]

### Fixed

- [bug description]

### Improved

- [enhancement description]

### Removed

- [deprecation description]
```

**Entry Rules:**

| Rule                    | Example                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| Type subcategories      | `### Added`, `### Changed`, `### Fixed`, `### Improved`, `### Removed` |
| Omit empty categories   | If no fixes, skip `### Fixed` entirely                                 |
| Single line per entry   | No paragraphs, no multi-line descriptions                              |
| Use backticks for code  | commands, flags, env vars, settings, file paths                        |
| Linear refs optional    | `(INT-XXX)` at end of line if helpful                                  |
| User-facing only        | Skip pure internal refactorings unless they affect users               |
| Most recent at top      | New version goes above existing versions                               |
| No netted-out changes   | If added AND removed in this release, omit entirely                    |
| Combine related commits | Multiple commits on same feature = single changelog entry              |
| Priority ordering       | High → Medium → Low within each subcategory (from Step 5.1)            |
| Skip = omit             | Changes marked "Skip" in Step 5.1 are not included                     |

**Verb Usage:**

| Verb     | Use For                                                    |
| -------- | ---------------------------------------------------------- |
| Added    | New features, new capabilities, new options                |
| Fixed    | Bug fixes, error corrections, regressions                  |
| Improved | Performance, UX enhancements to existing features          |
| Changed  | Behavioral modifications, renames, config changes          |
| Removed  | Deprecated features, deleted functionality, breaking drops |

**Building entries from combined sources:**

Use this priority for writing the changelog line:

1. **Linear issue title** (if user-facing and concise) → best for user-facing language
2. **PR title** (if descriptive) → good summary of intent
3. **Commit messages** (if PR/Linear are vague) → fallback for specificity

If a parent Linear issue has subissues, decide:

- **Few subissues (2-3):** One changelog entry per subissue if each is user-facing
- **Many subissues (4+):** One combined entry using the parent issue description
- **Mixed:** Entry for the parent + separate entries only for standout subissues

**What to Include:**

- User-facing features and changes
- Bug fixes users would notice
- Performance improvements with impact
- New integrations and services
- Security fixes (call out explicitly)

**What to Skip:**

- Pure test additions without user impact
- Internal refactorings with no behavior change
- CI/tooling config changes
- Dependency updates (unless security-related)
- **Changes that were netted out (added then removed in same release)**

### 7.1 Build GitHub Release Body

After building the CHANGELOG entry, generate a richer GitHub Release body. This is written to `/tmp/release-notes-$NEW_VERSION.md` for use in Phase 6.

**Format:** Mirrors the sorted CHANGELOG structure with an added Highlights section.

```markdown
## Highlights

- [Top 3 most impactful changes, one sentence each]

## What's Changed

### Added

- [entries from CHANGELOG ### Added section]

### Changed

- [entries from CHANGELOG ### Changed section]

### Fixed

- [entries from CHANGELOG ### Fixed section]

### Improved

- [entries from CHANGELOG ### Improved section]

### Removed

- [entries from CHANGELOG ### Removed section]

## CHANGELOG

See [CHANGELOG.md](https://github.com/pbuchman/intexuraos/blob/main/CHANGELOG.md) for all versions.

**Full Changelog**: https://github.com/pbuchman/intexuraos/compare/vPREVIOUS...vNEW_VERSION
```

**Rules:**

| Rule                       | Details                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| Highlights first           | Pick the top 3 High-priority items from Step 5.1                    |
| Match CHANGELOG categories | Use same `### Added/Changed/Fixed/Improved/Removed` subcategories   |
| Skip empty categories      | If no fixes, omit the `### Fixed` section                           |
| Reuse CHANGELOG wording    | Use the same entries from Step 7                                    |
| Include comparison link    | `compare/vPREVIOUS...vNEW_VERSION` for GitHub's diff view           |
| Write to temp file         | `/tmp/release-notes-$NEW_VERSION.md` — consumed by Phase 6 step 6.9 |

**Comparison link:** Use the previous version tag (from Step 2) as `vPREVIOUS`.

```bash
# Write the release notes file
cat > /tmp/release-notes-$NEW_VERSION.md << 'RELEASE_EOF'
[generated content]
RELEASE_EOF
```

---

## What to Skip

- PRs that only update dependencies (unless security-related)
- PRs that only modify CI/tooling configs
- PRs with `skip-changelog` label
- Revert PRs that net out with their original (omit BOTH from changelog)
- Direct commits that are merge conflict resolutions
- PRs that only add/update tests without user-facing changes
- **Changes that were added AND removed/reverted within the same release window**

## What to Highlight

- PRs with `feature` or `enhancement` labels on Linear
- PRs fixing customer-reported issues (often have Sentry links)
- PRs with `breaking-change` label (MUST be prominently noted)
- PRs that add new services or integrations
- Security fixes (even if PATCH, call out explicitly)
- Performance improvements mentioned in PR description
- Linear parent issues with many completed subissues (indicates significant effort)

## Using Linear MCP Tools

To fetch Linear issue details for a PR:

1. **Extract issue ID** from PR title/body/commits (pattern: `INT-XXX`)
2. **Fetch issue details:**
   ```
   Use mcp__linear__get_issue with the issue ID
   ```
3. **Extract useful fields:**
   - `title` — User-facing description
   - `description` — Full context
   - `labels` — Categorization (feature, bug, chore, etc.)
   - `state` — Verify issue was completed (or cancelled → net out)
4. **Fetch subissues:**
   ```
   Use mcp__linear__list_issues with parentId filter, limit: 20
   ```
5. **For each subissue:** Extract title, labels, state. Cancelled subissues are netted out.

**Label Interpretation:**

| Linear Label      | Changelog Verb | Semver Impact |
| ----------------- | -------------- | ------------- |
| `feature`         | Added          | MINOR         |
| `enhancement`     | Improved       | MINOR         |
| `bug`             | Fixed          | PATCH         |
| `breaking-change` | Removed        | MAJOR         |
| `chore`           | Changed        | PATCH         |

## Version Strategy

Use semantic versioning:

- **Major (X.0.0)** — Breaking changes, major rewrites
- **Minor (0.X.0)** — New features, significant additions
- **Patch (0.0.X)** — Bug fixes, small improvements
