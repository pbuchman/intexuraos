# 3-0: Test Coverage

**Tier:** 3 (Documentation/Verification)

**Depends on:** All Tier 1 and Tier 2 tasks

## Context Snapshot

All code changes must pass tests and meet coverage thresholds.

## Problem Statement

Ensure test coverage is maintained after refactoring.

## Scope

**In scope:**

- Run full test suite
- Verify coverage thresholds
- Update/create fakes for testing
- Fix any test failures

**Out of scope:**

- Documentation (3-1)

## Required Approach

1. Create fake SpeechTranscriptionPort for tests
2. Update existing tests that used SrtServiceClient
3. Add tests for new transcription flow
4. Run coverage and verify thresholds

## Step Checklist

- [ ] Create FakeSpeechTranscriptionPort in test fakes
- [ ] Update webhook route tests
- [ ] Update services.ts tests (if any)
- [ ] Run `npm run test`
- [ ] Run `npm run test:coverage`
- [ ] Verify coverage thresholds met

## Definition of Done

- All tests pass
- Coverage thresholds met
- Fake implementation available for testing

## Verification Commands

```bash
npm run test
npm run test:coverage
npm run ci
```

## Rollback Plan

If tests fail due to missing coverage:

1. Identify uncovered code
2. Add tests or mark as justified exclusion
3. Re-run coverage
