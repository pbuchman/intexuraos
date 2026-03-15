# Gemini Triage Robustness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent missed code reviews caused by transient Gemini API failures during PR triage by enforcing tool-call mode on iteration 1 and retrying once on LLM failure for `pull_request` events.

**Architecture:** Two independent fixes in two packages. Fix #2 (`mode: 'ANY'`) lives in the Gemini infra package and forces the model to call a tool when no tool has been called yet, preventing silent empty responses on iteration 1. Fix #3 (retry) lives in code-agent's `unifiedEvaluator` and provides a safety net when the LLM client does return an error for a PR event.

**Tech Stack:** TypeScript, `@google/genai` SDK (unified), Vitest, Fastify (code-agent)

---

## Root cause (context for implementer)

PR #1196 (2026-03-14): Gemini 2.5 Flash called `request_review(code_quality)` on iteration 1, then returned an **empty response** (no function call, no text) on iteration 2. `toolCallingClient.ts:253` immediately returns `err` on empty response with no retry. `unifiedEvaluator.ts` treats any LLM failure on a `pull_request` event as a fallback-skip. Result: no review dispatched.

Firestore proof: `event_decisions/ed_6XKyq4KIAcir12KzQbsb`, `decision: 'skip'`, `reason: 'fallback_skip: LLM failed: Empty response from model'`.

---

## Files

| File                                                                     | Change                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/infra-gemini/src/toolCallingClient.ts`                         | Add `toolConfig.functionCallingConfig.mode` to `generateContent` call      |
| `packages/infra-gemini/src/__tests__/toolCallingClient.test.ts`          | Tests for `mode: 'ANY'` on iteration 1, `mode: 'AUTO'` on iteration 2+     |
| `apps/code-agent/src/domain/services/unifiedEvaluator.ts`                | Add single retry on `LLM_FAILED` for `pull_request` events                 |
| `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts` | Tests for retry behaviour: recovers on second attempt, respects event type |

---

## Chunk 1: Fix #2 — Force tool calling mode in Gemini client

### Task 1: Add `toolConfig` to the `generateContent` call

**Files:**
- Modify: `packages/infra-gemini/src/toolCallingClient.ts:148-155`
- Test: `packages/infra-gemini/src/__tests__/toolCallingClient.test.ts`

**Background:** The `generateContent` call is inside the `while (iteration < effectiveMax)` loop. `totalToolCalls` starts at `0` and is incremented only AFTER a tool fires. So:
- Iteration 1 (`totalToolCalls === 0`): `mode: 'ANY'` → Gemini **must** call a function.
- Iteration 2+ (`totalToolCalls > 0`): `mode: 'AUTO'` → Gemini can return final text.

Guard: only add `toolConfig` when `functionDeclarations.length > 0` (no tools = no forcing).

- [ ] **Step 1: Write failing test — `mode: 'ANY'` on first call**

Add to `packages/infra-gemini/src/__tests__/toolCallingClient.test.ts` inside `describe('createGeminiToolCallingClient')`:

```typescript
describe('toolConfig mode enforcement', () => {
  it('sends mode ANY on first iteration when tools are provided', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      textResponse('done')
    );

    const client = createClient();
    await client.run({
      systemPrompt: 'triage agent',
      messages: [{ role: 'user', content: 'eval PR' }],
      tools: [
        {
          name: 'skip',
          description: 'Skip this PR',
          parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
          run: async () => JSON.stringify({ success: true }),
        },
      ],
    });

    const firstCallConfig = mockGenerateContent.mock.calls[0]?.[0]?.config as
      | { toolConfig?: { functionCallingConfig?: { mode?: string } } }
      | undefined;
    expect(firstCallConfig?.toolConfig?.functionCallingConfig?.mode).toBe('ANY');
  });

  it('sends mode AUTO on second iteration after a tool call', async () => {
    const skipTool = {
      name: 'skip',
      description: 'Skip',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
      run: async () => JSON.stringify({ success: true }),
    };

    mockGenerateContent
      .mockResolvedValueOnce(
        functionCallResponse('skip', { reason: 'trivial' })
      )
      .mockResolvedValueOnce(
        textResponse('Skipped because trivial.')
      );

    const client = createClient();
    await client.run({
      systemPrompt: 'triage agent',
      messages: [{ role: 'user', content: 'eval PR' }],
      tools: [skipTool],
    });

    const secondCallConfig = mockGenerateContent.mock.calls[1]?.[0]?.config as
      | { toolConfig?: { functionCallingConfig?: { mode?: string } } }
      | undefined;
    expect(secondCallConfig?.toolConfig?.functionCallingConfig?.mode).toBe('AUTO');
  });

  it('does NOT add toolConfig when no tools are provided', async () => {
    mockGenerateContent.mockResolvedValueOnce(textResponse('plain text response'));

    const client = createClient();
    await client.run({
      systemPrompt: 'simple agent',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
    });

    const callConfig = mockGenerateContent.mock.calls[0]?.[0]?.config as
      | { toolConfig?: unknown }
      | undefined;
    expect(callConfig?.toolConfig).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /path/to/repo
pnpm run verify:workspace:tracked infra-gemini 2>&1 | grep -A3 "toolConfig mode"
```

Expected: 3 failing tests about `toolConfig`.

- [ ] **Step 3: Implement `toolConfig` in `toolCallingClient.ts`**

In `packages/infra-gemini/src/toolCallingClient.ts`, replace the `generateContent` call (lines 148-155):

```typescript
// Before:
const response = await ai.models.generateContent({
  model,
  contents,
  config: {
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations }],
  },
});

// After:
const response = await ai.models.generateContent({
  model,
  contents,
  config: {
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations }],
    ...(functionDeclarations.length > 0 && {
      toolConfig: {
        functionCallingConfig: {
          mode: totalToolCalls === 0 ? 'ANY' : 'AUTO',
        },
      },
    }),
  },
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm run verify:workspace:tracked infra-gemini
```

Expected: all tests pass, including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/infra-gemini/src/toolCallingClient.ts \
        packages/infra-gemini/src/__tests__/toolCallingClient.test.ts
git commit -m "fix(infra-gemini): enforce tool calling mode ANY on first iteration

Sets functionCallingConfig.mode='ANY' when no tools have been called yet,
forcing Gemini to always call a function on iteration 1. Switches to 'AUTO'
after the first tool fires so the model can return final text.

Prevents silent empty responses that caused missed PR reviews (INT-XXX).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Fix #3 — Retry LLM failures for `pull_request` events in unifiedEvaluator

### Task 2: Add single retry on LLM failure for `pull_request` events

**Files:**
- Modify: `apps/code-agent/src/domain/services/unifiedEvaluator.ts:168-186`
- Test: `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts`

**Background:** `deps.evaluateEvent` is the function injected into `createUnifiedEvaluator`. For `pull_request` events, when this returns `err(...)`, the current code immediately calls `handleFallback` → skip. Adding a single retry before fallback handles transient API errors without any risk: if the error is transient, retry succeeds; if structural, it fails again → identical outcome.

The retry only applies to `pull_request` events (not `issue_comment`) because:
- PR reviews are high-value, cost of missed review >> cost of one extra LLM call (~$0.001)
- Comment events are lower priority and have a fallback-dispatch path anyway

- [ ] **Step 1: Write failing test — retry recovers on second attempt**

Find the existing `describe` block for LLM triage failures in `unifiedEvaluator.test.ts` and add:

```typescript
describe('LLM triage retry for pull_request events', () => {
  it('retries evaluateEvent once on failure for pull_request event and succeeds', async () => {
    const prEvent = createFakeEvent({
      eventType: 'pull_request',
      action: 'opened',
      id: 'evt-pr-retry',
      auditEventId: 'audit-pr-retry',
    });

    const evaluateEvent = vi.fn()
      .mockResolvedValueOnce(err({ code: 'LLM_FAILED', message: 'LLM failed: Empty response from model' }))
      .mockResolvedValueOnce(ok({
        triage: { action: 'skip', reason: 'Trivial config change' },
        usage: { costUsd: 0.001, toolCalls: [{ tool: 'skip', args: { reason: 'Trivial config change' } }] },
        reasoning: 'Config-only PR, no review needed.',
      }));

    const logger = createFakeLogger();
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(prEvent, logger);

    expect(evaluateEvent).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: prEvent.id }),
      'LLM triage failed — retrying for pull_request event'
    );
    // Should record a skip decision (from the successful second attempt)
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'skip', reason: expect.stringContaining('Trivial') })
    );
  });

  it('does NOT retry for issue_comment events — falls back immediately', async () => {
    const commentEvent = createFakeEvent({
      eventType: 'issue_comment',
      action: 'created',
    });

    const evaluateEvent = vi.fn()
      .mockResolvedValue(err({ code: 'LLM_FAILED', message: 'LLM failed: Empty response from model' }));

    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(commentEvent, createFakeLogger());

    // Only called once — no retry for non-PR events
    expect(evaluateEvent).toHaveBeenCalledTimes(1);
  });

  it('falls back to skip if retry also fails for pull_request event', async () => {
    const prEvent = createFakeEvent({
      eventType: 'pull_request',
      action: 'opened',
      id: 'evt-pr-double-fail',
      auditEventId: 'audit-pr-double-fail',
    });

    const evaluateEvent = vi.fn()
      .mockResolvedValue(err({ code: 'LLM_FAILED', message: 'LLM failed: Empty response from model' }));

    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(prEvent, createFakeLogger());

    expect(evaluateEvent).toHaveBeenCalledTimes(2);
    // Falls back to skip
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'skip', reason: expect.stringContaining('fallback_skip') })
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm run verify:workspace:tracked code-agent 2>&1 | grep -A3 "retry"
```

Expected: 3 failing tests.

- [ ] **Step 3: Implement retry in `unifiedEvaluator.ts`**

In `apps/code-agent/src/domain/services/unifiedEvaluator.ts`, find the LLM invocation block (around line 168):

```typescript
// Before:
const llmResult = await deps.evaluateEvent(event);

if (!llmResult.ok) {
  logger.warn(
    { eventId: event.id, error: llmResult.error },
    'LLM triage failed'
  );
  // ...handleFallback
}
```

Replace with:

```typescript
let llmResult = await deps.evaluateEvent(event);

// Retry once on any LLM failure for pull_request events.
// PRs are high-value: a transient API error (e.g. empty response) should not silently skip a review.
// Cost of an extra call (~$0.001) is negligible compared to a missed review.
if (!llmResult.ok && event.eventType === 'pull_request') {
  logger.warn(
    { eventId: event.id, error: llmResult.error },
    'LLM triage failed — retrying for pull_request event'
  );
  llmResult = await deps.evaluateEvent(event);
}

if (!llmResult.ok) {
  logger.warn(
    { eventId: event.id, error: llmResult.error },
    'LLM triage failed'
  );
  // ...rest of existing failure handling unchanged
}
```

> **Important:** The `let` change on `llmResult` is the only structural change. All downstream handling (`handleFallback`, `handleReviewTriageFailure`) stays exactly as-is.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm run verify:workspace:tracked code-agent
```

Expected: all tests pass including the 3 new ones.

- [ ] **Step 5: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: all workspaces pass.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/services/unifiedEvaluator.ts \
        apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts
git commit -m "fix(code-agent): retry LLM triage once on failure for pull_request events

Transient Gemini API errors (empty response, timeout) caused PR triage to
fall back to skip immediately, silently dropping code review requests.

Now retries evaluateEvent once before falling back, for pull_request events
only. issue_comment events keep the existing immediate-fallback behaviour.

Root cause: PR #1196 missed review due to 'Empty response from model' on
iteration 2 of Gemini tool calling loop.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verification

After both commits:

```bash
pnpm run ci:tracked
```

All workspaces must pass. The two fixes are independent — either can be reverted without affecting the other.
