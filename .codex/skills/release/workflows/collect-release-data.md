# Collect Release Data

**Trigger:** User calls `$release --collect`.

Run deterministic data collection, then enrich `.prerelease-data.md` by executing the four triage prompts from `reference/agent-prompts.md` in the current Codex session.

---

## When to Use

Use this pipeline when the release has enough changes that inline analysis is likely to be incomplete:

- 20+ commits since last tag
- Multiple Linear issues spanning multiple PRs
- The user wants release data staged before running `$release`

For small releases, the full workflow can collect data inline.

---

## Step 0: Run Collection Script

```bash
./scripts/collect-release-data.sh
```

This writes `.prerelease-data.md` at the repo root with:

- HEAD sha on line 1 for staleness checks
- Commits with hash, subject, author, date, PR link, files, and body
- Pull requests with title, author, summary, labels, and Linear refs
- Modified services, packages, and infrastructure
- Linear issue identifiers referenced by the release window

If the script fails, report the failure and stop. Do not run triage prompts on partial data.

After the script completes, read `.prerelease-data.md` and count commits. If fewer than 5 commits were collected, tell the user the raw data may be enough for inline release analysis and ask whether to continue triage.

---

## Current-Session Triage Pattern

Each triage step follows the same pattern:

1. Read the required sections from `.prerelease-data.md`.
2. Read the named prompt in `reference/agent-prompts.md`.
3. Execute the prompt in the current Codex session using the default model.
4. Append exactly the generated markdown section to `.prerelease-data.md`.

Do not use external agent names by default. Use Codex subagents only if the user explicitly asks for delegated or parallel agent work.

---

## Step 1: Commit Grouper

Prompt section: `## Commit Grouper` in `reference/agent-prompts.md`.

Input: `## Commits` from `.prerelease-data.md`.

Output to append: `## Commit Analysis`.

---

## Step 2: Change Classifier

Prompt section: `## Change Classifier` in `reference/agent-prompts.md`.

Input: `## Pull Requests` and `## Commit Analysis` from `.prerelease-data.md`.

Output to append: `## Change Groups`.

---

## Step 3: Netting Detector

Prompt section: `## Netting Detector` in `reference/agent-prompts.md`.

Input: `## Change Groups` and `## Pull Requests` from `.prerelease-data.md`.

Output to append: `## Netting Analysis`.

---

## Step 4: Summary Writer

Prompt section: `## Summary Writer` in `reference/agent-prompts.md`.

Input: `## Change Groups` and `## Netting Analysis` from `.prerelease-data.md`.

Output to append: `## Triage Summary`.

---

## Output Validation

Before reporting completion, verify all generated sections exist:

```bash
for section in "## Commit Analysis" "## Change Groups" "## Netting Analysis" "## Triage Summary"; do
  if ! grep -q "$section" .prerelease-data.md; then
    echo "MISSING: $section"
  fi
done
```

If any section is missing, report which step failed and keep the partial file for rerun or manual inspection.

---

## Completion

Report:

```text
Pre-release data collected and triaged.

File: .prerelease-data.md
HEAD: <sha>
Features: <N> | Notable: <N> | Minor: <N> | Skipped: <N>
Recommended bump: <MAJOR|MINOR|PATCH>

Run $release to start the release workflow; Phase 1 will use this data when it is fresh for the current HEAD.
```
