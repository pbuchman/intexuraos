# Tier 1: Quick Fixes (Single Line/Branch)

## Status: COMPLETED

## Items

| #   | File                                                           | Gap                         | Status               |
| --- | -------------------------------------------------------------- | --------------------------- | -------------------- |
| 1   | `packages/common-core/src/encryption.ts`                       | Line 41 (catch non-Error)   | ❌ Unreachable       |
| 2   | `apps/whatsapp-service/src/signature.ts`                       | Line 64 (catch invalid hex) | ❌ Unreachable       |
| 3   | `apps/user-service/src/domain/settings/utils/maskApiKey.ts`    | Line 15 branch              | ✅ Done              |
| 4   | `packages/infra-notion/src/notion.ts`                          | Line 100 branch             | Skipped              |
| 5   | `apps/user-service/src/routes/oauthRoutes.ts`                  | Line 162 branch             | Skipped              |
| 6   | `apps/mobile-notifications-service/src/routes/statusRoutes.ts` | Line 91 branch              | ❌ TypeScript safety |
| 7   | `packages/http-server/src/validation-handler.ts`               | Line 51 branch              | Skipped              |

## Notes

- Some branches are unreachable due to Node.js behavior (Buffer.from doesn't throw)
- Some branches are TypeScript safety checks (`noUncheckedIndexedAccess`)
- Created `maskApiKey.test.ts` for item #3

## Verification

```bash
npx vitest run apps/user-service/src/__tests__/utils/maskApiKey.test.ts
```
