# Tier 2: Small Gaps (2-5 lines each)

## Status: PENDING

Files with 2-5 uncovered lines or branch conditions.

## Items

| #   | File                                                  | Coverage      | Gap      | Uncovered      | Status  |
| --- | ----------------------------------------------------- | ------------- | -------- | -------------- | ------- |
| 1   | `apps/user-service/src/routes/deviceRoutes.ts`        | 93.33% branch | 2 lines  | Lines 95, 211  | Pending |
| 2   | `apps/user-service/src/routes/tokenRoutes.ts`         | 91.66% branch | 1 line   | Line 102       | Pending |
| 3   | `apps/whatsapp-service/src/routes/messageRoutes.ts`   | 95% branch    | 2 lines  | Lines 184, 191 | Pending |
| 4   | `apps/whatsapp-service/src/routes/webhookRoutes.ts`   | 93.68% branch | 1 line   | Line 177       | Pending |
| 5   | `apps/whatsapp-service/src/routes/mappingRoutes.ts`   | 96.29% branch | 1 branch | Line 127       | Pending |
| 6   | `packages/http-server/src/health.ts`                  | 91.66% funcs  | 2 lines  | Lines 87, 125  | Pending |
| 7   | `packages/infra-notion/src/notion.ts`                 | 98.27% branch | 1 branch | Line 100       | Pending |
| 8   | `apps/user-service/src/routes/llmKeysRoutes.ts`       | 94.82% branch | 1 branch | Line 390       | Pending |
| 9   | `apps/user-service/src/routes/oauthRoutes.ts`         | 98% branch    | 1 branch | Line 162       | Pending |
| 10  | `apps/user-service/src/infra/firestore/encryption.ts` | 92.3% branch  | 1 line   | Line 70        | Pending |

## Verification

```bash
npx vitest run --coverage apps/user-service/src/__tests__/routes.test.ts
npx vitest run --coverage packages/http-server/src/__tests__/health.test.ts
```
