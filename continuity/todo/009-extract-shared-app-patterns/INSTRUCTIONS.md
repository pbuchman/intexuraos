# Extract Shared App Patterns — Instructions

## Goal

Migrate `apps/promptvault-service` to use shared packages under `packages/*` (at minimum: `packages/http-contracts` and `packages/http-server`), without changing runtime behavior, API behavior, or business logic.

## Background

Currently, each service (auth-service, promptvault-service, notion-service, etc.) duplicates:

1. **OpenAPI schemas** — ErrorCode, Diagnostics, ApiOk, ApiError, HealthCheck, HealthResponse
2. **Fastify JSON Schemas** — $id-based schemas for route validation
3. **Health check utilities** — checkSecrets, checkFirestore, checkNotionSdk, computeOverallStatus
4. **Validation error handler** — setErrorHandler for Fastify validation errors

This duplication leads to:

- Inconsistency risk when updating one service but not others
- Code maintenance burden
- Harder onboarding for new services

## Scope

### In Scope

1. Create `packages/http-contracts` — OpenAPI schemas, Fastify schemas
2. Create `packages/http-server` — Health checks, validation handler
3. Update `apps/promptvault-service` to use these packages
4. Update ESLint boundary rules for new packages
5. Update tsconfig.json with new package references

### Out of Scope

- Migrating other services (auth-service, notion-service, etc.) — that's future work
- Changing API behavior or response formats
- Adding new features
- Changing business logic

## Constraints

1. **NPM only** — This repo uses plain NPM, not yarn or pnpm
2. **No runtime behavior change** — Tests must pass without modification
3. **No API change** — OpenAPI spec must remain identical
4. **Backward compatible** — Other services can continue working without changes

## Verification

```bash
npm run ci   # Must pass with no changes to existing tests
```

## Success Criteria

1. `packages/http-contracts` exists with exported OpenAPI/Fastify schemas
2. `packages/http-server` exists with health check and validation utilities
3. `apps/promptvault-service/src/server.ts` imports from new packages
4. All existing tests pass without modification
5. `npm run ci` passes
6. ESLint boundary rules recognize new packages
