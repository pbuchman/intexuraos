---
name: release
description: Orchestrate a 6-phase release workflow with automated service documentation, high-level docs updates, README "What's New" section, website improvements, and semantic versioning. Use when preparing a new release.
argument-hint: '[--skip-docs | --phase N]'
---

# Release Skill

Orchestrate a comprehensive 6-phase release workflow with checkpoints for user control.

## Usage

```
/release                    # Full release workflow
/release --skip-docs        # Skip Phase 2 (service documentation)
/release --phase 3          # Resume from specific phase
```

## Core Mandates

1. **Checkpoint Pattern**: Phases 3, 4, and 5 MUST pause for user approval before applying changes
2. **Silent Batch Processing**: Phase 2 runs service-scribe agents in parallel without user interaction
3. **CI Gate**: `pnpm run ci:tracked` MUST pass before Phase 6 commits anything
4. **Tag Push**: Phase 6 creates AND pushes the version tag to remote
5. **Three Suggestions Only**: Phase 5 website audit produces EXACTLY 3 improvement suggestions
6. **Monorepo Version Sync**: Phase 6 MUST update ALL package.json files (root, apps/\*, packages/\*, workers/\*) to the new version — not just the root

## Phase Overview

| Phase | Name            | Interaction    | Key Actions                                       |
| ----- | --------------- | -------------- | ------------------------------------------------- |
| 1     | Kickoff         | User Input     | Run semver analysis, detect modified services     |
| 2     | Service Docs    | Silent Batch   | Spawn service-scribe agents in parallel           |
| 3     | High-Level Docs | **Checkpoint** | Propose docs/overview.md updates, wait            |
| 4     | README          | **Checkpoint** | Propose "What's New" section, wait                |
| 5     | Website         | **Checkpoint** | RecentUpdatesSection + 3 suggestions              |
| 6     | Finalize        | Automatic      | **Bump ALL versions**, CI check, commit, tag push |

## Tool Verification (Fail Fast)

Before ANY operation, verify all required tools:

| Tool       | Verification Command | Purpose               |
| ---------- | -------------------- | --------------------- |
| Git        | `git --version`      | Version control       |
| GitHub CLI | `gh auth status`     | PR/release operations |
| Node.js    | `node --version`     | Package management    |

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
2. Find last release tag: `git tag -l "v*" --sort=-v:refname | head -1`
3. List merged PRs since last release
4. Detect modified services (apps changed since last tag)
5. Run semver-release logic to determine version bump
6. Ask user for release focus/highlights guidance

### Phase 2: Service Documentation (Silent)

For each modified service detected in Phase 1:

- Spawn Task tool with `subagent_type: service-scribe`
- Run all agents in parallel
- Wait for all to complete before proceeding

### Phase 3: High-Level Docs (Checkpoint)

1. Read `docs/overview.md`
2. Propose updates reflecting new features
3. **CHECKPOINT**: Present changes, wait for approval
4. Apply approved changes

### Phase 4: README Update (Checkpoint)

1. Generate "What's New in vX.Y.Z" section
2. **CHECKPOINT**: Present proposed section, wait for approval
3. Apply approved changes to README.md

**Accumulation Pattern (MANDATORY):**

Website "What's New" section accumulates features across a MAJOR version:

- **Showcase ALL approved features** from ALL sub-releases in current major version
- Example: v2.0.0 (6 features) + v2.1.0 (2 features) → 8 tiles total in v2.x section
- **Only when new major version releases** (e.g., v3.0.0) do old features move to VersionHistorySection
- **Header**: "What's New" (no version number)
- **Right side**: Changelog link
- **Maximum**: 3-12 feature tiles

**Content Approval Process:**

Ask user ONE BY ONE for each potential feature:

- User decides: tile-worthy or skip
- **Default rules**:
  - User-facing features (new capabilities, UX improvements) → YES
  - Bug fixes that users notice → YES
  - Technical refactorings → NO (unless major impact like cost savings)

#### README Section Format

**User Feedback:** "Make it more concise, include really important info"

**Principle:** When in doubt, cut words. Keep only core value propositions with one-line impact statements.

##### Example: v2.1.0 (Approved Format)

```markdown
## What's New in v2.1.0

| Improvement                 | Impact                                           |
| --------------------------- | ------------------------------------------------ |
| **Code Consolidation**      | Removed 4,200+ duplicate lines across 8 services |
| **Standardized Validation** | All LLM responses now use Zod schemas            |
| **Cost Optimization**       | 63% Cloud Build cost reduction                   |
| **Bug Fix**                 | Fixed duplicate WhatsApp approval messages       |
```

##### Before/After Comparison

**❌ Verbose (Avoid):**

```markdown
## What's New in v2.1.0

### Code Consolidation

We have significantly improved the codebase by removing duplicate code across multiple services. This effort resulted in the elimination of over 4,200 lines of redundant code spread across 8 different microservices, which will improve maintainability and reduce the cognitive load for developers working on the codebase.

### Standardized Validation

In this release, we have implemented a comprehensive validation standardization effort. All LLM responses throughout the system now utilize Zod schemas for runtime validation, which provides better type safety and more consistent error handling across all services.

### Cost Optimization

After analyzing our cloud infrastructure costs, we identified several optimization opportunities. This release includes changes that resulted in a 63% reduction in Cloud Build costs, which will result in significant ongoing savings for our operations.

### Bug Fixes

Fixed an issue where WhatsApp approval messages were being sent multiple times, causing confusion for users. This issue has been resolved and messages are now sent only once as intended.
```

**✅ Concise (Use):**

```markdown
## What's New in v2.1.0

| Improvement                 | Impact                                           |
| --------------------------- | ------------------------------------------------ |
| **Code Consolidation**      | Removed 4,200+ duplicate lines across 8 services |
| **Standardized Validation** | All LLM responses now use Zod schemas            |
| **Cost Optimization**       | 63% Cloud Build cost reduction                   |
| **Bug Fix**                 | Fixed duplicate WhatsApp approval messages       |
```

**Key Differences:**

- Remove wordy descriptions and redundant phrases
- One-line impact statements (no paragraphs)
- Focus on quantifiable metrics and user-facing value
- Table format for scannability
- Bold key terms for quick skimming

### Phase 5: Website Improvements (Checkpoint)

1. Generate `RecentUpdatesSection.tsx` content from release
2. **Check if major version release** — if YES, also create `VersionHistorySection` content
3. Audit `HomePage.tsx` for improvement opportunities
4. Combine into EXACTLY 3 suggestions
5. **CHECKPOINT**: Present suggestions, wait for selection
6. For each approved suggestion: invoke `/frontend-design` skill

**Version History Pattern (Major Version Release Only):**

When releasing a NEW major version (e.g., v3.0.0):

- **Trigger**: Activated when new major version releases
- **Structure**: Expandable button below "What's New" section
- **Content**: Combined subreleases (e.g., v2.0.0, v2.1.0 → v2.x paragraph)
- **Format**: List format with paragraphs, not tiles
- **Required**: Marketing slogan for each major version

**Example v1.x slogan:**
"End-to-end AI autonomy: From your mobile to the cloud and back. IntexuraOS went from architecture document to handling live traffic — voice to research, links to bookmarks, dates to calendar events."

### Phase 6: Finalize

1. **Update ALL package.json versions** — root, apps/\*, packages/\*, workers/\* (CRITICAL)
2. Run `pnpm run ci:tracked` — MUST pass
3. Stage all changes
4. Commit with release message
5. Create version tag
6. Push tag to remote
7. Display release summary

## Checkpoint Pattern

At each checkpoint phase:

```
1. Present proposed changes clearly
2. STOP execution
3. Use AskUserQuestion: "Approve changes? (approve/revise/skip)"
4. If "revise" → ask for feedback, incorporate, re-present
5. If "skip" → proceed without applying
6. If "approve" → apply changes, continue to next phase
```

## References

- Workflow: [`workflows/full-release.md`](workflows/full-release.md)
- Website Audit: [`workflows/website-audit.md`](workflows/website-audit.md)
- Templates: [`templates/`](templates/)
- Checklist: [`reference/phase-checklist.md`](reference/phase-checklist.md)
