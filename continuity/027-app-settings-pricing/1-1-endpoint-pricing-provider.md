# 1-1: Implement Pricing Endpoint

## Status: ✅ DONE

## Tier: 1 (Independent)

## Context

Endpoint `/internal/settings/pricing/:provider` w app-settings-service.

## Scope

- apps/app-settings-service/src/routes/internalRoutes.ts
- apps/app-settings-service/src/infra/firestore/index.ts (FirestorePricingRepository)
- Internal auth validation

## Endpoint

- Method: GET
- Path: /internal/settings/pricing/:provider
- Auth: X-Internal-Auth header
- Response: ProviderPricing

## Steps

- [x] Create infra/firestore/index.ts (FirestorePricingRepository reads from settings/llm_pricing/{provider})
- [x] Create routes/internalRoutes.ts with pricing endpoint
- [x] Add validateInternalAuth() middleware
- [x] Register routes in server.ts
- [x] Add tests

## Definition of Done

- [x] Endpoint returns correct data for all 4 providers
- [x] Returns 404 for unknown provider
- [x] Returns 401 without valid X-Internal-Auth
- [x] Tests pass

## Created Files

- apps/app-settings-service/src/routes/internalRoutes.ts
- apps/app-settings-service/src/infra/firestore/index.ts
- apps/app-settings-service/src/__tests__/routes/internalRoutes.test.ts
- apps/app-settings-service/src/__tests__/infra/FirestorePricingRepository.test.ts

## Verification

```bash
npm run test -w @intexuraos/app-settings-service
npm run ci
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-2-create-llm-usage-logger.md.
