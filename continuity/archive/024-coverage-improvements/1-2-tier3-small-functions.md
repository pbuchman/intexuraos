# Tier 3: Small Functions (15-30 mins each)

## Status: PENDING

Small function coverage gaps requiring new test cases.

## Items

| #   | File                                                              | Coverage     | Gap     | Uncovered                    | Status  |
| --- | ----------------------------------------------------------------- | ------------ | ------- | ---------------------------- | ------- |
| 1   | `apps/research-agent/src/domain/research/utils/costCalculator.ts` | 0%/100%      | 3 lines | Lines 8-10 (entire function) | Pending |
| 2   | `apps/whatsapp-service/src/infra/linkpreview/openGraphFetcher.ts` | 96.1%/97.82% | 3 lines | Lines 60, 70, 85             | Pending |
| 3   | `apps/commands-router/src/infra/pubsub/commandResultPublisher.ts` | 75%/100%     | 1 line  | Line 29                      | Pending |

## Verification

```bash
npx vitest run --coverage <path/to/file.test.ts>
```
