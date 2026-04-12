# App Settings Service — Technical Debt

**Last Updated:** 2026-04-07
**Analysis Run:** [2026-04-07 entry](#)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Low-Med  |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **2** | —        |

---

## Future Plans

1. **Budget management** — User-defined spending limits with notification thresholds
2. **Cost alerts** — Push notifications when spending reaches a configurable percentage of budget
3. **Cost forecasting** — Predict future costs based on historical usage patterns
4. **Admin API** — Pricing configuration endpoint to manage pricing without direct Firestore migrations
5. **Daily breakdown** — Per-day aggregation in usage costs response for finer-grained analytics

---

## Code Smells

### Medium Priority

| File                                               | Issue                                       | Impact                                                |
| -------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `publicRoutes.ts`, `internalRoutes.ts`, `index.ts` | Duplicated parallel-provider-fetch logic    | Adding a new provider requires changes in 3 locations |

**Details:** The pattern of fetching all 4 providers in parallel (`Promise.all([getByProvider(Google), getByProvider(OpenAI), ...])`) and checking each for null is repeated verbatim in three places: the public pricing route, the internal pricing route, and the startup validator.

**Resolution path:** Extract a `fetchAllProviderPricing(repo: PricingRepository)` utility function that returns `{ google, openai, anthropic, perplexity }` or throws with a list of missing providers.

---

### Low Priority

| File                          | Issue                               | Impact                                                          |
| ----------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| `infra/firestore/index.ts:23` | Hardcoded Firestore collection path | Cannot override for multi-tenant or staging without code change |

**Details:** Collection path is a hardcoded string (`'settings/llm_pricing/providers'`).

**Resolution path:** Add optional env var `INTEXURAOS_PRICING_COLLECTION` with the hardcoded value as default.

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

| File        | Issue                                                                   | Suggestion                               |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| `server.ts` | Handles server setup, OpenAPI config, schema registration, health check | Extract OpenAPI schemas to separate file |

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
| 2026-03-24 | v8 ignore comment wording non-standard | Updated to stricter blocker-keyword format (`noUncheckedIndexedAccess guard`)                                       |
| 2026-02-02 | 100% branch coverage not enforced      | Added v8 ignore exemptions for TypeScript-only safety branches; strict enforcement enabled                          |
| 2026-02-01 | Response contract violations           | Internal route migrated from raw `reply.send()` to standardized `reply.ok()` / `reply.fail()`                       |
| 2026-02-01 | Direct `pino()` usage                  | `FirestoreUsageStatsRepository` replaced with `createAppLogger()` from `@intexuraos/infra-sentry`                   |
| 2026-02-01 | Inconsistent internal error format     | Internal pricing endpoint now returns `{ success: false, error: { code, message } }` instead of `{ error: string }` |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
