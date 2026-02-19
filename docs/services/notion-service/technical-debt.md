# Notion Service - Technical Debt

**Last Updated:** 2026-02-19

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| Code Smells         | 1     | Low      |
| **Total**           | **1** | Low      |

## Active Debt

### Webhook Stub — No Event Processing

**Severity:** Low | **Category:** Incomplete feature

`POST /notion-webhooks` accepts any JSON payload and responds `{ received: true }` without processing events. The route exists to receive webhooks from Notion but performs no side effects. When Notion integration matures, this stub must be replaced with real event handling (e.g., sync triggers, cache invalidation).

**File:** `apps/notion-service/src/routes/webhookRoutes.ts`

---

## Future Plans

1. **Multiple workspaces** - Support multiple Notion workspaces per user
2. **Sync status** - Detailed sync progress tracking
3. **Scoped access** - Granular database/page permissions
4. **Webhook processing** - Handle Notion events for real-time sync

## Recent Improvements

### Dev-mode Log Formatting (2026-02-16)

Added PM2-friendly log formatting in development mode for improved readability during local development.

### Dash0 OpenTelemetry Integration (2026-02-16)

Added Dash0 OTel distributed tracing integration (#803). Provides end-to-end request tracing alongside existing Sentry error tracking.

### PM2 Ecosystem Migration (2026-02-14)

Switched PM2 ecosystem to use `pnpm --filter <service> start:local` scripts instead of direct process invocations. Fixed `start:local` to use `tsx` (not `node --experimental-strip-types`) for TypeScript execution.

### Page Preview Endpoint (2026-01-29)

Added internal endpoint `GET /internal/notion/users/:userId/pages/:pageId/preview` for validating Notion page access. Returns page title and URL. Used by research-agent for export target validation.

### PromptVault Removal (2026-01-26)

Removed `promptVaultPageId` from the connect request schema (INT-319). The service now focuses on Notion connection management and page access.

### Sentry Logger Migration (2026-01-30)

Migrated from direct `pino()` to `createAppLogger()` from `@intexuraos/infra-sentry`. Added `debug` method to NotionLogger adapter in server.ts.

### Response Contract Compliance (2026-01-30)

All routes now use standardized `reply.ok()`/`reply.fail()`:

- Internal routes: `reply.fail('UNAUTHORIZED', ...)` instead of raw `reply.status(401)`
- Internal context endpoint: `reply.ok({ connected, token })` instead of raw objects
- Disconnect endpoint: `reply.ok({})` instead of returning connection state

### 100% Branch Coverage (2026-01-31)

Achieved strict 100% branch coverage with proper v8 ignore annotations for TypeScript type guards and test infrastructure boundaries.

---

## Resolved Issues

### Historical Issues

| Date       | Issue                              | Resolution                            |
| ---------- | ---------------------------------- | ------------------------------------- |
| 2026-01-31 | Branch coverage below 100%         | v8 ignore annotations + new tests     |
| 2026-01-30 | Direct pino() usage (no Sentry)    | Migrated to createAppLogger           |
| 2026-01-30 | Raw reply.send() in routes         | Migrated to reply.ok()/reply.fail()   |
| 2026-01-29 | No page access validation          | Added page preview internal endpoint  |
| 2026-01-26 | Unused promptVaultPageId parameter | Removed from connect schema (INT-319) |
