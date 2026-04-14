# Centralize LLM Pricing in llm-usage-service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `llm-usage-service` the single source of truth for LLM pricing. Remove `pricing: ModelPricing` from `createLlmClient()` and all call sites; move cost calculation to `llm-usage-service` on ingestion; keep OpenRouter provider-reported costs as pass-through.

**Architecture:** Clients emit usage events with raw token counts (no local cost calculation). `llm-usage-service` computes `billedUsd` on ingestion using its Firestore pricing table. OpenRouter events carry `providerReportedUsd` which is trusted as-is. The `IPricingContext` / `PricingContext` boot-time fetch pattern is deleted from all consumer services.

**Tech Stack:** TypeScript, Fastify, Firestore, Zod, Vitest

**Linear Issue:** [INT-1377](https://linear.app/pbuchman/issue/INT-1377)

---

## 1. Pricing-Location Audit

### 1.1 Type Definitions

| File                                   | Lines   | What it defines                               | Migration action                                                              |
| -------------------------------------- | ------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/llm-contract/src/pricing.ts` | 36-67   | `ModelPricing` interface (core pricing shape) | **Keep** — still needed by `llm-usage-service` and `infra-*` cost calculators |
| `packages/llm-contract/src/pricing.ts` | 75-92   | `ProviderPricing` interface                   | **Keep** — used by `llm-usage-service` storage and API                        |
| `packages/llm-contract/src/pricing.ts` | 100-118 | `CostCalculator` interface                    | **Move** — relocate into `llm-usage-service` (only consumer post-migration)   |
| `packages/llm-pricing/src/types.ts`    | 9-20    | `LlmPricing` interface                        | **Keep** — read-only view for web UI                                          |

### 1.2 Pricing Data Sources

| File                                                                       | Lines   | What it holds                                                                | Migration action                                                                                                              |
| -------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/llm-usage-service/src/infra/firestore/firestorePricingRepository.ts` | 1-59    | Firestore `llm_pricing` collection (one doc per provider)                    | **Keep** — canonical source of truth                                                                                          |
| `packages/infra-openrouter/src/defaultAllowlist.ts`                        | 30-59   | `DEFAULT_OPENROUTER_ALLOWED_MODELS` with embedded per-token prices           | **Partial removal** — keep model list for allowlist logic; remove `getDefaultAllowlistPricing()` from pricing-resolution path |
| `packages/infra-gemini/src/toolCallingClient.ts`                           | 37-43   | `TOOL_CALLING_PRICING` hardcoded (Gemini 2.5 Flash: in=$0.30/M, out=$2.50/M) | **Delete** — pricing comes from `llm-usage-service` at ingestion time                                                         |
| `workers/orchestrator/src/services/validation-model-clients.ts`            | 19-23   | `GEMINI_VALIDATION_PRICING` hardcoded (same values as TOOL_CALLING_PRICING)  | **Delete** — pricing comes from `llm-usage-service` at ingestion time                                                         |
| `packages/llm-contract/src/__tests__/fixtures/pricing.ts`                  | various | `TEST_GOOGLE_PRICING`, `TEST_OPENAI_PRICING`, `TEST_ANTHROPIC_PRICING`       | **Keep** — test fixtures, but may need updates to match new flow                                                              |

### 1.3 Pricing Resolution / Distribution

| File                                                   | Lines   | What it does                                                                     | Migration action                                                                      |
| ------------------------------------------------------ | ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/llm-pricing/src/pricingClient.ts`            | 129-174 | `fetchAllPricing()` — HTTP client to `GET /internal/pricing`                     | **Delete** — consumer apps no longer fetch pricing at boot                            |
| `packages/llm-pricing/src/pricingClient.ts`            | 257-298 | `fetchAllPricingWithRetry()` — retry wrapper                                     | **Delete**                                                                            |
| `packages/llm-pricing/src/pricingClient.ts`            | 307-422 | `IPricingContext` interface + `PricingContext` class — O(1) model→pricing lookup | **Delete** — no longer needed by clients                                              |
| `packages/llm-pricing/src/pricingClient.ts`            | 458-465 | `createPricingContext()` factory                                                 | **Delete**                                                                            |
| `packages/internal-clients/src/user-service/client.ts` | 234-248 | `resolvePricing()` — branches OpenRouter vs static model pricing                 | **Delete**                                                                            |
| `packages/infra-openrouter/src/defaultAllowlist.ts`    | 72-76   | `getDefaultAllowlistPricing()` — used by `resolvePricing()` and orchestrator     | **Delete** from pricing path (keep function for allowlist membership check if needed) |

### 1.4 Pricing Consumers (LLM Client Creation)

| File                                                            | Lines   | How it uses pricing                                                            | Migration action                                      |
| --------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `packages/llm-factory/src/llmClientFactory.ts`                  | 54-73   | `LlmClientConfig.pricing: ModelPricing` — **required** field                   | **Remove** `pricing` field from config                |
| `packages/infra-gemini/src/toolCallingClient.ts`                | 49-57   | `ToolCallingClientConfig.pricing: ModelPricing`                                | **Remove** `pricing` field                            |
| `apps/chat-agent/src/services.ts`                               | 113-150 | Fetches pricing at boot, creates `PricingContext`, passes to `createLlmClient` | **Remove** pricing fetch and context                  |
| `apps/code-agent/src/services.ts`                               | 96      | Uses `TOOL_CALLING_PRICING` constant                                           | **Remove** — no local pricing needed                  |
| `apps/code-agent/src/services.ts`                               | 363-369 | Stub `pricingContext` that throws                                              | **Delete** entirely                                   |
| `apps/research-agent/src/services.ts`                           | 84      | `pricingContext: IPricingContext` in ServiceContainer                          | **Remove** from container                             |
| `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`        | 31-114  | All adapters accept `pricing: ModelPricing` param                              | **Remove** `pricing` param from all factory functions |
| `workers/orchestrator/src/services/validation-model-clients.ts` | 95-156  | Uses `getDefaultAllowlistPricing()` + `GEMINI_VALIDATION_PRICING`              | **Remove** pricing from `createLlmClient` calls       |

### 1.5 Cost Calculation (infra-* packages)

| File                                              | What it does                                        | Migration action                                                                                                                                 |
| ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/infra-gemini/src/costCalculator.ts`     | `calculateTextCost()`, `calculateImageCost()`       | **Move to llm-usage-service** — only llm-usage-service needs cost calc                                                                           |
| `packages/infra-claude/src/costCalculator.ts`     | Same pattern                                        | **Move to llm-usage-service**                                                                                                                    |
| `packages/infra-gpt/src/costCalculator.ts`        | Same pattern                                        | **Move to llm-usage-service**                                                                                                                    |
| `packages/infra-perplexity/src/costCalculator.ts` | Same pattern                                        | **Move to llm-usage-service**                                                                                                                    |
| `packages/infra-openrouter/src/costCalculator.ts` | `toModelPricing()`, provider-reported cost handling | **Partial keep** — OpenRouter client still needs `toModelPricing()` for the `useProviderCost` logic; cost calculation moves to llm-usage-service |

### 1.6 Usage Event Building

| File                                          | Lines   | What it does                                                                      | Migration action                                                                                                                        |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/llm-pricing/src/buildUsageEvent.ts` | 31-93   | Constructs `UsageEventPayload` with `billedUsd`, `calculatedUsd`, `pricingSource` | **Update** — `cost.calculatedUsd` becomes `null` (or absent) for non-OpenRouter; `cost.billedUsd` set by llm-usage-service on ingestion |
| `packages/llm-pricing/src/usageLogger.ts`     | various | `UsageLogger` class — calls cost calculator, then builds event                    | **Update** — remove cost calculation step; emit raw tokens only                                                                         |

---

## 2. Usage-Event Schema (Post-Migration)

### 2.1 Event Shape

The usage event emitted by clients **after migration**. Key change: `cost.billedUsd` and `cost.calculatedUsd` become `0` for non-OpenRouter providers. `llm-usage-service` enriches cost fields on ingestion.

```typescript
// Client-emitted event (what leaves the producer)
interface UsageEventPayload {
  schemaVersion: 2; // bumped from 1 to signal the new contract
  eventId: string;
  occurredAt: string; // ISO timestamp

  owner: {
    type: 'user' | 'system';
    id: string;
  };

  source: {
    service: string;
    component: string;
    client: string;
    environment: 'dev' | 'prod' | 'test';
    workerLocation?: string;
  };

  request: {
    provider: LlmProvider; // 'google' | 'openai' | 'anthropic' | 'perplexity' | 'openrouter'
    model: string;
    operation: 'research' | 'generate' | 'image_generation' | 'tool_calling' | 'other';
    success: boolean;
    durationMs: number;
  };

  usage: {
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
  };

  cost: {
    // For OpenRouter: providerReportedUsd from API response
    // For all others: null (llm-usage-service computes on ingestion)
    providerReportedUsd: number | null;
    // pricingSource: 'provider_reported' when providerReportedUsd is set,
    //                'pending' when llm-usage-service should compute
    pricingSource: 'provider_reported' | 'pending';
  };

  correlation: {
    requestId: string | null;
    traceId: string | null;
    taskId: string | null;
    researchId: string | null;
    attempt: number | null;
    sessionId: string | null;
  };

  error: {
    code: string | null;
    message: string | null;
  } | null;
}
```

### 2.2 Stored Event Shape (after llm-usage-service ingestion)

```typescript
// What llm-usage-service writes to Firestore
interface UsageEvent {
  // ...all fields from UsageEventPayload...
  receivedAt: string;
  ingress: 'internal' | 'orchestrator_webhook';

  cost: {
    billedUsd: number; // computed by llm-usage-service (or from providerReportedUsd)
    providerReportedUsd: number | null;
    calculatedUsd: number | null; // llm-usage-service's calculation
    pricingSource: 'provider_reported' | 'calculated';
  };
}
```

### 2.3 Zod Schema (client-emitted)

```typescript
import { z } from 'zod';

const LlmProviderSchema = z.enum(['google', 'openai', 'anthropic', 'perplexity', 'openrouter']);

const UsageEventInputSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),

  owner: z.object({
    type: z.enum(['user', 'system']),
    id: z.string().min(1),
  }),

  source: z.object({
    service: z.string().min(1),
    component: z.string().min(1),
    client: z.string().min(1),
    environment: z.enum(['dev', 'prod', 'test']),
    workerLocation: z.string().optional(),
  }),

  request: z.object({
    provider: LlmProviderSchema,
    model: z.string().min(1),
    operation: z.enum(['research', 'generate', 'image_generation', 'tool_calling', 'other']),
    success: z.boolean(),
    durationMs: z.number().int().min(0),
  }),

  usage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
    cacheReadTokens: z.number().int().min(0),
    cacheWriteTokens: z.number().int().min(0),
    cachedTokens: z.number().int().min(0),
    reasoningTokens: z.number().int().min(0),
    thinkingTokens: z.number().int().min(0),
    webSearchCalls: z.number().int().min(0),
    groundingEnabled: z.boolean(),
    imageCount: z.number().int().min(0),
  }),

  cost: z.object({
    providerReportedUsd: z.number().min(0).nullable(),
    pricingSource: z.enum(['provider_reported', 'pending']),
  }),

  correlation: z.object({
    requestId: z.string().nullable(),
    traceId: z.string().nullable(),
    taskId: z.string().nullable(),
    researchId: z.string().nullable(),
    attempt: z.number().int().nullable(),
    sessionId: z.string().nullable(),
  }),

  error: z.object({
    code: z.string().nullable(),
    message: z.string().nullable(),
  }).nullable(),
});
```

### 2.4 Backward Compatibility: Dual-Schema Acceptance

During rollout, `llm-usage-service` MUST accept both `schemaVersion: 1` (existing events with `billedUsd`/`calculatedUsd`) and `schemaVersion: 2` (new events without local cost). This prevents ordering issues during deployment: if llm-usage-service deploys first, old producers still send v1 events. If a producer deploys first, llm-usage-service already accepts v2.

Strategy: Use `z.discriminatedUnion('schemaVersion', [v1Schema, v2Schema])` at the ingestion route.

---

## 3. Call-Site Inventory

### 3.1 `createLlmClient()` Call Sites

| #   | File                                                            | Line   | Pricing source                                                        | Can emit without local pricing? |
| --- | --------------------------------------------------------------- | ------ | --------------------------------------------------------------------- | ------------------------------- |
| 1   | `packages/internal-clients/src/user-service/client.ts`          | 208    | `config.pricingContext.getPricing(Gemini25Flash)` (platform fallback) | **Yes** — remove pricing param  |
| 2   | `packages/internal-clients/src/user-service/client.ts`          | 260    | `resolvePricing(model)` via `buildClientForModel()`                   | **Yes** — remove pricing param  |
| 3   | `packages/internal-clients/src/user-service/client.ts`          | 285    | `resolvePricing(defaultModel)` (main client creation)                 | **Yes** — remove pricing param  |
| 4   | `apps/chat-agent/src/services.ts`                               | 144    | `pricingContext.getPricing(Gemini25Flash)`                            | **Yes** — remove pricing param  |
| 5   | `workers/orchestrator/src/services/validation-model-clients.ts` | 110    | `getDefaultAllowlistPricing(rawId) ?? ZERO_PRICING` (OpenRouter)      | **Yes** — remove pricing param  |
| 6   | `workers/orchestrator/src/services/validation-model-clients.ts` | 138    | `GEMINI_VALIDATION_PRICING` (Gemini)                                  | **Yes** — remove pricing param  |

### 3.2 `createToolCallingClient()` Call Sites

| #   | File                              | Line   | Pricing source                                               | Can emit without local pricing? |
| --- | --------------------------------- | ------ | ------------------------------------------------------------ | ------------------------------- |
| 1   | `apps/code-agent/src/services.ts` | 434    | `GEMINI_TOOL_CALLING_PRICING` (imported from `infra-gemini`) | **Yes** — remove pricing param  |

### 3.3 Research Agent Adapters (indirect `createLlmClient` via adapters)

| #   | File                                                     | Function                   | Pricing source                                                       |
| --- | -------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| 1   | `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts` | `createResearchProvider()` | `pricing: ModelPricing` param from `ServiceContainer.pricingContext` |
| 2   | Same file                                                | `createSynthesizer()`      | Same                                                                 |
| 3   | Same file                                                | `createTitleGenerator()`   | Same                                                                 |
| 4   | Same file                                                | `createContextInferrer()`  | Same                                                                 |
| 5   | Same file                                                | `createInputValidator()`   | Same                                                                 |

All 5 pass `pricing` into individual adapter constructors (GeminiAdapter, ClaudeAdapter, GptAdapter, PerplexityAdapter, OpenRouterAdapter). Each adapter then passes it to the underlying `infra-*` client.

**Verdict:** All call sites can emit usage events without local pricing. The `pricing` parameter is only used for cost calculation, which moves to `llm-usage-service`.

---

## 4. llm-usage-service Pricing Model

### 4.1 Current State

- **Storage:** Firestore `llm_pricing` collection, one document per provider (5 docs: google, openai, anthropic, perplexity, openrouter).
- **Write path:** `POST /internal/pricing` (X-Internal-Auth) — used by the `/llm-manager` skill to update prices.
- **Read path:** `GET /internal/pricing` (X-Internal-Auth) — fetched by consumer apps at boot.
- **Public read:** `GET /llm-usage/pricing` (Auth0 bearer) — used by web UI.

### 4.2 Post-Migration Design

**Storage:** No change — same Firestore `llm_pricing` collection, same document structure. Already sufficient.

**Cost computation on ingestion:**
- `ingestUsageEvents()` gains a new dependency: `pricingRepository: PricingRepository`.
- For each `schemaVersion: 2` event:
  1. If `cost.pricingSource === 'provider_reported'` and `cost.providerReportedUsd !== null`: set `billedUsd = providerReportedUsd`, `calculatedUsd = null`, `pricingSource = 'provider_reported'`.
  2. Otherwise: look up `(request.provider, request.model)` in pricing table → compute cost using the appropriate `CostCalculator` → set `billedUsd = calculatedUsd`, `pricingSource = 'calculated'`.
- For `schemaVersion: 1` events: process as-is (backward compat).

**Unknown model handling:**
- If pricing is not found for `(provider, model)`: log a warning, set `billedUsd = 0`, `calculatedUsd = 0`, `pricingSource = 'calculated'`. Do NOT reject the event — emit-don't-skip policy.
- This matches the existing `PricingContext.getPricing()` behavior which falls back to `{inputPricePerMillion: 0, outputPricePerMillion: 0}` for unknown models.

**OpenRouter pass-through:** When `providerReportedUsd` is set, trust it. No lookup. This matches OpenRouter's billing model where cost is determined by the upstream provider and returned in the API response.

**Pricing versioning:** Pricing changes are already timestamped via `ProviderPricing.updatedAt`. Usage events are costed with the pricing that was current at ingestion time. No retroactive re-pricing is needed for this design.

**Caching:** On each ingestion batch, load pricing from Firestore. Cache in memory with a TTL (e.g., 5 minutes) to avoid per-event Firestore reads. The pricing data is small (~5 docs) and changes infrequently.

### 4.3 Cost Calculator Consolidation

Move cost calculator functions into `llm-usage-service`:

```
apps/llm-usage-service/src/domain/services/costCalculation.ts
```

This file consolidates logic from:
- `packages/infra-gemini/src/costCalculator.ts`
- `packages/infra-claude/src/costCalculator.ts`
- `packages/infra-gpt/src/costCalculator.ts`
- `packages/infra-perplexity/src/costCalculator.ts`
- `packages/infra-openrouter/src/costCalculator.ts`

Into a single `calculateCost(provider, usage, pricing)` function that dispatches by provider.

---

## 5. Fallback Redesign

### 5.1 Current Fallback Chain (user-service client)

```
user requests model → resolvePricing(model) → createLlmClient({pricing}) →
  on failure → buildClientForModel(fallbackModel) → resolvePricing(fallbackModel) → createLlmClient({pricing})
```

**Problem:** `resolvePricing()` calls `config.pricingContext.getPricing()` which throws in code-agent. When the primary OpenRouter model is rate-limited and the fallback is `gpt-4o-mini`, the `getPricing()` call for `gpt-4o-mini` throws, crashing the fallback chain.

### 5.2 Post-Migration Fallback Chain

```
user requests model → createLlmClient({model}) →
  on failure → buildClientForModel(fallbackModel) → createLlmClient({fallbackModel})
```

**Fix:** `createLlmClient` no longer requires `pricing`. The entire `resolvePricing()` function is deleted. `pricingContext` is removed from the client config. No pricing resolution happens at client-creation time.

### 5.3 Provider Combination Matrix

| Primary                 | Fallback                                | Current behavior                    | Post-migration   |
| ----------------------- | --------------------------------------- | ----------------------------------- | ---------------- |
| OpenRouter → Gemini     | `resolvePricing()` throws in code-agent | Works — no pricing needed           |
| Gemini → OpenRouter     | Works (allowlist pricing)               | Works — no pricing needed           |
| Gemini → Anthropic      | Works (if pricingContext has pricing)   | Works — no pricing needed           |
| OpenRouter → OpenRouter | Works (allowlist pricing)               | Works — no pricing needed           |
| Any → Any (code-agent)  | `pricingContext.getPricing()` throws    | Works — no pricingContext, no throw |

**Conclusion:** The fallback chain is strictly simpler post-migration. The root cause of the production failure (pricingContext throwing) is eliminated by deleting the concept entirely from client creation.

---

## 6. Frontend Pricing Audit

### 6.1 Current Web App Pricing Usage

| Component                 | File                                                  | What it shows                                                                      | Pricing source                                                  |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| LLM Pricing Page          | `apps/web/src/pages/LlmUsagePricingPage.tsx`          | All providers + models with per-million pricing, cache multipliers, grounding cost | `GET /llm-usage/pricing` (Auth0) from `llm-usage-service`       |
| OpenRouter Model Selector | `apps/web/src/components/OpenRouterModelSelector.tsx` | Model list with `pricing.inputPricePerMillion`, `pricing.outputPricePerMillion`    | Fetched from `research-agent` via `/research/openrouter/models` |
| Usage View Page           | `apps/web/src/pages/LlmUsageViewPage.tsx`             | Event details including `costUsd`                                                  | Usage events from `llm-usage-service`                           |
| Usage Dashboard           | `apps/web/src/pages/LlmUsagePage.tsx`                 | Aggregated cost data                                                               | Usage aggregates from `llm-usage-service`                       |

### 6.2 Impact Assessment

**LLM Pricing Page:** No change needed. Already fetches from `llm-usage-service` via `GET /llm-usage/pricing`. This endpoint remains unchanged.

**OpenRouter Model Selector:** The pricing fields (`inputPricePerMillion`, `outputPricePerMillion`) are sourced from `research-agent`'s `/research/openrouter/models` endpoint, which returns OpenRouter's own model metadata. These are **presentation labels** showing the OpenRouter catalog price, not the pricing used for cost calculation. No change needed.

**Usage View/Dashboard:** After migration, events stored in Firestore will have `cost.billedUsd` computed by `llm-usage-service` instead of producers. The display logic reads stored values — no change needed.

**Verdict:** No frontend changes required. The web app already reads pricing from `llm-usage-service` for display and reads usage events (which will have `billedUsd` enriched at ingestion). The OpenRouter model selector reads from `research-agent` which is a separate presentation concern.

---

## 7. Migration Plan

### 7.1 Single PR vs. Child Issues

**Decision: Multiple child issues (4 parallel tasks + 1 final integration).**

Rationale:
- The migration touches 6 apps/workers, 5 infra-* packages, 3 shared packages, and the web app.
- Estimated ~40-60 files changed across ~15 workspaces.
- A single PR would be unreviewable and risky.
- The work naturally decomposes into service boundaries that can be developed in parallel with well-defined contracts.

### 7.2 Migration Phases

**Phase 1 (parallel, 4 child issues):**

1. **llm-usage-service: Server-side cost calculation** — Add cost calculator, accept v2 events, dual-schema support
2. **packages: Remove pricing from client APIs** — Update `llm-factory`, `llm-pricing`, `llm-contract`, `infra-*` packages
3. **apps: Remove pricing from consumers** — Update `chat-agent`, `code-agent`, `research-agent`, `internal-clients`
4. **workers: Remove pricing from orchestrator** — Update `orchestrator` validation clients

**Phase 2 (sequential, after Phase 1 merges):**

5. **Cleanup: Delete dead code** — Remove `fetchAllPricing*`, `PricingContext`, `IPricingContext`, `resolvePricing`, `getDefaultAllowlistPricing`, `TOOL_CALLING_PRICING`, `GEMINI_VALIDATION_PRICING`, unused cost calculators from infra-*

### 7.3 Commit Order Within Each PR (to keep branch green)

For each child issue's PR, follow this order:
1. Add new code (new cost calculator in llm-usage-service, v2 schema support)
2. Update interfaces (make `pricing` optional, then remove)
3. Update call sites (remove pricing arguments)
4. Delete unused code
5. Update tests throughout

---

## 8. Risk & Failure-Mode Register

### 8.1 llm-usage-service Downtime During LLM Calls

| Scenario                                  | Current behavior                                                        | Post-migration behavior                                        | Risk                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| llm-usage-service down, LLM call succeeds | Usage event fails to POST (logged, not thrown — fire-and-forget sink)   | **Same** — usage sinks are fire-and-forget                     | **Low** — LLM calls still succeed; usage event is lost |
| llm-usage-service down at boot time       | `fetchAllPricingWithRetry()` retries for ~30s then throws → app crashes | **No boot-time fetch** — apps start without pricing dependency | **Improved** — apps are more resilient                 |

**Key insight:** Usage sinks (`HttpInternalAuthUsageSink`, `HttpWebhookUsageSink`) already fire-and-forget. A failed POST logs a warning but does NOT propagate the error to the caller. This means LLM calls are decoupled from usage-service availability both before and after migration.

### 8.2 Missing Pricing for a New Model

| Scenario                              | Current behavior                                                   | Post-migration behavior                                                                     |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| New model added without pricing entry | `PricingContext.getPricing()` returns `{0, 0}` with stderr warning | `llm-usage-service` looks up pricing, finds nothing → sets `billedUsd = 0` with warning log |

**Risk: Low.** The behavior is equivalent. Both pre- and post-migration, missing pricing results in $0 cost. The stderr/log warning is the signal to add pricing.

### 8.3 Bad Pricing Value

| Scenario                                          | Impact                               | Mitigation                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Over-priced model (e.g., 10x actual)              | Usage dashboard shows inflated costs | Pricing is human-reviewed via `/llm-manager` skill; `updatedAt` timestamp provides audit trail                                                |
| Under-priced model (e.g., $0 for expensive model) | Costs are hidden                     | Same mitigation — plus the existing `emit-don't-skip` policy means events are never lost; retroactive correction via re-ingestion is possible |

### 8.4 Deployment Ordering

| Scenario                                                             | Risk                                          | Mitigation                                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| llm-usage-service deploys v2 schema support BEFORE producers migrate | None — v1 events still accepted               | Dual-schema acceptance via discriminated union                                                                              |
| Producer deploys v2 events BEFORE llm-usage-service                  | **Medium** — v2 events rejected by old schema | Deploy llm-usage-service first; alternatively, make v2 backward-compatible with v1 shape (keep `billedUsd` field, set to 0) |
| Partial producer rollout (some v1, some v2)                          | None — dual-schema handles both               | N/A                                                                                                                         |

**Mitigation strategy:** Deploy `llm-usage-service` (child issue 1) first. It accepts both v1 and v2. Then roll out producers in any order.

### 8.5 OpenRouter Provider Cost Reliability

| Scenario                                  | Impact                          | Mitigation                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter returns `null` or `0` for cost | Event stored with $0 cost       | Already happens today — `useProviderCost` flag + fallback to per-token calc. Post-migration: llm-usage-service can fall back to its own pricing table for OpenRouter models too |
| OpenRouter returns inflated cost          | Event stored with inflated cost | Trust-but-verify: llm-usage-service can optionally cross-check against its pricing table and log discrepancies >2x                                                              |

---

## 9. Child-Issue Breakdown

### Child Issue 1: llm-usage-service — Server-Side Cost Calculation

**Scope:** `apps/llm-usage-service/`

**Description:**
Add cost calculation to `ingestUsageEvents()`. When receiving a `schemaVersion: 2` event with `pricingSource: 'pending'`, look up pricing by `(provider, model)` and compute `billedUsd` using consolidated cost calculators.

**Implementation:**
1. Create `apps/llm-usage-service/src/domain/services/costCalculation.ts` — consolidate cost calculators from all `infra-*` packages into a single `calculateCost(provider: LlmProvider, usage: UsageTokens, pricing: ModelPricing): number` function.
2. Add in-memory pricing cache to `ingestUsageEvents()` (load from `PricingRepository`, cache 5 min TTL).
3. Update `ingestUsageEvents()`: for v2 events, compute cost; for v1 events, pass through as-is.
4. Update Fastify route schema to accept both v1 and v2 events via discriminated union.
5. Add comprehensive tests for all provider cost calculations and the dual-schema ingestion path.

**Contract with other issues:**
- Accepts both `schemaVersion: 1` and `schemaVersion: 2` events
- v2 event `cost` shape: `{ providerReportedUsd: number | null, pricingSource: 'provider_reported' | 'pending' }`
- Stored event `cost` shape: `{ billedUsd: number, providerReportedUsd: number | null, calculatedUsd: number | null, pricingSource: 'provider_reported' | 'calculated' }`
- No changes to HTTP endpoints (paths, auth, response shapes)

**Test Requirements:**
- Unit tests for `calculateCost()` covering all 5 providers (google, openai, anthropic, perplexity, openrouter)
- Unit tests for `ingestUsageEvents()` with v1 events (backward compat), v2 events with `pending` pricing, v2 events with `provider_reported` pricing
- Edge cases: unknown model (should set $0 + warning), zero tokens, negative providerReportedUsd (should clamp to 0)
- Integration test: full route → Firestore round-trip with v2 event

### Child Issue 2: packages — Remove Pricing from Client APIs

**Scope:** `packages/llm-factory/`, `packages/llm-pricing/`, `packages/llm-contract/`, `packages/infra-gemini/`, `packages/infra-claude/`, `packages/infra-gpt/`, `packages/infra-perplexity/`, `packages/infra-openrouter/`, `packages/internal-clients/`

**Description:**
Remove `pricing: ModelPricing` from `LlmClientConfig` and `ToolCallingClientConfig`. Remove `IPricingContext`, `PricingContext`, `fetchAllPricing*`, `createPricingContext` from `llm-pricing`. Remove `resolvePricing()` from `internal-clients/user-service/client.ts`. Remove `pricingContext` from `createUserServiceClient` config. Update `buildUsageEvent()` to emit `schemaVersion: 2` events without local cost. Remove `getDefaultAllowlistPricing()` from pricing resolution (keep for allowlist membership).

**Implementation:**
1. `llm-factory`: Remove `pricing` from `LlmClientConfig`. Remove `pricing` from `ToolCallingClientConfig`.
2. `llm-pricing`: Update `buildUsageEvent()` to produce v2 events. Delete `fetchAllPricing()`, `fetchAllPricingWithRetry()`, `PricingContext`, `IPricingContext`, `createPricingContext()`. Update `UsageLogger` to not call cost calculators.
3. `llm-contract`: Keep `ModelPricing`, `ProviderPricing` (still used by llm-usage-service). Remove `CostCalculator` interface (moved to llm-usage-service).
4. `infra-*`: Remove `pricing` param from client constructors. Remove `costCalculator` usage in response normalization. Keep `toModelPricing()` in infra-openrouter for allowlist display.
5. `internal-clients`: Delete `resolvePricing()`. Remove `pricingContext` from `createUserServiceClient` config. Remove `pricing` from all `createLlmClient` calls.
6. `infra-gemini`: Delete `TOOL_CALLING_PRICING`. Remove `pricing` from `ToolCallingClientConfig`.

**Contract with other issues:**
- `LlmClientConfig` becomes: `{ apiKey, model, userId, logger, usageSink, ownerType? }`
- `ToolCallingClientConfig` becomes: `{ apiKey, model, userId, logger, usageSink }`
- `createUserServiceClient` config no longer includes `pricingContext`
- `buildUsageEvent()` emits `schemaVersion: 2` with `cost: { providerReportedUsd, pricingSource }`
- `GenerateResult.usage.costUsd` field: either removed or set to `0` (discuss: removing it breaks the interface for callers that log it — safer to keep as `0` and document)

**Test Requirements:**
- All existing tests updated to remove pricing from client configs
- `buildUsageEvent()` tests for v2 schema (providerReported case, pending case)
- `createLlmClient()` tests without pricing param
- `createUserServiceClient` tests without `pricingContext`
- Fallback tests in `client-fallback.test.ts` updated to work without pricing

### Child Issue 3: apps — Remove Pricing from Consumer Services

**Scope:** `apps/chat-agent/`, `apps/code-agent/`, `apps/research-agent/`

**Description:**
Remove pricing-related boot-time logic, `pricingContext` from service containers, and pricing params from LLM adapter factories.

**Implementation:**
1. `chat-agent`: Remove `fetchAllPricingWithRetry()` call at boot. Remove `createPricingContext()`. Remove `pricing` from `createLlmClient()` call.
2. `code-agent`: Delete `GEMINI_TOOL_CALLING_PRICING` constant. Delete stub `pricingContext` object. Remove `pricing` from `createToolCallingClient()` call. Remove `pricingContext` from `createUserServiceClient()`.
3. `research-agent`: Remove `pricingContext: IPricingContext` from `ServiceContainer`. Remove `pricing: ModelPricing` param from all 5 factory functions in `LlmAdapterFactory.ts`. Remove `pricing` param from all adapter constructors (GeminiAdapter, ClaudeAdapter, etc.). Remove boot-time pricing fetch.

**Contract with other issues:**
- Depends on Child Issue 2 (packages) being complete (or developed against the same branch)
- `ServiceContainer` types change: no `pricingContext` field
- Adapter constructors lose `pricing` param
- No changes to HTTP endpoints or domain logic

**Test Requirements:**
- `chat-agent/src/__tests__/services.test.ts` updated to remove pricing mocks
- `code-agent` tests updated to remove pricing-related test fixtures
- `research-agent` adapter tests updated to remove pricing from constructor args
- All service boot tests pass without pricing fetch

### Child Issue 4: workers — Remove Pricing from Orchestrator

**Scope:** `workers/orchestrator/`

**Description:**
Remove `GEMINI_VALIDATION_PRICING`, `ZERO_PRICING`, and `getDefaultAllowlistPricing()` usage from `validation-model-clients.ts`. Remove `pricing` from all `createLlmClient()` calls.

**Implementation:**
1. Delete `GEMINI_VALIDATION_PRICING` constant.
2. Delete `ZERO_PRICING` constant.
3. Remove `getDefaultAllowlistPricing()` import and usage.
4. Remove `pricing` from both `createLlmClient()` calls (OpenRouter and Gemini paths).
5. Update all tests in `validation-model-clients.test.ts`.

**Contract with other issues:**
- Depends on Child Issue 2 (packages) for updated `LlmClientConfig` without `pricing`
- No changes to orchestrator HTTP endpoints or domain logic
- Usage events emitted via `HttpWebhookUsageSink` will be v2 format (handled by Child Issue 1)

**Test Requirements:**
- `validation-model-clients.test.ts`: Remove all pricing-related assertions from `createLlmClient` mock calls
- Verify `buildValidationClients()` works without pricing params
- Verify OpenRouter and Gemini model paths both work

---

## Endpoint Changes

### Modified

| Endpoint                            | Service           | Change                                                                            |
| ----------------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `POST /internal/usage`              | llm-usage-service | Accept both `schemaVersion: 1` and `schemaVersion: 2` events; compute cost for v2 |
| `POST /internal/usage/orchestrator` | llm-usage-service | Same dual-schema support                                                          |

### Created

None.

### Removed

None.

### Unchanged

| Endpoint                 | Service           |
| ------------------------ | ----------------- |
| `GET /internal/pricing`  | llm-usage-service |
| `POST /internal/pricing` | llm-usage-service |
| `GET /llm-usage/pricing` | llm-usage-service |

---

## Deployment Order

1. **Deploy Child Issue 1** (llm-usage-service with dual-schema support) — must go first
2. **Deploy Child Issues 2, 3, 4** (packages + apps + workers) — can go in any order after step 1
3. **Cleanup PR** — remove v1 schema acceptance from llm-usage-service after all producers are migrated (optional, low priority)

---

## Open Questions (Resolved)

1. **Should `GenerateResult.usage.costUsd` be removed?**
   Decision: Keep the field but set to `0`. Removing it is a breaking interface change that affects logging in callers. Setting to `0` is safe and makes the migration simpler.

2. **Should `llm-usage-service` do retroactive re-pricing?**
   Decision: No. Events are priced at ingestion time. Retroactive re-pricing is a separate feature if needed later.

3. **Should OpenRouter events also get server-side pricing as a cross-check?**
   Decision: Not in v1 of this migration. Can be added later as a validation layer.
