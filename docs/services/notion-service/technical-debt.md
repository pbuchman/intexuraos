# Notion Service -- Technical Debt

**Last Updated:** 2026-02-22
**Analysis Run:** [2026-02-22 entry](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| Code Smells         | 1     | Low      |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| TODO/FIXME Comments | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| **Total**           | **1** | Low      |

---

## Future Plans

1. **Multiple workspaces** -- Support connecting multiple Notion workspaces per user (currently limited to one; reconnecting replaces the existing connection)
2. **Webhook event processing** -- Replace the stub at `POST /notion-webhooks` with real event handling for sync triggers, cache invalidation, or page change notifications
3. **Scoped page access** -- Granular database/page permissions beyond the current all-or-nothing integration token approach
4. **Sync status tracking** -- Detailed progress reporting for operations that read from or write to Notion (e.g., research export progress)

---

## Code Smells

### Low Priority

| File                                 | Issue          | Impact                                              |
| ------------------------------------ | -------------- | --------------------------------------------------- |
| `src/routes/webhookRoutes.ts`        | Webhook stub   | Accepts any JSON, logs it, performs no side effects |

**Detail:** The `POST /notion-webhooks` endpoint accepts any JSON payload via `z.record(z.unknown())`, logs it for debugging, and returns `{ received: true }`. This is intentionally a stub awaiting future webhook processing implementation. It has no security impact since it produces no side effects, but represents an incomplete feature.

---

## Test Coverage Gaps

None. The service achieves 100% branch coverage with appropriate v8 ignore annotations for:

- TypeScript type guards on Firestore document types (3 annotations in `notionConnectionRepository.ts`)
- Integration route error mapping switch cases (6 annotations in `integrationRoutes.ts`)
- Internal route Firestore error paths (4 annotations in `internalRoutes.ts`)
- Test infrastructure import boundaries (2 annotations in `integrationRoutes.ts`)

All annotations use valid categories (`test-infra`, `ts-type`) per project standards.

---

## TypeScript Issues

None. No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found in source code.

---

## TODO/FIXME Comments

None found in `apps/notion-service/src/`.

---

## SRP Violations

No files exceed the 300-line SRP guideline in a concerning way. The largest file is `server.ts` at 374 lines, which is acceptable because it handles OpenAPI schema definitions, Fastify configuration, and health check setup -- all standard server bootstrap responsibilities.

---

## Code Duplicates

No significant duplication patterns detected. The service is small and focused.

---

## Recent Improvements

### v3.1.0 Release (2026-02-22)

Package version bump to v3.1.0.

### v3.0.0 Release (2026-02-19)

Full documentation refresh as part of monorepo v3.0.0 release.

### Dash0 OpenTelemetry Integration (2026-02-16)

Added Dash0 OTel distributed tracing integration (#803). Provides end-to-end request tracing alongside existing Sentry error tracking.

### Dev-mode Log Formatting (2026-02-16)

Added PM2-friendly log formatting in development mode for improved readability during local development.

### PM2 Ecosystem Migration (2026-02-14)

Switched PM2 ecosystem to use `pnpm --filter <service> start:local` scripts. Fixed `start:local` to use `tsx` instead of `node --experimental-strip-types`.

### Page Preview Endpoint (2026-01-29)

Added `GET /internal/notion/users/:userId/pages/:pageId/preview` for validating Notion page access before research exports. Used by research-agent.

### PromptVault Removal (2026-01-26)

Removed `promptVaultPageId` from the connect request schema (INT-319). The service now focuses purely on Notion connection management and page access validation.

### Sentry Logger Migration (2026-01-30)

Migrated from direct `pino()` to `createAppLogger()` from `@intexuraos/infra-sentry`. Added `debug` method to NotionLogger adapter.

### Response Contract Compliance (2026-01-30)

All routes now use standardized `reply.ok()`/`reply.fail()` per the project response contract.

### 100% Branch Coverage (2026-01-31)

Achieved strict 100% branch coverage with proper v8 ignore annotations for TypeScript type guards and test infrastructure boundaries.

---

## Resolved Issues

| Date       | Issue                              | Resolution                            |
| ---------- | ---------------------------------- | ------------------------------------- |
| 2026-02-16 | No distributed tracing             | Added Dash0 OTel integration          |
| 2026-01-31 | Branch coverage below 100%         | v8 ignore annotations + new tests     |
| 2026-01-30 | Direct pino() usage (no Sentry)    | Migrated to createAppLogger           |
| 2026-01-30 | Raw reply.send() in routes         | Migrated to reply.ok()/reply.fail()   |
| 2026-01-29 | No page access validation          | Added page preview internal endpoint  |
| 2026-01-26 | Unused promptVaultPageId parameter | Removed from connect schema (INT-319) |

---

## Related

- [Features](features.md) -- User-facing documentation
- [Technical](technical.md) -- Developer reference
- [Documentation Run Log](../../documentation-runs.md)
