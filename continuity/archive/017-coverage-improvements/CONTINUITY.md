# Coverage Improvements - Continuity Ledger

## Goal

Improve coverage to meet 95% thresholds for lines, statements, functions, and branches.

## Current Status (Dec 31, 2025)

| Metric     | Before | After  | Target | Status  |
| ---------- | ------ | ------ | ------ | ------- |
| Lines      | 93.84% | 98.48% | 95%    | ✅ PASS |
| Statements | 93.58% | 98.38% | 95%    | ✅ PASS |
| Functions  | 94.19% | 98.89% | 95%    | ✅ PASS |
| Branches   | 92.11% | 96.33% | 95%    | ✅ PASS |

## Subtask Registry

| File                               | Status      | Description              |
| ---------------------------------- | ----------- | ------------------------ |
| `1-0-tier1-quick-fixes.md`         | ✅ Complete | Single line/branch fixes |
| `1-1-tier2-small-gaps.md`          | ⏳ Partial  | 2-5 line gaps            |
| `1-2-tier3-small-functions.md`     | ⏳ Partial  | Small function additions |
| `1-3-tier4-larger-efforts.md`      | ⏳ Partial  | 30+ min efforts          |
| `2-0-remaining-branch-coverage.md` | ⏳ Pending  | Final 0.82% gap          |

## Done

1. ✅ Created `userSettingsRepository.test.ts` - covered 143 lines
2. ✅ Enhanced `FakeFirestore` for `FieldValue.delete()` and nested fields
3. ✅ Added emulator mode tests for `cleanupWorker`
4. ✅ Added `getDistinctFilterValues` usecase tests
5. ✅ Added `maskApiKey` utility tests
6. ✅ Added `internalRoutes` tests for auth and error handling
7. ✅ Added `auth0Client` tests for missing description fallbacks
8. ✅ Added `messageRoutes` tests for transcription/linkPreview branches
9. ✅ Added factory function tests for notion-service usecases
10. ✅ Rewrote `promptApi.test.ts` for new architecture - 44 tests, covered all branches

## Now

✅ **COMPLETE** - All thresholds met!

## Next

Archive to `continuity/archive/017-coverage-improvements/`

## Key Decisions

- FakeFirestore needed enhancement to support `FieldValue.delete()` sentinel
- Some code is unreachable (defensive catch blocks, Fastify schema validation)
- `promptApi.ts` tests are deprecated/skipped - needs architectural decision

## Blockers

~~1. `promptApi.ts` tests are skipped~~ ✅ **RESOLVED** - Rewrote tests for new architecture 2. Some catch blocks are unreachable (URL parsing, Buffer.from behavior) - minor impact 3. Fastify schema validation runs before handler code - minor impact 4. opengraphFetcher.ts lines 60, 70, 85 - catch blocks for invalid URL parsing - minor impact

## Open Questions

~~1. Should we unskip `promptApi.ts` tests or rewrite them for new architecture?~~ ✅ **RESOLVED** - Rewrote them 2. Should we exclude unreachable defensive code from coverage? - Not needed, we're above threshold
