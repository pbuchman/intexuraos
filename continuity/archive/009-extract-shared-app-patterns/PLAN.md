# Execution Plan — Extract Shared App Patterns

## Overview

**Goal**: Extract common HTTP patterns from `apps/promptvault-service` into shared packages, enabling reuse across all services.

**Approach**: Create two new packages that extract duplicated code, then update promptvault-service to use them.

---

## Phase 1: Analysis & Preparation

### Task 1.1: Identify Duplicated Patterns

**Files to analyze**:

- `apps/promptvault-service/src/server.ts` (651 lines)
- `apps/user-service/src/server.ts` (389 lines)
- `apps/notion-service/src/server.ts` (551 lines)

**Common patterns identified**:

| Pattern                                                  | Location                        | Lines          |
| -------------------------------------------------------- | ------------------------------- | -------------- |
| OpenAPI component schemas (ErrorCode, Diagnostics, etc.) | server.ts buildOpenApiOptions() | ~80 lines each |
| Fastify JSON schemas ($id-based)                         | server.ts app.addSchema()       | ~50 lines each |
| Health check types & functions                           | server.ts                       | ~80 lines each |
| Validation error handler                                 | server.ts setErrorHandler()     | ~30 lines each |

**Total duplicated**: ~240 lines × 3 services = ~720 lines

### Task 1.2: Define Package Boundaries

**Package 1: `@intexuraos/http-contracts`**

- OpenAPI schema definitions (JSON objects for swagger config)
- Fastify JSON schemas with $id for route validation
- No runtime dependencies (pure data)

**Package 2: `@intexuraos/http-server`**

- Health check types and functions
- Validation error handler
- Dependencies: @intexuraos/common, fastify

---

## Phase 2: Create http-contracts Package

### Task 2.1: Create Package Structure

**Files to create**:

```
packages/http-contracts/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── openapi-schemas.ts      # OpenAPI component schemas
    └── fastify-schemas.ts      # Fastify $id schemas
```

**package.json**:

```json
{
  "name": "@intexuraos/http-contracts",
  "version": "0.0.4",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "dependencies": {}
}
```

### Task 2.2: Extract OpenAPI Schemas

**Source**: `apps/promptvault-service/src/server.ts` lines 122-337

**Target**: `packages/http-contracts/src/openapi-schemas.ts`

**Exports**:

- `ERROR_CODES` — Array of error code strings
- `ErrorCodeSchema` — OpenAPI schema for ErrorCode
- `DiagnosticsSchema` — OpenAPI schema for Diagnostics
- `ErrorBodySchema` — OpenAPI schema for ErrorBody
- `ApiOkSchema` — OpenAPI schema for success response
- `ApiErrorSchema` — OpenAPI schema for error response
- `HealthCheckSchema` — OpenAPI schema for health check
- `HealthResponseSchema` — OpenAPI schema for health response
- `coreComponentSchemas` — Combined object for spreading into components.schemas
- `bearerAuthSecurityScheme` — Security scheme definition

### Task 2.3: Extract Fastify Schemas

**Source**: `apps/promptvault-service/src/server.ts` lines 423-468

**Target**: `packages/http-contracts/src/fastify-schemas.ts`

**Exports**:

- `fastifyDiagnosticsSchema` — Fastify schema with $id: 'Diagnostics'
- `fastifyErrorCodeSchema` — Fastify schema with $id: 'ErrorCode'
- `fastifyErrorBodySchema` — Fastify schema with $id: 'ErrorBody'
- `registerCoreSchemas(app)` — Helper to register all core schemas

---

## Phase 3: Create http-server Package

### Task 3.1: Create Package Structure

**Files to create**:

```
packages/http-server/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── health.ts              # Health check utilities
    └── validation-handler.ts  # Validation error handler
```

**package.json**:

```json
{
  "name": "@intexuraos/http-server",
  "version": "0.0.4",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "dependencies": {
    "@intexuraos/common": "*",
    "@intexuraos/http-contracts": "*",
    "fastify": "^5.1.0"
  }
}
```

### Task 3.2: Extract Health Check Utilities

**Source**: `apps/promptvault-service/src/server.ts` lines 20-120

**Target**: `packages/http-server/src/health.ts`

**Exports**:

- `HealthStatus` — Type: 'ok' | 'degraded' | 'down'
- `HealthCheck` — Interface for individual check result
- `HealthResponse` — Interface for full health response
- `checkSecrets(required: string[])` — Check required env vars
- `checkFirestore()` — Check Firestore connectivity
- `checkNotionSdk()` — Passive Notion SDK check
- `computeOverallStatus(checks)` — Aggregate check results
- `buildHealthResponse(serviceName, version, checks)` — Build response object

### Task 3.3: Extract Validation Error Handler

**Source**: `apps/promptvault-service/src/server.ts` lines 385-421

**Target**: `packages/http-server/src/validation-handler.ts`

**Exports**:

- `createValidationErrorHandler()` — Returns Fastify error handler function

---

## Phase 4: Update Configuration

### Task 4.1: Update Root tsconfig.json

Add references to new packages:

```json
{
  "references": [
    { "path": "packages/common" },
    { "path": "packages/http-contracts" },
    { "path": "packages/http-server" }
    // ... existing app references
  ]
}
```

### Task 4.2: Update ESLint Boundary Rules

**File**: `eslint.config.js`

**Changes**:

1. Add new element types for http-contracts and http-server
2. Update import rules to allow proper dependency flow

**Dependency graph**:

```
http-contracts (leaf, no dependencies)
       ↑
    common (can import http-contracts)
       ↑
  http-server (can import common, http-contracts)
       ↑
     apps (can import all packages)
```

### Task 4.3: Run npm install

```bash
npm install
```

---

## Phase 5: Migrate promptvault-service

### Task 5.1: Update server.ts Imports

**File**: `apps/promptvault-service/src/server.ts`

**Add imports**:

```typescript
import {
  coreComponentSchemas,
  bearerAuthSecurityScheme,
  registerCoreSchemas,
} from '@intexuraos/http-contracts';
import {
  checkSecrets,
  checkFirestore,
  checkNotionSdk,
  computeOverallStatus,
  buildHealthResponse,
  createValidationErrorHandler,
  type HealthCheck,
  type HealthResponse,
} from '@intexuraos/http-server';
```

### Task 5.2: Replace Inline Definitions

**Changes**:

1. Remove local `HealthStatus`, `HealthCheck`, `HealthResponse` type definitions
2. Remove local `checkSecrets`, `checkFirestore`, `checkNotionSdk`, `computeOverallStatus` functions
3. Update `buildOpenApiOptions()` to use `coreComponentSchemas` spread
4. Replace inline `app.addSchema()` calls with `registerCoreSchemas(app)`
5. Replace `setErrorHandler` with `createValidationErrorHandler()`

### Task 5.3: Update promptvault-service tsconfig.json

Add references to new packages:

```json
{
  "references": [
    { "path": "../../packages/common" },
    { "path": "../../packages/http-contracts" },
    { "path": "../../packages/http-server" }
  ]
}
```

### Task 5.4: Update promptvault-service package.json

Add dependencies:

```json
{
  "dependencies": {
    "@intexuraos/common": "*",
    "@intexuraos/http-contracts": "*",
    "@intexuraos/http-server": "*"
    // ... existing deps
  }
}
```

---

## Phase 6: Verification

### Task 6.1: Run Type Check

```bash
npm run typecheck
```

**Expected**: No errors

### Task 6.2: Run Lint

```bash
npm run lint
```

**Expected**: No new errors (existing warning in whatsapp-service is unrelated)

### Task 6.3: Run Tests

```bash
npm run test
```

**Expected**: All existing tests pass without modification

### Task 6.4: Run Full CI

```bash
npm run ci
```

**Expected**: All checks pass

### Task 6.5: Verify API Contract

```bash
# Start service and compare OpenAPI spec
cd apps/promptvault-service
npm run start &
curl http://localhost:8081/openapi.json > /tmp/new-spec.json
# Compare with baseline (should be identical except possibly server URLs)
```

---

## Phase 7: Cleanup & Documentation

### Task 7.1: Run Code Review

Use `code_review` tool to get feedback on changes.

### Task 7.2: Run Security Check

Use `codeql_checker` tool to verify no security issues.

### Task 7.3: Archive Continuity

Move `continuity/todo/009-extract-shared-app-patterns/` to `continuity/archive/`

---

## Execution Order

1. Phase 1: Analysis (already complete from exploration)
2. Phase 2: Create http-contracts (Tasks 2.1-2.3)
3. Phase 3: Create http-server (Tasks 3.1-3.3)
4. Phase 4: Update configuration (Tasks 4.1-4.3)
5. Phase 5: Migrate promptvault-service (Tasks 5.1-5.4)
6. Phase 6: Verification (Tasks 6.1-6.5)
7. Phase 7: Cleanup (Tasks 7.1-7.3)

---

## Estimated Effort

| Phase     | Tasks  | Est. Hours |
| --------- | ------ | ---------- |
| 1         | 2      | 0.5        |
| 2         | 3      | 1          |
| 3         | 3      | 1          |
| 4         | 3      | 0.5        |
| 5         | 4      | 1          |
| 6         | 5      | 0.5        |
| 7         | 3      | 0.5        |
| **Total** | **23** | **~5**     |

---

## Risks & Mitigations

1. **Risk**: Breaking existing tests
   **Mitigation**: Extract only, don't modify behavior. Tests should pass unchanged.

2. **Risk**: ESLint boundary violations
   **Mitigation**: Update boundary rules before adding imports.

3. **Risk**: OpenAPI spec changes
   **Mitigation**: Compare generated spec before/after migration.

4. **Risk**: Type incompatibilities
   **Mitigation**: Use same type definitions, just move location.
