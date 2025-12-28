# Task 1-1: Tests for common-http

## Tier
1 - Independent deliverable

## Context
packages/common-http contains:
- auth/jwt.ts: JWT verification using JWKS (verifyJwt, clearJwksCache)
- auth/fastifyAuthPlugin.ts: Fastify auth plugin (requireAuth, tryAuth, fastifyAuthPlugin)
- http/response.ts: API response utilities (ok, fail)
- http/fastifyPlugin.ts: Core Fastify plugin (intexuraFastifyPlugin)
- http/validation.ts: Zod error handling (handleValidationError)
- http/requestId.ts: Request ID utilities (getRequestId, REQUEST_ID_HEADER)

## Problem Statement
No tests exist for common-http. Need high coverage for all modules.

## Scope
- packages/common-http/src/__tests__/jwt.test.ts
- packages/common-http/src/__tests__/fastifyAuthPlugin.test.ts
- packages/common-http/src/__tests__/response.test.ts
- packages/common-http/src/__tests__/fastifyPlugin.test.ts
- packages/common-http/src/__tests__/validation.test.ts
- packages/common-http/src/__tests__/requestId.test.ts

## Non-Scope
- index.ts (barrel file)
- http/logger.ts (excluded in vitest.config.ts)

## Required Approach

### jwt.test.ts
- Test verifyJwt with valid token (mock jose)
- Test verifyJwt with empty token
- Test verifyJwt with expired token
- Test verifyJwt with invalid signature
- Test verifyJwt with missing sub claim
- Test clearJwksCache

### fastifyAuthPlugin.test.ts
- Test requireAuth with valid token
- Test requireAuth with missing auth header
- Test requireAuth with misconfigured server
- Test tryAuth success and failure paths

### response.test.ts
- Test ok() with data only
- Test ok() with diagnostics
- Test fail() with all parameters

### requestId.test.ts
- Test getRequestId with string header
- Test getRequestId with array header
- Test getRequestId fallback to UUID

### validation.test.ts
- Test handleValidationError formats errors correctly

### fastifyPlugin.test.ts
- Test plugin registers ok/fail decorators
- Test onRequest hook sets requestId and startTime
- Test onSend hook adds request-id header

## Step Checklist
- [ ] Create jwt.test.ts
- [ ] Create fastifyAuthPlugin.test.ts
- [ ] Create response.test.ts
- [ ] Create fastifyPlugin.test.ts
- [ ] Create validation.test.ts
- [ ] Create requestId.test.ts
- [ ] Run tests and verify pass

## Definition of Done
All common-http modules have high test coverage (>90%)

## Verification Commands
```bash
npm run test -- packages/common-http --coverage
```

## Rollback Plan
Delete test files if task fails
