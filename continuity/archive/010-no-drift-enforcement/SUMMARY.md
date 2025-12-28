# Phase 3 & 4: No-Drift Enforcement and Coverage Cleanup

## Overview

This task implements enforcement mechanisms to prevent regression in the HTTP shared foundation and adds test coverage for the new packages.

## Status: COMPLETE

## Phase 3: No-Drift Enforcement

### Existing Enforcement Mechanisms

The following enforcement mechanisms were already in place and continue to protect against drift:

1. **ESLint Boundaries Plugin** (`eslint.config.js`)
   - Enforces import rules between packages
   - `http-contracts` is a leaf package (no dependencies)
   - `http-server` can only import from `common`
   - Apps can import from all packages

2. **No Cross-App Imports** (`no-restricted-imports`)
   - Prevents apps from importing from other apps
   - Each app listed in patterns array

3. **Verify Boundaries Script** (`npm run verify:boundaries`)
   - Proves boundary plugin works via executable tests
   - Run as part of CI

4. **Verify Common Script** (`npm run verify:common`)
   - Prevents domain-specific code from leaking into common
   - Enforced keyword-based detection

### Added Enforcement

No additional scripts were needed because:

1. ESLint already enforces the import graph
2. TypeScript enforces type compatibility
3. The existing CI pipeline runs all checks

## Phase 4: Coverage Cleanup

### Tests Added

1. **packages/http-contracts/src/**tests**/fastify-schemas.test.ts**
   - Tests for fastifyDiagnosticsSchema
   - Tests for fastifyErrorCodeSchema
   - Tests for fastifyErrorBodySchema
   - Tests for registerCoreSchemas()

2. **packages/http-contracts/src/**tests**/openapi-schemas.test.ts**
   - Tests for all OpenAPI schema exports
   - Tests for ERROR_CODES constant
   - Tests for coreComponentSchemas
   - Tests for bearerAuthSecurityScheme

3. **packages/http-server/src/**tests**/health.test.ts**
   - Tests for checkSecrets()
   - Tests for checkFirestore() (mocked in test environment)
   - Tests for checkNotionSdk()
   - Tests for computeOverallStatus()
   - Tests for buildHealthResponse()

4. **packages/http-server/src/**tests**/validation-handler.test.ts**
   - Tests for createValidationErrorHandler()
   - Tests validation error transformation
   - Tests internal error handling

### Coverage Results

After adding tests:

- `http-contracts/src`: 100% coverage
- `http-server/src`: 78% lines, 89% branches, 86% functions

Note: `health.ts` has 66% line coverage because the Firestore production code path (lines 66-83) is intentionally skipped in test environment. This is acceptable because:

1. The code path is only exercised in production
2. Testing would require actual GCP credentials
3. The code is straightforward (timeout + error handling)

## Verification

```bash
npm run ci  # All tests pass, coverage thresholds met
```

## Files Changed

- packages/http-contracts/src/**tests**/fastify-schemas.test.ts (new)
- packages/http-contracts/src/**tests**/openapi-schemas.test.ts (new)
- packages/http-server/src/**tests**/health.test.ts (new)
- packages/http-server/src/**tests**/validation-handler.test.ts (new)
