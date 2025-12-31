# Tier 3: Small Function Additions (15-30 mins)

## Status: PARTIAL

## Items

| #   | File                                                                                             | Gap                          | Status  |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------- | ------- |
| 1   | `apps/mobile-notifications-service/src/domain/notifications/usecases/getDistinctFilterValues.ts` | Lines 27-33 (7 lines)        | ✅ Done |
| 2   | `apps/mobile-notifications-service/src/routes/notificationRoutes.ts`                             | Lines 302-313 (11 lines)     | Pending |
| 3   | `apps/whatsapp-service/src/workers/cleanupWorker.ts`                                             | Lines 71, 106-119 (15 lines) | ✅ Done |

## Completed Work

### Item 1: getDistinctFilterValues.ts

- Added tests to `usecases.test.ts`
- Tests cover success path, empty result, and error handling

### Item 3: cleanupWorker.ts

- Added emulator mode tests
- Tests cover topic/subscription creation when they don't exist
- Tests cover skipping creation when they already exist
- Enhanced mock to support `topic()` method with `exists()` and `create()`

## Verification

```bash
npx vitest run apps/mobile-notifications-service/src/__tests__/usecases.test.ts
npx vitest run apps/whatsapp-service/src/__tests__/workers/cleanupWorker.test.ts
```
