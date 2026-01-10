# 1-4: Add Calculator to infra-gpt

## Status: ✅ DONE

## Tier: 1 (Independent)

## Context

Analogicznie do infra-gemini. Obsługuje również image generation.

## Scope

- packages/infra-gpt/src/costCalculator.ts (NEW)
- packages/infra-gpt/src/clientV2.ts (NEW)
- packages/infra-gpt/src/types.ts (extend with GptConfigV2)

## Provider-Specific

- cacheReadMultiplier for cached tokens
- webSearchCostPerCall for web search
- imagePricing per size

## Steps

- [x] Create costCalculator.ts (OpenAI-specific: cache, web search)
- [x] Create GptConfigV2 in types.ts
- [x] Create clientV2.ts
- [x] Handle image pricing per size
- [x] Export from index.ts
- [ ] Add tests (not added - relies on integration tests)

## Definition of Done

- [x] createGptClientV2 works with passed pricing
- [x] Image costs vary by size
- [x] Original createGptClient unchanged
- [x] npm run ci passes

## Created Files

- packages/infra-gpt/src/costCalculator.ts
- packages/infra-gpt/src/clientV2.ts
- packages/infra-gpt/src/types.ts (updated with GptConfigV2)

## Verification

```bash
npm run test -w @intexuraos/infra-gpt
npm run ci
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-5-infra-claude-calculator.md.
