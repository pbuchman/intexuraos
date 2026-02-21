# Resume Goal Preservation — Design

## Problem

When a user sends a message (e.g., PR comment) to a completed task, the orchestrator resumes the Claude session with `--continue`. If the session's context is near capacity, Claude Code compacts the conversation. The compaction summary can lose or deprioritize the user's actual request, causing Claude to follow stale system prompt instructions instead.

**Root cause:** The user's goal exists only in the conversation (user prompt), which is vulnerable to compaction. The system prompt — which survives compaction — contains the original task goal, not the new one.

## Solution

Inject the user's new message into the system prompt when resuming (`continueSession: true`). System prompts are never compacted.

## Changes

### `workers/orchestrator/src/services/task-dispatcher.ts`

**`startWorkerAttempt()`** — When `continueSession: true`, append an `[ACTIVE GOAL]` section to the system prompt containing the raw user message (with the RESUME PRE-FLIGHT preamble stripped).

**New helper: `buildActiveGoalSection(prompt: string)`** — Strips the preamble from the combined prompt and wraps the user's actual message in an `[ACTIVE GOAL — HIGHEST PRIORITY]` block.

### `workers/orchestrator/src/services/system-prompt.ts`

No changes. The `buildActiveGoalSection` lives in `task-dispatcher.ts` as a private method since it's only used there and depends on the preamble format defined there.

### Tests

Update `task-dispatcher.test.ts`:
- Verify system prompt includes `[ACTIVE GOAL]` section when `continueSession: true`
- Verify system prompt does NOT include it on initial attempts
- Verify preamble is stripped from the goal text
