---
name: release
description: Prepare an IntexuraOS release by collecting release data, triaging changes, updating docs, versions, changelog, website release highlights, and GitHub release notes.
---

# Release Skill

Use this skill to prepare an IntexuraOS release.

## Usage

```text
$release                    # Full release workflow
$release --skip-docs        # Skip service documentation and RAG embeddings
$release --phase 3          # Resume from a specific phase
$release --collect          # Only collect and triage release data
```

## Codex Execution Model

- Run the workflow in the current Codex session with the default model.
- Do not require slash commands or legacy agent definitions.
- Former release-agent instructions live in `reference/agent-prompts.md`; execute those prompts in the current session unless the user explicitly asks for Codex subagents.
- Use the existing `$share` skill or the explicit GCS upload commands in the workflow when publishing the prioritizer page.
- Follow project rules from `.claude/CLAUDE.md` for branch, commit, CI, and PR behavior.

## Invocation Detection

| Argument      | Workflow                            | What Happens                                                                               |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| none          | `workflows/full-release.md`         | Full release workflow                                                                      |
| `--skip-docs` | `workflows/full-release.md`         | Full release workflow, skipping service documentation and RAG embeddings                   |
| `--phase N`   | `workflows/full-release.md`         | Resume from Phase N                                                                        |
| `--collect`   | `workflows/collect-release-data.md` | Separate pipeline: collect release data, triage it, write `.prerelease-data.md`, then stop |

`--collect` is not a modifier of the full release workflow. It runs the collection pipeline and exits. The full workflow can later consume `.prerelease-data.md` when it is fresh for the current HEAD.

## Core Mandates

1. Feature prioritization happens once in Phase 1 using the interactive prioritizer page.
2. Notable changes and minor fixes bypass the prioritizer and are automatically included in the changelog unless netted out.
3. Service documentation runs silently in the current Codex session by default.
4. `pnpm run ci:tracked` must pass before any release commit.
5. All package versions must stay synchronized across root, apps, packages, and workers.
6. Finalization must use a feature branch and a PR targeting `development`; do not commit directly to `development` or `main`.
7. Tags must point to a commit contained in `origin/main`.
8. GitHub Release notes must mirror the sorted CHANGELOG categories.
9. Post-release validation must verify tag, release, changelog, package versions, and branch state.

## Phase Overview

| Phase | Name            | Interaction | Key Actions                                                                                      |
| ----- | --------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| 1     | Kickoff         | User Input  | Analyze semver, create prioritizer page, parse user priorities                                   |
| 2     | Service Docs    | Silent      | Update service docs for modified services and validate factual accuracy                          |
| 3     | High-Level Docs | Automatic   | Update `docs/overview.md`, README badges, and `docs/services/index.md`                           |
| 4     | README          | Automatic   | Generate or update README "What's New" from highlighted release features                         |
| 5     | Website         | Automatic   | Update homepage version strings and `WhatsNewSection`                                            |
| 6     | Finalize        | Automatic   | Sync versions, update changelog, run CI, commit on feature branch, open PR, tag main after merge |

## Tool Verification

Before release operations, verify required tools:

| Tool       | Verification Command | Purpose                 |
| ---------- | -------------------- | ----------------------- |
| Git        | `git --version`      | Version control         |
| GitHub CLI | `gh auth status`     | PR and release actions  |
| Node.js    | `node --version`     | Package scripts         |
| gsutil     | `gsutil version`     | Prioritizer page upload |
| jq         | `jq --version`       | JSON transforms         |

If any required tool is unavailable, stop and report the failing tool, purpose, and fix.

## References

- Full workflow: `workflows/full-release.md`
- Collection workflow: `workflows/collect-release-data.md`
- Website audit workflow: `workflows/website-audit.md`
- Former agent prompts: `reference/agent-prompts.md`
- Semver analysis: `reference/semver-analysis.md`
- Phase checklist: `reference/phase-checklist.md`
- Templates: `templates/`
