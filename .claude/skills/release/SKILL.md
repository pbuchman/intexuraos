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

## Phase Overview

| Phase | Name           | Interaction       | Key Actions                                    |
| ----- | -------------- | ----------------- | ---------------------------------------------- |
| 1     | Kickoff        | User Input        | Run semver analysis, detect modified services  |
| 2     | Service Docs   | Silent Batch      | Spawn service-scribe agents in parallel        |
| 3     | High-Level Docs| **Checkpoint**    | Propose docs/overview.md updates, wait         |
| 4     | README         | **Checkpoint**    | Propose "What's New" section, wait             |
| 5     | Website        | **Checkpoint**    | RecentUpdatesSection + 3 suggestions           |
| 6     | Finalize       | Automatic         | CI check, commit, tag push, summary            |

## Tool Verification (Fail Fast)

Before ANY operation, verify all required tools:

| Tool       | Verification Command      | Purpose               |
| ---------- | ------------------------- | --------------------- |
| Git        | `git --version`           | Version control       |
| GitHub CLI | `gh auth status`          | PR/release operations |
| Node.js    | `node --version`          | Package management    |

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

### Phase 5: Website Improvements (Checkpoint)

1. Generate `RecentUpdatesSection.tsx` content from release
2. Audit `HomePage.tsx` for improvement opportunities
3. Combine into EXACTLY 3 suggestions
4. **CHECKPOINT**: Present suggestions, wait for selection
5. For each approved suggestion: invoke `/frontend-design` skill

### Phase 6: Finalize

1. Run `pnpm run ci:tracked` — MUST pass
2. Stage all changes
3. Commit with release message
4. Create version tag
5. Push tag to remote
6. Display release summary

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
