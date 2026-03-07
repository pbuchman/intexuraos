---
name: release
description: Orchestrate a 6-phase release workflow with automated service documentation, high-level docs updates, README "What's New" section, website improvements, RAG embeddings refresh, and semantic versioning. Use when preparing a new release.
argument-hint: '[--skip-docs | --phase N | --collect]'
---

# Release Skill

Orchestrate a comprehensive 6-phase release workflow with checkpoints for user control.

## Usage

```
/release                    # Full release workflow
/release --skip-docs        # Skip Phase 2 (service documentation)
/release --phase 3          # Resume from specific phase
/release --collect          # Only collect and triage release data (no release)
```

## Invocation Detection

| Argument      | Workflow                                                                 | What Happens                                                                                                          |
| ------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| (none)        | [`workflows/full-release.md`](workflows/full-release.md)                 | Full 6-phase release                                                                                                  |
| `--skip-docs` | [`workflows/full-release.md`](workflows/full-release.md)                 | Full release, skip Phase 2                                                                                            |
| `--phase N`   | [`workflows/full-release.md`](workflows/full-release.md)                 | Resume from Phase N                                                                                                   |
| `--collect`   | [`workflows/collect-release-data.md`](workflows/collect-release-data.md) | **Separate pipeline** — run bash script + 4 agent triage steps, produce `.prerelease-data.md`, then STOP. No release. |

**`--collect` is NOT a modifier of the release workflow.** It runs a completely different pipeline and exits. The output file is consumed later by `/release` Phase 1 step 2 if it exists and is fresh.

## Core Mandates

1. **Feature-Only Prioritization**: Phase 1 presents only **features** in the interactive prioritizer. User stars highlights, skips unwanted features, reorders, and adds comments. Notable changes and minor fixes are **automatically included** in the changelog without user intervention. This is the ONLY user interaction before Phase 6.
2. **Silent Batch Processing**: Phase 2 runs service-scribe agents in parallel without user interaction
3. **CI Gate**: `pnpm run ci:tracked` MUST pass before Phase 6 commits anything
4. **Tag Push**: Phase 6 creates AND pushes the version tag to remote
5. **Automatic Docs & Website**: Phases 3, 4, and 5 run automatically using prioritization data from Phase 1 — no checkpoints
6. **Monorepo Version Sync**: Phase 6 MUST update ALL package.json files (root, apps/\*, packages/\*, workers/\*) to the new version — not just the root
7. **Sorted Changelog Style**: Changelog entries use type subcategories (`### Added`, `### Fixed`, etc.) with entries sorted by priority within each category
8. **Tag on Main**: Tag MUST be created on `main` after merge, not on `development`
9. **GitHub Release**: Phase 6 MUST create a GitHub Release with categorized release notes matching the sorted CHANGELOG format
10. **Post-Release Validation**: Phase 6 MUST run 5 validation checks after release creation — all must PASS

## Phase Overview

| Phase | Name            | Interaction  | Key Actions                                                                                          |
| ----- | --------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| 1     | Kickoff         | User Input   | Run semver analysis, single prioritization touchpoint                                                |
| 2     | Service Docs    | Silent Batch | Spawn service-scribe agents in parallel                                                              |
| 3     | High-Level Docs | Automatic    | Auto-update docs/overview.md via release-docs-updater agent                                          |
| 4     | README          | Automatic    | Auto-generate "What's New" from High-priority items                                                  |
| 5     | Website         | Automatic    | Auto-update RecentUpdatesSection from High-priority features                                         |
| 6     | Finalize        | Automatic    | **Bump ALL versions**, CI check, RAG embeddings, commit, merge dev→main, tag on main, GitHub Release |

## Tool Verification (Fail Fast)

Before ANY operation, verify all required tools:

| Tool       | Verification Command | Purpose                 |
| ---------- | -------------------- | ----------------------- |
| Git        | `git --version`      | Version control         |
| GitHub CLI | `gh auth status`     | PR/release operations   |
| Node.js    | `node --version`     | Package management      |
| gsutil     | `gsutil version`     | Prioritizer page upload |

### Failure Handling

If ANY required tool is unavailable, **ABORT immediately**:

```
ERROR: /release cannot proceed - <tool-name> unavailable

Required for: <purpose>
Fix: <fix-command>

Aborting.
```

## Phase Flow Details

### Phase 1: Kickoff

1. Get current version from `package.json`
2. **Check for pre-collected data:** If `.prerelease-data.md` exists and its HEAD sha (line 1) matches current `git rev-parse HEAD`, load it and skip to step 5 — the file already contains commits, PRs, modified services, and optionally a triage summary. If the file is stale or missing, continue with steps 3-4.
3. Find last release tag, list merged PRs since last release
4. Detect modified services (apps changed since last tag)
5. Run semver analysis to determine version bump (see `reference/semver-analysis.md`)
6. **Feature Prioritization Touchpoint** — present only **features** in the interactive prioritizer page. User stars highlights (for README/website), skips unwanted features, reorders priority, adds optional comments. Notable changes and minor fixes are **not shown** in the prioritizer — they are automatically included in the changelog. For major releases, also ask for marketing slogan.

### Phase 2: Service Documentation (Silent)

For each modified service detected in Phase 1:

- Spawn Task tool with `subagent_type: service-scribe`
- Run all agents in parallel
- Wait for all to complete before proceeding

### Phase 3: High-Level Docs (Automatic)

1. Spawn `release-docs-updater` agent with High-priority changes and optional comments
2. Agent auto-updates `docs/overview.md`, verifies README badges, checks `docs/services/index.md`
3. If pure bugfix release with no High-priority features affecting the overview, agent skips updates

### Phase 4: README Update (Automatic)

1. Auto-generate "What's New" table from High-priority items
2. Use user comments (from Phase 1 touchpoint) as descriptions where provided; fall back to triage summary descriptions
3. Apply following the accumulation pattern

**Accumulation Pattern (MANDATORY):**

README "What's New" section accumulates features across a MAJOR version:

- **Showcase ALL High-priority features** from ALL sub-releases in current major version
- Example: v2.0.0 (6 features) + v2.1.0 (2 features) → 8 tiles total in v2.x section
- **Only when new major version releases** (e.g., v3.0.0) do old features move to VersionHistorySection
- **Header**: "What's New in vX.Y.Z"
- **Right side**: Changelog link
- **Maximum**: 3-12 feature tiles

#### README Section Format

**Principle:** When in doubt, cut words. Keep only core value propositions with one-line impact statements.

```markdown
## What's New in vX.Y.Z

| Improvement         | Impact                              |
| ------------------- | ----------------------------------- |
| **Feature Name**    | One-line impact from user comment   |
| **Another Feature** | One-line impact from triage summary |
```

### Phase 5: Website Improvements (Automatic)

1. Auto-update `RecentUpdatesSection.tsx` from High-priority features
2. **If major version release**: also create `VersionHistorySection` content using marketing slogan from Phase 1 touchpoint
3. Invoke `/frontend-design` skill for implementation

**Version History Pattern (Major Version Release Only):**

When releasing a NEW major version (e.g., v3.0.0):

- **Trigger**: Activated when new major version releases
- **Structure**: Expandable button below "What's New" section
- **Content**: Combined subreleases (e.g., v2.0.0, v2.1.0 → v2.x paragraph)
- **Format**: List format with paragraphs, not tiles
- **Required**: Marketing slogan collected during Phase 1 touchpoint

### Phase 6: Finalize

1. **Update ALL package.json versions** — root, apps/\*, packages/\*, workers/\* (CRITICAL)
2. **Update CHANGELOG.md** using sorted type subcategories (see Changelog Format below)
3. Run `pnpm run ci:tracked` — MUST pass
4. **Refresh RAG embeddings** — re-embed all docs into production Firestore (see below)
5. Stage & commit on `development`
6. Push `development` to remote
7. **Merge `development` → `main`** — via existing PR or direct merge
8. **Tag on `main`** — tag the merge commit, not `development` (CRITICAL)
9. Push tag to remote
10. **Create GitHub Release** — with categorized release notes from Step 7.1
11. **Post-release validation** — verify tag on main, GitHub Release exists, CHANGELOG committed, versions match, on development branch
12. Display release summary (including release URL and validation results)

#### RAG Embeddings Refresh (Step 4)

After CI passes (docs are finalized), re-generate embeddings for the chat-agent RAG pipeline:

```bash
FIRESTORE_EMULATOR_HOST="" \
GOOGLE_CLOUD_PROJECT=intexuraos-dev-pbuchman \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
OPENAI_API_KEY=$INTEXURAOS_OPENAI_APP_API_KEY \
pnpm run embed-docs
```

This reads all `docs/**/*.md`, chunks by headers, generates OpenAI embeddings, and uploads to the `doc_embeddings` Firestore collection. Stale embeddings (from deleted docs) are cleaned automatically.

**Skip condition:** If `--skip-docs` was used, skip this step too (no doc changes to re-embed).

**Failure handling:** Log the error but do NOT block the release. Embeddings can be re-run manually after release.

## Changelog Format (Sorted by Type)

**Structure:** Version header with type subcategories. Entries sorted by priority (High first) within each category.

```markdown
## X.Y.Z

### Added

- [feature description with inline `code`]
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

**Rules:**

| Rule                  | Details                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| Version headers       | `## X.Y.Z` — no dates                                                  |
| Type subcategories    | `### Added`, `### Changed`, `### Fixed`, `### Improved`, `### Removed` |
| Omit empty categories | If no fixes, skip `### Fixed` entirely                                 |
| Priority ordering     | High-priority entries first within each category                       |
| Single line per entry | No paragraphs or multi-line descriptions                               |
| Backticks for code    | Commands, flags, env vars, settings, file paths                        |
| Linear refs optional  | `(INT-XXX)` at end if helpful                                          |
| User-facing only      | Skip internal refactorings unless they affect users                    |
| Most recent at top    | New version prepended to file                                          |

**Skip:** Pure test additions, CI config changes, internal refactorings, dependency updates (unless security)

## Single Touchpoint Pattern

All user interaction happens in Phase 1 step 7 via an **interactive HTML prioritization page**.

**Only features are shown in the prioritizer.** Notable changes and minor fixes bypass the prioritizer entirely and are automatically included in the changelog under the appropriate type subcategories (Added/Changed/Fixed/Improved/Removed).

```
1. Generate prioritizer page with ONLY features using templates/prioritizer.html
2. Upload to GCS via /share workflow → user gets a URL
3. User interacts with the page:
   - ★ Star features for README/website highlights
   - ✕ Skip features to omit from CHANGELOG
   - Drag to reorder priority
   - Add comments to override descriptions
4. User clicks "Export & Copy", pastes structured text back
5. Parse export → priority map + comments map + highlight flags
6. Notable changes + minor fixes → auto-categorized into changelog
7. For major releases: also collect marketing slogan
8. Phases 2-5 run automatically using this data — no further user interaction
```

## References

- Workflow: [`workflows/full-release.md`](workflows/full-release.md)
- Data Collection: [`workflows/collect-release-data.md`](workflows/collect-release-data.md)
- Website Audit: [`workflows/website-audit.md`](workflows/website-audit.md)
- Templates: [`templates/`](templates/)
- Checklist: [`reference/phase-checklist.md`](reference/phase-checklist.md)
