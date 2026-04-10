# INT-1338 — Phase 2 Decision Log

**Status:** All 17 architectural and scoping decisions captured. This doc is the source of truth; the per-track plan docs (`INT-1339` through `INT-1343`) contain the step-by-step instructions but must be read **together with** this doc because several sections of those plans are now superseded by decisions here.

**Date captured:** 2026-04-10
**Parent epic:** INT-1338 — LLM Usage Service Phase 2
**Child tracks:** INT-1339 (pricing), INT-1340 (UI), INT-1341 (orchestrator), INT-1342 (Firestore migration), INT-1343 (pricing UI move)

---

## Part 1 — Scope correction (the big one)

**Original scope error:** The first draft of Track 2 hooked into `workers/orchestrator/src/services/turn-metrics-collector.ts` to parse Claude Code session JSONL files and emit per-call usage events. This tracked **worker-runtime** LLM usage (the Claude Code CLI executing a code task inside a container, making its own API calls) — which is **NOT** in scope.

**Correct scope:** Only track LLM usage from places in IntexuraOS that use the `LLMClient` interface directly (i.e. our own code making LLM calls, not user-facing worker execution).

### Verified LLM-client call sites in the orchestrator (only these are in scope for Track 2)

1. `workers/orchestrator/src/services/agent-compliance-validator.ts:297` — `createOpenRouterClient({... usageSink: new StructuredLogUsageSink({ logger }) })`. Used by `OrchestratorAgentComplianceValidator.validate()` to analyze PR session transcripts post-execution.
2. `workers/orchestrator/src/services/completion-verifier.ts:810` — `createLlmClient({... usageSink: new StructuredLogUsageSink({ logger }) })` (via `@intexuraos/llm-factory`). Two `.generate()` call sites (`:626` and `:746`) extract structured data from agent completion transcripts.

Both currently use `StructuredLogUsageSink` from `@intexuraos/llm-pricing` — log-only, zero Firestore writes, matches user's prior statement that orchestrator does not write to Firestore.

### Out of scope (explicit)

- Worker-runtime Claude Code / Codex LLM calls (JSONL-derived usage)
- `workers/orchestrator/src/services/turn-metrics-collector.ts` — stays untouched for this epic (continues to emit per-turn rollups to `code-agent/internal/turn-metrics` as it does today)
- `workers/orchestrator/src/services/orchestrator-audit-sink.ts` (audit file writer) — unrelated concern

---

## Part 2 — Decisions by track

### Track 2 (INT-1341) — Orchestrator → usage service (fully reframed)

**Architecture:** Orchestrator must **not** call `llm-usage-service` directly. Instead:

1. A new **`HttpWebhookUsageSink`** in `packages/llm-pricing` HMAC-signs usage events and POSTs them to `code-agent`.
2. A new route **`POST /internal/webhooks/usage-events`** on `code-agent` validates the HMAC (reusing the orchestrator HMAC secret it already has for turn-metrics) and forwards to `llm-usage-service`.
3. `code-agent` uses `X-Internal-Auth` to call `POST /internal/usage/events` on `llm-usage-service`.

**Rationale:** Code-agent is the single trust boundary between orchestrator and IntexuraOS internal APIs. Orchestrator never learns the internal auth token, keeps its HMAC-only auth model, and llm-usage-service keeps one auth model (X-Internal-Auth).

**Replacement sites:**
- `agent-compliance-validator.ts:297` — swap `StructuredLogUsageSink` for `HttpWebhookUsageSink`
- `completion-verifier.ts:810` — same

**New components:**
- `packages/llm-pricing/src/httpWebhookUsageSink.ts` — signs with HMAC, POSTs to code-agent (new sink)
- `apps/code-agent/src/routes/internalUsageWebhookRoute.ts` — receives HMAC webhook, forwards to llm-usage-service
- `apps/code-agent/src/domain/usecases/forwardUsageEvents.ts` — the forwarding logic with HTTP client

**Dropped from original Track 2 plan:**
- `UsagePublisher` class in orchestrator — not needed, sink injection is enough
- JSONL parsing in `turn-metrics-collector.ts` — out of scope
- `extractUsageEvents()`, `selectProvider()`, `deriveEventId()` utilities — not needed
- Feature flag `INTEXURAOS_USAGE_PUBLISHER_ENABLED` — not needed
- `session-jsonl-sample.jsonl` fixture — not needed
- Phase 1 JSONL verification step — not applicable

**Dependency changes:**
- Track 2 is no longer blocked by Track 4 (orchestrator already has pricing client-side, no server-side cost calc needed)
- Track 2 moves from Phase 2 to **Phase 1 parallel** (alongside Track 1 and Track 4)
- Track 3 still depends on Track 2 (reuses the new `HttpUsageSink` primitive)

**Note on `HttpUsageSink` primitives:**
- Track 2 ships **`HttpWebhookUsageSink`** (HMAC-signed, for orchestrator → code-agent)
- Track 2 **also** ships **`HttpInternalAuthUsageSink`** (X-Internal-Auth, for in-cluster apps → llm-usage-service directly) — this is what Track 3 reuses to replace `FirestoreUsageSink` across all provider client call sites

### Track 3 (INT-1342) — Firestore writers migration (scope expanded and simplified)

**Core work (unchanged):**
- Replace `FirestoreUsageSink` with `HttpInternalAuthUsageSink` (shipped by Track 2) across all provider client factories in `packages/infra-{claude,gpt,gemini,perplexity,openrouter}`
- Update `services.ts` in every consuming app
- Delete `FirestoreUsageSink` and `llm_usage_stats` collection writes

**Added to scope (significant):**

1. **Remove `user_usage` feature entirely.** The `code-agent` `user_usage` Firestore collection and quota cache are redundant. Cost-based quota enforcement has already been partially dismantled in git history:
   - `597c23adc fix(code-agent): remove monthly cost limit rate check`
   - `09a115605 Reorder sidebar menu items and remove daily cost limit`
   - Original implementation: `8def391d8 INT-367 Implement user rate limiting infrastructure`

   Track 3 finishes this cleanup by deleting `apps/code-agent/src/infra/firestore/userUsageFirestoreRepository.ts`, the `user_usage` collection registration, and any remaining cost-based rate-limiter reads. Keep `rateLimitService.checkLimits()`'s `concurrentTasks`/`tasksThisHour` enforcement — those are correctness-critical.

2. **Remove `packages/llm-audit` entirely.** The `LogAuditSink` → `llm_api_logs` feature is no longer needed (logger output is sufficient for prompt visibility). Track 3 deletes:
   - The whole `packages/llm-audit` package
   - The `auditSink` parameter from every `createXxxClient()` factory in `packages/infra-*`
   - Audit-sink construction in every app's `services.ts`
   - The `llm_api_logs` Firestore collection usage

3. **Delete `/settings/usage-costs` (`LlmCostsPage`) entirely.** Since it reads the legacy `llm_usage_stats` via `app-settings-service`, and we're deleting that collection, and Track 1's new LLM Usage UI can cover per-user cost views via filter+groupBy, the standalone page is redundant. Track 3 removes:
   - `apps/web/src/pages/LlmCostsPage.tsx`
   - `/settings/usage-costs` route in `apps/web/src/App.tsx`
   - Sidebar entry "Usage Costs" in `apps/web/src/components/Sidebar.tsx`
   - `getUsageCosts()` from `apps/web/src/services/settingsApi.ts`
   - `apps/app-settings-service/src/infra/firestore/usageStatsRepository.ts` (the reader)
   - The `/settings/usage-costs` route handler on `app-settings-service`
   - Related types (`AggregatedCosts`) from `apps/web/src/types/index.ts`

4. **Remove all `zai` references.** Zai is no longer a supported provider. Track 3 removes references from:
   - `apps/web/src/types/index.ts`
   - `apps/app-settings-service/src/routes/internalRoutes.ts`
   - `apps/app-settings-service/src/index.ts` (REQUIRED_ENV)
   - `apps/app-settings-service/src/__tests__/routes/publicRoutes.test.ts`
   - `apps/app-settings-service/src/__tests__/routes/internalRoutes.test.ts`
   - `apps/linear-agent/src/__tests__/fakes.ts`
   - `packages/llm-prompts/src/classification/intelligentPromptBuilder.ts`
   - `packages/llm-pricing/src/__tests__/testFixtures.test.ts`
   - `packages/llm-pricing/src/__tests__/pricingClient.test.ts`
   - `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`
   - `packages/llm-contract/src/__tests__/supportedModels.test.ts`
   - `packages/llm-contract/src/__tests__/fixtures/pricing.ts`
   - `LlmProviders` enum if present
   - Any `ZAI_*` env vars in terraform and ecosystem.config.cjs

**Dropped from original Track 3 plan:**
- User quota cache webhook fanout (`POST /internal/webhooks/quota-update`) — not needed since `user_usage` is being deleted entirely
- Dual-write / parity verification period — replaced by atomic delete+migrate approach per Track 4's aggressive deprecation philosophy

### Track 4 (INT-1339) — Pricing ownership (simplified)

**Dropped entirely:**
- Server-side cost calculation on event ingest — no track requires it (all existing and new callers compute cost client-side)
- `computeCost` flag in the ingest request
- Schema `anyOf` for mixed cost/no-cost batches
- Image-size handling in cost calc
- `calculateEventCost` use case
- Image-pricing 1024x1024 default

**Kept:**
- Move pricing ownership: `app-settings-service` → `llm-usage-service`
- New `PricingRepository` + `llm_pricing` Firestore collection
- `POST /internal/pricing` (write) with `X-Internal-Auth`
- Public `GET /llm-usage/pricing` with Auth0 bearer (for Track 5 UI — see path convention below)
- One-time migration `086_migrate_pricing_to_llm_usage_service.mjs` at repo root
- Redirect all `fetchAllPricing()` callers to new endpoint
- Delete old endpoint in same PR

**Deprecation strategy:** **Atomic delete in the same PR.** No 307 → 410 window. Single PR:
1. Adds new endpoints on llm-usage-service
2. Migrates pricing data via the migration script
3. Updates all 11 consumer apps' `fetchAllPricing()` callers (in-place rename, not a new symbol)
4. Deletes the old `GET /internal/settings/pricing` route on `app-settings-service`

No feature flag, no special deploy safeguards. Ship it during a low-traffic window with standard rollback readiness.

**Pricing providers:** 5 providers total (drop zai):
- `google`, `openai`, `anthropic`, `perplexity` — calculated cost from pricing table
- `openrouter` — **cost comes from provider API response** (`cost.pricingSource = 'provider_reported'`), not from pricing table. Pricing table entries for openrouter may be informational only or absent. Verify during Track 4 implementation.

**Per-provider endpoint:** Not added. Bulk `GET /llm-usage/pricing` only.

### Track 1 (INT-1340) — Web UI (minor updates)

**Confirmed decisions:**
- `.count()` aggregation included by default on list endpoint
- **All filter+sort combinations needed in composite indexes.** During plan execution, consult Firestore composite index documentation via context7 MCP to determine the minimal-correct set (Firestore only requires composite indexes for queries combining equality filters on one field with range/sort on a different field — not literal full permutations). Document the chosen index set explicitly in the migration file. Existing `llm_usage_events` collection already has some indexes from Phase 1 — coordinate carefully to avoid conflicts.
- Track 1's existing `docs/plans/INT-1340-track-1-llm-usage-web-ui.md` remains the source for step-by-step work **except** for path naming and auth model changes below.

**Path convention change:** Per web-app pattern (domain-prefixed paths, service baseURL from `config.{service}ServiceUrl`), all new public routes on llm-usage-service use the `/llm-usage/*` prefix:
- `POST /llm-usage/events/list` (paginated raw events) — formerly planned as `POST /internal/usage/events/list`
- `GET /llm-usage/events/:eventId` — formerly planned as `GET /internal/usage/events/:eventId`
- `POST /llm-usage/query` (aggregate query) — replaces both the internal version and the new public version; there is NO internal query endpoint anymore
- `GET /llm-usage/pricing` — added by Track 4

All public routes use Auth0 bearer auth validated by the same middleware other user-facing services use. Drop the internal query endpoint (`POST /internal/usage/query`) entirely — only the UI reads usage data, and the read path is public.

**Web API service update:** `apps/web/src/services/llmUsageApi.ts` follows the existing `apiRequest(baseUrl, path, accessToken)` pattern with `config.llmUsageServiceUrl`. Add that config key in the web app's config module.

### Track 5 (INT-1343) — Pricing UI move (minor updates)

**Confirmed decisions:**
- New path: `/#/llm-usage/pricing`
- Old URL `/#/settings/llm-pricing`: **remove outright, no redirect shim.** Aligns with atomic deprecation philosophy.
- Track 5 data source: new public `GET /llm-usage/pricing` on llm-usage-service (delivered by Track 4)
- Drop 4 of the 4 open decisions from Track 5:
  1. Old URL handling — decided (404)
  2. Public endpoint ownership — decided (Track 4 owns it)
  3. New endpoint path — decided (`/llm-usage/pricing`)
  4. Response shape for zai/openrouter — decided (drop zai entirely; openrouter stays, cost comes from provider response)

**`LlmCostsPage` deletion moves to Track 3** (since it requires backend reader cleanup to complete meaningfully).

---

## Part 3 — Revised dependency graph

```
Phase 1 (parallel — start immediately)
├── INT-1340 (Track 1) — Web UI + new public routes
├── INT-1341 (Track 2) — Orchestrator sinks + code-agent webhook + HttpUsageSink primitives
└── INT-1339 (Track 4) — Pricing ownership move + public pricing endpoint

Phase 2 (after Track 2)
└── INT-1342 (Track 3) — Firestore migration + user_usage removal + llm-audit removal
                          + LlmCostsPage deletion + zai cleanup

Phase 3 (after Track 1 + Track 4)
└── INT-1343 (Track 5) — Pricing UI move
```

**Critical change:** 3 tracks are now parallelizable in Phase 1 (previously 2). Track 2 no longer blocks on Track 4.

---

## Part 4 — Updated llm-usage-service route surface (final)

### Internal routes (X-Internal-Auth)
- `POST /internal/usage/events` — ingest events (from code-agent, and from other backend services via `HttpInternalAuthUsageSink`)
- `POST /internal/pricing` — write pricing (for the migration script and future admin operations)

### Public routes (Auth0 bearer)
- `POST /llm-usage/events/list` — paginated raw event list with `.count()` total (Track 1)
- `GET /llm-usage/events/:eventId` — single raw event detail (Track 1)
- `POST /llm-usage/query` — aggregate query with groupBy (Track 1, replaces internal version)
- `GET /llm-usage/pricing` — full pricing table (Track 4)

### Removed (compared to Phase 1 surface)
- `POST /internal/webhooks/usage-events` — removed; orchestrator routes via code-agent instead
- `POST /internal/usage/query` — removed; only public query endpoint exists now

---

## Part 5 — Decisions locked (summary table)

| #   | Decision                                                  | Choice                                                                |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Orchestrator → usage service path                         | Via code-agent webhook (HMAC) → code-agent forwards (X-Internal-Auth) |
| 2   | Server-side cost calculation                              | Dropped entirely                                                      |
| 3   | Web read auth pattern                                     | Public routes on llm-usage-service with Auth0 bearer                  |
| 4   | Track 3 scope for `user_usage`                            | Remove feature entirely, no migration                                 |
| 5   | `app-settings-service` FirestoreUsageStatsRepository fate | Delete the whole `/settings/usage-costs` page + backend               |
| 6   | `packages/llm-audit` fate                                 | Remove package entirely                                               |
| 7   | Per-provider pricing endpoint                             | Not added (bulk only)                                                 |
| 8   | Track 4 deprecation timeline                              | Atomic delete in same PR (no 307/410 window)                          |
| 9   | Track 1 list endpoint total count                         | Include `.count()` by default                                         |
| 10  | Track 1 composite index strategy                          | All combinations (research Firestore docs before migration)           |
| 11  | Track 5 old URL                                           | Remove outright, 404                                                  |
| 12  | Track 5 new path                                          | `/#/llm-usage/pricing`                                                |
| 13  | Code-agent webhook path                                   | `POST /internal/webhooks/usage-events`                                |
| 14  | Internal query endpoint fate                              | Removed; public `POST /llm-usage/query` only                          |
| 15  | Pricing response shape                                    | 5 providers (drop zai, keep openrouter)                               |
| 16  | Track 4 deploy safety                                     | None — ship it                                                        |
| 17  | Path convention for public routes                         | `/llm-usage/*` prefix (domain-based, matches web app pattern)         |

---

## Part 6 — What each original plan doc STILL uses vs what's superseded

| Plan doc                                           | Status                   | Use for                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INT-1339-track-4-pricing-ownership.md`            | **Partially superseded** | File structure, repository code, migration script skeleton. **Skip:** server-side cost calc sections (phases for `calculateEventCost`, `computeCost` flag, schema `anyOf`). **Update during execution:** endpoint path naming (use `/llm-usage/pricing` for public read), deprecation strategy (atomic not gradual). |
| `INT-1340-track-1-llm-usage-web-ui.md`             | **Mostly valid**         | Frontend component skeletons, hook patterns, pagination cursor design, Tailwind examples. **Update during execution:** backend route paths use `/llm-usage/*` prefix not `/internal/usage/*`; add `.count()` aggregation; research composite index requirements more rigorously.                                     |
| `INT-1341-track-2-orchestrator-usage-publisher.md` | **Fully superseded**     | Do not use. The entire plan was written for the wrong scope (JSONL parsing). Rewrite from scratch using Part 2 of this doc as the spec.                                                                                                                                                                              |
| `INT-1342-track-3-firestore-migration.md`          | **Partially superseded** | Use for: `HttpUsageSink` design (just rename `HttpInternalAuthUsageSink`), the provider client audit, env var wiring pattern. **Skip:** user_usage decision matrix (decided — remove), webhook fanout, dual-write/parity period. **Add:** user_usage removal, llm-audit removal, LlmCostsPage deletion, zai cleanup. |
| `INT-1343-track-5-move-pricing-ui.md`              | **Mostly valid**         | File rename, swap imports, sidebar updates. **Skip:** the 4 DECISION NEEDED markers (all resolved). **Update during execution:** old URL handling (hard 404, no shim); path naming already matches decision.                                                                                                         |

---

## Part 7 — Action items before Phase 1 starts

1. **Rewrite Track 2 plan doc** (`INT-1341-...md`) from scratch using Part 2 of this document as the specification. This is the only full-rewrite required.
2. **Research Firestore composite index rules** via context7 MCP and produce the minimal-correct index list for Track 1 before writing the migration.
3. **Verify the orchestrator already has code-agent's URL and HMAC secret** (it does, based on `webhook-client.ts` usage). Just wire a new target URL for usage webhooks.
4. **Confirm code-agent has `INTEXURAOS_INTERNAL_AUTH_TOKEN`** — it should since it's a core service, but verify during Track 2 plan rewrite.
5. **Create new web app config key** `llmUsageServiceUrl` in `apps/web/src/config/index.ts` with dev/prod URLs.
6. **Audit one more time** for any stragglers: grep for `FirestoreUsageSink`, `llm_usage_stats`, `llm_api_logs`, `user_usage`, `zai`, `ZAI`, `UsageLogger` to make sure the inventories in Tracks 2/3 are complete before coding.
