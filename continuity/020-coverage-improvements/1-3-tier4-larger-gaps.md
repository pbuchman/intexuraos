# Tier 4: Larger Coverage Gaps (30+ mins)

## Status: PENDING

Files with significant coverage gaps requiring more substantial test additions.

## Items

| # | File | Coverage | Gap | Uncovered Lines | Status |
|---|------|----------|-----|-----------------|--------|
| 1 | `apps/promptvault-service/src/infra/notion/promptApi.ts` | 93.54% branch | Multiple branches | 348-358, 366-382 | Pending |

## Verification

```bash
npx vitest run --coverage apps/promptvault-service/src/__tests__/infra/promptApi.test.ts
```

## Notes

The promptApi.ts file has complex branching logic for parsing Notion API responses. Need to add test cases for edge cases in the response parsing.
