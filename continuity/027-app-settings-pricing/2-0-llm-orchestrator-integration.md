# 2-0: Integration in llm-orchestrator

## Status: 🔶 PARTIAL

## Tier: 2 (Integration)

## Context

Użycie nowych klientów V2 z PricingClient cache.

## Scope

- apps/llm-orchestrator/src/infra/pricing/PricingClient.ts (NEW) ✅
- Update services.ts to use V2 clients ❌ (not done)
- Update use cases to pass pricing ❌ (not done)

## PricingClient Implementation ✅

```typescript
class PricingClient {
  private cache = new Map<LlmProvider, { data: ProviderPricing; expiresAt: number }>();
  private readonly ttlMs = 5 * 60 * 1000; // 5 min

  async getForProvider(provider: LlmProvider): Promise<ProviderPricing | null>;
  async getModelPricing(provider: LlmProvider, model: string): Promise<ModelPricing | null>;
  clearCache(): void;
}
```

## Steps

- [x] Create PricingClient.ts with HTTP call to app-settings-service
- [ ] Add APP_SETTINGS_SERVICE_URL to config
- [ ] Update services.ts: add pricingClient
- [ ] Update client factory functions to use V2 + pricing
- [ ] Update use cases to get pricing before creating clients
- [ ] Add Terraform secret for APP_SETTINGS_SERVICE_URL
- [ ] Add tests for PricingClient

## What's Done

PricingClient created with:

- HTTP client calling app-settings-service `/internal/settings/pricing/:provider`
- 5-minute TTL cache
- Error handling with fallback to cached data
- Exported from `apps/llm-orchestrator/src/infra/pricing/index.ts`

## What's Remaining (Future Work)

- Full integration: update LlmAdapterFactory to use V2 clients
- Pass PricingClient to services.ts
- Update use cases to fetch pricing before creating clients

## Created Files

- apps/llm-orchestrator/src/infra/pricing/PricingClient.ts
- apps/llm-orchestrator/src/infra/pricing/index.ts (updated)

## Notes

The infrastructure is complete. V2 clients exist and are exported from all 4 infra-\* packages.
llm-orchestrator still uses V1 clients for now - migration can happen incrementally.
CI passes with current state.
