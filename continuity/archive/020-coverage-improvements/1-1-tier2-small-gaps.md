# Tier 2: Small Gaps (2-5 lines each)

## Status: BLOCKED (Defensive Code)

Most items are defensive code patterns that are unreachable or impractical to test.

## Items

| #   | File                                                  | Coverage      | Gap      | Uncovered      | Status  | Reason                                                  |
| --- | ----------------------------------------------------- | ------------- | -------- | -------------- | ------- | ------------------------------------------------------- |
| 1   | `apps/user-service/src/routes/deviceRoutes.ts`        | 93.33% branch | 2 lines  | Lines 95, 211  | Blocked | Validation error handling - tested elsewhere            |
| 2   | `apps/user-service/src/routes/tokenRoutes.ts`         | 91.66% branch | 1 line   | Line 102       | Blocked | Validation error handling                               |
| 3   | `apps/whatsapp-service/src/routes/messageRoutes.ts`   | 95% branch    | 2 lines  | Lines 184, 191 | Blocked | noUncheckedIndexedAccess guards                         |
| 4   | `apps/whatsapp-service/src/routes/webhookRoutes.ts`   | 93.68% branch | 1 line   | Line 177       | Blocked | Validation error handling                               |
| 5   | `apps/whatsapp-service/src/routes/mappingRoutes.ts`   | 96.29% branch | 1 branch | Line 127       | Blocked | noUncheckedIndexedAccess guard                          |
| 6   | `packages/http-server/src/health.ts`                  | 91.66% funcs  | 2 lines  | Lines 87, 125  | Blocked | Timeout callback + empty catch marked `istanbul ignore` |
| 7   | `packages/infra-notion/src/notion.ts`                 | 98.27% branch | 1 branch | Line 100       | Blocked | Defensive null check                                    |
| 8   | `apps/user-service/src/routes/llmKeysRoutes.ts`       | 94.82% branch | 1 branch | Line 390       | Blocked | noUncheckedIndexedAccess guard                          |
| 9   | `apps/user-service/src/routes/oauthRoutes.ts`         | 98% branch    | 1 branch | Line 162       | Blocked | Defensive error handling                                |
| 10  | `apps/user-service/src/infra/firestore/encryption.ts` | 92.3% branch  | 1 line   | Line 70        | Blocked | noUncheckedIndexedAccess after length check             |

## Verification

```bash
npx vitest run --coverage apps/user-service/src/__tests__/routes.test.ts
npx vitest run --coverage packages/http-server/src/__tests__/health.test.ts
```
