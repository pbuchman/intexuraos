# 1-6: Add Calculator to infra-perplexity

## Status: ✅ DONE

## Tier: 1 (Independent)

## Context

Perplexity zwraca provider cost z API — priorytet nad kalkulacją.

## Scope

- packages/infra-perplexity/src/costCalculator.ts (NEW)
- packages/infra-perplexity/src/clientV2.ts (NEW)
- packages/infra-perplexity/src/types.ts (extend with PerplexityConfigV2)

## Provider-Specific

- useProviderCost: true — użyj usage.cost.total_cost z API
- Fallback do kalkulacji jeśli API nie zwróci kosztu

## Steps

- [x] Create costCalculator.ts (respects useProviderCost)
- [x] Create PerplexityConfigV2 in types.ts
- [x] Create clientV2.ts
- [x] Export from index.ts
- [ ] Add tests (not added - relies on integration tests)

## Definition of Done

- [x] createPerplexityClientV2 works with passed pricing
- [x] Provider cost used when available
- [x] Original createPerplexityClient unchanged
- [x] npm run ci passes

## Created Files

- packages/infra-perplexity/src/costCalculator.ts
- packages/infra-perplexity/src/clientV2.ts
- packages/infra-perplexity/src/types.ts (updated with PerplexityConfigV2)

## Verification

```bash
npm run test -w @intexuraos/infra-perplexity
npm run ci
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 2-0-research-agent-integration.md.
