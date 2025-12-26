# 1-8 - Add Tests for Server Initialization

**Tier:** 1 (Depends on: ALL Tier 0 issues must be complete)

---

## Prerequisites

Before starting this issue, ensure these are complete:

- [x] `0-0-narrow-coverage-exclusions.md` - Coverage config is cleaned up
- [x] `0-1-common-package-coverage.md` - Common utilities are tested
- [x] `0-2-standardize-test-utilities.md` - Test patterns are documented

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90%
- Test runner: Vitest with v8 coverage provider
- Mock external systems only
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`

### Changes from Tier 0

- Coverage exclusions have been narrowed (see 0-0)
- Test utility patterns documented (see 0-2)

---

## Problem Statement

Server files have gaps in coverage:

- `apps/auth-service/src/server.ts`: **91.74%** (lines 68-91, 252-254 uncovered)
- `apps/notion-service/src/server.ts`: **91.57%** (lines 305-306, 355-357 uncovered)
- `apps/promptvault-service/src/server.ts`: **93.06%** (lines 360-361, 410-412 uncovered)
- `apps/whatsapp-service/src/server.ts`: **90.2%** (lines 60-83, 172-173 uncovered)

These typically contain error handling and edge cases in server initialization.

---

## Scope

### In Scope

- `apps/*/src/server.ts` files
- Server initialization error paths

### Out of Scope

- Route handlers (covered by other Tier 1 issues)
- Infra adapters (Tier 2 issue)

---

## Required Approach

- **Testing style**: Integration tests for server initialization
- **Mocking strategy**:
  - Mock environment variables
  - Mock failed service initialization
- **Architecture boundaries**: Test server startup and health checks

---

## Steps

1. Read server files to identify uncovered lines:

===
cat apps/auth-service/src/server.ts | head -100
cat apps/whatsapp-service/src/server.ts | head -100
===

2. Check existing systemEndpoints tests:

===
cat apps/auth-service/src/**tests**/systemEndpoints.test.ts
===

3. Identify uncovered scenarios (typically):
   - Server startup failures
   - Health check with degraded services
   - Missing configuration

4. Extend systemEndpoints.test.ts files with:
   - Health check degraded state
   - Server initialization error handling

5. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] All server.ts files have ≥ 95% coverage
- [ ] Server startup error paths tested
- [ ] Health check edge cases tested
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If server tests cause port conflicts:

1. Use random ports for test servers
2. Ensure proper cleanup in afterAll
