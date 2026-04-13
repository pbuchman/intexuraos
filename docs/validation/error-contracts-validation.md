# Error Contract Cross-Validation Report

**Generated:** 2026-02-19
**Scope:** Error handling patterns across 20 apps (19 services + web frontend)
**Method:** Static analysis of all `apps/*/src/**/*.ts` route files (excluding `__tests__`)

---

## Summary

| Metric                              | Count |
| ----------------------------------- | ----- |
| Total `reply.fail()` calls (source) | 599   |
| Total `reply.ok()` calls (source)   | 272   |
| Raw `reply.send()` calls (source)   | 17    |
| `@allow-raw-send` annotations       | 33    |
| Unannotated raw sends               | 0     |
| Official verifier result            | PASS  |

**Overall verdict:** Contract compliance is strong. All `reply.send()` calls are either annotated with `@allow-raw-send` or exempted by the verifier (empty sends / 204 No Content). No stack trace leaks detected.

---

## Error Code Registry

All error codes are defined in `packages/common-core/src/errors.ts` as the `ErrorCode` union type, with a deterministic HTTP status mapping via `ERROR_HTTP_STATUS`.

| Error Code               | HTTP Status | Semantic Meaning                                  | Total Uses |
| ------------------------ | ----------- | ------------------------------------------------- | ---------- |
| `INTERNAL_ERROR`         | 500         | Unexpected server-side failure                    | 155        |
| `NOT_FOUND`              | 404         | Resource does not exist                           | 103        |
| `UNAUTHORIZED`           | 401         | Missing or invalid authentication                 | 84         |
| `INVALID_REQUEST`        | 400         | Bad input from caller                             | 50         |
| `FORBIDDEN`              | 403         | Authenticated but not permitted                   | 46         |
| `DOWNSTREAM_ERROR`       | 502         | Third-party or internal service failure           | 46         |
| `CONFLICT`               | 409         | State conflict (duplicate, version mismatch)      | 17         |
| `MISCONFIGURED`          | 503         | Service is misconfigured (worker not ready)       | 15         |
| `RATE_LIMITED`           | 429         | Caller exceeding rate limits                      | 6          |
| `WORKER_NOT_CONFIGURED`  | 424         | Worker is not yet configured                      | 3          |
| `UNPROCESSABLE_ENTITY`   | 422         | Input structurally valid but semantically invalid | 3          |
| `LOCKED`                 | 423         | Resource is locked                                | 3          |
| `GONE`                   | 410         | Resource permanently deleted                      | 2          |
| `WORKER_UNHEALTHY`       | 400         | Worker health check failed                        | 1          |
| `WORKER_UNAVAILABLE`     | 502         | Worker unavailable temporarily                    | 1          |
| `RESEARCH_NOT_COMPLETED` | 400         | Research not in completed state                   | 1          |
| `PAGE_NOT_CONFIGURED`    | 400         | Notion page not configured                        | 1          |
| `NOT_OWNER`              | 403         | User does not own the resource                    | 1          |
| `NOTION_NOT_CONNECTED`   | 400         | Notion integration not set up                     | 1          |
| `NO_SYNTHESIS`           | 400         | No synthesis available                            | 1          |
| `INVALID_WORKER`         | 400         | Worker ID is not valid                            | 1          |
| `INVALID_STATUS`         | _(cast)_    | Non-standard — see Consistency Issues             | 1          |
| `ALREADY_EXPORTED`       | 409         | Research already exported to Notion               | 1          |

**Usage by service:**

| Service                      | `reply.fail()` calls | `reply.ok()` calls |
| ---------------------------- | -------------------- | ------------------ |
| code-agent                   | 98                   | 35                 |
| research-agent               | 86                   | 37                 |
| whatsapp-service             | 63                   | 23                 |
| user-service                 | 50                   | 22                 |
| linear-agent                 | 47                   | 29                 |
| todos-agent                  | 37                   | 17                 |
| bookmarks-agent              | 32                   | 17                 |
| actions-agent                | 31                   | 15                 |
| calendar-agent               | 22                   | 11                 |
| app-settings-service         | 13                   | 3                  |
| notes-agent                  | 12                   | 7                  |
| mobile-notifications-service | 11                   | 8                  |
| image-service                | 11                   | 3                  |
| notion-service               | 10                   | 8                  |
| commands-agent               | 10                   | 6                  |
| chat-agent                   | 4                    | 1                  |
| web-agent                    | 2                    | 5                  |
| api-docs-hub                 | 0                    | 0                  |
| web (frontend)               | 0                    | 0                  |

---

## Raw Send Analysis

**Result: No violations.** The official `verify:reply-send` script passes cleanly.

All 17 non-test `reply.send()` calls are annotated. Grouped by reason:

| Category                  | Services                                                   | Count | Reason                                                              |
| ------------------------- | ---------------------------------------------------------- | ----- | ------------------------------------------------------------------- |
| 204 No Content            | calendar-agent, mobile-notifications-service, linear-agent | 3     | HTTP spec — body not permitted                                      |
| External webhook callback | code-agent (webhookRoutes)                                 | 7     | Orchestrator expects `{ received: true }` contract                  |
| Binary/image proxy        | bookmarks-agent                                            | 6     | Buffer responses and legacy image format                            |
| WhatsApp Meta contract    | whatsapp-service (webhookRoutes)                           | 2     | Meta webhook requires custom format                                 |
| OAuth2 spec               | user-service (oauthRoutes)                                 | 11    | RFC 6749 mandates flat `{ error, error_description }`               |
| Domain error codes        | code-agent (codeRoutes, webhookRoutes)                     | 4     | Application-specific error payloads not supported by `reply.fail()` |

---

## Consistency Issues

### MEDIUM — `reply.status()` Pre-Set Before `reply.fail()` (calendar-agent)

**Files:** `apps/calendar-agent/src/routes/calendarRoutes.ts`, `apps/calendar-agent/src/routes/internalRoutes.ts`

calendar-agent uses a centralized error-mapping helper that calls `reply.status(N)` before `reply.fail(code, ...)`. Since `reply.fail()` internally calls `this.status(ERROR_HTTP_STATUS[code]).send()`, the pre-set is always overridden. The issue is the **`DOWNSTREAM_ERROR`** case:

```typescript
// calendarRoutes.ts:89-90
reply.status(500); // Sets 500
return await reply.fail('DOWNSTREAM_ERROR', error.message); // Overrides to 502
```

`DOWNSTREAM_ERROR` maps to **502 Bad Gateway**, not 500. The pre-set `status(500)` is misleading to readers even though Fastify will send 502. All other pre-sets happen to match their `ErrorCode` HTTP mappings (403→`FORBIDDEN`, 401→`UNAUTHORIZED`, 404→`NOT_FOUND`, 400→`INVALID_REQUEST`).

**Affected lines:** calendarRoutes.ts:89, 874, 928, 939, 1013; internalRoutes.ts:50, 317, 428

**Recommendation:** Remove the redundant `reply.status()` pre-sets in the centralized error helper. The status is fully determined by the `ErrorCode`.

---

### MEDIUM — `INVALID_STATUS` Used via `as ErrorCode` Cast (code-agent)

**File:** `apps/code-agent/src/routes/codeRoutes.ts:3573`

```typescript
return reply.fail('INVALID_STATUS' as ErrorCode, error.message);
```

`INVALID_STATUS` is **not in the `ErrorCode` union** (`packages/common-core/src/errors.ts`). The `as ErrorCode` cast bypasses TypeScript type safety. Because the code is under a `/* v8 ignore */` block, it doesn't affect coverage, but a caller receiving this response would get an undocumented error code.

This pattern exists in two places in codeRoutes.ts (lines 3570–3581 region), both within the same `v8 ignore` block.

**Note:** The research-agent correctly maps the same domain concept (`INVALID_STATUS` internal error type) to the standard `CONFLICT` error code (`researchRoutes.ts:1303-1306`). The code-agent should follow the same pattern.

**Recommendation:** Map `invalid_status` → `CONFLICT` or `INVALID_REQUEST` (as appropriate) rather than casting a non-existent code.

---

### LOW — `error.message` Passed Directly to `DOWNSTREAM_ERROR` (multiple services)

**Affected services:** calendar-agent, linear-agent, whatsapp-service, and others

Pattern:

```typescript
return await reply.fail('DOWNSTREAM_ERROR', error.message);
```

This propagates the downstream service's raw error message to the API caller. For `DOWNSTREAM_ERROR` (502), the message originates from third-party APIs (Google Calendar, Linear, WhatsApp Meta). These messages are generally informational and not security-sensitive (no tokens or PII observed in the error patterns), but they may:

- Expose internal service endpoint names or IDs
- Leak third-party rate limit details or quota messages
- Be confusing to end-callers who should only see that a downstream service failed

**Services with the most raw `error.message` propagation in DOWNSTREAM_ERROR:**

- `whatsapp-service`: 10+ instances (verificationRoutes, mappingRoutes, messageRoutes)
- `calendar-agent`: 8 instances (centralized handler)
- `linear-agent`: 4 instances (centralized handler)

**No stack traces detected** — all error objects use `.message` only, never `.stack`.

**Recommendation:** Consider standardizing `DOWNSTREAM_ERROR` messages to generic descriptions like `'Calendar service unavailable'` and logging the original error server-side only.

---

### LOW — `INTERNAL_ERROR` With `result.error.message` (todos-agent, notes-agent, research-agent)

These services pass domain layer error messages directly as the HTTP error message:

```typescript
return await reply.fail('INTERNAL_ERROR', result.error.message);
```

Domain error messages (e.g., from `Result` types) are typically clean human-readable strings crafted in use-cases, so this is lower risk than catching raw `Error` objects. However, consistency review shows this pattern is universal and no mitigation is needed beyond the existing logging approach.

---

### LOW — web-agent Inline Error Propagation via `reply.ok()`

**File:** `apps/web-agent/src/routes/internalRoutes.ts`

web-agent uses a partial-success pattern: failures are returned as `reply.ok({ result: { status: 'failed', error: { code, message } } })` rather than `reply.fail()`. This is intentional — the endpoint supports batch processing where individual URL failures don't constitute a 4xx/5xx response.

The messages embedded in these inline errors include:

- `contentResult.error.message` (from Crawl4AI client)
- `llmClientResult.error.message` (from user-service)
- `summaryResult.error.message` (from LLM summarizer)

These could potentially expose internal service messages to callers. However, the endpoint is internal-only (`/internal/page-summaries`), reducing exposure risk.

---

## Contract Compliance by Service

| Service                      | reply.ok | reply.fail | Raw sends | Annotated | Status                                             |
| ---------------------------- | -------- | ---------- | --------- | --------- | -------------------------------------------------- |
| actions-agent                | 15       | 31         | 0         | —         | PASS                                               |
| api-docs-hub                 | 0        | 0          | 0         | —         | PASS (health endpoint uses standard health format) |
| app-settings-service         | 3        | 13         | 0         | —         | PASS                                               |
| bookmarks-agent              | 17       | 32         | 6         | 6         | PASS                                               |
| calendar-agent               | 11       | 22         | 0         | —         | PASS (see consistency issue)                       |
| chat-agent                   | 1        | 4          | 0         | —         | PASS                                               |
| code-agent                   | 35       | 98         | 7         | 7+4       | PASS (see INVALID_STATUS issue)                    |
| commands-agent               | 6        | 10         | 0         | —         | PASS                                               |
| image-service                | 3        | 11         | 0         | —         | PASS                                               |
| linear-agent                 | 29       | 47         | 1         | 1         | PASS                                               |
| mobile-notifications-service | 8        | 11         | 1         | 1         | PASS                                               |
| notes-agent                  | 7        | 12         | 0         | —         | PASS                                               |
| notion-service               | 8        | 10         | 0         | —         | PASS                                               |
| research-agent               | 37       | 86         | 0         | —         | PASS                                               |
| todos-agent                  | 17       | 37         | 0         | —         | PASS                                               |
| user-service                 | 22       | 50         | 11        | 11        | PASS                                               |
| web-agent                    | 5        | 2          | 0         | —         | PASS                                               |
| whatsapp-service             | 23       | 63         | 2         | 2         | PASS                                               |

---

## Action Items

| ID    | Severity | Service                                        | Issue                                                                                                            | Action                                                                                          |
| ----- | -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| EC-01 | MEDIUM   | code-agent                                     | `INVALID_STATUS` cast bypasses `ErrorCode` type safety                                                           | Map `invalid_status` → `CONFLICT` in the error-mapping block (codeRoutes.ts ~3573)              |
| EC-02 | MEDIUM   | calendar-agent                                 | Redundant `reply.status(500)` before `reply.fail('DOWNSTREAM_ERROR')` misleads readers (actual sent status: 502) | Remove pre-set `status()` calls in centralized error handler; let `reply.fail()` own the status |
| EC-03 | LOW      | calendar-agent, linear-agent, whatsapp-service | Raw third-party error messages propagated via `DOWNSTREAM_ERROR`                                                 | Standardize with static messages; log originals server-side only                                |
| EC-04 | LOW      | web-agent                                      | Internal error messages embedded in partial-success `reply.ok()` responses                                       | Document as accepted design for internal-only batch endpoint                                    |

---

## Notes on Architecture

**Error code centralization:** All valid error codes are defined in a single source of truth (`packages/common-core/src/errors.ts`). The TypeScript type system prevents most misuse — the single exception found (`INVALID_STATUS as ErrorCode`) required explicit casting to bypass it.

**HTTP status determinism:** `ERROR_HTTP_STATUS` provides a 1:1 mapping from `ErrorCode` to HTTP status. This eliminates per-route status decisions and ensures all callers receive consistent HTTP codes for the same error types.

**Centralized error handlers:** calendar-agent and linear-agent use route-level error handler helpers (top of route file) to map domain errors to HTTP codes. This is a good pattern that reduces duplication but introduces the `reply.status()` redundancy noted above.

**Partial-success pattern (web-agent):** Using `reply.ok()` with an inline `status: 'failed'` field for batch endpoints is a valid deviation from `reply.fail()`. It is scoped to internal-only endpoints and is semantically correct (the request itself succeeded; individual items failed).
