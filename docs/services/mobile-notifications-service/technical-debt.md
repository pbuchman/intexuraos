# Mobile Notifications Service — Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** [2026-04-22 v3.6.0 documentation refresh](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 1     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **1** | —        |

---

## Future Plans

1. **Firestore-backed digest subscriptions** — Replace the hard-coded `DIGEST_SUBSCRIPTIONS` array in `digestSubscriptions.ts` with a `notification_digest_subscriptions` Firestore collection and self-service subscription management endpoints (see INT-1382 code comment)
2. **Push provider integration** — Direct FCM/APNs integration to push notifications back to devices (currently only stores for polling/internal queries)
3. **iOS support** — Expand beyond Android/Tasker to iOS Shortcuts or native companion app
4. **Rich notifications** — Support images, action buttons, and sound customization in webhook payloads
5. **Batch operations** — Bulk notification management (bulk delete, bulk mark-as-read)
6. **Notification categories** — AI-powered automatic categorization of notifications by type (chat, alert, transaction, etc.)
7. **Configurable digest timezone** — Currently hard-coded to `Europe/Warsaw` (CET/CEST); support per-user timezone selection

---

## Code Smells

### High Priority

_None identified._

### Medium Priority

| File                         | Issue                                                                                                    | Impact                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/routes/digestRoutes.ts` | Single route file handles all digest endpoints (internal cron, internal run, user-facing CRUD, backfill) | Approaching SRP threshold; will become harder to navigate as digest features grow |

### Low Priority

_None identified._

---

## Test Coverage Gaps

_None identified. All branches covered or properly exempted with v8 ignore annotations._

---

## TypeScript Issues

_None identified. No `any` types, `@ts-ignore`, or `@ts-expect-error` found in source files._

---

## TODOs / FIXMEs

_None found in codebase._

---

## SRP Violations

_None exceeding threshold currently, but `digestRoutes.ts` is the largest route file and should be monitored._

---

## Code Duplicates

_None identified._

---

## Deprecations

_None identified._

---

## Resolved Issues

| Date       | Issue                                                        | Resolution                                                                                    |
| ---------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 2026-04-22 | 5-batch cap in title filter caused incomplete results        | Removed cap; title filter now iterates all matching batches (INT-1398)                        |
| 2026-04-22 | Digest timestamp filter used milliseconds instead of seconds | Fixed to use seconds for postTimeSec field (INT-1412)                                         |
| 2026-04-22 | Missing daily digest summaries from cron                     | Fixed run-yesterday endpoint dispatching (INT-1420)                                           |
| 2026-04-22 | Digest LLM usage not reported                                | Restored HttpInternalAuthUsageSink with brand (INT-1421)                                      |
| 2026-03-24 | v8 ignore explanations lacked blockers                       | Updated annotations with correct blocker keywords as part of platform-wide enforcement pass   |
| 2026-03-11 | v8 ignore blocks in repositories/routes                      | Replaced with real tests for Firestore error paths; reduced to 10 directives across 4 files   |
| 2026-02-01 | Response contract violations                                 | All routes migrated to standardized `reply.ok()` / `reply.fail()` contract                    |
| 2026-02-01 | Direct pino() usage                                          | Replaced with `createAppLogger()` from `@intexuraos/infra-sentry`                             |
| 2026-02-01 | Inconsistent internal error format                           | Internal routes now return `{ success, error: { code, message } }`                            |
| 2026-02-02 | 100% branch coverage not enforced                            | Added v8 ignore exemptions for TypeScript-only safety branches; strict enforcement now active |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
