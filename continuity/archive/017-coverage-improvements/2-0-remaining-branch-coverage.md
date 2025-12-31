# Tier 2: Remaining Branch Coverage (0.82% gap)

## Status: PENDING

## Goal

Close the 0.82% gap to reach 95% branch coverage threshold.

## Priority Items (Highest Impact)

| #   | File               | Current | Gap  | Effort | Notes                            |
| --- | ------------------ | ------- | ---- | ------ | -------------------------------- |
| 1   | `promptApi.ts`     | 55.91%  | ~44% | High   | Tests skipped/deprecated         |
| 2   | `messageRoutes.ts` | 91.66%  | 8%   | Medium | transcription/linkPreview fields |
| 3   | `deviceRoutes.ts`  | 93.33%  | 7%   | Low    | Lines 95, 211                    |
| 4   | `tokenRoutes.ts`   | 91.66%  | 8%   | Low    | Fastify validates first          |
| 5   | `webhookRoutes.ts` | 93.68%  | 6%   | Low    | Line 177                         |

## Recommended Actions

### Option A: Fix promptApi.ts (Best ROI)

1. Investigate why tests are skipped
2. Either unskip and fix, or rewrite for new architecture
3. This alone could add ~2-3% branch coverage

### Option B: Cover messageRoutes.ts optional fields

1. Add messages with `transcription` field to fake
2. Add messages with `linkPreview` field to fake
3. Test that these fields appear in response

### Option C: Cover remaining route error paths

1. Some paths are blocked by Fastify schema validation
2. May need to bypass Fastify and test handlers directly

## Files Modified in This Session

1. `packages/infra-firestore/src/testing/firestoreFake.ts` - Enhanced
2. `apps/user-service/src/__tests__/infra/userSettingsRepository.test.ts` - Created
3. `apps/user-service/src/__tests__/utils/maskApiKey.test.ts` - Created
4. `apps/whatsapp-service/src/__tests__/workers/cleanupWorker.test.ts` - Updated
5. `apps/mobile-notifications-service/src/__tests__/usecases.test.ts` - Updated
6. `apps/notion-service/src/__tests__/internalRoutes.test.ts` - Updated
7. `apps/notion-service/src/__tests__/fakes.ts` - Updated
8. `apps/user-service/src/__tests__/infra/auth0Client.test.ts` - Updated

## Verification

```bash
npm run test:coverage
# Should show branches >= 95%
```
