# Tier 1: Quick Fixes (< 5 mins each)

## Status: PENDING

Single line/branch coverage gaps that can be fixed with minimal test additions.

## Items

| # | File | Coverage | Gap | Uncovered | Status |
|---|------|----------|-----|-----------|--------|
| 1 | `packages/common-core/src/encryption.ts` | 95.83% | 1 line | Line 41 (encrypt catch) | Pending |
| 2 | `apps/whatsapp-service/src/signature.ts` | 91.66% | 1 line | Line 64 (catch branch) | Pending |
| 3 | `packages/llm-audit/src/audit.ts` | 95.45% branch | 1 branch | Line 145 (undefined value in loop) | Pending |
| 4 | `apps/commands-router/src/infra/gemini/classifier.ts` | 86.36% branch | 1 line | Line 122 | Pending |
| 5 | `apps/commands-router/src/routes/statusRoutes.ts` | 91.66% branch | 1 branch | Line 91 | Pending |
| 6 | `apps/promptvault-service/src/routes/promptRoutes.ts` | 97.22% branch | 1 line | Line 281 | Pending |

## Verification

```bash
npx vitest run --coverage packages/common-core/src/__tests__/encryption.test.ts
npx vitest run --coverage apps/whatsapp-service/src/__tests__/signature.test.ts
npx vitest run --coverage packages/llm-audit/src/__tests__/audit.test.ts
```
