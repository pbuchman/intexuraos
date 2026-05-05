# Research Cost and LLM Usage Reporting Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make research pages and LLM usage reports use authoritative billed usage data, including prompt types and image-generation costs.

**Architecture:** `llm-usage-service` remains the billing authority. Shared LLM packages emit complete raw usage facts, `research-agent` correlates every research-related call and stores denormalized research totals from usage-service summaries, `image-service` forwards image metadata, and `web` only renders backend costs and grouping data.

**Tech Stack:** TypeScript strict mode, Fastify routes, Firestore, `@intexuraos/llm-pricing`, `@intexuraos/llm-contract`, Vite/React web app, `pnpm run verify:workspace:tracked`.

---

## Investigation Evidence

Production issue:
- Research ID: `fd6102dc-49e1-4527-a10f-bf654717b6e4`.
- User: `google-oauth2|113131655542389277022`.
- Production UI endpoint returned 200 from `GET /research/fd6102dc-49e1-4527-a10f-bf654717b6e4` at `2026-05-05T07:58:04Z`.

Firestore research document:
- `researches/fd6102dc-49e1-4527-a10f-bf654717b6e4.status = completed`.
- `totalInputTokens = 74183`.
- `totalOutputTokens = 16992`.
- `totalCostUsd = 0`.
- All four completed `llmResults[].costUsd = 0`.

Production research-agent logs:
- At `2026-05-05T07:56:01.241393Z`, immediately before final save, research-agent logged:
  `[4.3.5] Aggregate usage: inputTokens=74183, outputTokens=16992, costUsd=0.000000 (llm=0.000000, synth=0.000000, aux=0.000000, source=0.000000, add=0.000000)`.
- The same research had successful nonzero-token calls:
  `gemini-2.5-pro` 3,051 tokens, `gpt-5.4` 35,439 tokens, `or:minimax/minimax-m2.7` 17,462 tokens, `or:xiaomi/mimo-v2-pro` 17,204 tokens.

Production `llm_usage_events` in the same user/time window:
- 14 events scanned from `2026-05-05T07:52:00Z` to `2026-05-05T07:57:00Z`.
- Total billed cost: `$0.472707`.
- Research web-search rows billed:
  `xiaomi/mimo-v2-pro = 0.041410`, `gemini-2.5-pro = 0.069291`, `gpt-5.4 = 0.227935`, `minimax/m2.7 = 0.028381`.
- Synthesis billed: `research-synthesis = 0.058243`.
- Synthesis context inference billed: `research-synthesis-context-inference = 0.015596`.
- Image prompt generation billed: `image-thumbnail-prompt = 0.017825`.
- Image generation row had `model = gemini-2.5-flash-image`, `operation = image_generation`, `promptType = null`, `imageCount = 0`, `billedUsd = 0`.

Code evidence:
- `packages/infra-gemini/src/costCalculator.ts:9-14` returns `costUsd: 0`; the same zero pattern exists in other provider normalizers after server-side cost calculation was centralized.
- `apps/research-agent/src/domain/research/usecases/runSynthesis.ts:274-290` sums `llmResults[].costUsd`, `synthesisUsage.costUsd`, and auxiliary usage costs, so it persists zeros.
- `packages/llm-pricing/src/buildUsageEvent.ts:65-77` always emits `usage.imageCount: 0`.
- `packages/infra-gemini/src/client.ts:151-158` emits research usage with `promptType` undefined.
- `packages/infra-gemini/src/client.ts:215-222` emits image-generation usage with zero tokens, zero cost, no prompt type, and no image count.
- `apps/llm-usage-service/src/domain/models/usageQuery.ts:25-35` does not allow `request.promptType` group-by.
- `apps/llm-usage-service/src/infra/firestore/aggregateKeyUtils.ts:21-45` excludes prompt type from aggregate keys.
- Production pricing already contains `llm_pricing/google.models.gemini-2.5-flash-image.imagePricing['1024x1024'] = 0.03`; the billing failure is missing `imageCount`, not missing pricing.

## Root Cause

1. Provider clients stopped calculating costs locally and now return `NormalizedUsage.costUsd = 0`.
2. `research-agent` still treats client `usage.costUsd` as the source of truth for persisted research totals.
3. `llm-usage-service` correctly computes billed costs for token calls, but those costs are not read back by `research-agent`.
4. Research and image-generation calls do not consistently emit prompt types.
5. Image-generation events emit `imageCount = 0`, so existing image pricing cannot bill them.
6. Usage aggregates cannot group by prompt type because prompt type is not an aggregate dimension.
7. Existing production events for this research have `correlation.researchId = null`, so the fix must prevent future null correlation and include a diagnostic/backfill path for affected completed researches.

## Endpoint Changes

Modified:
- `POST /internal/usage/events`: keep shape backward compatible, but accept events with populated `request.promptType`, `correlation.researchId`, `usage.imageCount`, and optional image size when added by shared types.
- `POST /llm-usage/query`: add `request.promptType` to allowed `groupBy` values.
- `POST /internal/images/prompts/generate`: accept optional `correlation.researchId` and prompt-purpose metadata.
- `POST /internal/images/generate`: accept optional `correlation.researchId`, prompt-purpose metadata, and image size metadata.

Created:
- `GET /internal/usage/research/:researchId/summary?ownerId=<encoded-user-id>` in `llm-usage-service`.

Unchanged:
- Public `GET /research/:id` path stays the same; response fields become correct because persisted totals are corrected.
- Public LLM usage event list response shape stays the same.
- Browser cost display continues to use `cost.billedUsd`; the web app does not compute billing.

Removed:
- None.

## Shared Contracts

### Usage Event Facts

All agents must converge on this event fact contract:

```ts
interface UsageEventRequest {
  provider: LlmProvider;
  model: string;
  operation: 'research' | 'generate' | 'image_generation' | 'tool_calling' | 'other';
  success: boolean;
  durationMs: number;
  promptType?: string;
}

interface UsageEventUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  webSearchCalls: number;
  groundingEnabled: boolean;
  imageCount: number;
}

interface UsageEventCorrelation {
  requestId: string | null;
  traceId: string | null;
  taskId: string | null;
  researchId: string | null;
  attempt: number | null;
  sessionId: string | null;
}
```

Prompt type names:
- Input validation: `research-input-validation`.
- Input improvement: `research-input-improvement`.
- Research context inference: `research-context-inference`.
- Title generation: `research-title-generation`.
- Web research calls: `research-web-search`.
- Synthesis context inference: `research-synthesis-context-inference`.
- Synthesis: `research-synthesis`.
- Attribution repair: `research-attribution-repair`.
- Image thumbnail prompt: `image-thumbnail-prompt`.
- Image generation: `image-generation`.

### Research Usage Summary

`llm-usage-service` should expose this internal response:

```ts
interface ResearchUsageSummaryResponse {
  researchId: string;
  ownerId: string;
  totals: {
    billedUsd: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    imageCount: number;
  };
  events: {
    eventId: string;
    occurredAt: string;
    service: string;
    component: string;
    provider: string;
    model: string;
    operation: string;
    promptType: string | null;
    billedUsd: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    imageCount: number;
  }[];
  diagnostics: {
    correlatedEventCount: number;
    missingPromptTypeCount: number;
    missingResearchCorrelationCount: number;
    zeroBilledImageGenerationCount: number;
  };
}
```

`research-agent` must only persist `totalCostUsd` from `totals.billedUsd`, not from `NormalizedUsage.costUsd`.

## Parallel Subagent Responsibilities

These are direct child issues of INT-1590 and are intentionally independent. Implementation must dispatch one worker per boundary; workers must not edit files outside their boundary except for shared contracts explicitly listed here.

| Subissue | Boundary | Owns | Exposes | Parallel proof |
| --- | --- | --- | --- | --- |
| INT-1591 | Shared LLM packages | `NormalizedUsage` facts, usage sink payload, provider client research/image usage metadata | Complete usage event facts with promptType, correlation, imageCount | Does not need app routes or UI; tests fake usage sinks |
| INT-1592 | `llm-usage-service` | Billing, prompt-type aggregation, research summary endpoint, usage event storage/indexes | `ResearchUsageSummaryResponse`, `request.promptType` group-by | Can implement against shared contract types while app agents work |
| INT-1593 | `research-agent` | Research total persistence, research call prompt types/correlation, summary consumption, research backfill | Correct `totalCostUsd` and correlated research/image calls | Can fake usage-service summary in tests |
| INT-1594 | `image-service` | Image route metadata, prompt/image usage propagation, imageCount facts | Correlated prompt and image-generation events | Can fake usage sink and internal requests |
| INT-1595 | `web` | Prompt-type grouping UI and cost display | UI requests `groupBy: ['request.promptType']`, displays backend billed costs | Can mock API responses; no backend runtime needed |

## Task 1: Shared LLM Packages (INT-1591)

**Files:**
- Modify: `packages/llm-contract/src/types.ts`
- Modify: `packages/llm-pricing/src/usageLogger.ts`
- Modify: `packages/llm-pricing/src/buildUsageEvent.ts`
- Modify: `packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts`
- Modify: `packages/infra-gemini/src/client.ts`
- Modify: `packages/infra-gpt/src/client.ts`
- Modify: `packages/infra-openrouter/src/client.ts`
- Modify: `packages/infra-perplexity/src/client.ts`
- Modify: `packages/infra-claude/src/client.ts`
- Modify provider client tests under `packages/infra-*/src/__tests__/client.test.ts`

- [ ] **Step 1: Write failing usage event tests**

Add assertions to `packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts`:

```ts
expect(event['request']).toMatchObject({ promptType: 'image-generation' });
expect(event['usage']).toMatchObject({ imageCount: 1 });
expect(event['correlation']).toMatchObject({ researchId: 'research-123' });
```

Run:

```bash
pnpm --filter @intexuraos/llm-pricing test -- buildUsageEvent
```

Expected: FAIL because `imageCount` is hardcoded to `0` before implementation.

- [ ] **Step 2: Extend usage facts without reintroducing client billing**

Update `NormalizedUsage` with optional image facts and fix the stale cost comment:

```ts
export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Legacy compatibility field. Billing is computed by llm-usage-service. */
  costUsd: number;
  cacheTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  groundingEnabled?: boolean;
  thinkingTokens?: number;
  imageCount?: number;
}
```

Update `UsageLogParams` to preserve `imageCount` through the sink:

```ts
imageCount?: number;
```

- [ ] **Step 3: Emit imageCount from buildUsageEvent**

Change `packages/llm-pricing/src/buildUsageEvent.ts`:

```ts
imageCount: params.imageCount ?? params.usage.imageCount ?? 0,
```

Keep `providerReportedUsd` behavior unchanged so OpenRouter provider-reported costs remain authoritative.

- [ ] **Step 4: Make research prompt type explicit in provider clients**

Extend each provider research options type:

```ts
export interface ResearchOptions {
  promptType?: string;
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
}
```

Pass prompt type into `trackUsage`:

```ts
trackUsage('research', usage, true, Date.now() - start, undefined, options?.promptType ?? 'research-web-search', options?.correlation);
```

Apply the same fallback on failure events.

- [ ] **Step 5: Emit image generation prompt type and image count**

For Gemini and GPT `generateImage`, call:

```ts
trackUsage('image_generation', { ...usage, imageCount: 1 }, true, Date.now() - start, undefined, 'image-generation');
```

For failure paths, call:

```ts
trackUsage('image_generation', { ...emptyUsage, imageCount: 0 }, false, durationMs, errorMsg, 'image-generation');
```

- [ ] **Step 6: Verify shared package boundary**

Run:

```bash
pnpm --filter @intexuraos/llm-pricing test
pnpm --filter @intexuraos/infra-gemini test
pnpm --filter @intexuraos/infra-gpt test
pnpm --filter @intexuraos/infra-openrouter test
pnpm --filter @intexuraos/infra-perplexity test
pnpm --filter @intexuraos/infra-claude test
```

Expected: PASS.

## Task 2: LLM Usage Service (INT-1592)

**Files:**
- Modify: `apps/llm-usage-service/src/domain/models/usageQuery.ts`
- Modify: `apps/llm-usage-service/src/domain/models/dailyAggregate.ts`
- Modify: `apps/llm-usage-service/src/domain/usecases/queryUsage.ts`
- Modify: `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts`
- Create: `apps/llm-usage-service/src/domain/usecases/getResearchUsageSummary.ts`
- Modify: `apps/llm-usage-service/src/domain/repositories/usageEventRepository.ts`
- Modify: `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts`
- Modify: `apps/llm-usage-service/src/infra/firestore/firestoreUsageAggregateRepository.ts`
- Modify: `apps/llm-usage-service/src/infra/firestore/aggregateKeyUtils.ts`
- Modify: `apps/llm-usage-service/src/routes/internalUsageRoutes.ts`
- Modify tests under `apps/llm-usage-service/src/__tests__/`
- Create migration/index file in `migrations/`

- [ ] **Step 1: Write failing image billing test**

In `apps/llm-usage-service/src/__tests__/domain/usecases/ingestUsageEvents.test.ts`, add an event:

```ts
usage: {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  thinkingTokens: 0,
  webSearchCalls: 0,
  groundingEnabled: false,
  imageCount: 1,
},
request: {
  provider: 'google',
  model: 'gemini-2.5-flash-image',
  operation: 'image_generation',
  success: true,
  durationMs: 7000,
  promptType: 'image-generation',
},
```

Expected stored `cost.billedUsd` is `0.03` using existing Google pricing.

- [ ] **Step 2: Add prompt type aggregate dimension**

Add `request.promptType` to `ALLOWED_GROUP_BY` and aggregate storage:

```ts
export const MISSING_PROMPT_TYPE = '__missing__';
```

Store `promptType: event.request.promptType ?? MISSING_PROMPT_TYPE` in daily aggregates and include it in `GROUP_KEY_EXTRACTORS`.

- [ ] **Step 3: Update aggregate ID contract**

Include prompt type hash in `computeAggregateId(event)` after operation:

```ts
const promptTypeHash = sha256Truncated(event.request.promptType ?? MISSING_PROMPT_TYPE);
```

This prevents prompt types from being merged in old aggregate rows.

- [ ] **Step 4: Implement research usage summary use case**

Create `getResearchUsageSummary` that queries `llm_usage_events` by `correlation.researchId == researchId`, filters `owner.id == ownerId`, and returns `ResearchUsageSummaryResponse`.

If no correlated events are found, return zero totals plus diagnostics; do not guess billing inside this endpoint.

- [ ] **Step 5: Add internal route**

Add route:

```ts
app.get('/internal/usage/research/:researchId/summary', async (request, reply) => {
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
  const { researchId } = request.params as { researchId: string };
  const { ownerId } = request.query as { ownerId: string };
  const result = await getResearchUsageSummary(getServices(), { researchId, ownerId });
  return result.ok ? await reply.ok(result.value) : await reply.fail(result.error.code, result.error.message);
});
```

- [ ] **Step 6: Verify service boundary**

Run:

```bash
pnpm run verify:workspace:tracked -- llm-usage-service
```

Expected: PASS.

## Task 3: Research Agent (INT-1593)

**Files:**
- Modify: `apps/research-agent/src/services.ts`
- Modify: `apps/research-agent/src/domain/research/ports/llmProvider.ts`
- Modify: `apps/research-agent/src/domain/research/usecases/processResearch.ts`
- Modify: `apps/research-agent/src/domain/research/usecases/runSynthesis.ts`
- Modify: `apps/research-agent/src/routes/internalRoutes.ts`
- Modify: `apps/research-agent/src/infra/llm/GeminiAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/GptAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/PerplexityAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/ClaudeAdapter.ts`
- Modify: `apps/research-agent/src/infra/image/imageServiceClient.ts`
- Create or modify an internal usage-service client under `packages/internal-clients/src/usage-service/`
- Modify research-agent tests under `apps/research-agent/src/__tests__/`
- Create a research-owned migration/backfill under `migrations/`

- [ ] **Step 1: Write failing final-total test**

Add a `runSynthesis` test where every `usage.costUsd` returned by providers is `0`, but a fake usage summary returns:

```ts
totals: {
  billedUsd: 0.472707,
  inputTokens: 74183,
  outputTokens: 16992,
  totalTokens: 91175,
  imageCount: 1,
}
```

Expected final update:

```ts
expect(finalUpdate?.[1].totalCostUsd).toBeCloseTo(0.472707, 6);
```

- [ ] **Step 2: Add usage summary dependency**

Add a port to `runSynthesis` deps:

```ts
usageSummaryClient?: {
  getResearchSummary(input: { researchId: string; ownerId: string }): Promise<Result<ResearchUsageSummaryResponse, UsageServiceError>>;
};
```

Use it after cover image generation and before final research save so image prompt/image generation events can be included.

- [ ] **Step 3: Stop writing zero as authoritative cost**

Replace `totalCostUsd` assignment with:

```ts
const authoritativeCostUsd = summaryResult.ok
  ? summaryResult.value.totals.billedUsd
  : existingComputedCostUsd;
```

If `summaryResult` fails and `existingComputedCostUsd === 0`, log an error with `researchId` and do not overwrite an existing nonzero `research.totalCostUsd`.

- [ ] **Step 4: Pass prompt type and correlation on every research call**

Extend `ResearchProviderCallOptions` first:

```ts
export interface ResearchProviderCallOptions {
  researchId?: string;
  promptType?: string;
}
```

Use this shape for web research calls:

```ts
await llmProvider.research(event.prompt, research.researchContext, {
  researchId: event.researchId,
  promptType: 'research-web-search',
});
```

Update every `apps/research-agent/src/infra/llm/*Adapter.ts` implementation of `research()` to forward both values into the provider client:

```ts
const callResearchId = options?.researchId ?? this.researchId;
const researchOptions = {
  promptType: options?.promptType ?? 'research-web-search',
  ...(callResearchId !== undefined ? { correlation: { researchId: callResearchId } } : {}),
};
```

Adapter tests must assert `research()` forwards `promptType` and `correlation.researchId` to the provider client for Gemini, GPT, OpenRouter, Perplexity, and Claude adapters. Do the same for validation/title/context/synthesis/repair paths through their existing generate options.

- [ ] **Step 5: Correlate cover image requests**

Extend the image-service client so prompt generation and image generation each carry their own metadata:

```ts
correlation: { researchId },
```

`generatePrompt()` must send `promptType: 'image-thumbnail-prompt'`; `generateImage()` must send `promptType: 'image-generation'`. Do not add `imagePromptType` to the cross-service contract.

Keep old callers compatible by making the new fields optional.

- [ ] **Step 6: Add one-time backfill/reconciliation**

Create a migration that scans completed `researches` with `totalCostUsd === 0`, loads usage-service summary where correlation exists, and updates `totalCostUsd` only when `summary.totals.billedUsd > 0`.

For the known research whose historical events have null `correlation.researchId`, write a migration note and optional manual repair path based on exact owner/time/model evidence from this plan. Do not infer costs for arbitrary records without correlation.

- [ ] **Step 7: Verify service boundary**

Run:

```bash
pnpm run verify:workspace:tracked -- research-agent
```

Expected: PASS.

## Task 4: Image Service (INT-1594)

**Files:**
- Modify: `apps/image-service/src/routes/schemas/imageSchemas.ts`
- Modify: `apps/image-service/src/routes/schemas/promptSchemas.ts`
- Modify: `apps/image-service/src/routes/internalRoutes.ts`
- Modify: `apps/image-service/src/application/generateImage.ts`
- Modify: `apps/image-service/src/application/generatePrompt.ts`
- Modify: `apps/image-service/src/domain/ports/imageGenerator.ts`
- Modify: `apps/image-service/src/infra/image/GoogleImageGenerator.ts`
- Modify: `apps/image-service/src/infra/image/OpenAIImageGenerator.ts`
- Modify image-service tests under `apps/image-service/src/__tests__/`

- [ ] **Step 1: Write failing route metadata tests**

Add tests for request bodies:

```json
{
  "text": "research summary",
  "model": "gemini-2.5-pro",
  "userId": "user-1",
  "correlation": { "researchId": "research-123" },
  "promptType": "image-thumbnail-prompt"
}
```

```json
{
  "prompt": "cover image prompt",
  "model": "gemini-2.5-flash-image",
  "userId": "user-1",
  "title": "Research title",
  "correlation": { "researchId": "research-123" },
  "promptType": "image-generation"
}
```

Expected: both routes accept the body and forward `correlation` and their own `promptType`. With `additionalProperties: false`, neither schema should accept an `imagePromptType` field.

- [ ] **Step 2: Extend use case inputs**

Add optional fields:

```ts
correlation?: { researchId?: string | null };
promptType?: string;
```

Default prompt types:
- prompt generation route: `image-thumbnail-prompt`.
- image generation route: `image-generation`.

- [ ] **Step 3: Forward metadata into image generators**

Extend `ImageGenerator.generate` options:

```ts
export interface GenerateOptions {
  slug?: string;
  promptType?: string;
  correlation?: { researchId?: string | null };
}
```

Pass those options to Gemini/OpenAI `generateImage`.

- [ ] **Step 4: Verify image usage facts**

Tests must assert successful image generation logs:

```ts
expect(usageLog).toMatchObject({
  callType: 'image_generation',
  promptType: 'image-generation',
  imageCount: 1,
  correlation: { researchId: 'research-123' },
});
```

- [ ] **Step 5: Verify service boundary**

Run:

```bash
pnpm run verify:workspace:tracked -- image-service
```

Expected: PASS.

## Task 5: Web App (INT-1595)

**Files:**
- Modify: `apps/web/src/components/llm-usage/filterConstants.ts`
- Modify: `apps/web/src/pages/LlmUsagePage.tsx`
- Modify: `apps/web/src/types/llmUsage.ts`
- Modify tests under `apps/web/src/components/llm-usage/__tests__/`
- Modify tests under `apps/web/src/pages/research/__tests__/` if existing fixtures hide nonzero costs

- [ ] **Step 1: Write failing prompt-type grouping test**

Assert that selecting prompt type group-by sends:

```ts
groupBy: ['request.promptType']
```

Expected: FAIL until `GroupByMode` and `GROUP_BY_MAP` include `promptType`.

- [ ] **Step 2: Restore prompt type group-by option**

Add:

```ts
export type GroupByMode = 'none' | 'day' | 'component' | 'service' | 'model' | 'openrouter-model' | 'promptType';

export const GROUP_BY_MAP: Record<GroupByMode, string[]> = {
  promptType: ['request.promptType'],
  // existing values unchanged
};
```

Add option label:

```ts
{ key: 'promptType', label: 'Prompt Type' }
```

- [ ] **Step 3: Display missing prompt type consistently**

In `getGroupLabel`, map `__missing__`, `''`, and absent values to `Missing`.

- [ ] **Step 4: Assert image-generation cost display**

Add a raw event fixture:

```ts
cost: { billedUsd: 0.03, providerReportedUsd: null, calculatedUsd: 0.03, pricingSource: 'calculated' },
usage: { imageCount: 1, totalTokens: 0, ... }
```

Expected row cost: `$0.03`.

- [ ] **Step 5: Verify web boundary**

Run:

```bash
pnpm run verify:workspace:tracked -- web
```

Expected: PASS.

## Full Verification

After all subtasks are merged into the implementation branch:

```bash
pnpm run verify:workspace:tracked -- llm-usage-service
pnpm run verify:workspace:tracked -- research-agent
pnpm run verify:workspace:tracked -- image-service
pnpm run verify:workspace:tracked -- web
pnpm run ci:tracked
```

Expected: all commands pass.

Production verification after deploy:
- Run a new research with at least two research providers, synthesis, and cover image generation.
- Confirm `researches/<newId>.totalCostUsd > 0`.
- Confirm each new `llm_usage_events` row for the run has `correlation.researchId = <newId>` except non-research code-agent events.
- Confirm research web-search rows show `promptType = research-web-search`.
- Confirm image-generation row has `promptType = image-generation`, `imageCount = 1`, and `billedUsd = 0.03` for Gemini 1024x1024.
- Confirm LLM usage aggregate grouped by prompt type includes research, synthesis, image prompt, and image generation rows.
