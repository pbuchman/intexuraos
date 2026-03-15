---
name: codex-review
description: Request an automated code review from OpenAI Codex CLI. Runs codex review against a base branch and summarizes findings.
argument-hint: '[--base <branch>]'
user-invocable: true
---

# Codex Review

Request an external code review via the Codex CLI (OpenAI) and summarize findings.

## Invocation

| Input                              | Action                                           |
| ---------------------------------- | ------------------------------------------------ |
| `/codex-review`                    | Review current branch against origin/development |
| `/codex-review --base origin/main` | Review current branch against specified base     |

## Prerequisites

Verify Codex CLI is installed before proceeding:

```bash
which codex
```

If not found, ABORT with:

```
ERROR: Codex CLI not found.

Install: npm install -g @openai/codex
Docs: https://github.com/openai/codex

Aborting.
```

## Workflow

### Step 1: Gather Context

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BASE_BRANCH="${USER_BASE:-origin/development}"
```

Verify there are changes to review:

```bash
git diff "$BASE_BRANCH"...HEAD --stat
```

If no changes, STOP with: "No changes between `$CURRENT_BRANCH` and `$BASE_BRANCH`. Nothing to review."

### Step 2: Build Review Title

Extract Linear issue ID from branch name if present (pattern: `INT-\d+`).

```
Title format: "[INT-XXX] branch-description" or just "branch-description"
```

### Step 3: Run Codex Review

**CRITICAL:** `--base` and `[PROMPT]` cannot coexist. Model and reasoning are set via `-c` config flags, not direct flags.

```bash
codex review \
  --base "$BASE_BRANCH" \
  -c model=gpt-5.4 \
  -c reasoning.effort=xhigh \
  --title "$TITLE" \
  2>&1 | tee /tmp/codex-review.txt
```

### Step 4: Read and Summarize

Read `/tmp/codex-review.txt` and present a summary to the user:

1. **Overall verdict** — what did Codex think of the changes?
2. **Key findings** — list actionable items (bugs, style issues, suggestions)
3. **File-by-file highlights** — only if Codex provided per-file feedback

Do NOT editorialize or add opinions beyond what Codex reported. Present the findings factually.

## Edge Cases

| Situation                      | Action                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Codex not installed            | Abort with install instructions (see Prerequisites)                 |
| No changes to review           | Stop with informational message                                     |
| Codex command fails            | Show full error output, suggest checking OPENAI_API_KEY             |
| Very large output (>500 lines) | Summarize top findings, note full output at `/tmp/codex-review.txt` |

## Critical Rules

1. **NEVER modify code based on Codex findings** unless the user explicitly asks
2. **NEVER pass a prompt argument** alongside `--base` — they conflict
3. **ALWAYS save raw output** to `/tmp/codex-review.txt` for reference
4. **ALWAYS use `-c` flags** for model and reasoning config, not direct flags
