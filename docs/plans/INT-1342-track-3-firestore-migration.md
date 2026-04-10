# INT-1342 — Track 3: Migrate All Firestore LLM Usage Writers to HTTP

## Status

- Linear issue: **INT-1342**
- Parent epic: **INT-1338** (LLM Usage Service Phase 2)
- Dependencies:
  - **INT-1341** (Track 2 — proves orchestrator HTTP publisher pattern against `/internal/usage/events`)
  - **INT-1339** (Track 4 — server-side cost calc lands on `llm-usage-service`, so HTTP callers can omit `calculatedUsd`)
- Blocks: nothing in this epic — this is the last track that touches Firestore writers.
- Plan version: **1.0**

## Executive summary

Today every provider client in the monorepo (`infra-claude`, `infra-gpt`, `infra-gemini`, `infra-perplexity`, `infra-openrouter`) logs LLM usage by calling `createUsageLogger({ logger })`, which defaults to `FirestoreUsageSink` and writes directly to the `llm_usage_stats` collection. That collection is owned by the `llm-pricing` package (a package owning a collection is itself a CLAUDE.md architecture smell — see `firestore-collections.json` line 69), and its data is read by `app-settings-service`'s `FirestoreUsageStatsRepository` via `collectionGroup('by_user')` to drive the user cost dashboard. A second writer — `apps/code-agent/src/infra/firestore/userUsageFirestoreRepository.ts` — writes to the `user_usage` collection to enforce per-user rate limits and cost quotas in `rateLimitService`. A third writer — `packages/llm-audit/src/audit.ts` — writes full request/response bodies to `llm_api_logs`; it is explicitly **out of scope** for this track.

After this track lands:

1. The only process in the codebase that writes LLM usage aggregates is `apps/llm-usage-service` via its `POST /internal/usage/events` (internal) and `POST /webhooks/orchestrator-usage-event` (webhook) endpoints.
2. `FirestoreUsageSink` is deleted. A new `HttpUsageSink` replaces it, built on top of `createUsageServiceClient` from `@intexuraos/internal-clients`.
3. `app-settings-service`'s `FirestoreUsageStatsRepository` is replaced by an `HttpUsageStatsRepository` that calls `POST /internal/usage/query`. The `collectionGroup('by_user')` read path is retired.
4. The `llm_usage_stats` collection is manually deleted only after a 7-day dual-write parity window with ≤0.1% mismatch.
5. `code-agent`'s `user_usage` collection is retained as a **read-only cache** kept hot by a new fanout webhook, `POST /internal/webhooks/quota-update` on `code-agent`, which `llm-usage-service.ingestUsageEvents` fires whenever the `owner.id` matches a known code-agent user and the `source.service === 'code-agent'`. This is the recommended option but requires explicit approval — see `⚠ DECISION NEEDED: user_usage strategy` below.
6. `firestore-collections.json` is updated: `llm_usage_stats` entry removed, `user_usage` ownership rewritten to `code-agent` with a note that it is a cache populated by `llm-usage-service` webhooks.

Blast radius is huge: there are **41 files** touching `UsageLogger` across packages and apps, every one of the provider clients must change its factory wiring, every consuming app boots a `PricingContext` plus (after this track) an `HttpUsageSink` wired to `INTEXURAOS_LLM_USAGE_SERVICE_URL`, and an `app-settings-service` endpoint that users currently hit is being swapped out underneath them. A mistake here loses cost-tracking data, fails the monthly cost report, or — worst case — breaks `code-agent` rate limiting so one user can burn the whole monthly budget. The rollout plan treats this accordingly with a multi-week dual-write phase and an explicit human gate before collection deletion.

## Pre-flight checks (run before starting Phase 1)

1. **Verify INT-1341 is deployed and green.**
   - Orchestrator events landing in `llm_usage_events` and `llm_usage_daily_aggregates` collections (check Firestore Studio on `intexuraos-dev-pbuchman`).
   - `POST /webhooks/orchestrator-usage-event` error rate is <0.1% in dev for 24h.
2. **Verify INT-1339 is deployed and green.**
   - `llm-usage-service` `ingestUsageEvents` use case calculates `cost.calculatedUsd` server-side when the client omits it.
   - Parity check between `cost.providerReportedUsd` and `cost.calculatedUsd` on live events is ≤0.5%.
3. **Recount `UsageLogger` inventory.**
   ```bash
   rg "UsageLogger" apps/ packages/ --files-with-matches | wc -l
   rg "createUsageLogger\(" apps/ packages/ -n
   rg "FirestoreUsageSink" apps/ packages/ -n
   ```
   If the file count differs from the inventory in the next section, **update this plan before starting**. Drift means a new call site landed between planning and execution — audit it.
4. **Confirm the env var is already set everywhere.**
   ```bash
   rg "INTEXURAOS_LLM_USAGE_SERVICE_URL" terraform/ ecosystem.config.cjs apps/
   ```
   Should return matches in `terraform/environments/dev/main.tf` (line ~310), `ecosystem.config.cjs` (line ~57), and — after Phase 3 — every consuming app's `REQUIRED_ENV`.
5. **Sanity check `firestore-collections.json` hasn't drifted.** The current `llm_usage_stats` entry at line 69 says `"owner": "llm-pricing"`. If someone already changed this, stop and reconcile.

## Complete writer inventory

Verified by `rg "createUsageLogger\(" packages/ apps/` and `rg "FirestoreUsageSink" packages/ apps/` at plan time.

### Primary: `FirestoreUsageSink` (via `UsageLogger` default)

| #   | File                                                                       | Collection                                                         | Trigger                                    | Payload                            | Action                                                                                               |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `packages/llm-pricing/src/usageLogger.ts:112` (`FirestoreUsageSink`)       | `llm_usage_stats/{model}/by_call_type/{callType}/by_period/{total\ | YYYY-MM\                                   | YYYY-MM-DD}` + `/by_user/{userId}` | Every LLM call via any provider client                                                               | `totalCalls`, `successfulCalls`, `failedCalls`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, provider+model metadata | **Delete** after Phase 7 |
| 2   | `packages/llm-pricing/src/usageLogger.ts:314` (`UsageLogger.sink` default) | —                                                                  | —                                          | —                                  | Flip default to `HttpUsageSink` in Phase 6; drop the parameter entirely in Phase 7                   |
| 3   | `packages/infra-claude/src/client.ts:94`                                   | via #1                                                             | Every `createClaudeClient(...)` call       | —                                  | Change to use HTTP sink via config (Phase 3)                                                         |
| 4   | `packages/infra-gpt/src/client.ts:97`                                      | via #1                                                             | Every `createGptClient(...)`               | —                                  | Same                                                                                                 |
| 5   | `packages/infra-gemini/src/client.ts:87`                                   | via #1                                                             | Every `createGeminiClient(...)`            | —                                  | Already accepts `usageSink?` — no signature change, just thread through the new sink from app config |
| 6   | `packages/infra-gemini/src/toolCallingClient.ts:68`                        | via #1                                                             | Every `createGeminiToolCallingClient(...)` | —                                  | Already accepts `usageSink?` — thread through                                                        |
| 7   | `packages/infra-perplexity/src/client.ts:222`                              | via #1                                                             | Every `createPerplexityClient(...)`        | —                                  | Change: add `usageSink?` to `PerplexityConfig` and thread through                                    |
| 8   | `packages/infra-openrouter/src/client.ts:155`                              | via #1                                                             | Every `createOpenRouterClient(...)`        | —                                  | Already accepts `usageSink?` — thread through                                                        |

### Secondary: `userUsageFirestoreRepository`

| #   | File                                                                     | Collection            | Trigger                                                                                                                                                            | Payload                                                                                                                          | Action                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | `apps/code-agent/src/infra/firestore/userUsageFirestoreRepository.ts:14` | `user_usage/{userId}` | `rateLimitService.recordTaskStart/Complete` in `apps/code-agent/src/routes/codeRoutes.ts:1894,4543` and `apps/code-agent/src/domain/usecases/startAskAgent.ts:141` | `concurrentTasks`, `tasksThisHour`, `hourStartedAt`, `costToday`, `costThisMonth`, `dayStartedAt`, `monthStartedAt`, `updatedAt` | **See `⚠ DECISION NEEDED` below.** Default recommendation: keep `user_usage` as a read-only cache, hot-loaded by a `POST /internal/webhooks/quota-update` fanout webhook from `llm-usage-service`. Drop local `recordTaskStart` cost writes; keep `concurrentTasks` writes (that's a local ephemeral counter, not billing data). |

### Explicitly OUT OF SCOPE: `llm_api_logs`

| #   | File                                                     | Collection     | Trigger                                    | Payload                                                                                                                                | Action                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------- | -------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | `packages/llm-audit/src/audit.ts` (`FirestoreAuditSink`) | `llm_api_logs` | Every LLM request (both success and error) | Full prompt, full response (or error), provider, model, method, token counts, `costUsd`, `durationMs`, optional `researchId`, `userId` | **No change.** Audit logs are a different concern from usage metrics — they store full prompts/responses for compliance and debugging. This track should not touch them. Track it separately if we ever want to consolidate. |

### Final audit grep (Phase 10)

Run these four queries at the end of Phase 10 — **all should return zero production hits**:

```bash
rg "firestore.*usage" apps/ packages/ -i        # old direct Firestore patterns
rg "collection\(['\"]llm_usage_stats" apps/ packages/
rg "\.set\(.*tokens" apps/ packages/
rg "\.update\(.*costUsd" apps/ packages/
```

At plan time, these return: one hit in `app-settings-service/src/infra/firestore/usageStatsRepository.ts` (the READER — removed in Phase 8b), plus test fixtures in `packages/llm-pricing/src/__tests__/usageLogger.test.ts` (deleted in Phase 7). No other stragglers were found.

## Decision matrix for `user_usage`

This collection is **not** an LLM analytics aggregate — it is a **per-user quota enforcement state** used at task admission. Deleting it without a replacement breaks `code-agent` rate limiting. Three options:

### Option (a) — Compute quota live via `POST /internal/usage/query`

**How:** Delete `user_usage`. Every call to `rateLimitService.checkLimits(userId, promptLength)` issues `POST /internal/usage/query` with `{ timeRange: { from: startOfHour, to: now }, filters: { ownerIds: [userId], services: ['code-agent'] } }` and reads `totals.calls` / `totals.costUsd`.

**Pros:**
- Single source of truth (`llm_usage_events`). No cache invalidation.
- Works immediately after INT-1341/INT-1339 without a new webhook.

**Cons:**
- Adds **~100–300 ms** latency to every `code-agent` task submission (2 Firestore aggregations + 1 HTTP hop + internal auth).
- `llm-usage-service` becomes a hard dependency of `code-agent` admission. If it's down, we either block all code tasks or bypass quotas — both bad.
- `concurrentTasks` is NOT aggregated in `llm_usage_events` (it's a live counter of in-flight tasks, not a sum of past events). We would still need SOME local state.
- Query pattern (`ownerIds: [userId], services: ['code-agent']`) requires composite Firestore index support in `llm_usage_daily_aggregates` — currently exists, verified at plan time.

### Option (b) — Keep `user_usage` as a read-only cache, updated by webhook fanout ⭐ RECOMMENDED

**How:**
- `code-agent` keeps `user_usage` but drops its own `costToday`/`costThisMonth` increments from `rateLimitService.recordTaskStart/recordActualCost`.
- `code-agent` exposes a new endpoint: `POST /internal/webhooks/quota-update` (internal auth via `X-Internal-Auth`).
- `llm-usage-service.ingestUsageEvents` — after a successful `createEvent` + `incrementAggregate` — does a non-blocking fanout: if `event.source.service === 'code-agent'` AND `event.owner.type === 'user'`, POST `{ userId, costDeltaUsd, dailyCostUsd, monthlyCostUsd, periodKey }` to `code-agent`.
- `code-agent`'s webhook handler runs a Firestore transaction that increments `costToday` and `costThisMonth` on `user_usage/{userId}`, handling day/month window resets the same way `userUsageFirestoreRepository.recordTaskStart` does today.
- `concurrentTasks` stays a local counter, written on task dispatch and decremented on completion. This is correct — it's not a billing aggregate.
- `tasksThisHour` stays a local counter, bumped on `recordTaskStart` with hour-window reset. This is also correct — it's an admission counter, not a cost tracker.

**Pros:**
- Rate limit checks stay fast (single Firestore read).
- Resilient to `llm-usage-service` outages: if the webhook fails, `code-agent`'s admission decisions still work — they'll just be slightly stale (already-admitted tasks won't reflect yet-to-land cost).
- Preserves the existing `user_usage` read path — no changes needed in `rateLimitService.checkLimits`.

**Cons:**
- Adds a new endpoint, new webhook publisher wiring, new retry semantics.
- Webhook fanout must be idempotent (we may get duplicate events from retries). Use `eventId` as dedup key in a Firestore doc like `user_usage/{userId}/processed_events/{eventId}`.
- Two places to reason about quota: the cache and the events collection. If the cache drifts, the UX is wrong.

### Option (c) — Dual-write `user_usage` indefinitely

**How:** `code-agent` keeps calling `userUsageFirestoreRepository.recordTaskStart` AND emits a usage event to `llm-usage-service`. Both Firestore paths stay alive forever.

**Pros:** Zero risk to quota enforcement.

**Cons:** Eternal divergence. Violates the "one writer per collection" rule. Duplicates the data. No consolidation. Defeats the entire point of this epic.

**Not recommended.** Document the rejection and move on.

### ⚠ DECISION NEEDED: `user_usage` strategy

**Default recommendation: Option (b) — cache kept hot by webhook fanout.**

Rationale: it preserves admission-path latency, survives `llm-usage-service` outages, and still consolidates the source of truth to `llm_usage_events`. Option (a) adds a live HTTP dependency on the hot path, which we should not accept. Option (c) is a non-answer.

**User must approve explicitly before starting Phase 8.** If the user picks Option (a) instead, Phase 8 swaps the `user_usage` repo implementation for an `HttpBackedUserUsageRepository` and Phase 9 deletes the `user_usage` collection entirely. If Option (c), cancel Phases 8–9 and document as a known issue.

## Context files

The implementer should read all of these before touching code. Paths are absolute.

1. `/Users/p.buchman/personal/intexuraos-1/packages/llm-pricing/src/usageLogger.ts` — full file (422 lines). Pay attention to:
   - `UsageSink` interface (line 105)
   - `FirestoreUsageSink` class (lines 112–214) — this is being deleted
   - `UsageLogger` class (lines 308–375) and its default `sink` fallback (line 314)
   - `isUsageLoggingEnabled()` env flag (line 275) — preserve it
2. `/Users/p.buchman/personal/intexuraos-1/packages/llm-pricing/src/index.ts` — public exports. After Phase 7, `FirestoreUsageSink` is no longer exported; `HttpUsageSink` takes its place.
3. `/Users/p.buchman/personal/intexuraos-1/packages/llm-pricing/src/types.ts` — `LlmPricing` type (unrelated to usage, keep as-is).
4. `/Users/p.buchman/personal/intexuraos-1/packages/llm-pricing/src/pricingClient.ts` — unrelated but good context on how `PricingContext` is initialized. Same pattern should be used for `HttpUsageSink` construction.
5. `/Users/p.buchman/personal/intexuraos-1/packages/llm-audit/src/audit.ts` — read to confirm it is **not** touched.
6. `/Users/p.buchman/personal/intexuraos-1/packages/infra-claude/src/client.ts:94` — example of provider client factory wiring.
7. `/Users/p.buchman/personal/intexuraos-1/packages/infra-gpt/src/client.ts:97` — same pattern.
8. `/Users/p.buchman/personal/intexuraos-1/packages/infra-gemini/src/client.ts:87` — already takes optional `usageSink`, use this as the template.
9. `/Users/p.buchman/personal/intexuraos-1/packages/infra-gemini/src/toolCallingClient.ts:68` — also already takes `usageSink`.
10. `/Users/p.buchman/personal/intexuraos-1/packages/infra-perplexity/src/client.ts:222` — does NOT take `usageSink`; add it.
11. `/Users/p.buchman/personal/intexuraos-1/packages/infra-openrouter/src/client.ts:155` — already takes `usageSink`.
12. `/Users/p.buchman/personal/intexuraos-1/packages/internal-clients/src/usage-service/client.ts` — reuse `createUsageServiceClient`. Note: it already has `ingestEvents(request, { traceId? })` which is exactly what `HttpUsageSink` needs.
13. `/Users/p.buchman/personal/intexuraos-1/packages/internal-clients/src/usage-service/types.ts` — full event schema (`UsageEventInput`). `HttpUsageSink` must construct these from `UsageLogParams`.
14. `/Users/p.buchman/personal/intexuraos-1/apps/code-agent/src/infra/firestore/userUsageFirestoreRepository.ts` — full file (229 lines).
15. `/Users/p.buchman/personal/intexuraos-1/apps/code-agent/src/domain/services/rateLimitService.ts` — full file (101 lines). Understand what fields it actually reads from `user_usage` (only `concurrentTasks`, `tasksThisHour`, `costToday`).
16. `/Users/p.buchman/personal/intexuraos-1/apps/code-agent/src/domain/ports/userUsageRepository.ts` — interface.
17. `/Users/p.buchman/personal/intexuraos-1/apps/code-agent/src/domain/models/userUsage.ts` — `DEFAULT_LIMITS` + `ESTIMATED_COST_PER_TASK`.
18. `/Users/p.buchman/personal/intexuraos-1/apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts` — where the fanout webhook must be added.
19. `/Users/p.buchman/personal/intexuraos-1/apps/app-settings-service/src/infra/firestore/usageStatsRepository.ts` — `FirestoreUsageStatsRepository` (the READER being replaced).
20. `/Users/p.buchman/personal/intexuraos-1/apps/app-settings-service/src/routes/publicRoutes.ts:219` — the endpoint currently driven by the above reader.
21. `/Users/p.buchman/personal/intexuraos-1/terraform/environments/dev/main.tf:310` — confirm `INTEXURAOS_LLM_USAGE_SERVICE_URL` is already set in `common_service_env_vars`.
22. `/Users/p.buchman/personal/intexuraos-1/ecosystem.config.cjs:57` — same confirmation for PM2.
23. `/Users/p.buchman/personal/intexuraos-1/firestore-collections.json:69` — current `llm_usage_stats` ownership entry.

### Apps that use provider clients (the `services.ts` files to update)

Verified by `rg "createClaudeClient|createGptClient|createGeminiClient|createPerplexityClient|createOpenRouterClient"` at plan time:

| App                        | Services file / usage                                                                                                                                                                                        | Must update?                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `apps/research-agent`      | `src/infra/llm/ClaudeAdapter.ts`, `GeminiAdapter.ts`, `GptAdapter.ts`, `PerplexityAdapter.ts`, `OpenRouterAdapter.ts`, `InputValidationAdapter.ts`, `ContextInferenceAdapter.ts` — constructs clients inline | **YES** — add usageSink param to services.ts + pass through all adapters |
| `apps/user-service`        | `src/infra/llm/LlmValidatorImpl.ts` — constructs clients inline per-validation                                                                                                                               | **YES**                                                                  |
| `apps/linear-agent`        | `src/services.ts:79` — `createGeminiClient` in DI wiring                                                                                                                                                     | **YES**                                                                  |
| `apps/hellscript-agent`    | `src/index.ts:38` — `createGeminiClient` at startup                                                                                                                                                          | **YES**                                                                  |
| `apps/cron-agent`          | `src/index.ts` — creates a client                                                                                                                                                                            | **YES**                                                                  |
| `apps/image-service`       | `src/infra/llm/GptPromptAdapter.ts`, `GeminiPromptAdapter.ts`, `src/infra/image/GoogleImageGenerator.ts`, `OpenAIImageGenerator.ts`                                                                          | **YES**                                                                  |
| `apps/commands-agent`      | uses `llm-factory` wrapper; classifier tests mock `createUsageLogger`                                                                                                                                        | **YES** — `services.ts` constructs via `llm-factory`, trace the wrapping |
| `apps/todos-agent`         | uses `llm-factory` wrapper                                                                                                                                                                                   | **YES**                                                                  |
| `apps/data-insights-agent` | uses `llm-factory` wrapper                                                                                                                                                                                   | **YES**                                                                  |
| `apps/calendar-agent`      | uses `llm-factory` wrapper                                                                                                                                                                                   | **YES** (verify)                                                         |
| `apps/actions-agent`       | uses `llm-factory` wrapper                                                                                                                                                                                   | **YES** (verify)                                                         |
| `apps/chat-agent`          | uses `llm-factory` wrapper                                                                                                                                                                                   | **YES** (verify)                                                         |
| `apps/web-agent`           | uses `llm-factory` wrapper                                                                                                                                                                                   | **YES** (verify)                                                         |
| `apps/code-agent`          | only uses `EmbeddingClient` + `TOOL_CALLING_PRICING` from `infra-gemini`                                                                                                                                     | **NO** — no `createUsageLogger` call sites (verified)                    |

**Important:** `llm-factory` (if it exists as an app-level shared wrapper) must also be audited in Phase 3 — it may be the single funnel that constructs provider clients for many agents. If so, updating it updates them all at once. If it does not funnel all consumers, each agent's `services.ts` or adapter file needs individual treatment.

## Endpoint changes

### Modified

- **`apps/llm-usage-service` — `POST /internal/usage/events`**
  No API change. Internal behavior change: after `ingestUsageEvents` succeeds, fires a **non-blocking** fanout to `code-agent`'s `/internal/webhooks/quota-update` endpoint for events with `source.service === 'code-agent'` AND `owner.type === 'user'`. Fanout failures must be logged but must NOT roll back the original ingest (events are already safely stored and aggregated). (Only applies if **Option (b)** is chosen — gated on `⚠ DECISION NEEDED` above.)

- **`apps/app-settings-service` — `GET /public/usage/costs` (current `publicRoutes.ts:219`)**
  No API contract change. Internal behavior: `usageStatsRepository.getUserCosts(userId, days)` now delegates to `createUsageServiceClient(...).queryUsage({ timeRange, filters: { ownerIds: [userId] }, groupBy: ['day', 'model', 'operation'] })` and reshapes the response into the existing `AggregatedCosts` type. The response schema on the public endpoint stays identical so the web UI requires no changes.

### Created

- **`apps/code-agent` — `POST /internal/webhooks/quota-update`** (only if Option (b))
  - Headers: `X-Internal-Auth: <INTEXURAOS_INTERNAL_AUTH_TOKEN>`
  - Request body schema (validated by Fastify schema):
    ```ts
    {
      eventId: string,       // idempotency key
      userId: string,
      occurredAt: string,    // ISO-8601
      costDeltaUsd: number,  // positive or negative
      periodKeys: { day: string, month: string }  // YYYY-MM-DD, YYYY-MM
    }
    ```
  - Response: `{ success: true, applied: boolean }` (applied=false means duplicate eventId, already processed)
  - Handler uses a Firestore transaction to:
    1. Check `user_usage/{userId}/processed_events/{eventId}` existence — if present, return `applied: false`.
    2. Read `user_usage/{userId}`. Reset day/month windows if current `periodKeys` don't match stored `dayStartedAt` / `monthStartedAt`.
    3. Apply `costToday += costDeltaUsd`, `costThisMonth += costDeltaUsd`.
    4. Write `user_usage/{userId}/processed_events/{eventId}` sentinel doc with a 7-day TTL (expiration via `receivedAt` field + scheduled cleanup).
  - `logIncomingRequest()` is called at the top of the handler (CLAUDE.md architecture rule).

### Removed

- `FirestoreUsageSink` class and all its Firestore writes (Phase 7).
- `apps/app-settings-service/src/infra/firestore/usageStatsRepository.ts` and its `collectionGroup('by_user')` query (Phase 8b).
- `apps/code-agent/src/infra/firestore/userUsageFirestoreRepository.ts` `recordTaskStart(userId, estimatedCost)` and `recordActualCost(userId, actualCost, estimatedCost)` — the cost-writing parts are dropped. `incrementConcurrent`/`decrementConcurrent` survive because they manage live concurrent task count, not billing data. The `costToday`/`costThisMonth` fields on `user_usage` remain in the schema and are now populated ONLY via the webhook.

### Unchanged

- `apps/llm-usage-service` — `POST /webhooks/orchestrator-usage-event` (already added in INT-1341).
- All `llm-audit` / `llm_api_logs` paths.
- All `llm_pricing` Firestore collection paths (`settings/llm_pricing/providers`) — unrelated, owned by `app-settings-service`.

## Step-by-step implementation

### Phase 1 — Create `HttpUsageSink` (test-first)

1.1. Create `packages/llm-pricing/src/httpUsageSink.ts`. Write the failing test FIRST at `packages/llm-pricing/src/__tests__/httpUsageSink.test.ts`:
   - Test 1: given a fake `UsageServiceClient` and a `UsageLogParams`, `HttpUsageSink.log(params)` calls `client.ingestEvents` exactly once.
   - Test 2: the `UsageIngestRequest` it builds has `schemaVersion: 1`, `events[0].owner.type === 'user'` when `userId` is non-empty, `'system'` when empty.
   - Test 3: `events[0].request.operation` is mapped from `CallType` (`'research'` → `'research'`, `'generate'` → `'generate'`, `'image_generation'` → `'image_generation'`, `'tool_calling'` → `'tool_calling'`, `'visualization_insights'` → `'visualization_insights'`, `'visualization_vegalite'` → `'visualization_vegalite'`).
   - Test 4: `events[0].usage` mirrors `params.usage.inputTokens` / `outputTokens` / `totalTokens`, zero-fills fields `NormalizedUsage` doesn't carry (`cacheReadTokens`, `cacheWriteTokens`, `cachedTokens`, `reasoningTokens`, `thinkingTokens`, `webSearchCalls`, `imageCount`), sets `groundingEnabled: false` unless callers pass it.
   - Test 5: `events[0].cost.billedUsd === params.usage.costUsd`, `cost.providerReportedUsd === null`, `cost.calculatedUsd === null` (server calculates after INT-1339), `cost.pricingSource === 'external'` (client-side precomputed, now redundant but valid marker).
   - Test 6: `events[0].eventId` is a fresh UUID per call; `occurredAt` is a valid ISO-8601 string.
   - Test 7: on `client.ingestEvents` failure, `HttpUsageSink.log` rethrows — the outer `UsageLogger.log` catches and logs (same as `FirestoreUsageSink` failure handling).
   - Test 8: `source.service`, `source.component`, `source.client`, `source.environment` must all be populated from the constructor deps. Wrong deps → the sink won't compile.
   - Run all tests — they must all fail (file doesn't exist).

1.2. Implement `HttpUsageSink`:
   ```ts
   export interface HttpUsageSinkDeps {
     usageServiceClient: UsageServiceClient;
     source: {
       service: string;      // e.g., 'research-agent'
       component: string;    // e.g., 'research-use-case'
       client: string;       // e.g., 'claude' | 'gpt' | 'gemini' | ...
       environment: 'dev' | 'prod' | 'test';
     };
   }

   export class HttpUsageSink implements UsageSink {
     constructor(private readonly deps: HttpUsageSinkDeps) {}

     async log(params: UsageLogParams): Promise<void> {
       const event: UsageEventInput = buildUsageEvent(params, this.deps.source);
       const result = await this.deps.usageServiceClient.ingestEvents({
         schemaVersion: 1,
         events: [event],
       });
       if (!result.ok) {
         throw new Error(`HttpUsageSink ingestEvents failed: ${result.error.code} ${result.error.message}`);
       }
     }
   }
   ```
   Run tests — all green.

1.3. Export `HttpUsageSink` and `HttpUsageSinkDeps` from `packages/llm-pricing/src/index.ts`.

1.4. Run `pnpm run verify:workspace:tracked -- llm-pricing` — must pass with ≥95% branch coverage on the new file.

### Phase 2 — Add dual-write capability (feature flag)

This phase introduces a `DualWriteUsageSink` that writes to BOTH `FirestoreUsageSink` AND `HttpUsageSink`, gated by an env var `INTEXURAOS_USAGE_SINK_MODE` with values:

- `firestore` (default for Phase 2–4) — `FirestoreUsageSink` only, current behavior
- `dual` — `DualWriteUsageSink` (Firestore + HTTP, HTTP failures logged but not propagated)
- `http` — `HttpUsageSink` only (target state for Phase 6 onward)

2.1. Test-first: create `packages/llm-pricing/src/__tests__/dualWriteUsageSink.test.ts`:
   - Test 1: calls both `primary.log()` and `secondary.log()`.
   - Test 2: if `secondary.log()` throws, returns successfully (warning is logged via injected logger, primary is considered authoritative).
   - Test 3: if `primary.log()` throws, propagates the error (since primary is still authoritative during dual-write).

2.2. Implement:
   ```ts
   export class DualWriteUsageSink implements UsageSink {
     constructor(private readonly deps: {
       primary: UsageSink;
       secondary: UsageSink;
       logger: Logger;
     }) {}

     async log(params: UsageLogParams): Promise<void> {
       // Run in parallel but handle failures independently
       const secondaryPromise = this.deps.secondary.log(params).catch((error) => {
         this.deps.logger.warn({ err: error }, 'Secondary usage sink failed during dual-write');
       });
       await this.deps.primary.log(params);
       await secondaryPromise;
     }
   }
   ```

2.3. Add a factory helper `createUsageSinkFromEnv(deps)` in `packages/llm-pricing/src/usageSinkFactory.ts`:
   ```ts
   export function createUsageSinkFromEnv(deps: {
     logger: Logger;
     usageServiceClient: UsageServiceClient;
     source: HttpUsageSinkDeps['source'];
   }): UsageSink {
     const mode = process.env['INTEXURAOS_USAGE_SINK_MODE'] ?? 'firestore';
     switch (mode) {
       case 'http':
         return new HttpUsageSink({ usageServiceClient: deps.usageServiceClient, source: deps.source });
       case 'dual':
         return new DualWriteUsageSink({
           primary: new FirestoreUsageSink(),
           secondary: new HttpUsageSink({ usageServiceClient: deps.usageServiceClient, source: deps.source }),
           logger: deps.logger,
         });
       case 'firestore':
       default:
         return new FirestoreUsageSink();
     }
   }
   ```

2.4. Export from `packages/llm-pricing/src/index.ts`. Add tests covering all three branches of the factory (including the default fallthrough for invalid values, which must log a warning and default to `firestore` to avoid accidental data loss).

2.5. `pnpm run verify:workspace:tracked -- llm-pricing` — green.

### Phase 3 — Wire `HttpUsageSink` into every consuming app

For each app in the "Apps that use provider clients" table above, the edit is:

(a) Add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to `REQUIRED_ENV` in `apps/<app>/src/index.ts`.
(b) In `apps/<app>/src/services.ts` (or the equivalent DI wiring):
   - Import `createUsageServiceClient` from `@intexuraos/internal-clients`.
   - Import `createUsageSinkFromEnv` from `@intexuraos/llm-pricing`.
   - Construct `usageServiceClient` once at service bootstrap:
     ```ts
     const usageServiceClient = createUsageServiceClient({
       baseUrl: process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL']!,
       internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN']!,
       logger,
     });
     ```
   - Construct a `usageSink` with `source: { service: '<app-name>', component: '<use-case-name>', client: '<provider>', environment: process.env['INTEXURAOS_ENVIRONMENT'] as any }`.
   - Pass `usageSink` into every `createClaudeClient`/`createGptClient`/`createGeminiClient`/`createPerplexityClient`/`createOpenRouterClient`/`createGeminiToolCallingClient` call via the new config field (see Phase 3.1 below).

3.1. **Add `usageSink?` to provider client configs that don't already have it.**
   - `packages/infra-claude/src/types.ts` — add `usageSink?: UsageSink` to `ClaudeConfig`.
   - `packages/infra-gpt/src/types.ts` — add `usageSink?: UsageSink` to `GptConfig`.
   - `packages/infra-perplexity/src/types.ts` — add `usageSink?: UsageSink` to `PerplexityConfig`.
   - `packages/infra-gemini/src/types.ts` — already has `usageSink?` (verified).
   - `packages/infra-openrouter/src/types.ts` — already has `usageSink?` (verified).
   - Plumb the new field through the factory function:
     ```ts
     const usageLogger = createUsageLogger({
       logger,
       ...(usageSink !== undefined && { sink: usageSink }),
     });
     ```
   - Test-first for each client that's gaining the new param: add a test like `client.test.ts:871` (openrouter's existing "passes custom usageSink to createUsageLogger" test) — verify the sink is threaded through.

3.2. Apps to update (concrete edits):

   **research-agent** (`apps/research-agent/src/services.ts` + all adapters in `src/infra/llm/`):
   - Construct one `usageServiceClient` in `services.ts`.
   - Construct one `usageSink` with `source: { service: 'research-agent', component: 'research', client: '<provider>', environment: ... }`.
   - Thread through all six adapters (`ClaudeAdapter`, `GeminiAdapter`, `GptAdapter`, `PerplexityAdapter`, `OpenRouterAdapter`, `InputValidationAdapter`, `ContextInferenceAdapter`) — set `client` per adapter.
   - Each adapter stores the sink in its constructor and passes it into `createXxxClient({ ..., usageSink })`.

   **user-service** (`apps/user-service/src/infra/llm/LlmValidatorImpl.ts`):
   - `LlmValidatorImpl` constructs client per-validation. Inject `usageSink` via its constructor from `initializeServices`.
   - Each `createXxxClient` call in the file (six validators × two methods = twelve sites) passes `usageSink`.

   **linear-agent** (`apps/linear-agent/src/services.ts:79`): single `createGeminiClient` call. Single edit.

   **hellscript-agent** (`apps/hellscript-agent/src/index.ts:38`): single `createGeminiClient` call. Construct `usageServiceClient` + `usageSink` inline in `index.ts` right before the `createGeminiClient`.

   **cron-agent** (`apps/cron-agent/src/index.ts`): same pattern.

   **image-service** (`apps/image-service/src/infra/llm/GptPromptAdapter.ts:36`, `GeminiPromptAdapter.ts:36`, `src/infra/image/OpenAIImageGenerator.ts:52`, `GoogleImageGenerator.ts:53`):
   - Add `usageSink` to the adapter constructors.
   - `initializeServices(pricingContext)` in `apps/image-service/src/serviceFactory.ts:15` already takes `pricingContext` — extend to take `usageSink` too.
   - `apps/image-service/src/index.ts:22` already has `INTEXURAOS_APP_SETTINGS_SERVICE_URL` in REQUIRED_ENV — add `INTEXURAOS_LLM_USAGE_SERVICE_URL` next to it.

   **commands-agent, todos-agent, data-insights-agent, calendar-agent, actions-agent, chat-agent, web-agent**:
   - These use `@intexuraos/llm-factory` as a wrapper. **Audit `llm-factory` in Phase 3.0 before touching these apps.** If `llm-factory.createLlmClient()` is the single funnel, modify it to accept (and thread through) a `usageSink` parameter. Then each app just passes its own sink into the factory once.
   - If `llm-factory` does NOT exist or does NOT funnel all calls, treat each app like `linear-agent` above.

3.3. Tests for each app's `services.ts` change:
   - Add a test that verifies the `usageSink` reaches the provider client factory. Pattern: `vi.mock('@intexuraos/llm-pricing', ...)` → spy on `createUsageLogger` → assert it was called with `{ sink: <expected> }`.
   - Existing tests in `apps/research-agent/src/__tests__/routes.test.ts` (and similar) use `FakePricingContext` — they should keep working because the new `usageSink` is an independent dependency.

3.4. **Do not enable `INTEXURAOS_USAGE_SINK_MODE=dual` yet.** The env var stays unset (defaults to `firestore`) for this phase. All the code is wired, but at runtime it still behaves exactly like today.

3.5. `pnpm run ci:tracked` — green.

### Phase 4 — Deploy dual-write to dev, verify both paths work

4.1. Deploy all touched apps to `dev.intexuraos.cloud` (PM2 reload).

4.2. Flip the env var for ONE app first (`research-agent`) to `INTEXURAOS_USAGE_SINK_MODE=dual`.
   - Update `apps/research-agent/src/index.ts` REQUIRED_ENV only if you want to make it required; otherwise leave as a runtime-opt-in.
   - PM2 restart research-agent.

4.3. Issue a known research request via the web UI. Verify:
   - `llm_usage_stats/<model>/...` got a new entry (Firestore Studio).
   - `llm_usage_events` got a new entry with matching `eventId`, `occurredAt`, `usage.inputTokens/outputTokens`, `cost.billedUsd`.
   - `llm_usage_daily_aggregates/<day>-<service>-<model>` got the increment.
   - Both sinks agree on token counts within exact equality (no floating point surprise; token counts are ints, cost is stored at 6-decimal precision in both paths after INT-1339).

4.4. Repeat for each app one at a time, waiting 1h between flips to watch logs. Roll back any app that starts erroring in `HttpUsageSink`. Watch for:
   - `llm-usage-service` 4xx responses (schema mismatch — the `HttpUsageSink` is building wrong payloads → fix).
   - `llm-usage-service` 5xx responses (downstream issue — NOT a reason to flip all apps).
   - Duplicate event warnings (dedupe is working — expected if you retry).

4.5. Once all apps are in `dual` mode, move to Phase 5.

### Phase 5 — Parity verification script

5.1. Create `scripts/verify-llm-usage-parity.ts`:
   - Accept `--from=YYYY-MM-DD --to=YYYY-MM-DD` args.
   - For each day in range:
     - Read `llm_usage_stats/{model}/by_call_type/{callType}/by_period/{day}` (sum across all models + call types).
     - Read `llm_usage_daily_aggregates/{day}-*` (sum).
     - Report: `{ day, firestoreTotal: { calls, inputTokens, outputTokens, costUsd }, httpTotal: { ... }, diffPct: { ... } }`.
   - Fail with exit code 1 if any `diffPct > 0.1%`.
   - Run both paths in parallel for efficiency.

5.2. Add to CI as a manual `pnpm run verify:usage-parity --from=<yesterday> --to=<yesterday>` command (not gating — operator-run).

5.3. Add a scheduled daily job (cron in `cron-agent` or manual operator run) that runs the script for "yesterday" and posts to a dev Slack channel on mismatch. This is the canary for the entire dual-write period.

5.4. Run it on day 1, day 3, day 7 of the dev dual-write period. Document the results in this plan's rollout notes. **Do not proceed to Phase 6 until 7 consecutive days show ≤0.1% mismatch.**

### Phase 6 — Flip default to HTTP-only (dev, then prod)

6.1. In dev: flip all apps to `INTEXURAOS_USAGE_SINK_MODE=http` one at a time, 1h apart, watching logs.

6.2. At this point `llm_usage_stats` is receiving zero writes from dev. Verify by watching the collection's write rate in Firestore Studio (should drop to 0 new docs per hour within 1h of the last flip).

6.3. Repeat the parity script one more time (dev → 24h of http-only data → still should match the events path because the events path was already authoritative during dual-write).

6.4. Repeat steps 6.1–6.3 in prod.

### Phase 7 — Remove `FirestoreUsageSink` and `llm_usage_stats` writes

Only do this AFTER Phase 6 is green in prod for 48h.

7.1. Delete `packages/llm-pricing/src/usageLogger.ts` lines 112–214 (`FirestoreUsageSink` class) and the `COLLECTION_NAME = 'llm_usage_stats'` constant.

7.2. Remove the `FirestoreUsageSink` export from `packages/llm-pricing/src/index.ts`.

7.3. Change `UsageLogger` constructor default: instead of `this.sink = deps.sink ?? new FirestoreUsageSink()`, make `sink` a **required** dep. Update the type:
   ```ts
   constructor(deps: { logger: Logger; sink: UsageSink }) { ... }
   ```
   Update `createUsageLogger` similarly.

7.4. Delete `DualWriteUsageSink` class and `createUsageSinkFromEnv`'s `'firestore'` and `'dual'` branches (or simplify the whole factory to just return `new HttpUsageSink(...)` directly — the env var `INTEXURAOS_USAGE_SINK_MODE` is retired).

7.5. Delete `packages/llm-pricing/src/__tests__/usageLogger.test.ts` lines that reference `FirestoreUsageSink`, `mockFirestore.collection('llm_usage_stats')` (lines 227, 504 at plan time).

7.6. Delete `packages/llm-pricing/src/usageLogger.test.ts` if it still exists (there are two test files at plan time — one in `src/` and one in `src/__tests__/` — audit and consolidate).

7.7. Verify no imports of `FirestoreUsageSink` remain:
   ```bash
   rg "FirestoreUsageSink" apps/ packages/
   ```
   Only `docs/` should match now.

7.8. Update docs: `docs/packages/llm-pricing/README.md` (lines 111, 130), `docs/packages/llm-pricing/agent.md` (lines 12, 31, 118) — replace `FirestoreUsageSink` references with `HttpUsageSink`.

7.9. Update `scripts/verify-llm-architecture.ts` — it currently references `UsageLogger`; make sure its expectations still pass.

7.10. `pnpm run ci:tracked` — green.

7.11. Commit the removal as a separate PR from Phase 3–6 so the rollback story is clean.

### Phase 8 — Handle `user_usage` per decision

**Only proceed after the `⚠ DECISION NEEDED` above is answered by the user.**

#### Phase 8a — if Option (b) (recommended) — webhook fanout

8a.1. **In `apps/llm-usage-service`:** add a new `QuotaFanoutPublisher` service wired into the container.
   - Port: `QuotaFanoutPublisher { publish(event: UsageEvent): Promise<void> }`.
   - HTTP implementation posts to `${INTEXURAOS_CODE_AGENT_URL}/internal/webhooks/quota-update` with `X-Internal-Auth` header.
   - Fan-out only if `event.source.service === 'code-agent' && event.owner.type === 'user'`.
   - On failure: log at `warn` with `eventId`, do NOT throw. The events collection is the source of truth — the cache may just be stale until the next event.

8a.2. Modify `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts`:
   ```ts
   export interface IngestUsageEventsDeps {
     logger: Logger;
     usageEventRepository: UsageEventRepository;
     usageAggregateRepository: UsageAggregateRepository;
     quotaFanoutPublisher: QuotaFanoutPublisher;  // NEW
   }
   ```
   After the existing `accepted++` at line 71, add a fanout call:
   ```ts
   await deps.quotaFanoutPublisher.publish(fullEvent);
   ```
   Test-first: add a test verifying the fanout is called only for matching events, and that publisher failures don't affect the ingest response (failing publish → still accepted++).

8a.3. Wire `quotaFanoutPublisher` into `apps/llm-usage-service/src/services.ts`.

8a.4. **In `apps/code-agent`:** create `apps/code-agent/src/routes/internal/quotaUpdateRoutes.ts` — register `POST /internal/webhooks/quota-update`.
   - Validate body with Fastify schema matching the contract above.
   - Use `logIncomingRequest()` (CLAUDE.md rule).
   - Call a new use case `applyQuotaUpdate(deps, params)` that lives in `apps/code-agent/src/domain/usecases/applyQuotaUpdate.ts`.
   - Test-first: use case test for (a) first-time event applied, (b) duplicate eventId returns `applied: false`, (c) day-window reset when `periodKeys.day` changes.

8a.5. Modify `apps/code-agent/src/infra/firestore/userUsageFirestoreRepository.ts`:
   - Remove `recordTaskStart(userId, estimatedCost)` cost-write logic entirely. Keep the function (it still increments `tasksThisHour`), but delete the `costToday`/`costThisMonth` writes — those come from the webhook now.
   - Remove `recordActualCost(userId, actualCost, estimatedCost)` entirely. `rateLimitService.recordTaskComplete` no longer calls it.
   - Add a new method `applyCostDelta(eventId, userId, costDeltaUsd, periodKeys)` that is called by the new use case and does the transaction described in the "Created" section above.
   - Update the `UserUsageRepository` port in `apps/code-agent/src/domain/ports/userUsageRepository.ts` to match.

8a.6. Update `apps/code-agent/src/domain/services/rateLimitService.ts`:
   - `recordTaskComplete(userId, actualCost?)` — drop the `actualCost` branch (`userUsageRepository.recordActualCost(...)`). The cost comes via webhook now. Keep the `decrementConcurrent`.
   - Update tests in `apps/code-agent/src/__tests__/domain/services/rateLimitService.test.ts`.

8a.7. Update all `mockServices.ts` / `helpers` test fakes that implement `UserUsageRepository` to reflect the new interface.

8a.8. **Audit: does `code-agent` actually read `costToday`/`costThisMonth` anywhere for rate limit enforcement?**
   - `rateLimitService.checkLimits` (lines 39–84) currently reads `concurrentTasks` and `tasksThisHour` — NOT `costToday` or `costThisMonth` (verified at plan time, they're only logged for debug).
   - Conclusion: removing the local write path does NOT break any enforcement. The webhook keeps them accurate for display/analytics purposes only.

8a.9. Update `ecosystem.config.cjs` — no change needed (env var already exists).

8a.10. Update `terraform/environments/dev/main.tf` — `llm-usage-service` needs outbound access to `code-agent`'s internal URL. This should already be covered by `common_service_env_vars`, verify `INTEXURAOS_CODE_AGENT_URL` is in the llm-usage-service Cloud Run env.

8a.11. Deploy, end-to-end test: submit a code task, wait for completion, verify `user_usage/{userId}.costToday` incremented by the right amount and `user_usage/{userId}/processed_events/{eventId}` sentinel exists.

#### Phase 8b — Replace `FirestoreUsageStatsRepository` with HTTP

This is needed regardless of Option (a)/(b)/(c) because `app-settings-service` still reads `llm_usage_stats` via `collectionGroup('by_user')` and after Phase 6 that collection has no writers.

8b.1. Test-first: create `apps/app-settings-service/src/__tests__/infra/httpUsageStatsRepository.test.ts`.
   - Test 1: `getUserCosts('user-123', 90)` calls `usageServiceClient.queryUsage` with the correct time range (now - 90 days → now), filters `{ ownerIds: ['user-123'] }`, groupBy `['day', 'model', 'operation']`.
   - Test 2: maps `UsageQueryResponse` → existing `AggregatedCosts` shape (`totalCostUsd`, `totalCalls`, `monthlyBreakdown`, `byModel`, `byCallType`).
   - Test 3: empty response maps to the empty shape (preserves the existing contract at `usageStatsRepository.ts:126`).
   - Test 4: usage service error → throws (matches existing behavior).

8b.2. Implement `apps/app-settings-service/src/infra/httpUsageStatsRepository.ts`:
   ```ts
   export class HttpUsageStatsRepository implements UsageStatsRepository {
     constructor(private readonly deps: { usageServiceClient: UsageServiceClient }) {}

     async getUserCosts(userId: string, days = 90): Promise<AggregatedCosts> {
       const to = new Date().toISOString();
       const from = new Date(Date.now() - days * 86400 * 1000).toISOString();
       const result = await this.deps.usageServiceClient.queryUsage({
         timeRange: { from, to },
         filters: { ownerIds: [userId] },
         groupBy: ['day', 'model', 'operation'],
       });
       if (!result.ok) throw new Error(`queryUsage failed: ${result.error.message}`);
       return reshapeToAggregatedCosts(result.value);
     }
   }
   ```

8b.3. Wire `HttpUsageStatsRepository` into `apps/app-settings-service/src/services.ts`. Construct `usageServiceClient` at startup.

8b.4. Add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to `apps/app-settings-service/src/index.ts` REQUIRED_ENV.

8b.5. Delete `apps/app-settings-service/src/infra/firestore/usageStatsRepository.ts` and its tests.

8b.6. Update `apps/app-settings-service/src/infra/firestore/index.ts` — drop the `FirestoreUsageStatsRepository` export.

8b.7. End-to-end test: hit `GET /public/usage/costs?days=30` as a logged-in user, verify the response shape matches what the web UI expects (spot-check `apps/web/src/` for the consumer).

### Phase 9 — Update `firestore-collections.json`

9.1. Remove the `llm_usage_stats` entry from `firestore-collections.json` (lines 69–72 at plan time).

9.2. Update `user_usage` entry: set `owner` to `code-agent` (if not already), add a `notes` field explaining it is a cache written by `code-agent` and the `llm-usage-service` quota-update webhook (the cache pattern is a documented exception to the one-writer rule).
   Example:
   ```json
   "user_usage": {
     "owner": "code-agent",
     "description": "Per-user rate limit counters and cost quota cache.",
     "notes": "Cost fields (costToday, costThisMonth) are populated by the llm-usage-service quota-update webhook; concurrentTasks and tasksThisHour are populated locally by rateLimitService."
   }
   ```

9.3. Run `pnpm run ci:tracked` — the firestore validation CI check should still pass.

### Phase 10 — Final audit pass

10.1. Run all five grep queries and confirm zero production hits:
   ```bash
   rg "FirestoreUsageSink|new FirestoreUsageSink" apps/ packages/src/
   rg "llm_usage_stats" apps/ packages/src/
   rg "firestore.*usage" apps/ packages/ -i | grep -v llm-usage-service | grep -v test
   rg "collection\(['\"]llm_usage_stats" apps/ packages/
   rg "\.set\(.*tokens" apps/ packages/ | grep -v test
   rg "\.update\(.*costUsd" apps/ packages/ | grep -v test
   ```

10.2. Run full CI: `pnpm run ci:tracked` — must be green end-to-end.

10.3. **MANUAL STEP (gated on explicit user approval):** delete the `llm_usage_stats` Firestore collection.
   - Use `gcloud firestore bulk-delete --collection-ids=llm_usage_stats --project=intexuraos-dev-pbuchman` first on dev, confirm UI still works, then on prod.
   - This is irreversible. Do it last, and only after the parity script has shown ≤0.1% mismatch for 7+ days AND Phase 6 has been live in prod for 7+ days.
   - Record the deletion in the Linear issue as a comment with timestamps.

## Test plan

### Unit tests (must pass in CI before any deploy)

- `packages/llm-pricing/src/__tests__/httpUsageSink.test.ts` — new file, see Phase 1.1 for the 8 test cases. 100% branch coverage.
- `packages/llm-pricing/src/__tests__/dualWriteUsageSink.test.ts` — new file, 3 test cases.
- `packages/llm-pricing/src/__tests__/usageSinkFactory.test.ts` — new file, 4 branches (`firestore`, `dual`, `http`, invalid-fallback).
- Provider client test updates:
  - `packages/infra-claude/src/__tests__/client.test.ts` — add test that `usageSink` is passed through to `createUsageLogger`.
  - `packages/infra-gpt/src/__tests__/client.test.ts` — same.
  - `packages/infra-perplexity/src/__tests__/client.test.ts` — same.
  - (gemini, openrouter already have this test pattern — verify it still passes.)
- `apps/app-settings-service/src/__tests__/infra/httpUsageStatsRepository.test.ts` — new file, 4 test cases plus shape reshape coverage.
- `apps/code-agent/src/__tests__/domain/usecases/applyQuotaUpdate.test.ts` — new file (Option b), 5 test cases: first-apply, duplicate dedupe, day reset, month reset, concurrent-safe transaction.
- `apps/code-agent/src/__tests__/routes/quotaUpdateRoutes.test.ts` — integration test: valid body → 200, missing auth → 401, invalid schema → 400, duplicate → 200 with `applied: false`.
- `apps/llm-usage-service/src/__tests__/domain/usecases/ingestUsageEvents.test.ts` — update to cover the new fanout publisher call.

### Integration tests

- Dev environment end-to-end: submit a research request, verify both `llm_usage_stats` (Phase 4 during dual-write) and `llm_usage_events` receive the data. After Phase 6, verify only `llm_usage_events`.
- Dev environment end-to-end: submit a code task, verify `user_usage` is updated by the webhook (Option b).

### Operator tests (manual, gated on rollout)

- **Daily parity check** — Phase 5 parity script running for 7 days in dev, 7 days in prod, before moving to Phase 7 and then deleting the collection.

### Coverage requirements

- 95% branch coverage on all new files (`httpUsageSink.ts`, `dualWriteUsageSink.ts`, `usageSinkFactory.ts`, `applyQuotaUpdate.ts`, `quotaUpdateRoutes.ts`, `httpUsageStatsRepository.ts`, `quotaFanoutPublisher.ts`).
- No new `v8 ignore` comments unless blocked by a documented test infrastructure limitation (see `.claude/reference/coverage-exemptions.md`).

## Rollout plan

This is the highest-risk track of the epic. Rollout is deliberately slow.

**Week 0 (code complete, Phase 1–3 merged):**
- All apps wired with the new sink factory. `INTEXURAOS_USAGE_SINK_MODE` unset everywhere → runtime behavior = today.
- Parity script exists and is runnable but idle (will show 100% Firestore vs 0% HTTP, expected).

**Week 1 (dev dual-write starts):**
- Day 1: flip `research-agent` in dev to `INTEXURAOS_USAGE_SINK_MODE=dual`. Watch logs for 2h.
- Day 2: flip `user-service`, `image-service`, `linear-agent`.
- Day 3: flip remaining apps (`hellscript-agent`, `cron-agent`, agents using `llm-factory`).
- Day 4: run parity script. Should be ≤0.1%.
- Day 5–7: run parity daily. Alert the user if mismatch >0.1%.

**Week 2 (prod dual-write):**
- Day 1: flip one prod app (lowest-traffic first — `hellscript-agent` or `cron-agent`). Watch for 24h.
- Day 2–3: flip remaining prod apps.
- Day 4–7: parity script daily.

**Week 3 (prod dual-write stabilization):**
- 7 consecutive days of ≤0.1% mismatch in prod before proceeding.
- Phase 8b (swap `app-settings-service` reader) lands at the end of this week — it's safe because both writers are populating their data stores.

**Week 4 (dev HTTP-only):**
- Flip all dev apps to `INTEXURAOS_USAGE_SINK_MODE=http`. `llm_usage_stats` in dev stops receiving writes.
- Monitor `llm-usage-service` error rate. Must stay <0.1%.

**Week 5 (prod HTTP-only):**
- Flip all prod apps to `http`.
- 48h soak.

**Week 6 (code removal):**
- Phase 7 PR: remove `FirestoreUsageSink`, flip `UsageLogger.sink` to required, delete the feature-flag env var.
- Phase 8a PR (if Option b): webhook fanout end-to-end.

**Week 7 (collection deletion — HUMAN-GATED):**
- Operator confirms parity history and approves deletion.
- Delete `llm_usage_stats` from dev. Verify `app-settings-service` dashboard still works (because Phase 8b already swapped the reader).
- Delete `llm_usage_stats` from prod.
- Update `firestore-collections.json`.

## Acceptance criteria

All of these must be true before marking INT-1342 as Done:

- [ ] `rg "FirestoreUsageSink" apps/ packages/src/` returns **0** matches (docs excluded).
- [ ] `rg "llm_usage_stats" apps/ packages/src/` returns **0** matches (docs excluded).
- [ ] `rg "new FirestoreUsageSink\|FirestoreUsageSink()" apps/ packages/src/` returns **0** matches.
- [ ] `UsageLogger` constructor no longer accepts an optional `sink` — it's required.
- [ ] All consuming apps boot with `INTEXURAOS_LLM_USAGE_SERVICE_URL` in their `REQUIRED_ENV`. `validateRequiredEnv` fails fast if missing.
- [ ] `apps/app-settings-service` uses `HttpUsageStatsRepository` (not `FirestoreUsageStatsRepository`). `FirestoreUsageStatsRepository` is deleted.
- [ ] (Option b) `POST /internal/webhooks/quota-update` exists on `code-agent`. `llm-usage-service.ingestUsageEvents` fans out to it for matching events.
- [ ] (Option b) `apps/code-agent/src/infra/firestore/userUsageFirestoreRepository.ts` no longer has `recordActualCost`. `recordTaskStart` no longer writes `costToday`/`costThisMonth`.
- [ ] `firestore-collections.json` has `llm_usage_stats` removed, `user_usage` updated with cache notes.
- [ ] Parity script showed ≤0.1% mismatch for 7+ consecutive days in prod before collection deletion.
- [ ] `llm_usage_stats` Firestore collection deleted in both dev and prod (manual step, logged in Linear).
- [ ] `pnpm run ci:tracked` passes at every commit in the PR chain. No `v8 ignore` entries added without documented justification in the coverage-exemptions reference.
- [ ] All existing tests that referenced `FirestoreUsageSink` / `mockFirestore.collection('llm_usage_stats')` are updated or deleted.
- [ ] Docs updated: `docs/packages/llm-pricing/README.md`, `docs/packages/llm-pricing/agent.md`, `docs/packages/llm-pricing/technical-debt.md`, `docs/services/app-settings-service/technical.md`.

## Risks and mitigations

| #   | Risk                                                                                                                                                                                             | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Data loss during migration** — some writes land in Firestore but not HTTP, or vice versa, during dual-write.                                                                                   | M          | H      | Parity script run daily during Phases 4–6. Alert >0.1% mismatch. Rollback is trivial because both paths stay alive during dual-write.                                                                                                                                                                                                                                                                                       |
| 2   | **`code-agent` rate limiting breaks** — the `user_usage` migration leaves an edge case where `costToday` stops updating and users can over-spend.                                                | M          | H      | Option (b) webhook design keeps the cache hot. `rateLimitService.checkLimits` does NOT read `costToday`/`costThisMonth` today (verified — they're only in the debug log), so correctness isn't at risk, only observability. Still: Phase 8 has dedicated integration tests.                                                                                                                                                 |
| 3   | **`llm-usage-service` becomes a single point of failure** — if it's down, dev environment loses usage tracking.                                                                                  | L          | M      | HTTP sink failures are logged but not propagated to the caller — LLM requests still succeed, usage is just unlogged. Events can be backfilled from `llm_api_logs` (still on Firestore) if the outage is recorded.                                                                                                                                                                                                           |
| 4   | **Audit coverage of 41+ call sites incomplete** — we miss a writer and it keeps writing to `llm_usage_stats` after deletion, causing runtime crashes.                                            | M          | H      | Phase 10 final audit with 5 grep queries. Staging the deletion after 7 days of HTTP-only operation means any missed writer will surface in logs (it'll try to write to a non-existent collection — Firestore accepts this silently, which is the actual danger). Mitigation: after Phase 6 in dev, manually delete `llm_usage_stats` in dev FIRST and watch for crashes in the subsequent 72h. If no crashes, prod is safe. |
| 5   | **Webhook fanout infinite loop** — llm-usage-service fires webhook → code-agent processes → (if code-agent itself is a provider client consumer) → triggers another usage event → infinite loop. | L          | H      | Code-agent does NOT use provider clients via `createUsageLogger` (verified: only imports `EmbeddingClient` and `TOOL_CALLING_PRICING` from `infra-gemini`). The fanout only fires for `source.service === 'code-agent'`, and code-agent itself doesn't produce those events. Defense-in-depth: rate-limit the fanout endpoint at 10 req/s per userId.                                                                       |
| 6   | **Event schema drift** — `HttpUsageSink` builds events with wrong types after an `UsageEventInput` type update in `internal-clients`.                                                            | M          | M      | `internal-clients` tests catch type mismatches at compile time (`tsc`). `HttpUsageSink` unit tests validate the shape at runtime. Phase 4 dev deploy catches real mismatches.                                                                                                                                                                                                                                               |
| 7   | **`INTEXURAOS_USAGE_SINK_MODE` accidentally misconfigured** — e.g., typo `htttp` → factory falls through to default.                                                                             | L          | M      | Factory logs a warning on unknown values; add a test for this branch. Also: rollout plan flips apps ONE AT A TIME so a bad flip is caught before spreading.                                                                                                                                                                                                                                                                 |
| 8   | **Cost delta in webhook is stale** — `llm-usage-service` retries a failed ingest and the second attempt fans out a duplicate update.                                                             | M          | M      | `POST /internal/webhooks/quota-update` is idempotent via `eventId` sentinel doc. Duplicate calls return `applied: false`.                                                                                                                                                                                                                                                                                                   |
| 9   | **Web UI for user costs breaks** — `app-settings-service` public endpoint response shape changes when swapping the reader.                                                                       | L          | H      | Phase 8b reshapes the HTTP response to match the existing `AggregatedCosts` contract EXACTLY. Test in phase 8b.7 verifies against the web consumer.                                                                                                                                                                                                                                                                         |
| 10  | **Firestore composite index missing** — `queryUsage({ ownerIds, services })` needs an index that wasn't created.                                                                                 | L          | M      | Pre-flight: verify the daily aggregate repo supports this query pattern. If not, add an index migration in `migrations/*.mjs` BEFORE Phase 8b (phase dependency).                                                                                                                                                                                                                                                           |

## Out of scope

- **`llm_api_logs`** — The audit trail (`packages/llm-audit`) stays on direct Firestore writes. It stores full prompts/responses, which `llm-usage-service` is not designed to hold. Consolidating audit is a separate concern, maybe a future Phase 3 of this epic.
- **User-facing migration notifications** — No user-visible change. The `app-settings-service` endpoint contract is preserved.
- **Historical backfill** — Existing `llm_usage_stats` data is NOT migrated into `llm_usage_events`. The parity script only checks overlap on new writes. Historical dashboards (>90 days) will show a discontinuity. If this is unacceptable, a one-shot migration script is a separate ticket (estimate: 1–2 days).
- **Orchestrator / worker events** — already handled by INT-1341. This track only touches app-side writers.
- **Pricing lookup** — `PricingContext` and `fetchAllPricing` are untouched. They still talk to `app-settings-service`. Unrelated.
- **Changing the public API of `app-settings-service`** — the only internal change is the data source, not the contract.
- **Deleting `user_usage` entirely** — Option (a) would do this, but we're defaulting to Option (b) which keeps the collection as a cache. Only revisit if Option (a) is approved.

---

## Appendix A — `UsageEventInput` construction from `UsageLogParams`

For the test suite in Phase 1.1, this is the exact mapping `HttpUsageSink.buildUsageEvent` must implement:

```ts
function buildUsageEvent(
  params: UsageLogParams,
  source: HttpUsageSinkDeps['source'],
): UsageEventInput {
  const now = new Date();
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    occurredAt: now.toISOString(),
    owner: params.userId !== ''
      ? { type: 'user', id: params.userId }
      : { type: 'system', id: source.service },
    source: {
      service: source.service,
      component: source.component,
      client: source.client,
      environment: source.environment,
    },
    request: {
      provider: params.provider,
      model: params.model,
      operation: mapCallTypeToOperation(params.callType),
      success: params.success,
      durationMs: 0,  // UsageLogger doesn't track this; Track 4 adds server-side timing
    },
    usage: {
      inputTokens: params.usage.inputTokens,
      outputTokens: params.usage.outputTokens,
      totalTokens: params.usage.inputTokens + params.usage.outputTokens,
      cacheReadTokens: 0,    // NormalizedUsage doesn't carry these
      cacheWriteTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      thinkingTokens: 0,
      webSearchCalls: params.usage.webSearchCalls ?? 0,
      groundingEnabled: false,
      imageCount: 0,
    },
    cost: {
      billedUsd: params.usage.costUsd,
      providerReportedUsd: null,
      calculatedUsd: null,
      pricingSource: 'external',  // pre-calculated client-side; INT-1339 may recompute server-side
    },
    correlation: {
      requestId: null,
      traceId: null,
      taskId: null,
      researchId: null,
      attempt: null,
      sessionId: null,
    },
    error: params.success
      ? null
      : { code: null, message: params.errorMessage ?? null },
  };
}

function mapCallTypeToOperation(callType: CallType): UsageEventRequest['operation'] {
  switch (callType) {
    case 'research': return 'research';
    case 'generate': return 'generate';
    case 'image_generation': return 'image_generation';
    case 'tool_calling': return 'tool_calling';
    case 'visualization_insights': return 'visualization_insights';
    case 'visualization_vegalite': return 'visualization_vegalite';
    /* v8 ignore next -- ts-type: exhaustive switch, all CallType variants above @preserve */
    default: return 'other';
  }
}
```

**Note:** `NormalizedUsage` does not currently carry `cacheReadTokens`, `cacheWriteTokens`, `cachedTokens`, `reasoningTokens`, `thinkingTokens`, or `groundingEnabled`. The `HttpUsageSink` zero-fills these. If that's unacceptable (we'd lose cache tracking parity with Firestore), the `UsageLogParams` interface must be extended first — flag this before Phase 1 starts. Verified at plan time: `FirestoreUsageSink` also doesn't track these fields today, so parity is preserved.

## Appendix B — Quick reference for grep queries

```bash
# Count usage logger call sites
rg "createUsageLogger\(" apps/ packages/ -n | wc -l          # expect: 6 provider factories + tests

# Find all FirestoreUsageSink references
rg "FirestoreUsageSink" apps/ packages/ -n                   # expect post-Phase 7: 0 production hits

# Find all llm_usage_stats collection references
rg "llm_usage_stats" apps/ packages/ firestore-collections.json -n  # expect post-Phase 9: 0 hits

# Find all user_usage collection references
rg "user_usage" apps/ packages/ -n                           # expect: only code-agent + firestore-collections.json

# Find any direct Firestore writes of token/cost fields
rg "\.set\(.*tokens\|\.update\(.*costUsd" apps/ packages/ -n  # expect post-Phase 7: only llm-usage-service

# Find HttpUsageSink usage (should grow as we wire it)
rg "HttpUsageSink" apps/ packages/ -n                        # expect: 1 (definition) + N (wirings)
```
