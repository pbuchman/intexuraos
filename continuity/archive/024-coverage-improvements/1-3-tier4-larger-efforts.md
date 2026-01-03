# Tier 4: Larger Efforts (30+ mins each)

## Status: PENDING

Larger coverage gaps requiring significant test additions or new test files.

## Items

| #   | File                                                       | Coverage      | Gap       | Uncovered                            | Status  |
| --- | ---------------------------------------------------------- | ------------- | --------- | ------------------------------------ | ------- |
| 1   | `apps/llm-orchestrator/src/infra/llm/LlmAdapterFactory.ts` | 76.19%/50%    | 9 lines   | Lines 63-71                          | Pending |
| 2   | `apps/llm-orchestrator/src/routes/internalRoutes.ts`       | 83.41%/80.58% | ~17 lines | Lines 752-757, 762, 778-782, 793-802 | Pending |
| 3   | `apps/llm-orchestrator/src/routes/researchRoutes.ts`       | 96.31%/86.61% | 5 lines   | Lines 157, 228, 254-256              | Pending |

## Verification

```bash
npx vitest run --coverage <path/to/file.test.ts>
```
