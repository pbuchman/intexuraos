# App Settings Service -- Technical Debt

**Last Updated:** 2026-02-22
**Analysis Run:** [2026-02-22 entry](#)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 3     | Low-Med  |
| Test Gaps   | 0     | --       |
| Type Issues | 0     | --       |
| TODOs       | 0     | --       |
| **Total**   | **3** | --       |

---

## Future Plans

1. **Budget management** -- User-defined spending limits with notification thresholds
2. **Cost alerts** -- Push notifications when spending reaches a configurable percentage of budget
3. **Cost forecasting** -- Predict future costs based on historical usage patterns
4. **Admin API** -- Pricing configuration endpoint to manage pricing without direct Firestore migrations
5. **Daily breakdown** -- Per-day aggregation in usage costs response for finer-grained analytics

---

## Code Smells

### Medium Priority

| File                                               | Issue                                       | Impact                                                |
| -------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `publicRoutes.ts`, `internalRoutes.ts`, `index.ts` | Duplicated parallel-provider-fetch logic    | Adding a new provider requires changes in 3 locations |

**Details:** The pattern of fetching all 5 providers in parallel (`Promise.all([getByProvider(Google), getByProvider(OpenAI), ...])`) and checking each for null is repeated verbatim in three places: the public pricing route (lines 77-135), the internal pricing route (lines 73-110), and the startup validator (lines 38-89).

**Resolution path:** Extract a `fetchAllProviderPricing(repo: PricingRepository)` utility function that returns `{ google, openai, anthropic, perplexity, zai }` or throws with a list of missing providers.

---

### Low Priority

| File                                         | Issue                                       | Impact                                                          |
| -------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| `infra/firestore/index.ts:23`                | Hardcoded Firestore collection path         | Cannot override for multi-tenant or staging without code change |
| `infra/firestore/usageStatsRepository.ts:67` | Hardcoded collection group name (`by_user`) | Same as above                                                   |

**Details:** Collection paths are hardcoded strings (`'settings/llm_pricing/providers'` and `'by_user'` collection group with implied root `llm_usage_stats`).

**Resolution path:** Add optional env vars `INTEXURAOS_PRICING_COLLECTION` and `INTEXURAOS_USAGE_STATS_COLLECTION` with hardcoded values as defaults.

---

| File                                         | Issue                                                  | Impact                                                              |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `infra/firestore/usageStatsRepository.ts:67` | Collection group query fetches all history client-side | Firestore reads scale with total user history, not requested window |

**Details:** `getUserCosts()` queries `collectionGroup('by_user').where('userId', '==', userId)` without a date filter at the Firestore query level. The `days` cutoff is applied client-side after fetching all documents:

```typescript
if (period < cutoffDate) continue; // client-side filter
```

A user with 2 years of history pays full Firestore read cost even for a `?days=7` query.

**Resolution path:** Add a `createdAt` timestamp field to usage docs, then push the date filter into the Firestore query: `.where('createdAt', '>=', cutoffTimestamp)`. Requires a migration to backfill `createdAt` on existing docs.

---

## Test Coverage Gaps

No gaps. All source files have 100% branch coverage with v8 ignore exemptions for TypeScript-only safety branches.

---

## TypeScript Issues

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found.

---

## TODOs / FIXMEs

No TODO, FIXME, or HACK comments found in source code.

---

## SRP Violations

| File        | Lines | Issue                                                                   | Suggestion                               |
| ----------- | ----- | ----------------------------------------------------------------------- | ---------------------------------------- |
| `server.ts` | 407   | Handles server setup, OpenAPI config, schema registration, health check | Extract OpenAPI schemas to separate file |

---

## Code Duplicates

| Pattern                                           | Locations                                                | Suggestion                                            |
| ------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| Parallel provider fetch + null check per provider | `publicRoutes.ts`, `internalRoutes.ts`, `index.ts`       | Extract `fetchAllProviderPricing()` utility function  |

---

## Deprecations

None.

---

## Resolved Issues

| Date       | Issue                                  | Resolution                                                                                                          |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2026-02-02 | 100% branch coverage not enforced      | Added v8 ignore exemptions for TypeScript-only safety branches; strict enforcement enabled                          |
| 2026-02-01 | Response contract violations           | Internal route migrated from raw `reply.send()` to standardized `reply.ok()` / `reply.fail()`                       |
| 2026-02-01 | Direct `pino()` usage                  | `FirestoreUsageStatsRepository` replaced with `createAppLogger()` from `@intexuraos/infra-sentry`                   |
| 2026-02-01 | Inconsistent internal error format     | Internal pricing endpoint now returns `{ success: false, error: { code, message } }` instead of `{ error: string }` |

---

## Related

- [Features](features.md) -- User-facing documentation
- [Technical](technical.md) -- Developer reference
- [Documentation Run Log](../../documentation-runs.md)
