# Release

Generate a new release by analyzing actual code changes since the last release.

**Important:** Ignore commit messages. They are often misleading. Analyze the actual diff of each commit to understand what really changed.

## Steps

### 1. Read Current State

```bash
# Current version
cat package.json | grep '"version"'

# Last release in CHANGELOG
head -30 CHANGELOG.md
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

| Path Pattern | Category |
|-------------|----------|
| `apps/*/src/routes/*.ts` | API Endpoints - read the route to see method/path |
| `apps/*/src/domain/*/models/*.ts` | Domain Models - note new types/interfaces |
| `apps/*/src/domain/*/usecases/*.ts` | Use Cases - describe the business logic |
| `apps/web/src/components/*.tsx` | Web UI Components |
| `apps/web/src/pages/*.tsx` | Web UI Pages |
| `packages/infra-*` | Integration Features (if adding new provider) |

#### Technical Changes (Infrastructure)

| Path Pattern | Category |
|-------------|----------|
| `apps/*/` (new directory) | Services Created |
| `packages/*/` (new directory) | Packages Created |
| `terraform/**` | Infrastructure (Terraform) |
| `**/Dockerfile` | Docker Configuration |
| `.github/workflows/*` | CI/CD Pipeline |
| `firestore.indexes.json` | Database Design |
| `**/vitest.config.ts`, `**/__tests__/**` | Testing Infrastructure |
| `scripts/*` | Development Tools |

### 6. Build the Changelog Entry

Read the actual code to write meaningful descriptions:

```markdown
## [NEW_VERSION] - YYYY-MM-DD

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

### 7. Update Files and Commit

```bash
# Edit CHANGELOG.md with the new entry
# Update version in package.json
npm version NEW_VERSION --no-git-tag-version

# Commit
git add CHANGELOG.md package.json package-lock.json
git commit -m "Release vNEW_VERSION"
```

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
