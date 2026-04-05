# V8-Ignore Audit: INT-1236 — github-event-parser.ts

**Audited by:** INT-1236
**Date:** 2026-04-04
**Result:** Both blocks valid, no changes needed

## Block 1 — Lines 614-616

| Field            | Value                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Category         | `ts-type`                                                                                                                          |
| Code             | `typeof cs['url'] === 'string' ? cs['url'] : null`                                                                                 |
| Comment          | `typeof narrowing on unknown check_suite field -- cs['url'] fallback unreachable when GitHub always provides string url @preserve` |
| Blocker keywords | narrowing, fallback, unreachable, always provided                                                                                  |
| Valid            | Yes                                                                                                                                |

## Block 2 — Lines 680-688

| Field            | Value                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category         | `ts-type`                                                                                                                                                                       |
| Code             | `prMergedAt/createdAt` typeof + instanceof narrowing chains                                                                                                                     |
| Comment          | `typeof and instanceof narrowing on unknown payload fields -- prMergedAt/createdAt type coercion branches unreachable when test fixtures always provide Date objects @preserve` |
| Blocker keywords | narrowing, unreachable, test fixtures always                                                                                                                                    |
| Valid            | Yes                                                                                                                                                                             |

## CI Evidence

- `pnpm run verify:v8-ignore -- --no-overrides` passed (0 errors for this file)
- `pnpm run verify:workspace:tracked code-agent` passed (14488 tests)
