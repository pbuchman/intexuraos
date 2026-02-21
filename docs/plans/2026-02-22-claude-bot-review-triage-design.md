# Claude[bot] Review Edit Handling & Triage Response Design

## Problem

`claude[bot]` (GitHub Actions Claude) posts code review comments on PRs. It first creates a stub comment ("Claude Code is working...") then edits it multiple times as it appends findings. Currently, our webhook handler only dispatches `action: "created"` events. The worker receives the stub, correctly identifies it as "bot noise", and ignores it. The finalized review with actual findings is never seen.

## Goal

When `claude[bot]` finishes editing its review comment, dispatch the finalized body to the worker. The worker must triage every finding and immediately implement fixes.

## Design

### 1. Gate Change — Allow `edited` events from `claude[bot]`

**Current behavior** (`github.ts:371-376`):

| Event                         | Result  |
| ----------------------------- | ------- |
| `issue_comment` + `created`   | Dispatch |
| `issue_comment` + `edited`    | Dropped  |

**New behavior:**

| Event                                          | Result           |
| ---------------------------------------------- | ---------------- |
| `issue_comment` + `created`                    | Dispatch (unchanged) |
| `issue_comment` + `edited` + `sender=claude[bot]` | Dispatch (NEW)   |
| `issue_comment` + `edited` + `sender=anyone else` | Dropped (unchanged) |

Existing filters remain:
- `BOT_LOGIN` (`intexuraos-code-worker[bot]`) — prevents self-loops
- `EXTERNAL_AGENT_MENTIONS` (`@claude`, `@codex`) — finalized body says "Claude finished" not "@claude", so not caught

### 2. Message Builder — New variant for edited bot comments

Detection: `event.action === 'edited' && event.senderLogin === 'claude[bot]'`

New message format for this case:

```
[PR Comment — Bot Review Edit] Comment updated on PR #${prNumber} in ${repository}
From: @claude[bot]
Comment ID: ${commentId}
Type: issue_comment (edited)

Full comment body:
${body}

Instructions:
1. CHECK IF REVIEW IS STILL IN PROGRESS:
   Look for indicators that the review is NOT finished:
   - Body contains "is working" / "working..." / spinner image
   - Body is very short (< 200 chars) with no findings
   - Checklist items are unchecked ([ ] without [x])

   If the review appears to still be in progress -> do nothing, stop here.

2. IF REVIEW IS FINALIZED — process it as a code review:
   a. React with eyes: gh api /repos/${repository}/issues/comments/${commentId}/reactions -f content=eyes
   b. Read the full review body and extract EVERY finding/issue/suggestion
   c. For EACH finding, decide: FIX or SKIP
      - FIX: Clear actionable feedback, code change with clear intent, specific bug or gap
      - SKIP: Discussion/question, intentional design disagreement, out of PR scope, pure status report
   d. Post a response comment with a triage table:
      - One row per finding
      - Columns: Finding | Verdict (FIX/SKIP) | Reasoning | Action
      - For SKIP items: explain why in the Reasoning column
      - For FIX items: write "Will fix" in the Action column

   WARNING — MANDATORY — DO NOT STOP AFTER POSTING THE TABLE
   e. IMMEDIATELY after posting the triage comment, implement ALL fixes
      marked as FIX in the table. This is not optional. Do not end your turn
      until every FIX item has been implemented, committed, and pushed.
      Skipping implementation after posting the table is a contract violation.
   f. After all fixes: commit, push, verify CI passes
   g. Update your triage comment (gh api PATCH) to replace "Will fix"
      with the actual commit SHA for each implemented fix
```

### 3. Worker Response Format

```markdown
## Review Triage — Comment #${commentId}

| # | Finding | Verdict | Reasoning | Action |
|---|---------|---------|-----------|--------|
| 1 | SECRET env var variant not caught | FIX | Valid gap in pattern coverage | Fixed in abc123 |
| 2 | apikey URL param not tested | FIX | Test gap — pattern exists but untested | Fixed in abc123 |
| 3 | ghr_ token not directly tested | SKIP | Low value — regex provably covers it | — |
| 4 | Integration test dispatch assertion | FIX | High value — verifies secrets don't reach workers | Fixed in def456 |
```

### 4. Deduplication

Multiple `edited` events arrive as `claude[bot]` appends content. The worker handles this naturally:
- If body shows "working" indicators → does nothing
- Once finalized → processes and implements
- If a duplicate finalized edit arrives → worker sees review was already addressed (eyes reaction present, triage comment exists)

No code-level dedup needed.

### 5. Files to Modify

| File                                                         | Change                                           |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `apps/code-agent/src/routes/webhooks/github.ts:371-376`     | Expand gate for `edited` + `claude[bot]`         |
| `apps/code-agent/src/routes/webhooks/github.ts:133-176`     | New message format branch in `buildDispatchMessage()` |
| `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts` | Tests for new gate + message format             |

No orchestrator changes needed — dispatch, resume, and message queue infrastructure works as-is.

### Endpoint Changes

No endpoints created, removed, or modified. The existing webhook endpoint at `POST /webhooks/github` is unchanged — only internal dispatch logic changes.
