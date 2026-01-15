# Release

Generate a new release by analyzing actual code changes since the last release.

**Important:** Ignore commit messages. They are often misleading. Analyze the actual diff of each commit to understand what really changed.

## Steps

### 1. Read Current State

```bash
# Current version from root package.json
cat package.json | grep '"version"'

# Last release in CHANGELOG
head -50 CHANGELOG.md
```

### 2. Find Last Release Point

```bash
# Check for version tags
git tag -l "v*" --sort=-v:refname | head -5

# If no tag, find commit that set current version in CHANGELOG
git log --oneline --all -- CHANGELOG.md | head -10
```

### 3. Get List of Commits to Analyze

```bash
# Get commit hashes since last release (oldest first)
git log <last-release-commit>..HEAD --reverse --format="%H"
```

### 4. Analyze Each Commit's ACTUAL Changes

For EACH commit, run:

```bash
git show <commit-hash> --stat        # See which files changed
git show <commit-hash>               # See actual diff
```

**DO NOT trust the commit message.** Read the diff and determine:

- What files were added/modified/deleted?
- What functions/classes/routes were added?
- What behavior changed?
- What infrastructure was modified?

### 5. Categorize Based on File Paths and Content

#### Functional Changes (User-Facing)

| Path Pattern                        | Category                                          |
| ----------------------------------- | ------------------------------------------------- |
| `apps/*/src/routes/*.ts`            | API Endpoints - read the route to see method/path |
| `apps/*/src/domain/*/models/*.ts`   | Domain Models - note new types/interfaces         |
| `apps/*/src/domain/*/usecases/*.ts` | Use Cases - describe the business logic           |
| `apps/web/src/components/*.tsx`     | Web UI Components                                 |
| `apps/web/src/pages/*.tsx`          | Web UI Pages                                      |
| `packages/infra-*`                  | Integration Features (if adding new provider)     |

#### Technical Changes (Infrastructure)

| Path Pattern                             | Category                   |
| ---------------------------------------- | -------------------------- |
| `apps/*/` (new directory)                | Services Created           |
| `packages/*/` (new directory)            | Packages Created           |
| `terraform/**`                           | Infrastructure (Terraform) |
| `**/Dockerfile`                          | Docker Configuration       |
| `.github/workflows/*`                    | CI/CD Pipeline             |
| `migrations/*.mjs`                       | Database Migrations        |
| `**/vitest.config.ts`, `**/__tests__/**` | Testing Infrastructure     |
| `scripts/*`                              | Development Tools          |

### 6. Determine Semver Version Bump

Based on the categorized changes, determine the release type using this decision tree:

**Decision Table:**

| Change Type                                      | Release Level | Example                                |
| ------------------------------------------------ | ------------- | -------------------------------------- |
| **Breaking Changes**                             |               |                                        |
| Deleted routes/endpoints                         | **MAJOR**     | Removed `POST /todos`                  |
| Deleted domain models/use cases                  | **MAJOR**     | Removed `Todo` entity                  |
| Modified API signatures (removed params)         | **MAJOR**     | Removed `userId` from request          |
| Required previously optional params              | **MAJOR**     | `title?: string` → `title: string`     |
| Deleted Firestore collections                    | **MAJOR**     | Dropped `todos` collection             |
| Terraform resource deletion                      | **MAJOR**     | Removed Cloud Run service              |
| **New Features**                                 |               |                                        |
| New API endpoints                                | **MINOR**     | Added `GET /bookmarks`                 |
| New domain models/use cases                      | **MINOR**     | Added `Bookmark` entity                |
| New UI pages/components                          | **MINOR**     | Added settings page                    |
| New services/packages                            | **MINOR**     | Added `image-service`                  |
| New integrations/providers                       | **MINOR**     | Added OpenAI provider                  |
| **Bug Fixes & Improvements**                     |               |                                        |
| Bug fixes (backward compatible)                  | **PATCH**     | Fixed null pointer in todos            |
| Refactoring (no behavior change)                 | **PATCH**     | Extracted helper function             |
| Testing infrastructure                           | **PATCH**     | Added tests for bookmarks              |
| CI/CD improvements                               | **PATCH**     | Updated GitHub workflow                |
| Documentation                                    | **PATCH**     | Updated README                         |
| Performance improvements                          | **PATCH**     | Optimized query                        |

**Algorithm:**

```
IF any breaking_changes_found:
    RETURN "major"
ELSE IF any new_features_found:
    RETURN "minor"
ELSE:
    RETURN "patch"
```

**Examples:**

```
# Breaking change detected
- Removed `GET /internal/todos` endpoint → MAJOR (0.0.5 → 1.0.0)

# New feature only
- Added `POST /bookmarks` endpoint → MINOR (0.0.5 → 0.1.0)

# Bug fixes only
- Fixed todo pagination bug → PATCH (0.0.5 → 0.0.6)

# Mixed (new feature + bug fixes)
- Added `POST /bookmarks` + fixed pagination → MINOR (0.0.5 → 0.1.0)
  (new features take precedence over patches)
```

**Note for Early Development (0.0.X):**
- Still follow semver rules for consistency
- Breaking changes still warrant major bump (0.0.5 → 1.0.0)
- This prepares for proper semver when v1.0 is released

### 7. Build the Changelog Entry

**Format:** Unnumbered version headers with date only.

```markdown
## YYYY-MM-DD

### Added

- [Describe new features based on actual code added]

### Changed

- [Describe modifications based on actual diff]

### Fixed

- [Describe bug fixes based on what the code now does differently]

### Technical

- [Infrastructure/architecture changes]

---
```

**Changelog Rules:**

- Use date as header, not version number
- No numbered lists within sections — use bullet points
- Keep descriptions concise but meaningful
- Group related changes together
- Most recent release at the top

### 8. Update All Package Versions

**CRITICAL:** All package.json files must have the same version.

```bash
# Get new version
NEW_VERSION="X.Y.Z"

# Update root package.json
pnpm version $NEW_VERSION --no-git-tag-version

# Update all apps
for app in apps/*/package.json; do
  jq ".version = \"$NEW_VERSION\"" "$app" > tmp.json && mv tmp.json "$app"
done

# Update all packages
for pkg in packages/*/package.json; do
  jq ".version = \"$NEW_VERSION\"" "$pkg" > tmp.json && mv tmp.json "$pkg"
done

# Regenerate lock file
pnpm install
```

### 9. Update CHANGELOG.md Header

Update the "Current Version" line at the top of CHANGELOG.md:

```markdown
**Current Version:** X.Y.Z
```

### 10. Commit Release

```bash
git add CHANGELOG.md package.json package-lock.json apps/*/package.json packages/*/package.json
git commit -m "Release vNEW_VERSION"
```

---

## Analysis Approach

When reading a diff:

1. **New file added** → What does it do? Read the code.
2. **Function added** → What's its purpose? Read the implementation.
3. **Route added** → What endpoint? What does it handle?
4. **Component added** → What UI does it render?
5. **Test added** → What feature does it cover? (usually indicates the feature)
6. **Config changed** → What setting was modified and why?

## What to Skip

- Pure refactoring with no behavior change
- Formatting/linting changes
- Comment-only changes
- Test-only changes (unless they reveal a new feature)
- Dependency updates (unless significant)

## What to Highlight

- New API endpoints (method, path, purpose)
- New UI pages or significant components
- New integrations or providers
- Bug fixes (describe what was broken, now works)
- Performance improvements
- Security enhancements
- Breaking changes (MUST be noted)

## Version Strategy

Use semantic versioning:

- **Major (X.0.0)** — Breaking changes, major rewrites
- **Minor (0.X.0)** — New features, significant additions
- **Patch (0.0.X)** — Bug fixes, small improvements

For early development (0.0.X), increment patch for each release until feature-complete.
