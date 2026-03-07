# Collect Release Data

**Trigger:** User calls `/collect-release-data`

Runs deterministic data collection via shell script, then enriches the output through sequential focused agent steps. Each step reads only what it needs and appends structured output.

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

## Step 1: Commit Grouper

**Agent type:** subagent (Agent tool)

**Input:** Read ONLY the `## Commits` section from `.prerelease-data.md`.

**Prompt:**

```
Read the ## Commits section from .prerelease-data.md.

For each commit, extract:
- The PR number it belongs to (from the "PR:" line)
- The commit prefix (feat/fix/chore/refactor/docs from the subject)
- Whether it's "noise" — lockfile regeneration, terraform fmt, merge conflict resolution

Group commits by their parent PR number.

Output EXACTLY this format — no other text:

## Commit Analysis

### PR #<number> — <PR title>
- Commits: <count>
- Prefixes: <comma-separated unique prefixes>
- Noise commits: <count> (<short descriptions>)
- Substantive commits: <count>

### Direct commits (no PR)
- <hash> — <subject> — <prefix>

### Noise Summary
- Total noise commits: <N> out of <total>
- Types: lockfile (<N>), formatting (<N>), merge resolution (<N>)
```

**After agent completes:** Read the agent's output. Append it to `.prerelease-data.md`.

---

## Step 2: Change Classifier

**Agent type:** subagent (Agent tool)

**Input:** Read ONLY the `## Pull Requests` and `## Commit Analysis` sections from `.prerelease-data.md`.

**Prompt:**

```
Read the ## Pull Requests and ## Commit Analysis sections from .prerelease-data.md.

For each PR, compute an impact score:

  score = (substantive_commits × 1) + (distinct_services_in_files × 2) + (has_terraform × 2) + (has_new_directory × 5)

Then classify:
  score >= 8  → Feature
  score 3-7   → Notable Change
  score 1-2   → Minor Fix

Group PRs that share the same Linear issue (INT-XXX) into a single entry.
PRs with no Linear issue stay standalone.

Output EXACTLY this format — no other text:

## Change Groups

### Features
| Group | PRs | Linear | Score | Services Touched |
|-------|-----|--------|-------|-----------------|
| <user-facing name> | #N, #N | INT-XXX | <score> | <list> |

### Notable Changes
| Change | PR | Linear | Score |
|--------|-----|--------|-------|
| <description> | #N | INT-XXX or — | <score> |

### Minor Fixes
| Fix | PR | Score |
|-----|-----|-------|
| <description> | #N | <score> |

### Skipped (noise-only PRs)
- PR #N — <reason>
```

**After agent completes:** Read the agent's output. Append it to `.prerelease-data.md`.

---

## Step 3: Netting Detector

**Agent type:** subagent (Agent tool)

**Input:** Read ONLY the `## Change Groups` and `## Pull Requests` sections from `.prerelease-data.md`.

**Prompt:**

```
Read the ## Change Groups and ## Pull Requests sections from .prerelease-data.md.

Look for changes that cancel each other out within this release:

1. REVERT PAIRS: PR title contains "revert" or "Revert" — find the original PR it reverts
2. FOLLOW-UP FIXES: PR that fixes something broken by an earlier PR in the same release (look for "restore", "fix" referencing same area)
3. ADD-THEN-REMOVE: Feature added in one PR, removed or disabled in another
4. CANCELLED LINEAR ISSUES: Same INT-XXX appears in both an "add" and "remove" PR

For follow-up fixes: these should MERGE into the parent change group, not be listed separately.

Output EXACTLY this format — no other text:

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

**After agent completes:** Read the agent's output. Append it to `.prerelease-data.md`.

---

## Step 4: Summary Writer

**Agent type:** subagent (Agent tool)

**Input:** Read ONLY the `## Change Groups` and `## Netting Analysis` sections from `.prerelease-data.md`.

**Prompt:**

```
Read the ## Change Groups and ## Netting Analysis sections from .prerelease-data.md.

Apply the netting results:
- Remove any revert pairs
- Merge follow-up fixes into their parent group

For each surviving change group, write a ONE-SENTENCE user-facing summary.
Rules:
- No technical jargon — write for someone who uses the product, not builds it
- Start with a verb: "Added", "Fixed", "Improved", "Changed", "Removed"
- Include the impact or what the user gains
- Reference the Linear issue if present

Output EXACTLY this format — no other text:

## Triage Summary

### Features
- <verb> <user-facing summary> (INT-XXX, PRs: #N, #N)
- ...

### Notable Changes
- <verb> <user-facing summary> (PR #N)
- ...

### Minor Fixes
- <verb> <user-facing summary> (PR #N)
- ...

### Stats
- Features: <N>
- Notable changes: <N>
- Minor fixes: <N>
- Skipped/netted: <N>

### Recommended Version Bump
- <MAJOR|MINOR|PATCH> — <one-sentence rationale>
```

**After agent completes:** Read the agent's output. Append it to `.prerelease-data.md`.

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
