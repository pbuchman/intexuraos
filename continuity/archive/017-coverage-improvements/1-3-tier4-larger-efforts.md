# Tier 4: Larger Efforts (30+ mins)

## Status: PARTIAL

## Items

| #   | File                                                                                       | Gap             | Status      |
| --- | ------------------------------------------------------------------------------------------ | --------------- | ----------- |
| 1   | `apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts` | ~20 lines       | Pending     |
| 2   | `apps/promptvault-service/src/infra/notion/promptApi.ts`                                   | 55.91% branches | **BLOCKED** |
| 3   | `apps/user-service/src/infra/firestore/userSettingsRepository.ts`                          | 143 lines       | ✅ Done     |

## Completed Work

### Item 3: userSettingsRepository.ts

- Created `userSettingsRepository.test.ts` with 17 tests
- Enhanced `FakeFirestore` to support:
  - `FieldValue.delete()` sentinel detection
  - Nested field paths (e.g., `llmApiKeys.google`)
  - `setNestedField()` and `deleteNestedField()` helpers
- Tests cover:
  - `getSettings` (success, not found, with llmApiKeys, with llmTestResults, error)
  - `saveSettings` (new, with keys, error)
  - `updateLlmApiKey` (new user, existing user, error)
  - `deleteLlmApiKey` (delete key, delete with test result, error)
  - `updateLlmTestResult` (new user, existing user, error)

## Blocked Items

### Item 2: promptApi.ts

- Tests are marked as `describe.skip('promptApi (deprecated tests)')`
- 44 tests are skipped
- Comment says: "The new architecture uses notionServiceClient parameter and promptVaultSettingsRepository"
- **Decision needed:** Rewrite tests or delete them?

## Verification

```bash
npx vitest run apps/user-service/src/__tests__/infra/userSettingsRepository.test.ts
```
