# Tier 2: Small Gap Fixes (2-5 lines)

## Status: PARTIAL

## Items

| #   | File                                                                      | Gap                     | Status                 |
| --- | ------------------------------------------------------------------------- | ----------------------- | ---------------------- |
| 1   | `packages/http-server/src/health.ts`                                      | Lines 72, 110           | ❌ Timeout/unreachable |
| 2   | `apps/user-service/src/routes/deviceRoutes.ts`                            | Lines 95, 211           | Pending                |
| 3   | `apps/notion-service/src/routes/internalRoutes.ts`                        | Lines 16-17, 77         | ✅ Done                |
| 4   | `apps/whatsapp-service/src/infra/linkpreview/opengraphFetcher.ts`         | Lines 60, 70, 85        | Pending                |
| 5   | `apps/notion-service/src/domain/integration/usecases/connectNotion.ts`    | Line 124                | Pending                |
| 6   | `apps/notion-service/src/domain/integration/usecases/disconnectNotion.ts` | Line 61                 | Pending                |
| 7   | `apps/notion-service/src/domain/integration/usecases/getNotionStatus.ts`  | Line 63                 | Pending                |
| 8   | `apps/whatsapp-service/src/routes/messageRoutes.ts`                       | Lines 191, 209-211, 216 | Pending                |
| 9   | `apps/user-service/src/infra/auth0/client.ts`                             | Lines 102-108           | ✅ Done                |

## Completed Work

### Item 3: internalRoutes.ts

- Added test for `INTEXURAOS_INTERNAL_AUTH_TOKEN` not configured
- Added test for `isConnected` failure
- Added `setFailNextIsConnected` to FakeConnectionRepository

### Item 9: auth0/client.ts

- Added test for `invalid_grant` without `error_description`
- Added test for other errors without `error_description`

## Verification

```bash
npx vitest run apps/notion-service/src/__tests__/internalRoutes.test.ts
npx vitest run apps/user-service/src/__tests__/infra/auth0Client.test.ts
```
