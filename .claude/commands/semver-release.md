# Release

Generate a new release by analyzing merged pull requests and their associated Linear issues since the last release.

**Important:** Use PR descriptions and Linear issues as the primary source of truth. They contain human-written context about what changed and why.

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

# Get the date of the last release tag
git log -1 --format="%ci" v<last-version>
```

### 3. Get Merged PRs Since Last Release

```bash
# List PRs merged since last release date
gh pr list --state merged --base main --json number,title,body,mergedAt,author --limit 100 | \
  jq --arg date "<last-release-date>" '[.[] | select(.mergedAt > $date)]'
```

### 3.5. Get Direct Commits Without PRs

Some commits are pushed directly to development without going through a PR. Capture these separately:

```bash
# Get commits on development since last release that aren't from merge commits
git log v<last-version>..origin/development --no-merges --format="%H %s" | \
  while read hash msg; do
    # Check if commit is part of any merged PR
    if ! gh pr list --state merged --search "$hash" --json number | jq -e 'length > 0' > /dev/null 2>&1; then
      echo "$hash $msg"
    fi
  done
```

For each direct commit:

1. Use the commit message as the description
2. Extract Linear issue ID if present (INT-XXX pattern)
3. Categorize based on commit message prefix (feat:, fix:, chore:, etc.)

### 4. For Each PR: Extract Information

For EACH merged PR:

1. **Read the PR description** - Contains summary, test plan, and context
2. **Extract Linear issue IDs** - Look for `INT-XXX` patterns in title or body
3. **Fetch Linear issue details** - Use MCP tools to get issue title, description, and labels

```bash
# Get full PR details including body
gh pr view <pr-number> --json title,body,labels,mergedAt
```

For Linear issues, use the `mcp__linear__get_issue` tool:

- Extract issue ID from PR (e.g., `INT-123` → `INT-123`)
- Fetch issue details: title, description, labels, state

### 5. Categorize Based on PR and Linear Context

**Categorization sources (in priority order):**

1. **Linear issue labels** - `feature`, `bug`, `chore`, `breaking-change`
2. **PR labels** - Similar categorization
3. **Linear issue title prefix** - `[sentry]`, `[feature]`, etc.
4. **PR title prefix** - Convention-based (e.g., `feat:`, `fix:`, `chore:`)
5. **PR description content** - Look for explicit mentions of breaking changes

**Label to Category Mapping:**

| Label/Prefix                      | Verb Prefix | Semver Impact |
| --------------------------------- | ----------- | ------------- |
| `breaking-change`, `BREAKING`     | Removed     | MAJOR         |
| `feature`, `feat:`, `enhancement` | Added       | MINOR         |
| `bug`, `fix:`, `[sentry]`         | Fixed       | PATCH         |
| `improvement`, `perf:`            | Improved    | PATCH         |
| `chore`, `refactor`               | Changed     | PATCH         |

### 6. Determine Semver Version Bump

Based on the categorized changes from PRs, Linear issues, and direct commits:

**Decision Table:**

| Change Type            | Release Level | How to Detect                                       |
| ---------------------- | ------------- | --------------------------------------------------- |
| **Breaking Changes**   | **MAJOR**     |                                                     |
| API breaking change    | MAJOR         | PR mentions "breaking", Linear has `breaking` label |
| Removed endpoint       | MAJOR         | PR describes removal, deprecation notice            |
| Schema migration       | MAJOR         | PR mentions migration, DB changes                   |
| **New Features**       | **MINOR**     |                                                     |
| New feature            | MINOR         | Linear `feature` label, PR title `feat:`            |
| New service            | MINOR         | PR describes new service, Linear mentions new       |
| **Fixes & Maintenance**| **PATCH**     |                                                     |
| Bug fix                | PATCH         | Linear `bug` label, PR title `fix:`, `[sentry]`     |
| Refactoring            | PATCH         | PR title `refactor:`, Linear `chore` label          |
| Documentation          | PATCH         | PR title `docs:`, docs-only changes                 |

**Algorithm:**

```
IF any PR/issue indicates breaking changes:
    RETURN "major"
ELSE IF any PR/issue indicates new features:
    RETURN "minor"
ELSE:
    RETURN "patch"
```

### 7. Build the Changelog Entry

**Format:** Version header with simple bullet list.

```markdown
## X.Y.Z

- Added [feature description with inline `code` for commands/settings]
- Added [another feature] (INT-XXX)
- Changed [modification description]
- Fixed [bug description]
- Improved [enhancement description]
- Removed [deprecation description]
```

**Entry Rules:**

| Rule                    | Example                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| Start with verb         | Added, Fixed, Improved, Changed, Removed                                |
| Single line per entry   | No paragraphs, no multi-line descriptions                               |
| Use backticks for code  | commands, flags, env vars, settings, file paths                         |
| Linear refs optional    | `(INT-XXX)` at end of line if helpful                                   |
| User-facing only        | Skip pure internal refactorings unless they affect users                |
| No subcategories        | No `### Added`, `### Fixed` headers — just the bullet list              |
| Most recent at top      | New version goes above existing versions                                |

**Verb Usage:**

| Verb     | Use For                                                    |
| -------- | ---------------------------------------------------------- |
| Added    | New features, new capabilities, new options                |
| Fixed    | Bug fixes, error corrections, regressions                  |
| Improved | Performance, UX enhancements to existing features          |
| Changed  | Behavioral modifications, renames, config changes          |
| Removed  | Deprecated features, deleted functionality, breaking drops |

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

### 8. Update All Package Versions

**CRITICAL:** All package.json files must have the same version.

```bash
# Get new version
NEW_VERSION="X.Y.Z"

# Update root package.json
pnpm version $NEW_VERSION --no-git-tag-version

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

# Regenerate lock file
pnpm install
```

### 9. Commit Release

```bash
git add CHANGELOG.md package.json pnpm-lock.yaml apps/*/package.json packages/*/package.json workers/*/package.json
git commit -m "Release vNEW_VERSION"
```

---

## What to Skip

- PRs that only update dependencies (unless security-related)
- PRs that only modify CI/tooling configs
- PRs with `skip-changelog` label
- Revert PRs (mention original in changelog if significant)
- Direct commits that are merge conflict resolutions
- PRs that only add/update tests without user-facing changes

## What to Highlight

- PRs with `feature` or `enhancement` labels on Linear
- PRs fixing customer-reported issues (often have Sentry links)
- PRs with `breaking-change` label (MUST be prominently noted)
- PRs that add new services or integrations
- Security fixes (even if PATCH, call out explicitly)
- Performance improvements mentioned in PR description

## Using Linear MCP Tools

To fetch Linear issue details for a PR:

1. **Extract issue ID** from PR title/body (pattern: `INT-XXX`)
2. **Fetch issue details:**
   ```
   Use mcp__linear__get_issue with the issue ID
   ```
3. **Extract useful fields:**
   - `title` — User-facing description
   - `description` — Full context
   - `labels` — Categorization (feature, bug, chore, etc.)
   - `state` — Verify issue was completed

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
