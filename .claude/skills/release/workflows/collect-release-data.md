# Collect Release Data

**Trigger:** User calls `/release --collect`

Runs deterministic data collection via shell script, then enriches the output through 4 sequential Sonnet subagent steps. Each step uses a dedicated agent (with `model: sonnet` forced) that reads only its relevant sections and appends structured output.

---

## When to Use

This command is **optional**. It pays for itself when there are many commits/PRs since the last release. For small releases (< 10 commits), `/release` Phase 1 will collect data inline — faster than running this pipeline.

**Run this when:**

- 20+ commits since last tag
- Multiple Linear issues spanning multiple PRs
- You want to pre-stage release data before the actual release session

---

## Step 0: Run Collection Script

```bash
./scripts/collect-release-data.sh
```

This produces `.prerelease-data.md` at repo root with:

- HEAD sha (line 1, HTML comment — used for staleness checks)
- Commits with hash, subject, author, date, PR link, files, body
- Pull Requests with title, author, summary, labels, Linear refs
- Modified Services (apps, workers, packages, terraform)
- Linear Issues Referenced (just the INT-XXX IDs)

**If the script fails:** Report the error to the user and STOP. Do not proceed to triage steps.

**After script completes:** Read `.prerelease-data.md` and count the commits. If fewer than 5 commits, ask the user whether to continue with triage or stop (the raw data may be sufficient for `/release` to handle inline).

---

## Subagent Pattern

Every triage step (1–4) follows the same pattern:

1. **Read** the relevant section(s) from `.prerelease-data.md`
2. **Launch** the dedicated Sonnet agent via Agent tool with `subagent_type`
3. **Append** the agent's output to `.prerelease-data.md`

All 4 agents are defined in `.claude/agents/release-*.md` with `model: sonnet` — this forces Sonnet regardless of the parent session's model.

**Steps are sequential** — each depends on the previous step's output.

---

## Step 1: Commit Grouper

**Agent:** `subagent_type: "release-commit-grouper"`

**Prompt to agent:**

```
Read the ## Commits section from .prerelease-data.md (it is in the repo root).
Process every commit and produce the ## Commit Analysis output as defined in your instructions.
```

**After agent completes:** Append its output to `.prerelease-data.md`.

---

## Step 2: Change Classifier

**Agent:** `subagent_type: "release-change-classifier"`

**Prompt to agent:**

```
Read the ## Pull Requests and ## Commit Analysis sections from .prerelease-data.md (it is in the repo root).
Process every PR and produce the ## Change Groups output as defined in your instructions.
```

**After agent completes:** Append its output to `.prerelease-data.md`.

---

## Step 3: Netting Detector

**Agent:** `subagent_type: "release-netting-detector"`

**Prompt to agent:**

```
Read the ## Change Groups and ## Pull Requests sections from .prerelease-data.md (it is in the repo root).
Detect netting patterns and produce the ## Netting Analysis output as defined in your instructions.
```

**After agent completes:** Append its output to `.prerelease-data.md`.

---

## Step 4: Summary Writer

**Agent:** `subagent_type: "release-summary-writer"`

**Prompt to agent:**

```
Read the ## Change Groups and ## Netting Analysis sections from .prerelease-data.md (it is in the repo root).
Write user-facing summaries and produce the ## Triage Summary output as defined in your instructions.
```

**After agent completes:** Append its output to `.prerelease-data.md`.

---

## Completion

After Step 4, report to the user:

```
Pre-release data collected and triaged.

File: .prerelease-data.md
HEAD: <sha>
Features: <N> | Notable: <N> | Minor: <N> | Skipped: <N>
Recommended bump: <MAJOR|MINOR|PATCH>

Run /release to start the release workflow — Phase 1 will use this data.
```

---

## Error Handling

| Error | Action |
|-------|--------|
| Script fails | Report error, STOP |
| Agent step fails | Report which step failed, keep partial output in file, user can re-run |
| < 5 commits | Ask user if triage is worth it — raw data may be enough |
| File already exists and is fresh | Ask user: "Pre-release data exists for current HEAD. Re-run triage?" |
