# App Settings Service - Technical Debt

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| TODO/FIXME  | 0     | -        |
| Code Smells | 2     | Low      |

## Active Issues

### 1. Hardcoded Firestore collection paths

**Location:** `apps/app-settings-service/src/infra/firestore/index.ts:23`, `usageStatsRepository.ts:67`

**Issue:** Collection paths are hardcoded strings rather than environment variables:
- Pricing: `'settings/llm_pricing/providers'`
- Usage stats: collection group `'by_user'` with implied root `llm_usage_stats`

**Impact:** Cannot be overridden for multi-tenant or staging environments without code changes.

**Resolution path:** Add optional env vars `INTEXURAOS_PRICING_COLLECTION` and `INTEXURAOS_USAGE_STATS_COLLECTION` with hardcoded values as defaults.

---

### 2. Duplicated parallel-provider-fetch logic

**Location:** `publicRoutes.ts:77-135`, `internalRoutes.ts:73-110`, `index.ts:38-89`

**Issue:** The pattern of fetching all 5 providers in parallel and checking each for null is repeated verbatim in three places (public route, internal route, startup validator).

**Impact:** A new provider requires changes in 3 locations.

**Resolution path:** Extract a `fetchAllProviderPricing(repo)` utility that returns `{ google, openai, anthropic, perplexity, zai }` or throws/returns error list.

---

## Future Plans

1. **Budget management** - User-defined spending limits
2. **Cost alerts** - Notifications on threshold
3. **Forecasting** - Predict future costs
4. **Admin API** - Pricing configuration endpoint
5. **Daily breakdown** - Per-day aggregation in usage costs response

## Resolved Issues

1. **Response contract violations** - Internal route migrated from raw `reply.send()` / manual status codes to standardized `reply.ok()` / `reply.fail()` contract (resolved 2026-02-01)
2. **Direct pino() usage** - `FirestoreUsageStatsRepository` replaced with `createAppLogger()` from `@intexuraos/infra-sentry` so errors are automatically forwarded to Sentry (resolved 2026-02-01)
3. **Inconsistent internal error format** - Internal pricing endpoint now returns `{ success: false, error: { code, message } }` instead of `{ error: string }` (resolved 2026-02-01)
4. **100% branch coverage** - Added v8 ignore exemptions for TypeScript-only safety branches; strict enforcement enabled (resolved 2026-02-02)
