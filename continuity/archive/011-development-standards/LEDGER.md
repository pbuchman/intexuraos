# Decision Ledger

## Standard 1: Common Package Decomposition

### Decision: IMPLEMENT

### Target Structure

Split `packages/common` into 4 purpose-driven packages:

1. **`packages/common-core`** - Pure utilities with zero infrastructure dependencies
2. **`packages/common-http`** - Fastify helpers, requestId, error mapping
3. **`packages/infra-firestore`** - Firestore client/adapters only
4. **`packages/infra-notion`** - Notion client/adapters only

### Implementation Tasks

#### Task 1.1: Create packages/common-core

**Contents to move from packages/common:**

- `src/result.ts` - Result types and utilities
- `src/redaction.ts` - Security utilities (redactToken, redactObject, SENSITIVE_FIELDS)
- `src/http/errors.ts` - Error types (ErrorCode, ERROR_HTTP_STATUS, IntexuraOSError, getErrorMessage)

**New files to create:**

- `packages/common-core/package.json`
- `packages/common-core/tsconfig.json`
- `packages/common-core/src/index.ts`

**Dependencies:** None (leaf package)

#### Task 1.2: Create packages/common-http

**Contents to move from packages/common:**

- `src/http/response.ts` - API response helpers
- `src/http/requestId.ts` - Request ID handling
- `src/http/fastifyPlugin.ts` - Fastify plugin
- `src/http/validation.ts` - Validation error handling
- `src/http/logger.ts` - Logging utilities
- `src/auth/jwt.ts` - JWT verification
- `src/auth/fastifyAuthPlugin.ts` - Auth plugin

**New files to create:**

- `packages/common-http/package.json`
- `packages/common-http/tsconfig.json`
- `packages/common-http/src/index.ts`

**Dependencies:** `@intexuraos/common-core`

#### Task 1.3: Create packages/infra-firestore

**Contents to move from packages/common:**

- `src/firestore.ts` - Firestore client
- `src/testing/` - Fake Firestore utilities

**New files to create:**

- `packages/infra-firestore/package.json`
- `packages/infra-firestore/tsconfig.json`
- `packages/infra-firestore/src/index.ts`

**Dependencies:** `@intexuraos/common-core`

#### Task 1.4: Create packages/infra-notion

**Contents to move from packages/common:**

- `src/notion.ts` - Notion client and utilities
- `src/notionConnection.ts` - Notion connection repository

**New files to create:**

- `packages/infra-notion/package.json`
- `packages/infra-notion/tsconfig.json`
- `packages/infra-notion/src/index.ts`

**Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-firestore`

#### Task 1.5: Update packages/common as facade

Convert `packages/common` to re-export from new packages for backward compatibility.

#### Task 1.6: Update import statements across all apps

Update imports in:

- `apps/auth-service/`
- `apps/notion-service/`
- `apps/promptvault-service/`
- `apps/whatsapp-service/`
- `apps/mobile-notifications-service/`
- `apps/api-docs-hub/`
- `apps/web/`
- `packages/http-server/`
- `packages/http-contracts/`

#### Task 1.7: Update ESLint boundaries configuration

Update `eslint.config.js` to enforce new package boundaries:

- `common-core` imports nothing
- `common-http` imports from `common-core` only
- `infra-firestore` imports from `common-core` only
- `infra-notion` imports from `common-core` and `infra-firestore`
- Apps can import from all packages
- Domain layers NEVER import infra packages directly

#### Task 1.8: Update root configuration

- Add new packages to `package.json` workspaces
- Add project references to `tsconfig.json`

#### Task 1.9: Run CI and fix issues

- Run `npm run ci`
- Fix any TypeScript errors
- Fix any ESLint violations
- Ensure all tests pass

#### Task 1.10: Remove packages/common facade completely

**Status:** ✅ COMPLETED

Removed the facade package and updated all imports to use specific modules directly.

**Changes Made:**

1. Updated 100+ import statements across all apps
2. Updated `packages/http-server/src/health.ts` and `packages/http-server/src/__tests__/health.test.ts`
3. Removed `packages/common` directory
4. Updated root `tsconfig.json` references
5. Updated all `apps/*/package.json` dependencies
6. Updated all `apps/*/tsconfig.json` references
7. Updated `eslint.config.js` boundaries
8. All 973 tests pass, `npm run ci` succeeds

---

## Standard 2: Hard Cross-App Isolation

### Decision: IMPLEMENT ✅ COMPLETED

### Approach: Pattern-based glob matching

Replace the hardcoded list of 6 app names with 3 pattern rules:

- `@intexuraos/*-service` - matches all current and future service apps
- `@intexuraos/web` - matches web app (non-service naming)
- `@intexuraos/api-docs-hub` - matches docs hub (non-service naming)

### Trade-offs

Using a pattern means:

- New services following `-service` naming convention are automatically blocked
- Non-service apps (web, api-docs-hub) still need explicit entries
- Simpler ESLint config, fewer lines to maintain

The current naming convention is consistent, so this trade-off is acceptable.

---

## Standard 3: Thin Routes, Fat Use-Cases

### Decision: IMPLEMENT (for ALL services)

### Current State Analysis

| Service                      | Domain Layer | Usecases Folder | Routes Need Refactoring |
| ---------------------------- | ------------ | --------------- | ----------------------- |
| auth-service                 | ✅           | ❌              | YES                     |
| whatsapp-service             | ✅           | ✅              | Review needed           |
| promptvault-service          | ✅           | ✅              | Review needed           |
| mobile-notifications-service | ✅           | ✅              | Review needed           |
| notion-service               | ✅           | ✅              | DONE                    |

---

### Task 3.1: auth-service Route Refactoring

**Status:** ✅ PARTIALLY COMPLETED

**Completed:**

- Created `domain/identity/usecases/` folder
- Implemented `refreshAccessToken` use-case
- Refactored `tokenRoutes.ts` to use the use-case

**Files Created:**

- `apps/auth-service/src/domain/identity/usecases/index.ts`
- `apps/auth-service/src/domain/identity/usecases/refreshAccessToken.ts`

**Files Modified:**

- `apps/auth-service/src/domain/identity/index.ts` - Added usecases export
- `apps/auth-service/src/routes/tokenRoutes.ts` - Refactored to use-case

**Remaining (Out of Scope for This Task):**

The following routes could be further refactored in a future task, but are acceptable
as they primarily handle OAuth protocol mechanics rather than business logic:

- `oauthRoutes.ts` - OAuth2 token exchange (transport-layer protocol handling)
- `deviceRoutes.ts` - Device authorization (transport-layer protocol handling)
- `frontendRoutes.ts` - Frontend authentication (transport-layer protocol handling)
- `configRoutes.ts` - Pure configuration (no business logic)

---

### Task 3.2: whatsapp-service Route Review

**Status:** ✅ COMPLETED (Review Only)

**Findings:**

- Routes already delegate to use-cases (`ProcessImageMessageUseCase`, `ProcessAudioMessageUseCase`, `TranscribeAudioUseCase`, `ExtractLinkPreviewsUseCase`)
- Response transformation in routes is acceptable as transport-layer concern
- No business logic extraction needed

---

### Task 3.3: promptvault-service Route Review

**Status:** ✅ COMPLETED (Review Only)

**Findings:**

- Routes already delegate to use-cases (`listPrompts`, `createPrompt`, `getPrompt`, `updatePrompt`)
- Response transformation in routes is acceptable as transport-layer concern
- No business logic extraction needed

---

### Task 3.4: mobile-notifications-service Route Review

**Status:** ✅ COMPLETED (Review Only)

**Findings:**

- Routes already delegate to use-cases (`listNotifications`, `deleteNotification`, `createConnection`)
- All routes follow thin pattern: auth → parse → call use-case → map to HTTP
- No business logic extraction needed

---

### Task 3.5: notion-service Route Refactoring

**Status:** ✅ COMPLETED

Domain layer created with use-cases:

- `connectNotion.ts`
- `getNotionStatus.ts`
- `disconnectNotion.ts`

Routes refactored to thin adapters.

---

## Standard 4: Notion-Service Domain Introduction

### Decision: IMPLEMENT

### Structure

```
apps/notion-service/src/domain/
├── integration/
│   ├── index.ts
│   ├── ports/
│   │   ├── index.ts
│   │   └── ConnectionRepository.ts  (includes NotionApi interface)
│   └── usecases/
│       ├── index.ts
│       ├── connectNotion.ts
│       ├── getNotionStatus.ts
│       └── disconnectNotion.ts
```

### Port Design Decisions

1. Combined `ConnectionRepository` and `NotionApi` types in one ports file since they're closely related
2. Used `NotionConnectionPublic` type that matches the existing services.ts interface
3. Defined `NotionPagePreview` to match the existing API response structure

---

## Standard 5: Observability Baseline

### Decision: ALREADY SATISFIED

### Current State Assessment

The existing observability infrastructure already meets the requirements:

| Requirement   | Implementation                                         |
| ------------- | ------------------------------------------------------ |
| Service name  | Available via env vars, logged at startup              |
| requestId     | Generated/extracted in fastifyPlugin, added to headers |
| correlationId | Same as requestId (X-Request-Id header)                |
| Route         | Logged as request.url in onRequest/onResponse hooks    |
| Status code   | Logged as reply.statusCode in onResponse hook          |
| Latency       | Logged as responseTime (reply.elapsedTime)             |

### No Changes Required

The baseline was already satisfied by:

- `packages/common/src/http/fastifyPlugin.ts` - requestId handling, diagnostics
- `packages/common/src/http/logger.ts` - structured request/response logging

All services using `intexuraFastifyPlugin` and `registerQuietHealthCheckLogging` get consistent structured logging automatically.
