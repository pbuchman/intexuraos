# Tier 2: Small Gaps (5-15 mins each)

## Status: PENDING

2-5 line coverage gaps requiring small test additions.

## Items

| #  | File | Coverage | Gap | Uncovered | Status |
|----|------|----------|-----|-----------|--------|
| 1 | `apps/actions-agent/src/routes/internalRoutes.ts` | 94.35%/94.73% | 6 lines | Lines 378-387, 552-557 | Pending |
| 2 | `apps/commands-router/src/domain/usecases/processCommand.ts` | 95%/85.71% | 3 lines | Lines 164-171, 212 | Pending |
| 3 | `apps/commands-router/src/routes/internalRoutes.ts` | 93.33%/93.75% | 3 lines | Lines 133-143 | Pending |
| 4 | `apps/mobile-notifications-service/src/infra/firestore/deviceRepository.ts` | 94.11%/83.33% | 4 lines | Lines 133, 136, 166-167 | Pending |
| 5 | `apps/mobile-notifications-service/src/infra/firestore/filterRepository.ts` | 89.65%/93.33% | 4 lines | Lines 133, 166, 174, 215 | Pending |
| 6 | `apps/user-service/src/routes/deviceRoutes.ts` | 96.77%/93.33% | 2 lines | Lines 95, 211 | Pending |
| 7 | `apps/whatsapp-service/src/routes/messageRoutes.ts` | 97.97%/95% | 2 lines | Lines 184, 191 | Pending |
| 8 | `apps/whatsapp-service/src/routes/pubsubRoutes.ts` | 93.75%/95.23% | 5 lines | Lines 392-401, 527, 642 | Pending |
| 9 | `packages/common-core/src/encryption.ts` | 95.83%/100% | 1 line | Line 42 | Pending |

## Verification

```bash
npx vitest run --coverage <path/to/file.test.ts>
```
