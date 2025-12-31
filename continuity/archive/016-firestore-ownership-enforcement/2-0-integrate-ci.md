# 2-0: Integrate into CI

**Tier**: 2 (Integration)
**Dependencies**: 1-0, 1-1

## Problem

Validation must run automatically on every commit to prevent violations.

## Scope

Add validation script to `npm run ci` pipeline.

## Steps

- [ ] Add `verify:firestore` script to package.json
- [ ] Add to `ci` pipeline after `verify:common`
- [ ] Test CI passes with current code
- [ ] Verify violation blocks CI (manual test)

## Definition of Done

- `npm run verify:firestore` command exists
- Runs as part of `npm run ci`
- CI fails if violations detected
- CI passes with current codebase

## Verification

```bash
npm run verify:firestore
# Should pass

npm run ci
# Should include firestore validation and pass
```
