# Tier 1: Quick Fixes (< 5 mins each)

## Status: BLOCKED (Defensive Code)

These items are defensive code patterns that are unreachable or impractical to test.

## Items

| #   | File                                                  | Coverage      | Gap      | Uncovered                          | Status  | Reason |
| --- | ----------------------------------------------------- | ------------- | -------- | ---------------------------------- | ------- | ------ |
| 1   | `packages/common-core/src/encryption.ts`              | 95.83%        | 1 line   | Line 41 (encrypt catch)            | Blocked | Crypto ops don't throw in normal use |
| 2   | `apps/whatsapp-service/src/signature.ts`              | 91.66%        | 1 line   | Line 64 (catch branch)             | Blocked | Buffer.from doesn't throw on invalid hex |
| 3   | `packages/llm-audit/src/audit.ts`                     | 95.45% branch | 1 branch | Line 145 (undefined value in loop) | Blocked | Object.entries never returns undefined values |
| 4   | `apps/commands-router/src/infra/gemini/classifier.ts` | 86.36% branch | 1 line   | Line 122                           | Blocked | JSON.parse of `{...}` always returns object |
| 5   | `apps/mobile-notifications-service/src/routes/statusRoutes.ts` | 91.66% branch | 1 branch | Line 91       | Blocked | noUncheckedIndexedAccess guard |
| 6   | `apps/promptvault-service/src/routes/promptRoutes.ts` | 97.22% branch | 1 line   | Line 281                           | Blocked | Validation tested elsewhere |

## Verification

```bash
npx vitest run --coverage packages/common-core/src/__tests__/encryption.test.ts
npx vitest run --coverage apps/whatsapp-service/src/__tests__/signature.test.ts
npx vitest run --coverage packages/llm-audit/src/__tests__/audit.test.ts
```
