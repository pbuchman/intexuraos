# Fix code-agent usage webhook v2 schema mismatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/code-agent/src/routes/internalUsageWebhookRoute.ts` accept the v2 usage-event payload that the orchestrator's `HttpWebhookUsageSink` actually sends. No v1 compat — v2-only.

**Architecture:** The orchestrator's sender (`packages/llm-pricing/src/{httpWebhookUsageSink.ts,buildUsageEvent.ts}`) POSTs `{ schemaVersion: 2, events: [v2event] }` to code-agent's `/internal/webhooks/usage-events`. That gateway route currently declares `schemaVersion: enum[1]` and a v1 event schema (with `billedUsd`, `calculatedUsd`, pricingSource enum `['provider_reported','calculated','mixed','external']`). Fastify rejects with HTTP 400 before `forwardUsageEvents` is reached. The downstream target (`POST /internal/usage/events` on llm-usage-service) already accepts v2 via `UsageEventInput` schema, so once the gateway is aligned to v2, the full chain works.

**Tech Stack:** Fastify JSON Schema (Ajv), Vitest, TypeScript strict.

**Scope:**
- Modify: `apps/code-agent/src/routes/internalUsageWebhookRoute.ts` (Fastify body schema)
- Modify: `apps/code-agent/src/__tests__/routes/internalUsageWebhookRoute.test.ts` (v2 fixtures + regression test)

**Endpoint Changes:**
- Modified: `POST /internal/webhooks/usage-events` (code-agent) — body schema v1 → v2
- Created: none
- Removed: none
- Unchanged: `POST /internal/usage/events` (llm-usage-service) — already v2

**Authoritative v2 shape** (from sender `buildUsageEvent.ts` + downstream `usageEventInputSchema.ts`):
- top-level `schemaVersion: 2`
- event `schemaVersion: 2`
- `request` adds optional `promptType: string`
- `cost: { providerReportedUsd: number|null, pricingSource: 'provider_reported'|'pending' }` — drops `billedUsd`, `calculatedUsd`; tighter enum

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create feature branch**

```bash
cd /home/pbuchman/personal/intexuraos-5
git checkout -b fix/code-agent-usage-webhook-v2-schema
```

Expected: `Switched to a new branch 'fix/code-agent-usage-webhook-v2-schema'`

---

### Task 1: Write failing regression test (exact sender payload)

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/internalUsageWebhookRoute.test.ts`

The test uses the literal shape produced by the orchestrator's `buildUsageEvent()` so a future `enum[N]` drift breaks this test immediately.

- [ ] **Step 1: Add regression test after the existing "empty events array" test (~line 279)**

Insert after the `it('returns 200 with empty events array', ...)` block, before the `// Schema validation` divider:

```typescript
  // -----------------------------------------------------------------------
  // Regression: exact orchestrator v2 payload (buildUsageEvent + HttpWebhookUsageSink)
  // -----------------------------------------------------------------------

  it('returns 200 for the exact v2 payload produced by orchestrator buildUsageEvent', async () => {
    const body = {
      schemaVersion: 2,
      events: [
        {
          schemaVersion: 2,
          eventId: '11111111-1111-4111-8111-111111111111',
          occurredAt: '2026-04-17T01:45:03.782Z',
          owner: { type: 'system', id: 'orchestrator-validation' },
          source: {
            service: 'orchestrator',
            component: 'completion-verifier',
            client: 'completion-verifier',
            environment: 'dev',
          },
          request: {
            provider: 'openrouter',
            model: 'google/gemma-4-31b-it',
            operation: 'generate',
            success: true,
            durationMs: 0,
            promptType: 'completion-verification',
          },
          usage: {
            inputTokens: 2780,
            outputTokens: 93,
            totalTokens: 2873,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
            thinkingTokens: 0,
            webSearchCalls: 0,
            groundingEnabled: false,
            imageCount: 0,
          },
          cost: { providerReportedUsd: null, pricingSource: 'pending' },
          correlation: {
            requestId: null,
            traceId: null,
            taskId: 'task_537bbe88-76c8-41d2-bcc0-20ea06d506d3',
            researchId: null,
            attempt: null,
            sessionId: null,
          },
          error: null,
        },
      ],
    };
    const response = await sendUsageEvents(body);

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(mockUsageServiceClient.ingestEvents)).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run only this test, verify it fails**

```bash
pnpm --filter @intexuraos/code-agent test -- internalUsageWebhookRoute -t "exact v2 payload"
```

Expected: FAIL with statusCode 400 (schemaVersion validation error).

---

### Task 2: Update route schema to v2

**Files:**
- Modify: `apps/code-agent/src/routes/internalUsageWebhookRoute.ts`

- [ ] **Step 1: Change top-level schemaVersion to v2**

In `internalUsageWebhookRoute.ts`, replace:

```typescript
            schemaVersion: { type: 'integer', enum: [1] },
            events: {
              type: 'array',
              items: {
                type: 'object',
                required: [
                  'schemaVersion',
```

with:

```typescript
            schemaVersion: { type: 'integer', enum: [2] },
            events: {
              type: 'array',
              items: {
                type: 'object',
                required: [
                  'schemaVersion',
```

(The `replace_all: true` option works: only the top-level line matches this context.)

- [ ] **Step 2: Change per-event schemaVersion to v2**

Replace:

```typescript
                  schemaVersion: { type: 'integer', enum: [1] },
                  eventId: { type: 'string', minLength: 1 },
```

with:

```typescript
                  schemaVersion: { type: 'integer', enum: [2] },
                  eventId: { type: 'string', minLength: 1 },
```

- [ ] **Step 3: Add optional `promptType` to request properties**

Replace the `request` block:

```typescript
                  request: {
                    type: 'object',
                    required: ['provider', 'model', 'operation', 'success', 'durationMs'],
                    additionalProperties: false,
                    properties: {
                      provider: {
                        type: 'string',
                        enum: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'],
                      },
                      model: { type: 'string', minLength: 1 },
                      operation: {
                        type: 'string',
                        enum: [
                          'research',
                          'generate',
                          'image_generation',
                          'tool_calling',
                          'other',
                        ],
                      },
                      success: { type: 'boolean' },
                      durationMs: { type: 'number', minimum: 0 },
                    },
                  },
```

with:

```typescript
                  request: {
                    type: 'object',
                    required: ['provider', 'model', 'operation', 'success', 'durationMs'],
                    additionalProperties: false,
                    properties: {
                      provider: {
                        type: 'string',
                        enum: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'],
                      },
                      model: { type: 'string', minLength: 1 },
                      operation: {
                        type: 'string',
                        enum: [
                          'research',
                          'generate',
                          'image_generation',
                          'tool_calling',
                          'other',
                        ],
                      },
                      success: { type: 'boolean' },
                      durationMs: { type: 'number', minimum: 0 },
                      promptType: { type: 'string' },
                    },
                  },
```

- [ ] **Step 4: Replace cost schema with v2 shape**

Replace the `cost` block:

```typescript
                  cost: {
                    type: 'object',
                    required: ['billedUsd', 'providerReportedUsd', 'calculatedUsd', 'pricingSource'],
                    additionalProperties: false,
                    properties: {
                      billedUsd: { type: 'number', minimum: 0 },
                      providerReportedUsd: { type: ['number', 'null'] },
                      calculatedUsd: { type: ['number', 'null'] },
                      pricingSource: {
                        type: 'string',
                        enum: ['provider_reported', 'calculated', 'mixed', 'external'],
                      },
                    },
                  },
```

with:

```typescript
                  cost: {
                    type: 'object',
                    required: ['providerReportedUsd', 'pricingSource'],
                    additionalProperties: false,
                    properties: {
                      providerReportedUsd: { type: ['number', 'null'] },
                      pricingSource: {
                        type: 'string',
                        enum: ['provider_reported', 'pending'],
                      },
                    },
                  },
```

- [ ] **Step 5: Run the regression test alone, confirm pass**

```bash
pnpm --filter @intexuraos/code-agent test -- internalUsageWebhookRoute -t "exact v2 payload"
```

Expected: PASS.

---

### Task 3: Update existing tests to v2 fixtures

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/internalUsageWebhookRoute.test.ts`

All pre-existing tests use `schemaVersion: 1` and v1 cost shape. Update the fixture + the cost-related edge case.

- [ ] **Step 1: Rewrite `buildValidPayload()` to v2**

Replace the existing `buildValidPayload` (around lines 50-68):

```typescript
function buildValidPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    events: [
      {
        schemaVersion: 1,
        eventId: 'evt-001',
        occurredAt: '2026-04-10T12:00:00Z',
        owner: { type: 'user', id: 'user-1' },
        source: { service: 'code-agent', component: 'orchestrator', client: 'cli', environment: 'dev' },
        request: { provider: LlmProviders.Anthropic, model: 'claude-sonnet-4-20250514', operation: 'generate', success: true, durationMs: 1500 },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0, cachedTokens: 0, reasoningTokens: 0, thinkingTokens: 0, webSearchCalls: 0, groundingEnabled: false, imageCount: 0 },
        cost: { billedUsd: 0.01, providerReportedUsd: null, calculatedUsd: 0.01, pricingSource: 'calculated' },
        correlation: { requestId: null, traceId: null, taskId: 'task_abc', researchId: null, attempt: null, sessionId: null },
        error: null,
      },
    ],
  };
}
```

with:

```typescript
function buildValidPayload(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    events: [
      {
        schemaVersion: 2,
        eventId: 'evt-001',
        occurredAt: '2026-04-10T12:00:00Z',
        owner: { type: 'user', id: 'user-1' },
        source: { service: 'code-agent', component: 'orchestrator', client: 'cli', environment: 'dev' },
        request: { provider: LlmProviders.Anthropic, model: 'claude-sonnet-4-20250514', operation: 'generate', success: true, durationMs: 1500 },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0, cachedTokens: 0, reasoningTokens: 0, thinkingTokens: 0, webSearchCalls: 0, groundingEnabled: false, imageCount: 0 },
        cost: { providerReportedUsd: null, pricingSource: 'pending' },
        correlation: { requestId: null, traceId: null, taskId: 'task_abc', researchId: null, attempt: null, sessionId: null },
        error: null,
      },
    ],
  };
}
```

- [ ] **Step 2: Update "empty events array" test to schemaVersion 2**

Replace:

```typescript
    const body = { schemaVersion: 1, events: [] };
```

with:

```typescript
    const body = { schemaVersion: 2, events: [] };
```

- [ ] **Step 3: Update "malformed events" test to schemaVersion 2**

Replace:

```typescript
    const body = {
      schemaVersion: 1,
      events: [
        {
          // Missing all required fields — just an arbitrary object
          foo: 'bar',
        },
      ],
    };
```

with:

```typescript
    const body = {
      schemaVersion: 2,
      events: [
        {
          // Missing all required fields — just an arbitrary object
          foo: 'bar',
        },
      ],
    };
```

- [ ] **Step 4: Replace the `billedUsd` negative test with a v2-appropriate `pricingSource` enum test**

Replace the whole `it('returns 400 when cost billedUsd is negative', ...)` block (around lines 338-351):

```typescript
  it('returns 400 when cost billedUsd is negative', async () => {
    const validPayload = buildValidPayload();
    const events = (validPayload as { events: Record<string, unknown>[] }).events;
    const firstEvent = events[0];
    if (firstEvent !== undefined) {
      (firstEvent as { cost: Record<string, unknown> }).cost = {
        ...(firstEvent as { cost: Record<string, unknown> }).cost,
        billedUsd: -0.5,
      };
    }
    const response = await sendUsageEvents(validPayload);

    expect(response.statusCode).toBe(400);
  });
```

with:

```typescript
  it('returns 400 when cost.pricingSource is not in the v2 enum', async () => {
    const validPayload = buildValidPayload();
    const events = (validPayload as { events: Record<string, unknown>[] }).events;
    const firstEvent = events[0];
    if (firstEvent !== undefined) {
      (firstEvent as { cost: Record<string, unknown> }).cost = {
        ...(firstEvent as { cost: Record<string, unknown> }).cost,
        pricingSource: 'calculated',
      };
    }
    const response = await sendUsageEvents(validPayload);

    expect(response.statusCode).toBe(400);
  });
```

- [ ] **Step 5: Run the full file**

```bash
pnpm --filter @intexuraos/code-agent test -- internalUsageWebhookRoute
```

Expected: all tests PASS (including the new regression test from Task 1).

---

### Task 4: Verify full workspace CI for code-agent

**Files:** none

- [ ] **Step 1: Run workspace-scoped CI for code-agent**

```bash
cd /home/pbuchman/personal/intexuraos-5
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tee /tmp/ci-codeagent.txt
```

Expected: all checks pass (types, tests, coverage, lint).

- [ ] **Step 2: If anything failed, inspect**

```bash
rg -n "error|FAIL" -C3 /tmp/ci-codeagent.txt | head -80
```

Fix any reported issue in the same file set before proceeding.

- [ ] **Step 3: Repo-wide tracked CI**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked.txt
```

Expected: passes completely. If it fails, fix before commit (Commit Gate).

---

### Task 5: Commit

**Files:** already staged by prior tasks (git-add explicit).

- [ ] **Step 1: Stage changed files**

```bash
git add apps/code-agent/src/routes/internalUsageWebhookRoute.ts \
        apps/code-agent/src/__tests__/routes/internalUsageWebhookRoute.test.ts \
        docs/superpowers/plans/2026-04-17-code-agent-usage-webhook-v2-schema.md
```

- [ ] **Step 2: Commit with descriptive message**

```bash
git commit -m "$(cat <<'EOF'
fix(code-agent): align usage-webhook body schema with orchestrator v2 payload

The gateway route /internal/webhooks/usage-events was still on v1
(schemaVersion enum [1]; cost.billedUsd/calculatedUsd required), while
the orchestrator's HttpWebhookUsageSink posts schemaVersion 2 events
(cost = { providerReportedUsd, pricingSource in ['provider_reported','pending'] }).
Fastify rejected every orchestrator usage event with HTTP 400
("schemaVersion must be equal to one of the allowed values"), silently
dropping all LLM usage data from orchestrator-validation calls.

Switch the route schema to v2-only (no compat window — v1 is no longer
sent), add optional `request.promptType`, and add a regression test that
uses the exact shape buildUsageEvent() emits so future schema drift is
caught before deploy.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Push + PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin fix/code-agent-usage-webhook-v2-schema
```

- [ ] **Step 2: Open PR targeting `development`**

```bash
gh pr create --base development --title "fix(code-agent): align usage-webhook schema with orchestrator v2 payload" --body "$(cat <<'EOF'
## Summary
- Orchestrator's `HttpWebhookUsageSink` has been emitting `schemaVersion: 2` events since INT-1378, but code-agent's `/internal/webhooks/usage-events` still validates against a v1-only Fastify schema. Every orchestrator usage event was dropped with HTTP 400 `"schemaVersion must be equal to one of the allowed values"`.
- This PR switches the gateway body schema to v2-only: top-level and per-event `schemaVersion: 2`, v2 cost shape (`{ providerReportedUsd, pricingSource: 'provider_reported'|'pending' }`), and optional `request.promptType`. No compat window — v1 is no longer produced anywhere.
- Adds a regression test that uses the exact payload shape produced by `packages/llm-pricing/src/buildUsageEvent.ts`, so future drift between sender and gateway fails CI immediately.

## Test plan
- [x] `pnpm --filter @intexuraos/code-agent test -- internalUsageWebhookRoute` — all pass, including the new regression test
- [x] `pnpm run verify:workspace:tracked -- code-agent` passes
- [x] `pnpm run ci:tracked` passes
- [ ] After merge + dev deploy, confirm `Usage webhook POST failed with non-2xx status` warnings stop appearing in orchestrator logs

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

Return the PR URL.

---

## Self-Review

- **Spec coverage:** Root cause is schemaVersion + cost-shape + promptType mismatch. Tasks 1-3 cover all three.
- **No placeholders:** all code blocks contain real content; no TBDs.
- **Type consistency:** `pricingSource` enum values match between sender (`buildUsageEvent.ts:79`), downstream schema (`usageEventSchema.ts:127-130`), and new gateway schema (Task 2 Step 4).
- **Test coverage:** regression test locks the exact wire format; schema-validation tests re-anchored on v2 (`pricingSource` enum).
- **CI gate:** Task 4 runs `ci:tracked` before Task 5 commits (Commit Gate per CLAUDE.md).
