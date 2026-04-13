# LLM Usage Event Shape Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix structural bugs in the shared LLM usage event pipeline so that (a) Firestore writes never crash on OpenRouter-style model IDs, (b) user-initiated LLM calls show up as user-scoped events, (c) OpenRouter's per-call cost from the API response is the source of truth, and (d) missing pricing never drops events.

**Architecture:** All fixes land in `packages/llm-pricing/`, `packages/infra-openrouter/`, `packages/internal-clients/`, and `apps/llm-usage-service/`. Zero changes to `workers/orchestrator/*` files (orchestrator inherits the improved event shape via the shared package). Backwards-compatible: every new field is optional with a default that preserves current behavior.

**Tech Stack:** TypeScript strict mode, Vitest, Fastify (llm-usage-service), Firestore Admin SDK.

---

## Background — Verified Evidence

These are the bugs being fixed. Each was confirmed against production logs, Firestore data, and source files.

| #   | Symptom                                                                             | Root Cause                                                                                                              | File:Line                                                                            |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Recurring 500 on `/internal/webhooks/usage-events` (20:03:17, 20:54:16)             | `source.client = "xiaomi/mimo-v2-pro"` propagates into Firestore aggregate doc-ID; `/` makes the path-segment count odd | `packages/llm-pricing/src/buildUsageEvent.ts:46`                                     |
| 2   | Sync throw kills the request; aggregate lost                                        | `db.collection(C).doc(id)` is **outside** the try/catch                                                                 | `apps/llm-usage-service/src/infra/firestore/firestoreUsageAggregateRepository.ts:15` |
| 3   | User dashboard shows zero usage even when user-initiated calls happen               | `owner.type` hardcoded to `'system'` for every event                                                                    | `packages/llm-pricing/src/buildUsageEvent.ts:42`                                     |
| 4   | OpenRouter cost computed via static allowlist instead of API-reported value         | `extractUsage` hardcodes `undefined` for `providerCost`                                                                 | `packages/infra-openrouter/src/client.ts:160`                                        |
| 5   | Dynamic model selection (user picks unpriced model) throws → no LLM call → no event | `pricingContext.getPricing(model)` throws on missing                                                                    | `packages/llm-pricing/src/pricingClient.ts:374-379`                                  |

---

## File Structure

**Modify:**
- `packages/llm-pricing/src/usageLogger.ts` — add 3 optional fields to `UsageLogParams`
- `packages/llm-pricing/src/buildUsageEvent.ts` — consume new fields with safe defaults
- `packages/llm-pricing/src/pricingClient.ts` — make `getPricing` no-throw with warn-on-miss; `validateModels` keeps strict for startup
- `packages/llm-pricing/src/__tests__/usageLogger.test.ts` — add cases for new fields
- `packages/llm-pricing/src/__tests__/pricingClient.test.ts` — add no-throw test
- `packages/llm-pricing/src/__tests__/httpInternalAuthUsageSink.test.ts` — update assertion of `client === <model>` → `client === <component>`
- `packages/llm-pricing/src/__tests__/httpWebhookUsageSink.test.ts` — update assertion of `client === <model>` → `client === <component>`
- `packages/infra-openrouter/src/client.ts` — capture `usage.cost`, pass as `providerCost`
- `packages/infra-openrouter/src/types.ts` — add optional `cost?: number` to `OpenRouterUsage`
- `packages/infra-openrouter/src/__tests__/client.test.ts` — add provider-cost passthrough tests (generate AND research)
- `packages/llm-factory/src/llmClientFactory.ts` — add `ownerType` to `LlmClientConfig`, propagate
- `packages/llm-factory/src/openRouterGenerateClient.ts` — propagate `ownerType` to inner client
- `packages/infra-claude/src/client.ts` — accept `ownerType` in config, forward in `trackUsage`
- `packages/infra-gemini/src/client.ts` — accept `ownerType` in config, forward in `trackUsage`
- `packages/infra-gpt/src/client.ts` — accept `ownerType` in config, forward in `trackUsage`
- `packages/infra-perplexity/src/client.ts` — accept `ownerType` in config, forward in `trackUsage`
- `packages/internal-clients/src/user-service/client.ts` — pass `ownerType: 'user'` when creating per-user clients
- `apps/llm-usage-service/src/infra/firestore/aggregateKeyUtils.ts` — hash `source.client`
- `apps/llm-usage-service/src/infra/firestore/firestoreUsageAggregateRepository.ts` — widen try/catch around `doc()` call
- `apps/llm-usage-service/src/__tests__/infra/firestore/aggregateKeyUtils.test.ts` — UPDATE existing `parts[5]` assertion (line 51) and add slash-safety test
- `apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageAggregateRepository.test.ts` — add error-path test

**Buildup contract:** The new fields are added to `UsageLogParams` first (Task 1) so subsequent tasks have something to consume. Each subsequent task is independently committable.

---

## Task 1: Add optional fields to `UsageLogParams`

**Files:**
- Modify: `packages/llm-pricing/src/usageLogger.ts`
- Test: `packages/llm-pricing/src/__tests__/usageLogger.test.ts`

- [ ] **Step 1: Read the current `UsageLogParams` interface**

Read `packages/llm-pricing/src/usageLogger.ts:42-59` to confirm field structure.

- [ ] **Step 2: Add a failing test that the logger forwards new optional fields to the sink**

Append to `packages/llm-pricing/src/__tests__/usageLogger.test.ts` inside the existing `describe('usageLogger', ...)` block:

```ts
  describe('UsageLogger.log forwarding new optional fields', () => {
    it('forwards ownerType, clientName, providerReportedUsd to the sink when provided', async () => {
      const fakeSink = { log: vi.fn().mockResolvedValue(undefined) };
      const logger = createUsageLogger({ logger: fakeLogger, sink: fakeSink });

      await logger.log({
        ...baseParams,
        ownerType: 'user',
        clientName: 'linear-agent-title-gen',
        providerReportedUsd: 0.0042,
      });

      expect(fakeSink.log).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerType: 'user',
          clientName: 'linear-agent-title-gen',
          providerReportedUsd: 0.0042,
        }),
      );
    });

    it('omits new optional fields from the sink call when not provided', async () => {
      const fakeSink = { log: vi.fn().mockResolvedValue(undefined) };
      const logger = createUsageLogger({ logger: fakeLogger, sink: fakeSink });

      await logger.log(baseParams);

      const callArg = fakeSink.log.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg.ownerType).toBeUndefined();
      expect(callArg.clientName).toBeUndefined();
      expect(callArg.providerReportedUsd).toBeUndefined();
    });
  });
```

- [ ] **Step 3: Run the test to verify it fails (TypeScript error or assertion)**

```bash
cd /Users/p.buchman/personal/intexuraos-1
pnpm --filter @intexuraos/llm-pricing test usageLogger.test.ts
```

Expected: TypeScript error — `ownerType`/`clientName`/`providerReportedUsd` are not in `UsageLogParams`.

- [ ] **Step 4: Add the optional fields to `UsageLogParams`**

In `packages/llm-pricing/src/usageLogger.ts`, locate the `UsageLogParams` interface (around line 42). Add three optional fields with JSDoc:

```ts
export interface UsageLogParams {
  /** User ID for per-user tracking */
  userId: string;
  /** LLM provider (anthropic, openai, google, perplexity) */
  provider: LlmProvider;
  /** Model identifier (e.g., 'claude-sonnet-4-5') */
  model: string;
  /** Type of LLM operation performed */
  callType: CallType;
  /** Normalized usage with token counts and calculated cost */
  usage: NormalizedUsage;
  /** Whether the LLM call succeeded */
  success: boolean;
  /** Error message if success is false */
  errorMessage?: string;
  /** Optional pino logger for structured logging */
  logger?: Logger;
  /** Owner scope of the call. Defaults to 'system' when omitted to preserve legacy behavior. */
  ownerType?: 'user' | 'system';
  /** Slash-safe label identifying the calling client/transport (e.g. 'openrouter-generate'). Defaults to source.component when omitted. */
  clientName?: string;
  /** Cost reported by the provider (e.g. OpenRouter usage.cost). When set, the receiver records pricingSource: 'provider'. */
  providerReportedUsd?: number | null;
}
```

- [ ] **Step 5: Re-run the test to verify it passes**

```bash
pnpm --filter @intexuraos/llm-pricing test usageLogger.test.ts
```

Expected: PASS for both new tests; pre-existing tests still PASS.

- [ ] **Step 6: Run the package's full type-check + tests**

```bash
pnpm --filter @intexuraos/llm-pricing run ci:tracked
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-pricing/src/usageLogger.ts packages/llm-pricing/src/__tests__/usageLogger.test.ts
git commit -m "feat(llm-pricing): add optional ownerType, clientName, providerReportedUsd to UsageLogParams"
```

---

## Task 2: Update `buildUsageEvent` to consume the new fields

**Files:**
- Modify: `packages/llm-pricing/src/buildUsageEvent.ts`
- Test: `packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts` (NEW FILE)

- [ ] **Step 1: Create a new test file with failing tests**

Create `packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { buildUsageEvent } from '../buildUsageEvent.js';
import type { UsageLogParams } from '../usageLogger.js';

const baseParams: UsageLogParams = {
  userId: 'user-123',
  provider: LlmProviders.OpenRouter,
  model: 'or:nvidia/nemotron-3-super-120b-a12b:free',
  callType: 'generate',
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
  success: true,
};

const baseSource = { service: 'linear-agent', component: 'title-gen' };

describe('buildUsageEvent', () => {
  it('defaults owner.type to "system" when ownerType not provided', () => {
    const event = buildUsageEvent(baseParams, baseSource) as Record<string, any>;
    expect(event.owner).toEqual({ type: 'system', id: 'user-123' });
  });

  it('uses owner.type "user" when ownerType: "user" passed', () => {
    const event = buildUsageEvent(
      { ...baseParams, ownerType: 'user' },
      baseSource,
    ) as Record<string, any>;
    expect(event.owner).toEqual({ type: 'user', id: 'user-123' });
  });

  it('defaults source.client to source.component when clientName not provided', () => {
    const event = buildUsageEvent(baseParams, baseSource) as Record<string, any>;
    expect(event.source.client).toBe('title-gen');
  });

  it('uses source.client = clientName when provided', () => {
    const event = buildUsageEvent(
      { ...baseParams, clientName: 'openrouter-generate' },
      baseSource,
    ) as Record<string, any>;
    expect(event.source.client).toBe('openrouter-generate');
  });

  it('source.client never contains "/" even when model id contains it', () => {
    const event = buildUsageEvent(baseParams, baseSource) as Record<string, any>;
    expect(event.source.client).not.toMatch(/\//);
  });

  it('cost.providerReportedUsd is null and pricingSource is "calculated" by default', () => {
    const event = buildUsageEvent(baseParams, baseSource) as Record<string, any>;
    expect(event.cost.providerReportedUsd).toBeNull();
    expect(event.cost.pricingSource).toBe('calculated');
    expect(event.cost.billedUsd).toBe(0.001);
    expect(event.cost.calculatedUsd).toBe(0.001);
  });

  it('cost uses providerReportedUsd as billedUsd when provided; pricingSource = "provider_reported"', () => {
    const event = buildUsageEvent(
      { ...baseParams, providerReportedUsd: 0.0042 },
      baseSource,
    ) as Record<string, any>;
    expect(event.cost.providerReportedUsd).toBe(0.0042);
    expect(event.cost.billedUsd).toBe(0.0042);
    expect(event.cost.calculatedUsd).toBe(0.001); // params.usage.costUsd retained
    expect(event.cost.pricingSource).toBe('provider_reported');
  });

  it('clamps a negative providerReportedUsd to 0 (schema requires billedUsd >= 0)', () => {
    const event = buildUsageEvent(
      { ...baseParams, providerReportedUsd: -0.001 },
      baseSource,
    ) as Record<string, any>;
    expect(event.cost.billedUsd).toBeGreaterThanOrEqual(0);
  });

  it('treats providerReportedUsd: null as "no provider cost"', () => {
    const event = buildUsageEvent(
      { ...baseParams, providerReportedUsd: null },
      baseSource,
    ) as Record<string, any>;
    expect(event.cost.providerReportedUsd).toBeNull();
    expect(event.cost.pricingSource).toBe('calculated');
    expect(event.cost.billedUsd).toBe(0.001);
  });
});
```

- [ ] **Step 2: Run the test to verify failures**

```bash
pnpm --filter @intexuraos/llm-pricing test buildUsageEvent.test.ts
```

Expected: Multiple FAIL — `owner.type` always 'system', `source.client` is the model id, etc.

- [ ] **Step 3: Implement the changes in `buildUsageEvent.ts`**

Replace the body of `buildUsageEvent` in `packages/llm-pricing/src/buildUsageEvent.ts`:

```ts
export function buildUsageEvent(
  params: UsageLogParams,
  source: { service: string; component: string },
  correlationOverrides?: CorrelationOverrides
): UsageEventPayload {
  const environment: 'dev' | 'prod' = process.env['NODE_ENV'] === 'production' ? 'prod' : 'dev';

  const ownerType = params.ownerType ?? 'system';
  const clientName = params.clientName ?? source.component;
  const providerReportedUsd = params.providerReportedUsd ?? null;
  const useProviderCost = providerReportedUsd !== null;
  // Schema requires billedUsd >= 0; clamp defensively so a misbehaving provider can't 400 the receiver.
  const billedUsd = useProviderCost
    ? Math.max(0, providerReportedUsd)
    : params.usage.costUsd;
  const pricingSource = useProviderCost ? 'provider_reported' : 'calculated';

  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    owner: { type: ownerType, id: params.userId },
    source: {
      service: source.service,
      component: source.component,
      client: clientName,
      environment,
    },
    request: {
      provider: params.provider,
      model: params.model,
      operation: params.callType,
      success: params.success,
      durationMs: 0,
    },
    usage: {
      inputTokens: params.usage.inputTokens,
      outputTokens: params.usage.outputTokens,
      totalTokens: params.usage.totalTokens,
      cacheReadTokens: params.usage.cacheTokens ?? 0,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      reasoningTokens: params.usage.reasoningTokens ?? 0,
      thinkingTokens: params.usage.thinkingTokens ?? 0,
      webSearchCalls: params.usage.webSearchCalls ?? 0,
      groundingEnabled: params.usage.groundingEnabled ?? false,
      imageCount: 0,
    },
    cost: {
      billedUsd,
      providerReportedUsd,
      calculatedUsd: params.usage.costUsd,
      pricingSource,
    },
    correlation: {
      requestId: correlationOverrides?.requestId ?? null,
      traceId: null,
      taskId: correlationOverrides?.taskId ?? null,
      researchId: null,
      attempt: null,
      sessionId: correlationOverrides?.sessionId ?? null,
    },
    error: params.success ? null : { code: null, message: params.errorMessage ?? null },
  };
}
```

- [ ] **Step 4: Run buildUsageEvent tests to verify they pass**

```bash
pnpm --filter @intexuraos/llm-pricing test buildUsageEvent.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Run sibling sink tests to confirm no regression**

```bash
pnpm --filter @intexuraos/llm-pricing test
```

Expected: All PASS (httpInternalAuthUsageSink + httpWebhookUsageSink tests still green because they don't pass the new fields and defaults match prior behavior — `client = source.component`, not `client = model`).

If `httpInternalAuthUsageSink.test.ts` or `httpWebhookUsageSink.test.ts` asserts `client === <model>`, **update those tests to assert `client === <component>`** (this matches the new, correct semantic). Cite each test that changes.

- [ ] **Step 6: Run the receiver service tests to ensure aggregate doc-ID schema still validates**

```bash
pnpm --filter @intexuraos/llm-usage-service test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-pricing/src/buildUsageEvent.ts packages/llm-pricing/src/__tests__/
git commit -m "feat(llm-pricing): consume ownerType/clientName/providerReportedUsd in buildUsageEvent"
```

---

## Task 3: Make `pricingContext.getPricing` no-throw

**Files:**
- Modify: `packages/llm-pricing/src/pricingClient.ts`
- Test: `packages/llm-pricing/src/__tests__/pricingClient.test.ts`

- [ ] **Step 1: Add a failing test for the no-throw contract**

Append to `packages/llm-pricing/src/__tests__/pricingClient.test.ts` inside the existing PricingContext describe block:

```ts
  describe('getPricing no-throw on missing model', () => {
    it('returns zero pricing instead of throwing when the model is unknown', () => {
      const ctx = new PricingContext({
        google: { models: {}, updatedAt: '' },
        openai: { models: {}, updatedAt: '' },
        anthropic: { models: {}, updatedAt: '' },
        perplexity: { models: {}, updatedAt: '' },
        openrouter: { models: {}, updatedAt: '' },
      });

      const pricing = ctx.getPricing('or:some/unpriced-model' as LLMModel);

      expect(pricing).toEqual({ inputPricePerMillion: 0, outputPricePerMillion: 0 });
    });

    it('still returns the real pricing for a known model', () => {
      const ctx = new PricingContext({
        google: { models: {}, updatedAt: '' },
        openai: { models: {}, updatedAt: '' },
        anthropic: {
          models: {
            'claude-sonnet-4-5': { inputPricePerMillion: 3, outputPricePerMillion: 15 },
          },
          updatedAt: '',
        },
        perplexity: { models: {}, updatedAt: '' },
        openrouter: { models: {}, updatedAt: '' },
      });

      expect(ctx.getPricing('claude-sonnet-4-5' as LLMModel)).toEqual({
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
      });
    });
  });

  describe('validateModels still throws on missing — fail-fast preserved for startup', () => {
    it('validateModels throws when a required model is missing', () => {
      const ctx = new PricingContext({
        google: { models: {}, updatedAt: '' },
        openai: { models: {}, updatedAt: '' },
        anthropic: { models: {}, updatedAt: '' },
        perplexity: { models: {}, updatedAt: '' },
        openrouter: { models: {}, updatedAt: '' },
      });

      expect(() => ctx.validateModels(['claude-sonnet-4-5' as LLMModel])).toThrow(
        /Missing pricing/,
      );
    });
  });
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @intexuraos/llm-pricing test pricingClient.test.ts
```

Expected: FAIL — `getPricing` currently throws on unknown model.

- [ ] **Step 3: Implement the no-throw change**

In `packages/llm-pricing/src/pricingClient.ts`, replace the body of `getPricing`:

```ts
  /**
   * Get pricing for a model.
   *
   * Returns zero pricing for unknown models so producers can still emit a
   * usage event with cost=$0 instead of crashing. Use validateModels() at
   * startup if you need fail-fast for known-static dependencies.
   */
  getPricing(model: LLMModel): ModelPricing {
    const pricing = this.pricing.get(model);
    if (pricing === undefined) {
      // Audit trail: ops needs to know which models leak through unpriced.
      // Use console.warn (no Logger dep in PricingContext) — Cloud Logging picks it up as severity=WARNING.
      console.warn(`[llm-pricing] No pricing for model ${String(model)} — falling back to $0; emit-don't-skip policy`);
      return { inputPricePerMillion: 0, outputPricePerMillion: 0 };
    }
    return pricing;
  }
```

Update the JSDoc on `IPricingContext.getPricing` (line ~308) to match — remove "throws if not found" and replace with "returns zero pricing for unknown models, emits a warn for ops audit".

- [ ] **Step 4: Re-run the package tests**

```bash
pnpm --filter @intexuraos/llm-pricing test
```

Expected: New tests PASS. Existing tests assert no throw on known models — should still pass. If any pre-existing test asserts `expect(() => ctx.getPricing('unknown')).toThrow(...)`, **delete that assertion** (the contract changed). Cite each removed assertion.

- [ ] **Step 5: Run dependent packages' tests to catch any caller that relied on throw**

```bash
pnpm --filter @intexuraos/internal-clients test
pnpm --filter @intexuraos/llm-factory test
```

Expected: PASS. If a test in `internal-clients` was asserting `getLlmClient` throws on unknown model, change it to assert the LLM call now succeeds with cost=0. Cite the test.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-pricing/src/pricingClient.ts packages/llm-pricing/src/__tests__/pricingClient.test.ts
git commit -m "feat(llm-pricing): make getPricing no-throw; preserve fail-fast in validateModels"
```

---

## Task 4: Capture OpenRouter `usage.cost` in the API response

**Files:**
- Modify: `packages/infra-openrouter/src/client.ts`
- Test: `packages/infra-openrouter/src/__tests__/client.test.ts`

**Background:** Per OpenRouter docs (verified via context7 against `openrouter.ai`), `/chat/completions` always returns `usage.cost` (number, USD). The current code at line 156-160 hardcodes `undefined` and back-computes via static pricing. We will read `usage.cost`, populate `NormalizedUsage.costUsd` from it when present, and pass it through to `usageLogger.log` as `providerReportedUsd`.

- [ ] **Step 1: Read the current `extractUsage` and `trackUsage` functions**

Read `packages/infra-openrouter/src/client.ts:131-163`. Note the `OpenRouterUsage` interface lives in **`packages/infra-openrouter/src/types.ts:100-104`** (NOT in client.ts). It currently models `prompt_tokens`, `completion_tokens`, `total_tokens`. We need to add `cost?: number`. Also note that `extractUsage` is declared as a **closure inside `createOpenRouterClient`** that captures `pricing` from the outer scope — keep it as a closure, do not extract it to module scope.

- [ ] **Step 2: Add a failing test for cost passthrough**

In `packages/infra-openrouter/src/__tests__/client.test.ts`, add:

```ts
  describe('OpenRouter usage.cost passthrough', () => {
    it('uses usage.cost from API response and forwards it to the sink as providerReportedUsd', async () => {
      const fakeSink = { log: vi.fn().mockResolvedValue(undefined) };

      // Use nock or whatever the existing test infra uses to fake the OpenRouter response
      // (mirror an existing test in this file — copy its setup pattern).
      // The faked response body MUST include:
      //   usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0042 }

      const client = createOpenRouterClient({
        apiKey: 'test',
        model: 'xiaomi/mimo-v2-pro',
        userId: 'test-user',
        pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0, useProviderCost: true },
        logger: fakeLogger,
        usageSink: fakeSink,
      });

      const result = await client.generate('hello');
      expect(result.ok).toBe(true);

      expect(fakeSink.log).toHaveBeenCalledWith(
        expect.objectContaining({
          providerReportedUsd: 0.0042,
        }),
      );
    });

    it('omits providerReportedUsd when usage.cost absent and falls back to token-based costUsd', async () => {
      const fakeSink = { log: vi.fn().mockResolvedValue(undefined) };
      // Mirror the existing response-mocking idiom from this file's first test.
      // The faked response body MUST include:
      //   usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }   // NO cost field
      const client = createOpenRouterClient({
        apiKey: 'test',
        model: 'xiaomi/mimo-v2-pro',
        userId: 'test-user',
        pricing: { inputPricePerMillion: 1, outputPricePerMillion: 2 },
        logger: fakeLogger,
        usageSink: fakeSink,
      });
      await client.generate('hello');

      const callArg = fakeSink.log.mock.calls[0]?.[0] as Record<string, any>;
      expect(callArg.providerReportedUsd).toBeUndefined();
      // Sanity: token-based fallback still produces a non-zero cost when token prices > 0.
      expect(callArg.usage.costUsd).toBeGreaterThan(0);
    });

    it('forwards providerReportedUsd on the research callType too', async () => {
      const fakeSink = { log: vi.fn().mockResolvedValue(undefined) };
      // Faked response body for research: same shape with usage.cost = 0.011
      const client = createOpenRouterClient({
        apiKey: 'test',
        model: 'xiaomi/mimo-v2-pro',
        userId: 'test-user',
        pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0, useProviderCost: true },
        logger: fakeLogger,
        usageSink: fakeSink,
      });
      await client.research('hello');

      expect(fakeSink.log).toHaveBeenCalledWith(
        expect.objectContaining({ callType: 'research', providerReportedUsd: 0.011 }),
      );
    });
  });
```

(Adapt the response-mocking idiom to what's already in this file — read the first test in `client.test.ts` and mirror its `nock` or `vi.spyOn(global, 'fetch')` setup.)

- [ ] **Step 3: Run the test to verify failure**

```bash
pnpm --filter @intexuraos/infra-openrouter test
```

Expected: FAIL — `cost` not in the parsed `OpenRouterUsage`, not forwarded.

- [ ] **Step 4: Update the `OpenRouterUsage` type**

In `packages/infra-openrouter/src/types.ts:100-104`, add `cost`:

```ts
export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost?: number; // OpenRouter reports USD cost per request (always present per docs, optional for back-compat)
}
```

- [ ] **Step 5: Refactor `extractUsage` and `trackUsage` in `client.ts`**

In `packages/infra-openrouter/src/client.ts`, **keep `extractUsage` as a closure** inside `createOpenRouterClient` so it retains access to `pricing`. Change its return shape and update all call sites:

1. Replace `extractUsage` (current lines 150-163):

   ```ts
   function extractUsage(usage: OpenRouterUsage | undefined): {
     normalized: NormalizedUsage;
     providerReportedUsd: number | null;
   } {
     /* v8 ignore start -- upstream: cannot verify usage is present in all API responses @preserve */
     if (usage === undefined) {
       return {
         normalized: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
         providerReportedUsd: null,
       };
     }
     /* v8 ignore stop @preserve */
     const providerReportedUsd = typeof usage.cost === 'number' ? usage.cost : null;
     const normalized = normalizeUsage(
       usage.prompt_tokens,
       usage.completion_tokens,
       providerReportedUsd ?? undefined,
       pricing,
     );
     return { normalized, providerReportedUsd };
   }
   ```

2. Update `trackUsage` signature to accept the optional provider cost:

   ```ts
   function trackUsage(
     callType: CallType,
     usage: NormalizedUsage,
     success: boolean,
     errorMessage?: string,
     providerReportedUsd?: number | null,
   ): void {
     void usageLogger.log({
       userId,
       provider: LlmProviders.OpenRouter,
       model,
       callType,
       usage,
       success,
       ...(errorMessage !== undefined && { errorMessage }),
       ...(providerReportedUsd !== undefined && providerReportedUsd !== null && { providerReportedUsd }),
     });
   }
   ```

3. **Refactor every call site of `extractUsage`** — there are TWO success paths (research and generate) and FOUR error paths:

| Line                   | Path                  | Refactor                                                                                                                                                                                        |
| ---------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~218                   | `research` success    | `const { normalized, providerReportedUsd } = extractUsage(data.usage); trackUsage('research', normalized, true, undefined, providerReportedUsd);`                                               |
| ~316                   | `generate` success    | `const { normalized, providerReportedUsd } = extractUsage(data.usage); trackUsage('generate', normalized, true, undefined, providerReportedUsd);`                                               |
| ~210, ~249, ~298, ~327 | error paths (4 sites) | Leave the existing `emptyUsage` literal as-is and call `trackUsage(callType, emptyUsage, false, errorMsg)` — `providerReportedUsd` is omitted (defaults to undefined → omitted from sink call). |

   Read each call site before editing to confirm the surrounding variables.

4. Delete the obsolete comment at the old line 156 ("OpenRouter doesn't provide per-request cost in the response").

- [ ] **Step 6: Run the package tests**

```bash
pnpm --filter @intexuraos/infra-openrouter test
```

Expected: New tests PASS. Pre-existing tests still PASS (back-compat — when response has no `cost`, behavior matches today).

- [ ] **Step 7: Commit**

```bash
git add packages/infra-openrouter/src/client.ts packages/infra-openrouter/src/types.ts packages/infra-openrouter/src/__tests__/client.test.ts
git commit -m "feat(infra-openrouter): capture usage.cost from API response and forward as providerReportedUsd"
```

---

## Task 5: Plumb `ownerType` through `LlmClientConfig` and the OpenRouter generate client

**Files:**
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/src/openRouterGenerateClient.ts`
- Test: `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`
- Test: `packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts`

- [ ] **Step 1: Read `LlmClientConfig` and locate the call to underlying clients**

Read `packages/llm-factory/src/llmClientFactory.ts` and `packages/llm-factory/src/openRouterGenerateClient.ts`. Identify where `usageSink`/`usageLogger` is wired.

- [ ] **Step 2: Add a failing test asserting ownerType propagates to the underlying sink**

In `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`, add:

```ts
  describe('LlmClientConfig.ownerType propagation', () => {
    it('forwards ownerType to the usage sink when passed', async () => {
      const fakeSink = { log: vi.fn().mockResolvedValue(undefined) };
      const client = createLlmClient({
        apiKey: 'test',
        model: 'gpt-4o-mini',
        userId: 'user-123',
        pricing: { inputPricePerMillion: 1, outputPricePerMillion: 1 },
        logger: fakeLogger,
        usageSink: fakeSink,
        ownerType: 'user',
      });
      // Trigger the generate path — mock the underlying provider call to succeed cheaply.
      // (Mirror the existing test pattern in this file for HTTP mocking.)
      await client.generate('hello');

      expect(fakeSink.log).toHaveBeenCalledWith(
        expect.objectContaining({ ownerType: 'user' }),
      );
    });

    it('omits ownerType from the sink call when not configured (defaults to system downstream)', async () => {
      const fakeSink = { log: vi.fn().mockResolvedValue(undefined) };
      const client = createLlmClient({
        apiKey: 'test',
        model: 'gpt-4o-mini',
        userId: 'user-123',
        pricing: { inputPricePerMillion: 1, outputPricePerMillion: 1 },
        logger: fakeLogger,
        usageSink: fakeSink,
      });
      await client.generate('hello');

      const callArg = fakeSink.log.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg.ownerType).toBeUndefined();
    });
  });
```

Add a parallel test in `openRouterGenerateClient.test.ts`.

- [ ] **Step 3: Run the test to verify failure**

```bash
pnpm --filter @intexuraos/llm-factory test
```

Expected: TypeScript error — `ownerType` is not in `LlmClientConfig`.

- [ ] **Step 4: Add `ownerType` to `LlmClientConfig`**

In `packages/llm-factory/src/llmClientFactory.ts`, locate the `LlmClientConfig` interface and add:

```ts
export interface LlmClientConfig {
  // ...existing fields...
  /** Owner scope for emitted usage events. Defaults to undefined → 'system' downstream. */
  ownerType?: 'user' | 'system';
}
```

In every `createLlmClient` provider branch (Claude, Gemini, GPT, Perplexity, OpenRouter), find where the inner client is constructed and pass `ownerType` through into the `usageSink` payload. Concretely, each infra-* client's `trackUsage` helper needs to forward `ownerType`.

**Pattern (apply to each infra-* client called from llm-factory):**

In the infra client's `trackUsage` helper (e.g., `packages/infra-claude/src/client.ts`, similar pattern in others):

```ts
function trackUsage(
  callType: CallType,
  usage: NormalizedUsage,
  success: boolean,
  errorMessage?: string,
): void {
  void usageLogger.log({
    userId,
    provider: LlmProviders.Anthropic,
    model,
    callType,
    usage,
    success,
    ...(errorMessage !== undefined && { errorMessage }),
    ...(ownerType !== undefined && { ownerType }),
  });
}
```

Add `ownerType` to each infra client's `Config` interface (just pass-through). Read `ownerType` from `config` in the factory function. **Do this for all 5 infra-* clients (`infra-claude`, `infra-gemini`, `infra-gpt`, `infra-openrouter`, `infra-perplexity`)** so they all support the new field.

- [ ] **Step 5: Update `openRouterGenerateClient.ts` to forward `ownerType`**

In `packages/llm-factory/src/openRouterGenerateClient.ts`, the call to `createOpenRouterClient` (around line 12) — add `ownerType: config.ownerType` to the constructor argument.

- [ ] **Step 6: Run all dependent package tests**

```bash
pnpm --filter @intexuraos/llm-factory test
pnpm --filter @intexuraos/infra-openrouter test
pnpm --filter @intexuraos/infra-claude test
pnpm --filter @intexuraos/infra-gemini test
pnpm --filter @intexuraos/infra-gpt test
pnpm --filter @intexuraos/infra-perplexity test
```

Expected: All PASS (back-compat — when `ownerType` is not passed, behavior is unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/llm-factory packages/infra-claude packages/infra-gemini packages/infra-gpt packages/infra-openrouter packages/infra-perplexity
git commit -m "feat(llm-factory,infra-*): plumb ownerType through every LLM client construction"
```

---

## Task 6: User-context callers pass `ownerType: 'user'`

**Files:**
- Modify: `packages/internal-clients/src/user-service/client.ts`
- Test: `packages/internal-clients/src/user-service/__tests__/client.test.ts`

The `getLlmClient(userId)` function is called specifically when the system acts on behalf of a user. Every client created here MUST be tagged `ownerType: 'user'`.

- [ ] **Step 1: Add a failing test**

In `packages/internal-clients/src/user-service/__tests__/client.test.ts`, add:

```ts
  describe('getLlmClient sets ownerType to "user"', () => {
    it('passes ownerType: "user" into the underlying LlmClient config', async () => {
      // Spy on createLlmClient (or whatever it's wired through) to capture the config.
      const captured: any[] = [];
      vi.spyOn(llmFactoryModule, 'createLlmClient').mockImplementation((cfg: any) => {
        captured.push(cfg);
        return { generate: vi.fn().mockResolvedValue({ ok: true, value: { content: '' } }) } as any;
      });

      // Stub the user-service /settings + /llm-keys responses.
      // (Mirror the pattern used in the existing client.test.ts.)

      const client = createUserServiceClient({/* ... */});
      const result = await client.getLlmClient('user-123');
      expect(result.ok).toBe(true);

      expect(captured.at(-1)).toEqual(expect.objectContaining({ ownerType: 'user' }));
    });
  });
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @intexuraos/internal-clients test
```

Expected: FAIL — `ownerType` not in the captured config.

- [ ] **Step 3: Implement: pass `ownerType: 'user'` in every `createLlmClient` call inside `getLlmClient`**

In `packages/internal-clients/src/user-service/client.ts`, locate the three places `createLlmClient(...)` is invoked inside the `getLlmClient` async method (lines ~208, ~259, ~282). Add `ownerType: 'user'` to each `LlmClientConfig` literal.

Also update the inner `buildClientForModel` helper (line ~250-267) to pass `ownerType: 'user'`.

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter @intexuraos/internal-clients test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/internal-clients
git commit -m "feat(internal-clients): tag user-service getLlmClient calls with ownerType: 'user'"
```

---

## Task 7: Hash `source.client` in aggregate doc-ID (defense-in-depth)

**Files:**
- Modify: `apps/llm-usage-service/src/infra/firestore/aggregateKeyUtils.ts`
- Test: `apps/llm-usage-service/src/__tests__/infra/firestore/aggregateKeyUtils.test.ts`

After Task 2, `source.client` will no longer contain slashes from any IntexuraOS or orchestrator producer. This task adds a belt to the existing suspenders so any future producer that goes rogue can't crash the aggregate write.

- [ ] **Step 1: Update the existing test, then add new slash-safety cases**

The test file `apps/llm-usage-service/src/__tests__/infra/firestore/aggregateKeyUtils.test.ts` ALREADY EXISTS. At ~line 51 it asserts `expect(parts[5]).toBe('web')` (raw client). After hashing, `parts[5]` will be `sha256Truncated('web')`. Update that single assertion FIRST:

```ts
// Before (line ~51):
expect(parts[5]).toBe('web');
// After:
expect(parts[5]).toBe(sha256Truncated('web'));
```

Then APPEND the slash-safety cases (don't replace the file):

```ts
import { describe, expect, it } from 'vitest';
import { computeAggregateId } from '../../../infra/firestore/aggregateKeyUtils.js';
import type { UsageEvent } from '../../../domain/models/usageEvent.js';

const baseEvent: UsageEvent = {
  schemaVersion: 1,
  eventId: 'evt-1',
  occurredAt: '2026-04-13T20:00:00.000Z',
  receivedAt: '2026-04-13T20:00:00.001Z',
  ingress: 'orchestrator_webhook',
  owner: { type: 'system', id: 'sys-1' },
  source: { service: 'orchestrator', component: 'compliance', client: 'xiaomi/mimo-v2-pro', environment: 'dev' },
  request: { provider: 'openrouter', model: 'xiaomi/mimo-v2-pro', operation: 'generate', success: true, durationMs: 0 },
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cachedTokens: 0, reasoningTokens: 0, thinkingTokens: 0, webSearchCalls: 0, groundingEnabled: false, imageCount: 0 },
  cost: { billedUsd: 0, providerReportedUsd: null, calculatedUsd: 0, pricingSource: 'calculated' },
  correlation: { requestId: null, traceId: null, taskId: null, researchId: null, attempt: null, sessionId: null },
  error: null,
};

describe('computeAggregateId — slash safety', () => {
  it('produces an id with no "/" even when source.client contains slashes', () => {
    const id = computeAggregateId(baseEvent);
    expect(id).not.toMatch(/\//);
  });

  it('is deterministic for the same input', () => {
    expect(computeAggregateId(baseEvent)).toBe(computeAggregateId(baseEvent));
  });

  it('differs when source.client differs (hash distinguishes clients)', () => {
    const idA = computeAggregateId(baseEvent);
    const idB = computeAggregateId({
      ...baseEvent,
      source: { ...baseEvent.source, client: 'different-client' },
    });
    expect(idA).not.toBe(idB);
  });
});
```

- [ ] **Step 2: Run the test to verify the slash-safety case fails**

```bash
pnpm --filter @intexuraos/llm-usage-service test aggregateKeyUtils.test.ts
```

Expected: First test FAILS (id contains the raw `xiaomi/mimo-v2-pro`).

- [ ] **Step 3: Update `computeAggregateId` to hash `source.client`**

In `apps/llm-usage-service/src/infra/firestore/aggregateKeyUtils.ts`, replace the `computeAggregateId` body:

```ts
export function computeAggregateId(event: UsageEvent): string {
  const date = toDateString(event.occurredAt);
  const ownerIdHash = sha256Truncated(event.owner.id);
  const clientHash = sha256Truncated(event.source.client);
  const modelHash = sha256Truncated(event.request.model);
  const success = String(event.request.success);

  return [
    date,
    event.owner.type,
    ownerIdHash,
    event.source.service,
    event.source.component,
    clientHash,
    event.source.environment,
    event.request.provider,
    modelHash,
    event.request.operation,
    success,
  ].join('__');
}
```

Update the JSDoc on the function to reflect the new format string.

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter @intexuraos/llm-usage-service test aggregateKeyUtils.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Run the full app test suite**

```bash
pnpm --filter @intexuraos/llm-usage-service test
```

Expected: All PASS (other tests don't assert specific aggregate id strings; if any does, update it to the new format).

- [ ] **Step 6: Commit**

```bash
git add apps/llm-usage-service/src/infra/firestore/aggregateKeyUtils.ts apps/llm-usage-service/src/__tests__/infra/firestore/aggregateKeyUtils.test.ts
git commit -m "fix(llm-usage-service): hash source.client in aggregate doc-id for slash safety"
```

---

## Task 8: Wrap `db.collection().doc()` in try/catch in the aggregate repository

**Files:**
- Modify: `apps/llm-usage-service/src/infra/firestore/firestoreUsageAggregateRepository.ts`
- Test: `apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageAggregateRepository.test.ts`

Even after Task 7, `db.collection(C).doc(badId)` will throw synchronously if Firestore validates anything else. Move the doc reference construction inside the try block so any failure becomes a logged `err` Result instead of a 500.

- [ ] **Step 1: Add a failing test using the EXISTING mock pattern in this file**

Read the top of `apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageAggregateRepository.test.ts`. The file already uses `vi.mock('@intexuraos/infra-firestore', ...)` at the top with named mock functions like `mockDoc`, `mockCollection`. **Reuse those — do NOT introduce `vi.spyOn(firestoreModule, ...)` (mixing mock strategies on the same module is fragile).**

Add a test that reuses the existing mock infrastructure to make `mockDoc` throw synchronously on a single call:

```ts
  describe('incrementAggregate — does not throw on bad doc-id', () => {
    it('returns err Result instead of throwing when Firestore rejects the doc id', async () => {
      mockDoc.mockImplementationOnce(() => {
        throw new Error('Value for argument "documentPath" must point to a document');
      });

      const repo = new FirestoreUsageAggregateRepository();
      const result = await repo.incrementAggregate(makeFakeEvent());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/documentPath/);
      }
    });
  });
```

(Use the existing `makeFakeEvent` helper in this file, or copy its body if it doesn't exist as a helper. The point is to reuse the pre-existing mock plumbing rather than swap strategies.)

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @intexuraos/llm-usage-service test firestoreUsageAggregateRepository.test.ts
```

Expected: FAIL — the throw escapes (test expects `result.ok === false`, gets thrown error).

- [ ] **Step 3: Move the doc construction into the try block**

In `apps/llm-usage-service/src/infra/firestore/firestoreUsageAggregateRepository.ts`, refactor `incrementAggregate`:

```ts
  async incrementAggregate(event: UsageEvent): Promise<Result<void, { code: string; message: string }>> {
    const db = getFirestore();
    const aggregateId = computeAggregateId(event);
    const now = new Date().toISOString();

    try {
      const docRef = db.collection(COLLECTION).doc(aggregateId);
      const doc = await docRef.get();

      const counterFields = {
        // ... existing counter fields ...
      };

      if (doc.exists) {
        await docRef.update({
          ...counterFields,
          lastOccurredAt: event.occurredAt,
          updatedAt: now,
        });
      } else {
        await docRef.set({
          // ... existing set payload ...
        });
      }

      return ok(undefined);
    } catch (error: unknown) {
      const firestoreError = error as { code?: number; message?: string };
      return err({
        code: String(firestoreError.code ?? 'UNKNOWN'),
        message: firestoreError.message ?? 'Unknown Firestore error',
      });
    }
  }
```

The single-line move: `const docRef = db.collection(COLLECTION).doc(aggregateId);` was at line 15 (before try). Now it lives inside the try, BEFORE `await docRef.get()`.

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter @intexuraos/llm-usage-service test firestoreUsageAggregateRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/llm-usage-service/src/infra/firestore/firestoreUsageAggregateRepository.ts apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageAggregateRepository.test.ts
git commit -m "fix(llm-usage-service): widen try/catch to cover doc-ref construction in incrementAggregate"
```

---

## Task 9: End-to-end repo CI

**Files:** none

- [ ] **Step 1: Run the repo-wide CI from root**

```bash
cd /Users/p.buchman/personal/intexuraos-1
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-llm-fix.txt
```

Expected: PASS for every workspace touched. Coverage 100% branch.

- [ ] **Step 2: If CI fails — diagnose and fix per CLAUDE.md**

Per CLAUDE.md: any failure in any workspace is mine to fix. Read `/tmp/ci-output-llm-fix.txt`, find the failure, fix it, re-run.

- [ ] **Step 3: After CI passes, proceed to simplification (handled by the orchestrating session, not this plan).**

Per-task commits already exist. The simplify pass runs over the cumulative diff before the PR is opened.

---

## Endpoint Changes

Per CLAUDE.md "Plan Documentation: Plans with HTTP endpoints MUST include 'Endpoint Changes' section":

- **Modified:** none (no route signatures change)
- **Created:** none
- **Removed:** none
- **Unchanged routes, but wire-payload semantics shift (verified safe):**
  - `POST /internal/webhooks/usage-events` (orchestrator → llm-usage-service)
  - `POST /internal/usage/events` (apps/* via HttpInternalAuthUsageSink)

**Wire-payload semantic changes** (relative to today, all schema-compatible — verified against `apps/llm-usage-service/src/routes/schemas/usageEventSchema.ts:118-130`):
- `source.client` now carries the component label (e.g. `"agent-compliance-validator"`, `"title-gen"`) instead of the model id. Same string type, no slashes — schema accepts.
- `cost.providerReportedUsd` becomes a real number for OpenRouter calls (was always `null`). Schema already allows `number | null`.
- `cost.pricingSource` may now be `"provider_reported"` (was always `"calculated"`). Both values are in the existing enum `['provider_reported', 'calculated', 'mixed', 'external']`.
- `owner.type` may now be `"user"` for LLM calls executed on behalf of a real user (was always `"system"`). Schema already allows both via the existing enum.

**Behavioral side effects worth flagging to dashboards/ops:**
- Existing on-disk Firestore aggregates in `llm_usage_daily_aggregates` are keyed today by the model id at position 5 of the doc-id (e.g. `..__claude-sonnet-4-5__..`). After Task 7, position 5 becomes `sha256Truncated(source.client)`. New writes will land in NEW aggregate documents; historical aggregates stop accumulating. Effect: dashboards that group "by client" see a data discontinuity at deploy time. No data is lost — the underlying `llm_usage_events` collection is unaffected.
- This is acceptable because today's `sourceClient` field is semantically wrong (it equals the model id, redundant with `request.model`). The discontinuity restores correct semantics.

---

## Self-Review Checklist (run after writing the plan, before execution)

1. **Spec coverage:** Each of the 5 verified bugs in the Background table maps to at least one task: Bug 1 → Task 2 + Task 7 (defense), Bug 2 → Task 8, Bug 3 → Task 1+2+5+6, Bug 4 → Task 4, Bug 5 → Task 3. ✅
2. **No placeholders:** Every test step includes complete code. Step 4 of Task 4 says "mirror the test pattern" but explicitly tells the implementer where to look — acceptable for HTTP-mock idiom that varies by package. ✅
3. **Type consistency:** `ownerType: 'user' | 'system'`, `clientName: string`, `providerReportedUsd: number | null` consistent across Tasks 1, 2, 5, 6. ✅
4. **Backwards compat:** All new fields optional, defaults preserve current behavior — confirmed at every interface change. ✅
5. **Orchestrator untouched:** No `workers/orchestrator/*` files in the modify list. Side-effect on event shape via shared package is the *desired* behavior. ✅
