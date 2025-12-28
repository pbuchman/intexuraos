# Changes Log

## Standard 1: Common Package Decomposition

**Status:** SKIPPED (documented in LEDGER.md)

No files modified. Decision documented with reasoning.

---

## Standard 2: Hard Cross-App Isolation

**Status:** IMPLEMENTED

### Files Modified

- `eslint.config.js` - Replaced hardcoded app list with pattern-based regex

### Details

Replaced 6 individual app patterns with 3 pattern-based rules:

- `@intexuraos/*-service` - Matches all service apps automatically
- `@intexuraos/web` - Matches the web app
- `@intexuraos/api-docs-hub` - Matches the docs hub

This ensures new services following the naming convention are automatically blocked
without requiring ESLint config changes.

---

## Standard 3 & 4: Notion-Service Domain Introduction

**Status:** IMPLEMENTED

### Files Created

- `apps/notion-service/src/domain/integration/index.ts`
- `apps/notion-service/src/domain/integration/ports/index.ts`
- `apps/notion-service/src/domain/integration/ports/ConnectionRepository.ts`
- `apps/notion-service/src/domain/integration/usecases/index.ts`
- `apps/notion-service/src/domain/integration/usecases/connectNotion.ts`
- `apps/notion-service/src/domain/integration/usecases/getNotionStatus.ts`
- `apps/notion-service/src/domain/integration/usecases/disconnectNotion.ts`
- `apps/notion-service/src/__tests__/domain/usecases.test.ts`

### Files Modified

- `apps/notion-service/src/routes/integrationRoutes.ts` - Refactored to use domain use-cases
- `apps/whatsapp-service/src/__tests__/usecases/transcribeAudio.test.ts` - Removed unused eslint-disable

### Details

Routes are now thin adapters:

- Extract auth user
- Parse request body
- Call use-case
- Map result to HTTP response

Business logic (page validation, error mapping, connection saving) moved to use-cases.

---

## Standard 5: Observability Baseline

**Status:** ALREADY IMPLEMENTED

### Analysis

The existing logger in `packages/common/src/http/logger.ts` already provides:

- `requestId` in all log entries (via fastifyPlugin.ts)
- Request logging with method, URL, host, remoteAddress
- Response logging with statusCode, responseTime
- Health check suppression

The `intexuraFastifyPlugin` in `packages/common/src/http/fastifyPlugin.ts`:

- Captures request start time
- Generates/extracts requestId
- Adds requestId to response headers
- Includes diagnostics (requestId, durationMs) in all responses

This meets the observability baseline requirements:

- Service name: Available via environment variable in each service
- requestId/correlationId: ✓ (via X-Request-Id header)
- Route: ✓ (request.url in logs)
- Status code: ✓ (reply.statusCode in logs)
- Latency: ✓ (responseTime in logs)

No changes required - baseline already satisfied.

---

## Verification

- [x] `npm run ci` passes
- [x] Pattern-based ESLint rules block cross-app imports
- [x] notion-service domain layer structure created with tests
- [x] Routes refactored to thin adapters
- [x] Structured logging already includes required fields
