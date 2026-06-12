# Subagent Execution Reference

Use this reference when running `$release` with Codex subagent tools available.

## Default Routing

1. The controller reads the release workflow, builds a short execution plan, and keeps ownership of release state.
2. The controller dispatches bounded subagent tasks for collection triage, service docs, validation, high-level docs, README, website, CI fixes, and final audit.
3. The controller integrates subagent results, performs irreversible operations, and verifies the release.
4. If subagent tools are unavailable, execute the same workflow in the current session and report the fallback.

Do not create git worktrees. This repo forbids worktrees in `.claude/CLAUDE.md`.

## Controller-Owned Work

The controller must not delegate:

- user prioritizer generation, publishing, and export parsing
- final semver decision and changelog synthesis
- package version sync and lockfile refresh
- `pnpm run ci:tracked` gate ownership
- commit, push, PR creation, tag creation, GitHub Release creation
- post-release validation and release summary

Subagents may investigate, edit bounded files, validate, or fix bounded failures, but the controller remains accountable for final release correctness.

## Reasoning Effort

Use the inherited model by default. Set only `reasoning_effort`.

| Release Role          | Codex Agent Type | Effort                                           |
| --------------------- | ---------------- | ------------------------------------------------ |
| Commit Grouper        | `explorer`       | `medium`                                         |
| Change Classifier     | `explorer`       | `high`                                           |
| Netting Detector      | `explorer`       | `xhigh`                                          |
| Summary Writer        | `explorer`       | `high`                                           |
| Service Scribe        | `worker`         | `medium`, or `high` for broad/new services       |
| Doc Validator         | `explorer`       | `high`                                           |
| Docs Updater          | `worker`         | `high`                                           |
| README Writer         | `worker`         | `high`                                           |
| Website Worker        | `worker`         | `high`                                           |
| CI Failure Fixer      | `worker`         | `high`, escalate to `xhigh` after repeat failure |
| Final Release Auditor | `explorer`       | `xhigh`                                          |

`xhigh` is the Codex tool value for extra-high reasoning effort.

## Delegation Rules

- Give every subagent the exact prompt section from `reference/agent-prompts.md` or a complete release-specific task.
- Include release context, required input sections, allowed write scope, required output format, and files it may not touch.
- Tell workers they are not alone in the codebase, must not revert other edits, and must list changed files.
- Run mutating workers sequentially unless their write scopes are disjoint.
- Read-only explorer audits may run in parallel when they answer independent questions.
- Do not ask subagents to commit, push, create PRs, tag, create GitHub Releases, or change versions across the monorepo.

## Review Pattern

For mutating subagent work:

1. Worker completes the bounded task and reports changed files.
2. Controller reviews the diff and runs the relevant local check.
3. Dispatch a spec-compliance review for non-trivial edits.
4. Dispatch a quality/factual review when the edit changes docs, README, website, or release artifacts.
5. Send fixes back to the same worker until the review passes or the controller takes ownership of the blocker.

For release triage prompts, the controller appends approved generated markdown to `.prerelease-data.md`. Triage subagents return markdown only.
