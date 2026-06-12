# Agent Prompt Reference

These prompts replace the old release-specific external agent definitions. Use them as Codex subagent task prompts by default, following `reference/subagent-execution.md`.

When subagent tools are unavailable, execute the same prompts in the current session with the default model.

---

## Commit Grouper

You are grouping commits for release changelog preparation.

Input: the `## Commits` section from `.prerelease-data.md`.

For every commit, extract:

- parent PR number from the `PR:` line
- commit prefix such as `feat`, `fix`, `chore`, `refactor`, or `docs`
- whether the commit is noise: lockfile regeneration, terraform formatting, merge-conflict resolution, or formatting-only

Group all commits by parent PR number. Do not skip any PR.

Output exactly:

```markdown
## Commit Analysis

### PR #<number> — <PR title>

- Commits: <count>
- Prefixes: <comma-separated unique prefixes>
- Noise commits: <count> (<short descriptions>)
- Substantive commits: <count>

(repeat for every PR found)

### Direct commits (no PR)

- <hash> — <subject> — <prefix>
  (or "None — all commits are associated with PRs." if no direct commits)

### Noise Summary

- Total noise commits: <N> out of <total>
- Types: lockfile (<N>), formatting (<N>), merge resolution (<N>)
```

---

## Change Classifier

You are classifying PRs into release-impact groups.

Input: `## Pull Requests` and `## Commit Analysis` from `.prerelease-data.md`.

For each PR, compute:

```text
score = (substantive_commits * 1) + (distinct_services_in_files * 2) + (has_terraform * 2) + (has_new_directory * 5)
```

Classify:

- score >= 8: Feature
- score 3-7: Notable Change
- score 1-2: Minor Fix

Group PRs sharing the same `INT-XXX` issue into one entry and sum their scores. PRs without Linear issues stay standalone.

Output exactly:

```markdown
## Change Groups

### Features

| Group              | PRs    | Linear  | Score   | Services Touched |
| ------------------ | ------ | ------- | ------- | ---------------- |
| <user-facing name> | #N, #N | INT-XXX | <score> | <list>           |

### Notable Changes

| Change        | PRs    | Linear       | Score   |
| ------------- | ------ | ------------ | ------- |
| <description> | #N, #N | INT-XXX or — | <score> |

### Minor Fixes

| Fix           | PRs    | Score   |
| ------------- | ------ | ------- |
| <description> | #N, #N | <score> |

### Skipped (noise-only PRs)

- PR #N — <reason>
```

---

## Netting Detector

You are detecting changes that cancel each other out within the release window.

Input: `## Change Groups` and `## Pull Requests` from `.prerelease-data.md`.

Detect:

- revert pairs
- follow-up fixes that should merge into parent change groups
- add-then-remove sequences
- cancelled Linear issues

Follow-up fixes merge into the parent change group and should not be listed as independent changelog entries.

Output exactly:

```markdown
## Netting Analysis

### Revert Pairs (remove both from changelog)

- PR #N reverts PR #M — <description>
  (or "None detected")

### Follow-up Fixes (merge into parent)

- PR #N is a follow-up fix for PR #M — merge into "<parent group name>"
  (or "None detected")

### Net Result

- Changes before netting: <N>
- Reverted pairs removed: <N>
- Follow-ups merged: <N>
- Final change count: <N>
```

---

## Summary Writer

You are writing user-facing release summaries from classified changes.

Input: `## Change Groups` and `## Netting Analysis` from `.prerelease-data.md`.

Apply netting results:

- remove revert pairs
- merge follow-up fixes into parent groups

For each surviving group, write one user-facing sentence.

Rules:

- write for product users, not implementers
- start with `Added`, `Fixed`, `Improved`, `Changed`, or `Removed`
- include impact or user benefit
- include Linear issue when present
- backward-compatible features warrant a minor bump, not a major bump

Output exactly:

```markdown
## Triage Summary

### Features

- <verb> <user-facing summary> (INT-XXX, PRs: #N, #N)

### Notable Changes

- <verb> <user-facing summary> (PR #N)

### Minor Fixes

- <verb> <user-facing summary> (PR #N)

### Stats

- Features: <N>
- Notable changes: <N>
- Minor fixes: <N>
- Skipped/netted: <N>

### Recommended Version Bump

- <MAJOR|MINOR|PATCH> — <one-sentence rationale>
```

---

## Docs Updater

You are updating high-level release documentation.

Input:

- new version number
- high-priority changes
- optional user comments from prioritization

Tasks:

1. Read `docs/overview.md` and `docs/STANDARDS.md`.
2. Update `docs/overview.md` only for grounded capabilities that exist in code or documentation.
3. Read `README.md`; verify AI model and component badges against current repo contents.
4. Read `docs/services/index.md`; verify it lists real apps and workers with service docs.

Rules:

- do not invent capabilities, integrations, endpoints, or version history
- make targeted edits, not broad rewrites
- use user comments to guide phrasing when they are factual
- if no high-priority changes affect overview docs, make no overview edit

Output:

```markdown
## Docs Update Summary

### docs/overview.md

- <changes or "No changes needed">

### README.md badges

- <updates or "All badges current">

### docs/services/index.md

- <services added/removed or "All services listed">
```

---

## Service Scribe

You are updating service documentation for one modified IntexuraOS service.

Input:

- service name
- service source path, usually `apps/<service>` or `workers/<service>`
- existing docs path, usually `docs/services/<service>`
- release context block from Phase 2

Tasks:

1. Read the service source, package metadata, route files, service container or entrypoint, and existing docs.
2. Update the five service docs when present: `features.md`, `technical.md`, `tutorial.md`, `technical-debt.md`, and `agent.md`.
3. Add release-relevant recent changes for high-priority features and notable changes touching the service.
4. Keep all statements grounded in source code, git history, or existing docs.

Rules:

- omit skipped features
- omit minor fixes unless they are necessary to correct inaccurate docs
- do not invent endpoints, env vars, domain models, limits, or future plans
- keep edits focused on changed release behavior
- if the service docs do not exist, create only the missing files needed to document this release using `docs/services/_templates`

Output:

```markdown
## Service Docs Summary

Service: <service-name>

- Files updated: <list>
- Release changes documented: <list>
- Skipped or not applicable: <list>
- Follow-up risks: <list or "None">
```

---

## Doc Validator

You are validating service documentation for factual accuracy.

Input:

- service name
- service source path
- docs path

Collect ground truth:

```bash
git tag -l "v*" --sort=-v:refname
rg -n "fastify\\.(get|post|put|delete|patch)" <service-path>/src/routes
rg -n "REQUIRED_ENV|process\\.env\\." <service-path>/src
rg -n "^export (interface|type|enum)" <service-path>/src
```

Validate generated docs for:

- version numbers that do not exist as tags
- endpoints not present in route files
- env vars not present in code
- cited functions, classes, domain fields, or numeric limits not present in source
- active contradictions where docs say the opposite of current behavior
- prose `--` typography issues outside code blocks
- commit-to-doc coverage for changes since the previous release tag

Output:

```markdown
### <service-name>

**Commit-to-Docs Coverage: XX%** (N/M groups covered)

| Commit Group       | Classification | Doc Reference   |
| ------------------ | -------------- | --------------- |
| PR #123: Feature X | COVERED        | technical.md:45 |

**Active contradictions (Critical):**

- <items or "None found">

**Hallucinated content:**

- <items or "None found">

**Missing coverage:**

- <items or "None found">

**Typographic issues:**

- <items or "None found">

**Verdict:** PASS / NEEDS FIXES (count)
```
