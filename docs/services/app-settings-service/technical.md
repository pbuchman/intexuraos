# App Settings Service - Technical Reference

## Overview

App-settings-service provides application-wide LLM pricing and user-specific usage cost analytics.

## API Endpoints

| Method | Path                    | Description                  | Auth         |
| ------ | ----------------------- | ---------------------------- | ------------ |
| GET    | `/settings/pricing`     | Get all LLM provider pricing | Bearer token |
| GET    | `/settings/usage-costs` | Get user's usage costs       | Bearer token |

### Pricing Response

```typescript
{
  google: ProviderPricing,
  openai: ProviderPricing,
  anthropic: ProviderPricing,
  perplexity: ProviderPricing
}
```

### Usage Costs Query Parameters

| Parameter | Type    | Default | Max |
| --------- | ------- | ------- | --- |
| `days`    | integer | 90      | 365 |

### Usage Costs Response

```typescript
{
  totalCostUsd: number,
  totalCalls: number,
  dailyBreakdown: DailyCost[],
  monthlyBreakdown: MonthlyCost[],
  byModel: ModelCost[],
  byCallType: CallTypeCost[]
}
```

## Configuration

| Environment Variable                | Required | Description                  |
| ----------------------------------- | -------- | ---------------------------- |
| `INTEXURAOS_PRICING_COLLECTION`     | Yes      | Firestore pricing collection |
| `INTEXURAOS_USAGE_STATS_COLLECTION` | Yes      | Firestore usage collection   |

## Dependencies

**Infrastructure:**

- Firestore (`pricing` collection) - Provider pricing config
- Firestore (`usage_stats` collection) - User usage statistics

## Gotchas

**Default days** - Defaults to 90 if not specified.

**Max days** - Maximum 365 days. Requesting higher returns error.

**Missing providers** - Returns 500 if any provider pricing missing from Firestore.

**User scoping** - Usage costs automatically scoped to authenticated user.

## File Structure

```
apps/app-settings-service/src/
  infra/firestore/
    usageStatsRepository.ts  # User analytics
  routes/
    publicRoutes.ts           # Pricing and usage endpoints
    internalRoutes.ts         # Internal endpoints
  services.ts
  server.ts
```
