# Remove Redundant Codex Usage Data From WhatsApp Task Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Codex runtime lifecycle JSON and entrypoint exit lines from being persisted in code-task completion summaries and forwarded to WhatsApp notifications.

**Architecture:** The root fix belongs in `workers/orchestrator` before `TaskResult.summary` is built. `apps/code-agent` and `apps/whatsapp-service` should continue to display and deliver the persisted summary; they should not parse or scrub orchestrator runtime artifacts.

**Tech Stack:** TypeScript, Vitest, orchestrator completion verifier, code-agent webhook result storage, WhatsApp Pub/Sub notifications.

---

## Investigation Findings

Production evidence:
- Source task: `task_72814a90-7612-4153-9ee8-a23aaaf00cd4`, `linearIssueId=INT-1629`, `agentType=review`, `workerType=codex`, completed at `2026-05-12T08:12:28.079Z`.
- Firestore `code_tasks/task_72814a90-7612-4153-9ee8-a23aaaf00cd4.result.summary` already contains:

```text
* GH Actions are all passed; no code remediation is needed.
{"type":"turn.completed","usage":{"input_tokens":1866673,"cached_input_tokens":1723008,"output_tokens":7853,"reasoning_output_tokens":2171}}
Codex attempt finished with exit code: 0
```

Root cause:
- `workers/orchestrator/src/services/completion-verifier/block-parser.ts` locates the final `REVIEW_AGENT_FINAL:` block and parses key-value lines.
- For Codex JSONL transcripts, `extractAssistantText()` replaces `item.completed` agent-message events with the assistant text, but leaves non-agent runtime events such as `{"type":"turn.completed","usage":...}` unchanged.
- `locateBlockInLines()` ends a final block only on a closing fence, another known `*_AGENT_FINAL:` marker, or EOF.
- `parseKeyValues()` intentionally appends all non-key lines after `- Summary:` to support unindented summary bullets. Because the final block currently runs to EOF, the trailing Codex `turn.completed` event and `Codex attempt finished with exit code: 0` line become part of the `summary`.
- `workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts` copies parsed `verification.data.summary` to `TaskResult.summary`.
- `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts` passes that result to `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts`, whose `formatCompletionMessage()` sends `result.summary` verbatim to WhatsApp. This layer is not the source of the bad data.

Correct fix:
- Stop the completion-verifier final block at Codex runtime lifecycle boundaries after the agent final text, before parsing key-values.
- Preserve intentional unindented human summary bullets and bullets containing colons.
- Add regression coverage for both the parsed summary and the whole `verifyCompletion()` path so the failure cannot reappear through another parser entry point.

## Endpoint Changes

Modified: none.
Created: none.
Removed: none.
Unchanged: code-agent completion webhook payload shape and WhatsApp send-message payload shape remain unchanged.

## File Structure

- Modify: `workers/orchestrator/src/services/completion-verifier/block-parser.ts`
  - Add a small boundary predicate used by `locateBlockInLines()`.
  - Terminate the parsed final block when the next line is a Codex runtime lifecycle JSON event or code-worker entrypoint completion line.
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`
  - Add regression tests for `locateFinalBlock()` and `parseKeyValues()` with a Codex `turn.completed` line after `- Summary:`.
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts` or `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`
  - Keep coverage local to `block-parser.test.ts` unless branch coverage requires a narrow assertion in an adjacent completion-verifier test.

## Task 1: Reproduce the Summary Contamination in Parser Tests

**Files:**
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`
- Test: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`

- [ ] **Step 1: Add a failing regression test for Codex post-final runtime lines**

Add this test near the existing `parseKeyValues()` continuation tests:

```typescript
it('stops a Codex final block before turn.completed usage telemetry', () => {
  const transcript = [
    '{"type":"item.completed","item":{"type":"agent_message","text":"REVIEW_AGENT_FINAL:\\n- PR: https://github.com/pbuchman/intexuraos/pull/2085\\n- review_id: 4270391498\\n- Summary: * Reviewed the plan-only PR.\\n* GH Actions are all passed."}}',
    '[codex] {"type":"turn.completed","usage":{"input_tokens":1866673,"cached_input_tokens":1723008,"output_tokens":7853,"reasoning_output_tokens":2171}}',
    'Codex attempt finished with exit code: 0',
  ].join('\n');

  const block = locateFinalBlock(transcript, 'REVIEW_AGENT_FINAL:');

  expect(block).not.toBeNull();
  expect(block).toContain('* GH Actions are all passed.');
  expect(block).not.toContain('turn.completed');
  expect(block).not.toContain('input_tokens');
  expect(block).not.toContain('Codex attempt finished');

  const parsed = parseKeyValues(block ?? '');
  expect(parsed['Summary']).toBe('* Reviewed the plan-only PR.\n* GH Actions are all passed.');
});

it('stops a Codex final block before non-zero entrypoint completion lines', () => {
  const transcript = [
    '{"type":"item.completed","item":{"type":"agent_message","text":"REVIEW_AGENT_FINAL:\\n- PR: https://github.com/pbuchman/intexuraos/pull/2085\\n- review_id: 4270391498\\n- Summary: * Reviewed the plan-only PR."}}',
    'Codex attempt finished with exit code: 1',
  ].join('\n');

  const block = locateFinalBlock(transcript, 'REVIEW_AGENT_FINAL:');

  expect(block).not.toBeNull();
  expect(block).not.toContain('Codex attempt finished');

  const parsed = parseKeyValues(block ?? '');
  expect(parsed['Summary']).toBe('* Reviewed the plan-only PR.');
});
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```bash
pnpm --filter orchestrator test -- src/__tests__/services/completion-verifier/block-parser.test.ts
```

Expected: FAIL. The assertion `expect(block).not.toContain('turn.completed')` fails because `locateFinalBlock()` currently includes the `turn.completed` JSON line and the entrypoint completion line after the agent final text.

## Task 2: Terminate Final Blocks at Runtime Lifecycle Boundaries

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/block-parser.ts`
- Test: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`

- [ ] **Step 1: Add a boundary predicate**

In `workers/orchestrator/src/services/completion-verifier/block-parser.ts`, add this helper above `locateBlockInLines()`:

```typescript
function isPostFinalRuntimeBoundary(line: string): boolean {
  const trimmed = line.trim().replace(/^\s*\[[^\]]+\]\s+/, '');
  if (trimmed === '') return false;

  if (
    trimmed.startsWith('Codex attempt finished with exit code:')
  ) {
    return true;
  }

  if (!trimmed.startsWith('{')) return false;

  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    return parsed.type === 'turn.completed';
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Use the predicate in the final-block loop**

Update the loop in `locateBlockInLines()`:

```typescript
for (let i = lastMatchIdx; i < lines.length; i += 1) {
  /* v8 ignore start -- noUncheckedIndexedAccess requires fallback despite for-loop bounds */
  const line = lines[i] ?? '';
  /* v8 ignore stop */
  if (i > lastMatchIdx) {
    if (/^\s*`{3}\s*$/.test(line)) break;
    if (anyAgentFinalPattern.test(line)) break;
    if (isPostFinalRuntimeBoundary(line)) break;
  }
  body.push(line.replace(/^\s*\[[^\]]+\]\s+/, ''));
}
```

- [ ] **Step 3: Run the targeted test and confirm it passes**

Run:

```bash
pnpm --filter orchestrator test -- src/__tests__/services/completion-verifier/block-parser.test.ts
```

Expected: PASS. The new regression test confirms `Summary` keeps human-authored bullets and excludes Codex usage JSON plus the entrypoint exit line.

## Task 3: Add End-to-End Verifier Coverage for the Same Transcript Shape

**Files:**
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`
- Test: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`

- [ ] **Step 1: Add a `verifyCompletion()` regression test**

If `verifyCompletion` is not already imported in `block-parser.test.ts`, add:

```typescript
import { verifyCompletion } from '../../../services/completion-verifier.js';
```

Then add:

```typescript
it('does not include Codex turn.completed usage telemetry in verified review summaries', () => {
  const transcript = [
    '{"type":"item.completed","item":{"type":"agent_message","text":"REVIEW_AGENT_FINAL:\\n- PR: https://github.com/pbuchman/intexuraos/pull/2085\\n- review_id: 4270391498\\n- review_comments_posted: 0\\n- review_types: plan_review\\n- requirements_tracker_updated: yes\\n- gh_actions_status: all passed\\n- needs_remediation: 0\\n- memory_ids_used: mem_c1f22d25-6115-4f38-825a-647ad37dec21\\n- memory_ids_rejected: mem_6d23663d-d332-4f26-9430-31c0979b0008\\n- memory_usage_summary: parser boundary checked\\n- Summary: * Reviewed the plan-only PR.\\n* GH Actions are all passed."}}',
    '{"type":"turn.completed","usage":{"input_tokens":1866673,"cached_input_tokens":1723008,"output_tokens":7853,"reasoning_output_tokens":2171}}',
    'Codex attempt finished with exit code: 0',
  ].join('\n');

  const verdict = verifyCompletion({
    transcript,
    agentType: 'review',
    workerType: 'codex',
    executionMemoryContext: undefined,
    lastExitCode: undefined,
  });

  expect(verdict.kind).toBe('parsed');
  if (verdict.kind !== 'parsed') return;
  expect(verdict.missingRequired).toEqual([]);
  expect(verdict.data['summary']).toBe('* Reviewed the plan-only PR.\n* GH Actions are all passed.');
});
```

- [ ] **Step 2: Run the targeted verifier test**

Run:

```bash
pnpm --filter orchestrator test -- src/__tests__/services/completion-verifier/block-parser.test.ts
```

Expected: PASS. The deterministic verifier now returns a clean `data.summary`.

## Task 4: Verify the Workspace

**Files:**
- No additional file changes.

- [ ] **Step 1: Run orchestrator workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked orchestrator
```

Expected: PASS.

- [ ] **Step 2: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

## Risks and Guardrails

- Do not strip JSON-looking lines from inside user-authored summaries generally; stop only at known post-final runtime boundaries after the final marker.
- Keep the fix in `workers/orchestrator`, not in WhatsApp formatting. Scrubbing at WhatsApp would leave polluted `TaskResult.summary` in the web UI and APIs.
- Preserve existing support for unindented summary bullets and summary bullets containing colons; those are covered by existing tests and must remain green.
- No Firestore migration is required. Existing contaminated historical summaries can remain as historical data unless a separate cleanup issue is requested.
